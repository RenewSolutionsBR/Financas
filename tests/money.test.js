import { describe, it, assertEqual } from './harness.js';
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
});
