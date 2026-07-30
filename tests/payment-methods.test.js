import { describe, it, assert, assertEqual } from './harness.js';
import {
  TIPOS_FORMA, DEFAULT_PAYMENT_METHODS, conciliaComDoTipo,
  validatePaymentMethod, formaPorPrefixoExtrato, novaForma,
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

  it('o seed não traz nenhuma conta amarrada, por ser dado pessoal', () => {
    assert(DEFAULT_PAYMENT_METHODS.every((p) => !p.contaPadraoId));
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
    // "DEBITO AUT." casa débito automático; "DEBITO AUT. FATURA CARTAO" é mais
    // longo e precisa vencer, senão o pagamento de fatura vira débito comum.
    const forma = formaPorPrefixoExtrato('DEBITO AUT. CTA ENERGIA ELETRICA   Concessionaria', todas);
    assertEqual(forma.tipo, 'debito');
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
