import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  computeParcelaKey, computeParcelaGroups, syncPredictions, autoConfirmParcelas,
  splitParcelas, findParcelaDuplicates,
} from '../src/domain/parcelas.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

describe('parcelas: computeParcelaKey', () => {
  it('normaliza a descricao (maiuscula, sem espaco duplo) antes de compor a chave', () => {
    assertEqual(
      computeParcelaKey('  loja   exemplo  ', '2026-06-01', 3),
      computeParcelaKey('LOJA EXEMPLO', '2026-06-01', 3)
    );
  });

  it('descricoes diferentes geram chaves diferentes', () => {
    assert(computeParcelaKey('LOJA A', '2026-06-01', 3) !== computeParcelaKey('LOJA B', '2026-06-01', 3));
  });
});

describe('parcelas: splitParcelas (divisao por centavos, resto nas primeiras)', () => {
  it('divide exato quando o total e multiplo de n', () => {
    assertDeepEqual(splitParcelas(300, 3), [100, 100, 100]);
  });

  it('resto de centavos vai pras PRIMEIRAS parcelas, uma unidade de centavo cada', () => {
    // 100,00 / 3 = 33,33333... -> 33,34 + 33,33 + 33,33 (resto de 1 centavo na primeira)
    assertDeepEqual(splitParcelas(100, 3), [33.34, 33.33, 33.33]);
  });

  it('soma das parcelas bate EXATO com o total, centavo a centavo — sem residuo de ponto flutuante', () => {
    const vals = splitParcelas(999.97, 7);
    // Soma cada parcela JA em centavos inteiros (o que de fato seria gravado/exibido),
    // em vez de somar os floats brutos e arredondar so no final. A segunda forma foi
    // MEDIDA como vacua para a sabotagem "divisao float direta" (troca a aritmetica de
    // centavos por total/n cru): o residuo de uma divisao float direta, em qualquer
    // total/n de escala monetaria plausivel, fica bem abaixo de meio centavo, entao um
    // unico arredondamento no fim NUNCA acusa a sabotagem (so passaria a acusar com
    // totais na casa de dezenas de trilhoes de reais — fora de cogitacao pra este app).
    // Somando centavo a centavo, o residuo de cada parcela sabotada (ex.: 142.85285714...
    // em vez de 142.86/142.85) aparece na soma inteira imediatamente.
    const somaCentavos = vals.reduce((acc, v) => acc + Math.round(v * 100), 0);
    assertEqual(somaCentavos, Math.round(999.97 * 100));
  });
});

describe('parcelas: computeParcelaGroups + syncPredictions', () => {
  const CONTA = 'acc_cartao_1';
  const FORMA = 'pm_credito';

  function rowParcelamento(over) {
    return {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO', data: '2026-04-10',
      vencimento: '2026-05-01', valor: 100, parcela_atual: 1, parcela_total: 3,
      ...over,
    };
  }

  it('gera previsoes para as parcelas RESTANTES, uma por mes, com id determinístico seed_', () => {
    const { toAdd } = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assertEqual(toAdd.length, 2, 'parcela 1/3 ja veio na fatura; restam 2 previsoes (2/3 e 3/3)');
    assert(toAdd.every((t) => t.id.startsWith('seed_')), 'toda previsao usa o namespace seed_');
    assert(toAdd.every((t) => t.previsto === true && t.natureza === 'despesa'), 'previsao e despesa nao efetivada');
    assert(toAdd.every((t) => t.contaId === CONTA && t.formaPagamentoId === FORMA));
    assert(toAdd.every((t) => t.parcela_total === 3), 'parcela_total precisa vir do grupo original (3), nao ser recalculado errado a partir de "remaining"');
    assertDeepEqual(toAdd.map((t) => t.parcela_atual).sort(), [2, 3]);
  });

  it('mesma compra gera o MESMO id de previsao em duas chamadas — idempotencia', () => {
    const r1 = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    const r2 = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assertDeepEqual(r1.toAdd.map((t) => t.id).sort(), r2.toAdd.map((t) => t.id).sort());
  });

  it('previsao sem lancamento real cai em A_CLASSIFICAR; com lancamento real da mesma parcelaKey, herda a categoria dele', () => {
    const key = computeParcelaKey('LOJA EXEMPLO', '2026-04-10', 3);
    const semHistorico = syncPredictions([rowParcelamento()], [], CONTA, FORMA);
    assert(semHistorico.toAdd.every((t) => t.categoria === CATEGORIA_A_CLASSIFICAR));

    const comHistorico = syncPredictions(
      [rowParcelamento()],
      [{ id: 'x', previsto: false, parcelaKey: key, categoria: 'alimentacao' }],
      CONTA, FORMA
    );
    assert(comHistorico.toAdd.every((t) => t.categoria === 'alimentacao'));
  });

  it('duas compras DIFERENTES, mesma descricao e mesmo valor de parcela caindo no mesmo mes, geram ids DISTINTOS — sem isso putMany por id sobrescrevia uma previsao com a outra', () => {
    const compraA = rowParcelamento({ data: '2026-02-10', vencimento: '2026-03-01', parcela_atual: 1, parcela_total: 6 });
    const compraB = rowParcelamento({ data: '2026-04-10', vencimento: '2026-05-01', parcela_atual: 1, parcela_total: 4 });
    const { toAdd } = syncPredictions([compraA, compraB], [], CONTA, FORMA);
    const ids = toAdd.map((t) => t.id);
    assertEqual(new Set(ids).size, ids.length, 'nenhum id colidiu entre as duas compras');
    const porMes = new Map();
    toAdd.forEach((t) => { const chave = t.data.slice(0, 7); porMes.set(chave, (porMes.get(chave) || 0) + 1); });
    assert([...porMes.values()].some((n) => n > 1), 'o cenario precisa ter pelo menos um mes com previsao de AMBAS as compras, senao o teste nao cobre a colisao');
  });

  it('marca pra remover previsoes ANTIGAS (previsto true, sem origemManual) — wipe-and-regenerate', () => {
    const antiga = { id: 'seed_velho', previsto: true, origemManual: false };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [antiga], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, ['seed_velho']);
  });

  it('previsao de parcelamento MANUAL (origemManual true) NUNCA entra na lista de remocao', () => {
    // computeParcelaGroups so enxerga linha de FATURA — uma previsao manual
    // nunca seria regenerada de qualquer forma, entao tem que sobreviver.
    const manual = { id: 'x123', previsto: true, origemManual: true };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [manual], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, []);
  });

  it('lancamento CONFIRMADO (previsto false) nunca entra na lista de remocao', () => {
    const confirmado = { id: 'confirmed_x', previsto: false };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [confirmado], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, []);
  });
});

describe('parcelas: computeParcelaGroups com chave pre-computada (regressao ui/parcelas.js)', () => {
  // Duas parcelas (2/6 e 3/6) da MESMA compra, confirmadas a partir de DUAS
  // faturas diferentes: autoConfirmParcelas grava `data` como a data de CORTE
  // de cada fatura (ver domain/parcelas.js linha ~139), entao as duas
  // transacoes confirmadas tem `data` DIFERENTE mesmo sendo a mesma compra.
  // ui/parcelas.js reconstroi linhas sinteticas a partir dessas transacoes
  // pra alimentar computeParcelaGroups — sem passar a parcelaKey real
  // (already correta e invariante, calculada por autoConfirmParcelas a
  // partir da data de compra ORIGINAL), computeParcelaGroups re-derivava a
  // chave via computeParcelaKey(descricao, data, total), e como `data`
  // diverge entre as duas faturas, as duas parcelas nunca colapsavam num
  // grupo so — a aba Parcelas mostrava DOIS grupos pra uma unica compra.
  it('duas parcelas confirmadas de faturas diferentes (data de corte diferente) colapsam em UM grupo quando a mesma key e passada', () => {
    const key = computeParcelaKey('LOJA EXEMPLO', '2026-02-10', 6);
    const rowParcela2 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-03-28', // data de corte da fatura de marco (nao a data de compra original)
      vencimento: '2026-04-01', valor: 50, parcela_atual: 2, parcela_total: 6, key,
    };
    const rowParcela3 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-04-28', // data de corte da fatura de abril — diferente da de marco
      vencimento: '2026-05-01', valor: 50, parcela_atual: 3, parcela_total: 6, key,
    };
    const groups = computeParcelaGroups([rowParcela2, rowParcela3]);
    assertEqual(groups.length, 1, 'as duas parcelas da mesma compra precisam colapsar num unico grupo');
    assertEqual(groups[0].remaining, 3, 'parcela mais avancada (3/6) manda: restam 3 (4,5,6)');
  });

  it('sem key pre-computada (so `data`, comportamento pre-fix), a mesma situacao NAO colapsa — evidencia do bug original', () => {
    const rowParcela2 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-03-28', vencimento: '2026-04-01', valor: 50, parcela_atual: 2, parcela_total: 6,
    };
    const rowParcela3 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-04-28', vencimento: '2026-05-01', valor: 50, parcela_atual: 3, parcela_total: 6,
    };
    const groups = computeParcelaGroups([rowParcela2, rowParcela3]);
    assertEqual(groups.length, 2, 'sem key estavel, a divergencia de `data` entre faturas gera duas chaves e dois grupos — este e o bug que o fix resolve');
  });
});

describe('parcelas: autoConfirmParcelas', () => {
  const CONTA = 'acc_cartao_1';
  const FORMA = 'pm_credito';
  const key = computeParcelaKey('LOJA EXEMPLO', '2026-04-10', 3);

  function rowParcelamento(over) {
    return {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO', data: '2026-04-10',
      vencimento: '2026-06-01', valor: 33.33, parcela_atual: 2, parcela_total: 3,
      ...over,
    };
  }

  it('parcela_atual > 1 confirma sozinha MESMO SEM candidato previsto', () => {
    const { confirmed, updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(confirmed.length, 1);
    assertEqual(updatedTransactions[0].previsto, false);
    assertEqual(updatedTransactions[0].natureza, 'despesa');
    assert(updatedTransactions[0].id.startsWith('confirmed_'));
  });

  it('parcela_atual === 1 SEM candidato previsto NAO confirma — exige toque manual', () => {
    const row1 = rowParcelamento({ parcela_atual: 1, parcela_total: 3 });
    const { confirmed } = autoConfirmParcelas([row1], [], null, CONTA, FORMA);
    assertEqual(confirmed.length, 0);
  });

  it('confirma usando a data de CORTE da fatura, nao o vencimento, quando o corte e conhecido', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], '2026-05-28', CONTA, FORMA);
    assertEqual(updatedTransactions[0].data, '2026-05-28');
  });

  it('sem corte conhecido, cai no vencimento', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].data, '2026-06-01');
  });

  it('o id confirmado NUNCA reaproveita o id da previsao — namespaces sempre diferentes', () => {
    const previsao = { id: 'seed_algumacoisa', previsto: true, parcelaKey: key, data: '2026-05-30', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const { updatedTransactions, removedIds } = autoConfirmParcelas([rowParcelamento()], [previsao], null, CONTA, FORMA);
    assert(updatedTransactions[0].id !== previsao.id);
    assert(updatedTransactions[0].id.startsWith('confirmed_'));
    assertDeepEqual(removedIds, [previsao.id], 'o id antigo da previsao precisa ser removido explicitamente');
  });

  it('com candidato previsto, escolhe o de data MAIS PROXIMA do vencimento desta fatura entre varios', () => {
    const longe = { id: 'seed_longe', previsto: true, parcelaKey: key, data: '2026-04-01', categoria: 'outros', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const perto = { id: 'seed_perto', previsto: true, parcelaKey: key, data: '2026-05-29', categoria: 'lazer', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [longe, perto], null, CONTA, FORMA);
    // "longe" nao e candidato escolhido: fica intocado na lista (nao e responsabilidade
    // do autoConfirmParcelas limpar previsoes nao usadas, isso e syncPredictions). Por
    // isso localiza a transacao CONFIRMADA em vez de assumir indice fixo no array.
    const confirmada = updatedTransactions.find((t) => t.previsto === false);
    assertEqual(confirmada.categoria, 'lazer', 'devia ter escolhido o candidato mais perto do vencimento (perto), herdando a categoria dele');
  });

  it('sem candidato previsto mas com IRMAO REAL da mesma parcelaKey, herda a categoria do irmao em vez de A_CLASSIFICAR', () => {
    const irmaoReal = { id: 'confirmed_outro', previsto: false, parcelaKey: key, categoria: 'transporte' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [irmaoReal], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, 'transporte');
  });

  it('sem candidato e sem irmao real, cai em A_CLASSIFICAR', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, CATEGORIA_A_CLASSIFICAR);
  });
});

describe('parcelas: findParcelaDuplicates', () => {
  it('acha por identidade EXATA (mesma parcelaKey)', () => {
    const key = computeParcelaKey('LOJA X', '2026-06-01', 4);
    const t = { id: 't1', parcelaKey: key };
    const resultado = findParcelaDuplicates([t], [], 'LOJA X', '2026-06-01', 4, 25);
    assertDeepEqual(resultado.map((r) => r.id), ['t1']);
  });

  it('acha por heuristica fraca: valor <R$0,05, data <=15 dias, descricao por substring bidirecional, so parcela_atual>1', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO XYZ', data: '2026-06-05', valor: 25.02 };
    const key = computeParcelaKey('LOJA EXEMPLO XYZ', '2026-06-05', 4);
    const t = { id: 't1', parcelaKey: key };
    const resultado = findParcelaDuplicates([t], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado.map((r) => r.id), ['t1']);
  });

  it('heuristica fraca IGNORA linha de fatura com parcela_atual === 1', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 1, parcela_total: 4, descricao: 'LOJA EXEMPLO XYZ', data: '2026-06-05', valor: 25.02 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('diferenca de valor >= R$0,05 nao conta como duplicata fraca', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO', data: '2026-06-05', valor: 25.10 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('diferenca de data > 15 dias nao conta como duplicata fraca', () => {
    const rowFatura = { tipo: 'parcelamento', parcela_atual: 2, parcela_total: 4, descricao: 'LOJA EXEMPLO', data: '2026-05-01', valor: 25 };
    const resultado = findParcelaDuplicates([], [rowFatura], 'LOJA EXEMPLO', '2026-06-10', 4, 25);
    assertDeepEqual(resultado, []);
  });

  it('sem nenhuma pista, devolve lista vazia', () => {
    assertDeepEqual(findParcelaDuplicates([], [], 'NADA', '2026-06-10', 2, 10), []);
  });
});
