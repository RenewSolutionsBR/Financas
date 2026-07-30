import { describe, it, assertEqual, assert } from './harness.js';
import { isValidISO, formatDateBR, parseDateBR, addMonthsClamped, diffDays, monthKey, todayISO } from '../src/core/dates.js';

describe('dates', () => {
  it('valida ISO', () => {
    assert(isValidISO('2026-06-30'));
    assert(!isValidISO('30/06/2026'));
    assert(!isValidISO('2026-13-01'));
    assert(!isValidISO(''));
  });

  it('converte entre ISO e BR', () => {
    assertEqual(formatDateBR('2026-06-30'), '30/06/2026');
    assertEqual(parseDateBR('30/06/2026'), '2026-06-30');
    assertEqual(parseDateBR('1/5/2026'), '2026-05-01');
  });

  it('devolve null para data BR inválida', () => {
    assertEqual(parseDateBR('32/01/2026'), null);
    assertEqual(parseDateBR('sem data'), null);
    assertEqual(parseDateBR(''), null);
  });

  // O dia 30 caindo em fevereiro precisa virar 28, nunca escorregar para março:
  // sem isso, duas parcelas seguidas caem no mesmo mês.
  it('soma meses sem estourar para o mês seguinte', () => {
    assertEqual(addMonthsClamped('2026-01-30', 1), '2026-02-28');
    assertEqual(addMonthsClamped('2024-01-30', 1), '2024-02-29');
    assertEqual(addMonthsClamped('2026-06-30', 1), '2026-07-30');
    assertEqual(addMonthsClamped('2026-12-15', 1), '2027-01-15');
  });

  it('conta dias entre datas, sempre positivo', () => {
    assertEqual(diffDays('2026-06-30', '2026-06-28'), 2);
    assertEqual(diffDays('2026-06-28', '2026-06-30'), 2);
    assertEqual(diffDays('2026-06-30', '2026-06-30'), 0);
  });

  it('extrai a chave de mês', () => {
    assertEqual(monthKey('2026-06-30'), '2026-06');
  });

  it('todayISO devolve ISO válido', () => {
    assert(isValidISO(todayISO()));
  });

  it('isValidISO respeita ano bissexto, inclusive a regra de seculo', () => {
    assert(!isValidISO('2026-02-29'));
    assert(isValidISO('2024-02-29'));
    assert(isValidISO('2000-02-29'));
    assert(!isValidISO('1900-02-29'));
  });

  it('addMonthsClamped funciona com n negativo e cruzando ano', () => {
    assertEqual(addMonthsClamped('2026-03-31', -1), '2026-02-28');
    assertEqual(addMonthsClamped('2026-12-31', 2), '2027-02-28');
    assertEqual(addMonthsClamped('2026-01-31', 13), '2027-02-28');
    assertEqual(addMonthsClamped('2026-01-15', -13), '2024-12-15');
  });
});
