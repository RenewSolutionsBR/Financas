import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseLinhasGenerico } from '../src/importers/generic-table.js';

function mapeamentoPadrao() {
  return { colData: 0, colDescricao: 1, colValor: 2, colDocumento: 3, temCabecalho: true, escopo: 'extrato' };
}

describe('generic-table: parseLinhasGenerico', () => {
  const linhas = [
    ['Data', 'Historico', 'Valor', 'Doc'],
    ['01/06/2026', 'Compra Loja X', '-50,00', '111'],
    ['02/06/2026', 'Recebimento Y', '200,00', '222'],
  ];

  it('pula a linha de cabecalho quando temCabecalho e true', () => {
    const { rows } = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2);
  });

  it('nao pula nenhuma linha quando temCabecalho e false', () => {
    const semCabecalho = linhas.slice(1);
    const { rows } = parseLinhasGenerico(semCabecalho, { ...mapeamentoPadrao(), temCabecalho: false }, 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2);
  });

  it('valor negativo vira sinal debito e valor absoluto positivo; positivo vira credito', () => {
    const { rows } = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows[0].sinal, 'debito');
    assertEqual(rows[0].valor, 50);
    assertEqual(rows[1].sinal, 'credito');
    assertEqual(rows[1].valor, 200);
  });

  it('descricaoCanonica usa o escopo do mapeamento', () => {
    const { rows } = parseLinhasGenerico(linhas, { ...mapeamentoPadrao(), escopo: 'fatura' }, 'acc_1', 'generico.csv');
    assertEqual(rows[0].descricaoCanonica, 'COMPRA LOJA X');
  });

  it('linha com data invalida ou valor ilegivel e pulada, com aviso — nao quebra o import inteiro', () => {
    const comLinhaRuim = [...linhas, ['data-invalida', 'Lixo', 'abc', '999']];
    const { rows, avisos } = parseLinhasGenerico(comLinhaRuim, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertEqual(rows.length, 2, 'a linha ruim nao deve gerar linha normalizada');
    assert(avisos.length > 0);
  });

  it('id deterministico entre duas chamadas iguais', () => {
    const r1 = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    const r2 = parseLinhasGenerico(linhas, mapeamentoPadrao(), 'acc_1', 'generico.csv');
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });
});
