import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  TIPO_CONTA, TIPO_CARTAO, validateAccount, suggestMatchers, isAdicional,
  plasticosDoTitular, contaPagadoraEfetiva, contaQueCasaDescricao, novaConta, novoCartao,
  removeAccount,
} from '../src/domain/accounts.js';

const CONTA = { id: 'acc_cc', tipo: TIPO_CONTA, nome: 'Conta Corrente', instituicao: 'Banco X', agencia: '0001', numero: '12345-6' };
const TITULAR = { id: 'acc_t', tipo: TIPO_CARTAO, nome: 'Cartão Titular', instituicao: 'Banco X', bandeira: 'visa', final: '1111', diaVencimento: 30, contaPagadoraId: 'acc_cc', matchers: ['FINAL 1111'] };
const ADICIONAL = { id: 'acc_a', tipo: TIPO_CARTAO, nome: 'Cartão Adicional', instituicao: 'Banco X', bandeira: 'visa', final: '2222', cartaoPaiId: 'acc_t' };
const TODAS = [CONTA, TITULAR, ADICIONAL];

describe('accounts: validação', () => {
  it('exige nome', () => {
    assert(validateAccount({ ...CONTA, id: 'novo', nome: '' }, TODAS).length > 0);
  });

  it('exige final de 4 dígitos em cartão', () => {
    assert(validateAccount({ ...TITULAR, id: 'novo', final: '11' }, TODAS).length > 0);
    assert(validateAccount({ ...TITULAR, id: 'novo', final: 'abcd' }, TODAS).length > 0);
  });

  it('exige agência e número em conta', () => {
    assert(validateAccount({ ...CONTA, id: 'novo', agencia: '' }, TODAS).length > 0);
  });

  it('rejeita cartão adicional que aponta para outro adicional', () => {
    const erros = validateAccount({ ...ADICIONAL, id: 'novo', cartaoPaiId: 'acc_a' }, TODAS);
    assert(erros.some((e) => /adicional/i.test(e)));
  });

  it('rejeita cartão que aponta para si mesmo como pai', () => {
    assert(validateAccount({ ...ADICIONAL, cartaoPaiId: 'acc_a' }, TODAS).length > 0);
  });

  it('rejeita conta pagadora que não é conta', () => {
    const erros = validateAccount({ ...TITULAR, id: 'novo', contaPagadoraId: 'acc_a' }, TODAS);
    assert(erros.some((e) => /conta/i.test(e)));
  });

  it('aceita cadastros válidos', () => {
    assertEqual(validateAccount(CONTA, TODAS).length, 0);
    assertEqual(validateAccount(TITULAR, TODAS).length, 0);
    assertEqual(validateAccount(ADICIONAL, TODAS).length, 0);
  });
});

describe('accounts: titular e adicional', () => {
  it('reconhece o adicional pelo cartaoPaiId', () => {
    assert(isAdicional(ADICIONAL));
    assert(!isAdicional(TITULAR));
    assert(!isAdicional(CONTA));
  });

  it('lista todos os plásticos de um titular, incluindo ele mesmo', () => {
    assertDeepEqual(plasticosDoTitular('acc_t', TODAS).sort(), ['acc_a', 'acc_t']);
  });

  // O adicional não tem conta pagadora própria: quem paga é a do titular.
  it('resolve a conta pagadora do adicional pela do titular', () => {
    assertEqual(contaPagadoraEfetiva(ADICIONAL, TODAS), 'acc_cc');
    assertEqual(contaPagadoraEfetiva(TITULAR, TODAS), 'acc_cc');
    assertEqual(contaPagadoraEfetiva(CONTA, TODAS), null);
  });
});

describe('accounts: matchers', () => {
  it('sugere matcher a partir de bandeira e final', () => {
    const s = suggestMatchers({ tipo: TIPO_CARTAO, bandeira: 'master', final: '7777' });
    assert(s.some((m) => m.includes('7777')));
  });

  it('não sugere matcher para conta corrente', () => {
    assertDeepEqual(suggestMatchers(CONTA), []);
  });

  it('encontra o cartão cujo matcher aparece na descrição do extrato', () => {
    const achado = contaQueCasaDescricao('DEBITO AUT.  FATURA CARTAO VISA    FINAL 1111', TODAS);
    assertEqual(achado.id, 'acc_t');
  });

  it('devolve null quando nenhum matcher casa', () => {
    assertEqual(contaQueCasaDescricao('PIX ENVIADO  Alguem', TODAS), null);
  });
});

describe('accounts: construtores', () => {
  it('novaConta e novoCartao geram id com prefixo próprio', () => {
    assert(novaConta({ nome: 'X' }).id.startsWith('acc_'));
    assertEqual(novoCartao({ nome: 'Y', final: '3333' }).tipo, TIPO_CARTAO);
  });
});

describe('accounts: casos-limite que a suite nao cobria', () => {
  it('rejeita adicional com conta pagadora propria', () => {
    const erros = validateAccount({ ...ADICIONAL, contaPagadoraId: 'acc_cc' }, TODAS);
    assert(erros.some((e) => /pagadora/i.test(e)));
  });

  it('conta pagadora do adicional vem do titular mesmo se o campo proprio estiver preenchido', () => {
    const malformado = { ...ADICIONAL, contaPagadoraId: 'acc_outra' };
    assertEqual(contaPagadoraEfetiva(malformado, TODAS), 'acc_cc');
  });

  it('conta pagadora e null quando o titular referenciado nao existe', () => {
    assertEqual(contaPagadoraEfetiva({ ...ADICIONAL, cartaoPaiId: 'acc_sumiu' }, TODAS), null);
  });

  it('matcher nao casa dentro de um numero maior', () => {
    const cartoes = [{ id: 'c151', tipo: TIPO_CARTAO, final: '0151', matchers: ['FINAL 151'] }];
    assertEqual(contaQueCasaDescricao('DEBITO AUT. FATURA CARTAO FINAL 1511', cartoes), null);
    assertEqual(contaQueCasaDescricao('DEBITO AUT. FATURA CARTAO FINAL 151', cartoes).id, 'c151');
  });

  it('plasticosDoTitular resolve para o titular quando recebe id de adicional', () => {
    assertDeepEqual(plasticosDoTitular('acc_a', TODAS).sort(), ['acc_a', 'acc_t']);
  });

  it('contaQueCasaDescricao tolera descricao nula', () => {
    assertEqual(contaQueCasaDescricao(null, TODAS), null);
  });

  it('o ciclo novoCartao -> matchers sugeridos -> casamento fecha', () => {
    const cartao = novoCartao({ nome: 'Teste', bandeira: 'visa', final: '8421' });
    assertEqual(contaQueCasaDescricao('DEBITO AUT.  FATURA CARTAO VISA    FINAL 8421', [cartao]).id, cartao.id);
  });

  it('novaConta nao carrega matchers, que e campo de cartao', () => {
    assertEqual(novaConta({ nome: 'C' }).matchers, undefined);
  });
});

// (transactions || []) virava lista vazia quando o segundo argumento vinha
// undefined, e a guarda de "em uso" abaixo nunca disparava — uma conta em
// uso era excluida em silencio. O throw acontece antes de qualquer storage,
// entao roda no Node mesmo sem IndexedDB.
describe('accounts: exclusao recusa transactions ausente, para nao silenciar a guarda de em-uso', () => {
  it('lanca quando transactions e undefined', async () => {
    let erro = null;
    try { await removeAccount('acc_x'); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria ter recusado');
    assert(/lançamentos/i.test(erro.message), erro.message);
  });

  it('lanca quando transactions e null', async () => {
    let erro = null;
    try { await removeAccount('acc_x', null); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria ter recusado');
  });
});
