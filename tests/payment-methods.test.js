import { describe, it, assert, assertEqual } from './harness.js';
import {
  TIPOS_FORMA, DEFAULT_PAYMENT_METHODS, conciliaComDoTipo,
  validatePaymentMethod, formaPorPrefixoExtrato, novaForma, removeForma,
} from '../src/domain/payment-methods.js';

describe('payment-methods: seed', () => {
  it('cobre as sete formas do spec', () => {
    assertEqual(DEFAULT_PAYMENT_METHODS.length, 7);
    const tipos = DEFAULT_PAYMENT_METHODS.map((p) => p.tipo);
    for (const t of TIPOS_FORMA.filter((t) => t !== 'outro')) assert(tipos.includes(t));
  });

  it('todo item do seed tem tipo válido e ordem única', () => {
    const ordens = DEFAULT_PAYMENT_METHODS.map((p) => p.ordem);
    assertEqual(new Set(ordens).size, ordens.length);
    assert(DEFAULT_PAYMENT_METHODS.every((p) => TIPOS_FORMA.includes(p.tipo)));
  });
});

describe('payment-methods: comportamento por tipo', () => {
  it('crédito concilia por fatura; débito, pix e boleto por extrato', () => {
    assertEqual(conciliaComDoTipo('credito'), 'fatura');
    assertEqual(conciliaComDoTipo('debito'), 'extrato');
    assertEqual(conciliaComDoTipo('pix'), 'extrato');
    assertEqual(conciliaComDoTipo('boleto'), 'extrato');
    assertEqual(conciliaComDoTipo('transferencia'), 'extrato');
  });

  // Dinheiro não passa por documento nenhum: nunca aparece em fatura nem extrato.
  it('dinheiro não concilia com documento algum', () => {
    assertEqual(conciliaComDoTipo('dinheiro'), 'nenhum');
    assertEqual(conciliaComDoTipo('outro'), 'nenhum');
  });

  it('tipo desconhecido não concilia com nada', () => {
    assertEqual(conciliaComDoTipo('inventado'), 'nenhum');
    assertEqual(conciliaComDoTipo(undefined), 'nenhum');
  });
});

describe('payment-methods: validação', () => {
  const todas = [{ id: 'pm_pix', nome: 'Pix', tipo: 'pix', ordem: 1 }];

  it('exige nome e tipo válido', () => {
    assert(validatePaymentMethod({ id: 'x', nome: '', tipo: 'pix' }, todas).length > 0);
    assert(validatePaymentMethod({ id: 'x', nome: 'X', tipo: 'inexistente' }, todas).length > 0);
  });

  it('rejeita nome repetido, ignorando caixa', () => {
    assert(validatePaymentMethod({ id: 'x', nome: 'pix', tipo: 'pix' }, todas).length > 0);
    assertEqual(validatePaymentMethod({ id: 'pm_pix', nome: 'Pix', tipo: 'pix' }, todas).length, 0);
  });
});

describe('payment-methods: inferência pelo extrato', () => {
  const todas = DEFAULT_PAYMENT_METHODS;

  it('infere a forma pelo prefixo da descrição do extrato', () => {
    assertEqual(formaPorPrefixoExtrato('PIX ENVIADO                 Fulano', todas).tipo, 'pix');
    assertEqual(formaPorPrefixoExtrato('PAGAMENTO DE BOLETO OUTROS BANCOS  Empresa', todas).tipo, 'boleto');
    assertEqual(formaPorPrefixoExtrato('TED RECEBIDA                Empresa', todas).tipo, 'transferencia');
  });

  it('devolve null quando nenhum prefixo casa', () => {
    assertEqual(formaPorPrefixoExtrato('ALGO QUE NAO EXISTE', todas), null);
  });

  it('escolhe o prefixo mais específico quando dois casam', () => {
    // 'DEBITO AUT.' (débito) e 'DEBITO AUT. FATURA' (crédito) casam os dois.
    // Vence o mais longo, senão o pagamento da fatura vira débito comum.
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT.  FATURA CARTAO VISA    FINAL 0000', todas).tipo, 'credito');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', todas).tipo, 'credito');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. CTA ENERGIA ELETRICA   Concessionaria', todas).tipo, 'debito');
  });

  it('o prefixo mais longo vence independente da ordem do array', () => {
    const curta = { id: 'a', nome: 'Curta', tipo: 'debito', padroesExtrato: ['DEBITO AUT.'] };
    const longa = { id: 'b', nome: 'Longa', tipo: 'credito', padroesExtrato: ['DEBITO AUT. FATURA'] };
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FATURA X', [curta, longa]).id, 'b');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FATURA X', [longa, curta]).id, 'b');
  });

  it('forma desativada não classifica', () => {
    const inativa = { id: 'i', nome: 'Inativa', tipo: 'debito', ativo: false, padroesExtrato: ['DEBITO AUT.'] };
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. ALGO', [inativa]), null);
  });

  it('só casa no começo da linha', () => {
    assertEqual(formaPorPrefixoExtrato('PAGTO REF PIX ENVIADO', todas), null);
  });
});

describe('payment-methods: construtor', () => {
  it('novaForma deriva conciliaCom do tipo e põe no fim da ordem', () => {
    const f = novaForma({ nome: 'Vale', tipo: 'outro' }, DEFAULT_PAYMENT_METHODS);
    assertEqual(f.conciliaCom, 'nenhum');
    assertEqual(f.ordem, DEFAULT_PAYMENT_METHODS.length + 1);
    assert(f.id.startsWith('pm_'));
  });
});

describe('payment-methods: exclusão', () => {
  it('recusa excluir forma em uso, dizendo quantos lançamentos usam', async () => {
    const transacoes = [
      { id: 't1', formaPagamentoId: 'pm_pix' },
      { id: 't2', formaPagamentoId: 'pm_pix' },
      { id: 't3', formaPagamentoId: 'pm_boleto' },
    ];
    let erro = null;
    try {
      await removeForma('pm_pix', transacoes);
    } catch (e) {
      erro = e;
    }
    assert(erro !== null, 'deveria ter recusado');
    assert(erro.message.includes('2'), `mensagem não diz quantos: ${erro.message}`);
    assert(/desative/i.test(erro.message), 'mensagem não oferece a saída de desativar');
  });
});
