import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  TIPO_CONTA, TIPO_CARTAO, validateAccount, suggestMatchers, isAdicional,
  plasticosDoTitular, contaPagadoraEfetiva, contaQueCasaDescricao, novaConta, novoCartao,
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
