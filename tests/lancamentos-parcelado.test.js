import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { montarLancamentosParcelados, textoPreviewParcela } from '../src/ui/lancamentos-parcelado.js';
import { computeParcelaKey } from '../src/domain/parcelas.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

function dados(over) {
  return {
    descricao: 'Loja Exemplo', data: '2026-06-10', valorTotal: 300, numParcelas: 3,
    categoria: 'lazer', formaPagamentoId: 'pm_credito', contaId: 'acc_cartao_1',
    ...over,
  };
}

describe('lancamentos-parcelado: montarLancamentosParcelados', () => {
  it('cria N lancamentos, um por mes, com a soma batendo exatamente com o total', () => {
    const lista = montarLancamentosParcelados(dados());
    assertEqual(lista.length, 3);
    const soma = lista.reduce((a, t) => a + t.valor, 0);
    assertEqual(Math.round(soma * 100), 300 * 100);
  });

  it('so a PRIMEIRA parcela vira lancamento real; as demais sao previsto+origemManual', () => {
    const [p1, p2, p3] = montarLancamentosParcelados(dados());
    assertEqual(p1.previsto, undefined, 'parcela 1 nao tem a chave previsto — e um lancamento real desde o inicio');
    assertEqual(p2.previsto, true);
    assertEqual(p2.origemManual, true);
    assertEqual(p3.previsto, true);
    assertEqual(p3.origemManual, true);
  });

  it('todas compartilham a MESMA parcelaKey e o mesmo grupo_parcela', () => {
    const lista = montarLancamentosParcelados(dados());
    const key = computeParcelaKey('Loja Exemplo', '2026-06-10', 3);
    assert(lista.every((t) => t.parcelaKey === key));
    assert(lista.every((t) => t.grupo_parcela === lista[0].grupo_parcela));
  });

  it('parcela_atual/parcela_total numerados corretamente, datas um mes depois da outra', () => {
    const lista = montarLancamentosParcelados(dados());
    assertDeepEqual(lista.map((t) => t.parcela_atual), [1, 2, 3]);
    assert(lista.every((t) => t.parcela_total === 3));
    assertDeepEqual(lista.map((t) => t.data), ['2026-06-10', '2026-07-10', '2026-08-10']);
  });

  it('so a parcela 2+ ganha o sufixo "(parcela prevista)" na descricao', () => {
    const [p1, p2] = montarLancamentosParcelados(dados());
    assertEqual(p1.descricao, 'Loja Exemplo');
    assertEqual(p2.descricao, 'Loja Exemplo (parcela prevista)');
  });

  it('todas natureza despesa, origem manual, mesma conta/forma do formulario', () => {
    const lista = montarLancamentosParcelados(dados());
    assert(lista.every((t) => t.natureza === 'despesa' && t.origem === 'manual'));
    assert(lista.every((t) => t.formaPagamentoId === 'pm_credito' && t.contaId === 'acc_cartao_1'));
  });

  it('ids sao todos distintos entre si', () => {
    const lista = montarLancamentosParcelados(dados());
    assertEqual(new Set(lista.map((t) => t.id)).size, 3);
  });

  it('dia 31 clampado corretamente ao virar mes mais curto (fevereiro)', () => {
    const lista = montarLancamentosParcelados(dados({ data: '2026-01-31', numParcelas: 3 }));
    assertDeepEqual(lista.map((t) => t.data), ['2026-01-31', '2026-02-28', '2026-03-31']);
  });
});

describe('lancamentos-parcelado: textoPreviewParcela', () => {
  it('formata Nx de R$Y (total R$Z) quando valor e parcelas são válidos', () => {
    const texto = textoPreviewParcela(1200, 6);
    assertEqual(texto, '6x de R$ 200,00 (total R$ 1.200,00) — um lançamento por mês a partir da data escolhida.');
  });

  it('divide por centavos, primeira parcela absorve o resto', () => {
    const texto = textoPreviewParcela(100, 3);
    assertEqual(texto, '3x de R$ 33,34 (total R$ 100,00) — um lançamento por mês a partir da data escolhida.');
  });

  it('devolve null quando valor total é inválido', () => {
    assertEqual(textoPreviewParcela(null, 6), null);
    assertEqual(textoPreviewParcela(NaN, 6), null);
  });

  it('devolve null quando número de parcelas é menor que 2', () => {
    assertEqual(textoPreviewParcela(1200, 1), null);
    assertEqual(textoPreviewParcela(1200, 0), null);
    assertEqual(textoPreviewParcela(1200, null), null);
  });
});
