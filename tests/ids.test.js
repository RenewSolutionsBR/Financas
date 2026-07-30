import { describe, it, assert, assertEqual } from './harness.js';
import { uid, slugId, stableHash } from '../src/core/ids.js';

describe('ids', () => {
  it('uid começa com o prefixo e não repete', () => {
    const a = uid('acc');
    const b = uid('acc');
    assert(a.startsWith('acc_'));
    assert(a !== b);
  });

  it('slugId troca não-alfanumérico por sublinhado', () => {
    assertEqual(slugId('PADARIA DO JOÃO|2026-06-30|3'), 'PADARIA_DO_JO_O_2026_06_30_3');
  });

  // O hash é a identidade da linha importada: reimportar um extrato com período
  // sobreposto precisa gerar exatamente os mesmos ids, senão duplica tudo.
  it('stableHash é determinístico e sensível a cada parte', () => {
    const a = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 3]);
    const b = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 3]);
    const c = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 4]);
    assertEqual(a, b);
    assert(a !== c);
  });

  it('stableHash nao colide quando as partes contem espaco', () => {
    // O caso que o separador precisa cobrir: a fronteira entre duas partes se
    // desloca, mas a concatenacao dos textos fica igual. Descricao de extrato
    // tem espaco em quase toda linha ("PIX ENVIADO", "ENEL ENERGIA").
    assert(stableHash(['a b', 'c']) !== stableHash(['a', 'b c']));
    assert(
      stableHash(['acc1', '2026-06-30', '-95.83', 'PIX ENVIADO', 'JOAO', 3]) !==
      stableHash(['acc1', '2026-06-30', '-95.83', 'PIX', 'ENVIADO JOAO', 3])
    );
    assert(stableHash(['ab', 'c']) !== stableHash(['a', 'bc']));
  });

  it('stableHash aceita partes que nao sao string', () => {
    assertEqual(typeof stableHash([1, 2, 3]), 'string');
    assertEqual(stableHash([]).length, 8);
    assert(stableHash([null, undefined, 'x']) !== stableHash(['', '', 'x']));
  });
});
