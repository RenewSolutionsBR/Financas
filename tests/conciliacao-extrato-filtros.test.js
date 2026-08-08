import { describe, it, assertEqual } from './harness.js';
import { filtrarPorNaturezaEForma, tituloBaldeNaoLancado } from '../src/ui/conciliacao-extrato.js';

const extrairDePar = (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId });
const extrairDeTransaction = (t) => ({ natureza: t.natureza, formaPagamentoId: t.formaPagamentoId });
const extrairDeLinha = (l) => ({ natureza: l.natureza, formaPagamentoId: null });

describe('conciliacao-extrato: filtrarPorNaturezaEForma', () => {
  const pares = [
    { app: { natureza: 'despesa', formaPagamentoId: 'pm_pix' } },
    { app: { natureza: 'receita', formaPagamentoId: 'pm_pix' } },
    { app: { natureza: 'despesa', formaPagamentoId: 'pm_dinheiro' } },
  ];

  it('sem filtro nenhum, devolve tudo', () => {
    const r = filtrarPorNaturezaEForma(pares, {}, extrairDePar);
    assertEqual(r.length, 3);
  });

  it('filtra por natureza', () => {
    const r = filtrarPorNaturezaEForma(pares, { natureza: 'despesa' }, extrairDePar);
    assertEqual(r.length, 2);
  });

  it('filtra por forma de pagamento', () => {
    const r = filtrarPorNaturezaEForma(pares, { formaPagamentoId: 'pm_pix' }, extrairDePar);
    assertEqual(r.length, 2);
  });

  it('combina natureza E forma (AND, nao OR)', () => {
    const r = filtrarPorNaturezaEForma(pares, { natureza: 'despesa', formaPagamentoId: 'pm_pix' }, extrairDePar);
    assertEqual(r.length, 1);
  });

  it('funciona com transactions cruas (appUnmatched)', () => {
    const transacoes = [{ natureza: 'despesa', formaPagamentoId: 'pm_pix' }, { natureza: 'receita', formaPagamentoId: 'pm_pix' }];
    const r = filtrarPorNaturezaEForma(transacoes, { natureza: 'receita' }, extrairDeTransaction);
    assertEqual(r.length, 1);
  });

  it('funciona com linhas de extrato cru (sem forma) — filtro de forma nao exclui nada quando extrairForma devolve null', () => {
    const linhas = [{ natureza: 'despesa' }, { natureza: 'transferencia' }];
    const r = filtrarPorNaturezaEForma(linhas, { formaPagamentoId: 'pm_pix' }, extrairDeLinha);
    assertEqual(r.length, 2, 'linha crua nao tem forma ainda — filtro de forma so vale para itens que a extraem de verdade');
  });
});

describe('conciliacao-extrato: tituloBaldeNaoLancado', () => {
  it('sem filtro ativo, mostra so a contagem (mesmo se coincidir com o total)', () => {
    assertEqual(tituloBaldeNaoLancado(5, 5, false), 'No extrato, não lançado no app (5)');
  });

  it('com filtro ativo e contagem igual ao total, ainda mostra "de X" (filtro pode ter sido esquecido)', () => {
    assertEqual(tituloBaldeNaoLancado(5, 5, true), 'No extrato, não lançado no app (5 de 5)');
  });

  it('com filtro ativo reduzindo a contagem, mostra "X de Y" — evita 0 enganoso', () => {
    assertEqual(tituloBaldeNaoLancado(0, 3, true), 'No extrato, não lançado no app (0 de 3)');
  });
});
