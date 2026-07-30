import { describe, it, assertEqual, assert } from './harness.js';
import { fmtBRL, parseMoneyBR, round2 } from '../src/core/money.js';

describe('money', () => {
  it('formata em real brasileiro', () => {
    assertEqual(fmtBRL(1234.5), 'R$ 1.234,50');
    assertEqual(fmtBRL(0), 'R$ 0,00');
    assertEqual(fmtBRL(-7781.06), 'R$ -7.781,06');
  });

  it('lê valores no formato do extrato', () => {
    assertEqual(parseMoneyBR('-7.781,06'), -7781.06);
    assertEqual(parseMoneyBR('1.149,81'), 1149.81);
    assertEqual(parseMoneyBR('0,25'), 0.25);
    assertEqual(parseMoneyBR('R$ 60,80'), 60.8);
  });

  it('devolve null para o que não é valor', () => {
    assertEqual(parseMoneyBR(''), null);
    assertEqual(parseMoneyBR('   '), null);
    assertEqual(parseMoneyBR(null), null);
    assertEqual(parseMoneyBR('abc'), null);
  });

  it('arredonda para duas casas sem erro de ponto flutuante', () => {
    assertEqual(round2(0.1 + 0.2), 0.3);
    assertEqual(round2(1.005), 1.01);
  });

  it('round2 zera o residuo de ponto flutuante em vez de virar NaN', () => {
    assertEqual(round2(0.1 + 0.2 - 0.3), 0);
    assertEqual(round2(2.0000000000000004 - 2), 0);
    assertEqual(round2(1e-7), 0);
  });

  it('round2 trata negativo igual ao positivo no meio centavo', () => {
    assertEqual(round2(-1.005), -1.01);
    assertEqual(round2(-0.125), -0.13);
    assertEqual(round2(2.675), 2.68);
    assertEqual(round2(39233.185), 39233.19);
  });

  it('round2 devolve NaN para o que nao e numero', () => {
    assert(Number.isNaN(round2('abc')));
    assert(Number.isNaN(round2(Infinity)));
  });

  it('parseMoneyBR aceita as formas que o extrato produz', () => {
    assertEqual(parseMoneyBR('0,25 '), 0.25);
    assertEqual(parseMoneyBR('1.000'), 1000);
    assertEqual(parseMoneyBR('1.234.567,89'), 1234567.89);
    assertEqual(parseMoneyBR('1000,5'), 1000.5);
  });

  it('parseMoneyBR recusa ponto decimal ambiguo em vez de errar por 100x', () => {
    assertEqual(parseMoneyBR('12.30'), null);
    assertEqual(parseMoneyBR('.5'), null);
    assertEqual(parseMoneyBR('1.23.456'), null);
  });
});
