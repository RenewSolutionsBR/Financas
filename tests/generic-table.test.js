import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseLinhasGenerico, parseParcela, periodoDoStatement } from '../src/importers/generic-table.js';

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

// Coluna de parcela: antes de v21 o adaptador cravava parcela_atual/
// parcela_total em null, entao uma compra parcelada vinda de planilha nunca
// gerava as previsoes dos meses seguintes — o dado sumia em silencio.
describe('generic-table: coluna de parcela (modelo de planilha)', () => {
  it('parseParcela le "3/10" e "3 de 10"', () => {
    assertDeepEqual(parseParcela('3/10'), { atual: 3, total: 10 });
    assertDeepEqual(parseParcela('3 de 10'), { atual: 3, total: 10 });
    assertDeepEqual(parseParcela(' 03/10 '), { atual: 3, total: 10 });
  });

  it('celula vazia nao e parcelamento nem erro (compra a vista)', () => {
    assertDeepEqual(parseParcela(''), { atual: null, total: null });
    assertDeepEqual(parseParcela(null), { atual: null, total: null });
  });

  it('parcela impossivel ("7/5", "0/5") e tratada como invalida, nao como parcelamento torto', () => {
    assert(parseParcela('7/5').invalido === true);
    assert(parseParcela('0/5').invalido === true);
    assert(parseParcela('abc').invalido === true);
  });

  it('linha com parcela recebe tipo "parcelamento" — sem isso o commit ignora a parcela', () => {
    // autoConfirmParcelas e syncPredictions (domain/parcelas.js) filtram por
    // `tipo === 'parcelamento'`; ler a coluna sem marcar o tipo nao bastaria.
    const comParcela = [
      ['Data', 'Descricao', 'Valor', 'Parcela'],
      ['01/07/2026', 'Geladeira', '-200,00', '3/10'],
      ['02/07/2026', 'Cafe', '-9,00', ''],
    ];
    const mapa = { colData: 0, colDescricao: 1, colValor: 2, colParcela: 3, colDocumento: null, temCabecalho: true, escopo: 'fatura' };
    const { rows } = parseLinhasGenerico(comParcela, mapa, 'acc_1', 'modelo.xlsx');
    assertEqual(rows[0].parcela_atual, 3);
    assertEqual(rows[0].parcela_total, 10);
    assertEqual(rows[0].tipo, 'parcelamento');
    assertEqual(rows[1].parcela_atual, null);
    assertEqual(rows[1].tipo, null, 'compra a vista nao vira parcelamento');
  });

  it('parcela ilegivel gera aviso e a linha entra como compra a vista', () => {
    const comLixo = [
      ['Data', 'Descricao', 'Valor', 'Parcela'],
      ['01/07/2026', 'Geladeira', '-200,00', 'tres de dez'],
    ];
    const mapa = { colData: 0, colDescricao: 1, colValor: 2, colParcela: 3, colDocumento: null, temCabecalho: true, escopo: 'fatura' };
    const { rows, avisos } = parseLinhasGenerico(comLixo, mapa, 'acc_1', 'modelo.xlsx');
    assertEqual(rows.length, 1, 'a linha nao e descartada');
    assertEqual(rows[0].tipo, null);
    assertEqual(avisos.length, 1);
    assert(avisos[0].includes('Parcela ilegível'), avisos[0]);
  });
});

// Mesmo bug corrigido em lancamentos-xlsx.js (2026-08-13, planilha real do
// usuario): preencher a data como DATA DE VERDADE no Excel fazia a linha ser
// ignorada, enquanto digitar como texto funcionava.
describe('generic-table: celula de data e de valor vindas do Excel (nao texto)', () => {
  const mapa = { colData: 0, colDescricao: 1, colValor: 2, colDocumento: null, colParcela: 3, temCabecalho: true, escopo: 'fatura' };
  const cab = ['Data', 'Descricao', 'Valor', 'Parcela'];

  it('aceita objeto Date na coluna de data', () => {
    const { rows, avisos } = parseLinhasGenerico([cab, [new Date(2026, 6, 5), 'Teste', '-30,30', '']], mapa, 'acc_1', 'x.xlsx');
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(rows[0].data, '2026-07-05', '5 de julho, nao 7 de maio');
  });

  it('data como Date usa componentes locais — nunca recua um dia por fuso', () => {
    const { rows } = parseLinhasGenerico([cab, [new Date(2026, 0, 1), 'Ano novo', '-10,00', '']], mapa, 'acc_1', 'x.xlsx');
    assertEqual(rows[0].data, '2026-01-01');
  });

  it('aceita valor numerico puro (celula formatada como numero no Excel)', () => {
    const { rows, avisos } = parseLinhasGenerico([cab, ['05/07/2026', 'Teste', -30.3, '']], mapa, 'acc_1', 'x.xlsx');
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(rows[0].valor, 30.3);
    assertEqual(rows[0].sinal, 'debito', 'numero negativo continua sendo saida');
  });

  it('"3/10" que o Excel converteu em data vira aviso, nao parcelamento inventado', () => {
    const { rows, avisos } = parseLinhasGenerico([cab, ['05/07/2026', 'Loja', '-200,00', new Date(2026, 9, 3)]], mapa, 'acc_1', 'x.xlsx');
    assertEqual(rows.length, 1, 'a linha entra como compra a vista');
    assertEqual(rows[0].tipo, null);
    assertEqual(avisos.length, 1);
    assert(avisos[0].includes('Parcela ilegível'), avisos[0]);
  });
});

// Colisao de id: idDeterministicoDoDocumento monta `contaId|tipo|vencimento
// ||periodoFim`. O adaptador generico nao preenchia nenhum dos dois, entao
// TODA planilha da mesma conta gerava `contaId|fatura|undefined` — importar
// junho substituia maio em silencio.
describe('generic-table: periodo do statement (evita colisao de id)', () => {
  it('fatura usa o vencimento informado na tela de importacao', () => {
    const p = periodoDoStatement({ escopo: 'fatura', vencimento: '2026-07-10' }, []);
    assertEqual(p.vencimento, '2026-07-10');
  });

  it('extrato deriva o periodo do intervalo real coberto pelas linhas', () => {
    const rows = [{ data: '2026-06-15' }, { data: '2026-06-01' }, { data: '2026-06-30' }];
    const p = periodoDoStatement({ escopo: 'extrato' }, rows);
    assertEqual(p.periodoInicio, '2026-06-01');
    assertEqual(p.periodoFim, '2026-06-30');
  });

  it('duas faturas de meses diferentes deixam de colidir no mesmo id', () => {
    const idDe = (s) => `acc_visa|fatura|${s.vencimento || s.periodoFim}`;
    const maio = periodoDoStatement({ escopo: 'fatura', vencimento: '2026-05-10' }, []);
    const junho = periodoDoStatement({ escopo: 'fatura', vencimento: '2026-06-10' }, []);
    assert(idDe(maio) !== idDe(junho), 'ids precisam diferir, senao junho sobrescreve maio');
  });

  it('dois extratos de meses diferentes tambem deixam de colidir', () => {
    const idDe = (s) => `acc_cc|extrato|${s.vencimento || s.periodoFim}`;
    const maio = periodoDoStatement({ escopo: 'extrato' }, [{ data: '2026-05-01' }, { data: '2026-05-31' }]);
    const junho = periodoDoStatement({ escopo: 'extrato' }, [{ data: '2026-06-01' }, { data: '2026-06-30' }]);
    assert(idDe(maio) !== idDe(junho));
  });
});
