import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  computeParcelaKey, computeParcelaGroups, syncPredictions, autoConfirmParcelas,
  splitParcelas, findParcelaDuplicates, parcelaGroupsDaConta, outrasParcelasParaAtualizar,
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

  it('a PRIMEIRA previsao restante cai no MESMO mes civil do vencimento desta linha, nunca pula pro mes seguinte', () => {
    // Bug real de producao: duas faturas consecutivas podem vencer no MESMO
    // mes civil (ex.: 01/03 e 30/03) — se a previsao da parcela seguinte
    // sempre pulasse pro mes civil seguinte ao vencimento mais recente, o
    // mes da PROXIMA fatura real ficava sem NENHUMA entrada (a previsao
    // antiga daquele mes ja tinha sido removida pela confirmacao que acabou
    // de acontecer) ate essa fatura chegar — usuario via o mes "vazio" na
    // aba Lancamentos entre duas importacoes.
    const row = rowParcelamento({ vencimento: '2026-03-01', parcela_atual: 2, parcela_total: 10 });
    const { toAdd } = syncPredictions([row], [], CONTA, FORMA);
    const primeiraRestante = toAdd.find((t) => t.parcela_atual === 3);
    assertEqual(primeiraRestante.data.slice(0, 7), '2026-03', 'a parcela 3/10 precisa cair em marco (mesmo mes do vencimento desta linha), nao abril');
  });

  it('computeParcelaGroups SEM o parametro novo (ou com primeiraNoMesmoMes:true) mantem o comportamento atual — nenhuma regressao no fluxo de importacao', () => {
    const row = rowParcelamento({ vencimento: '2026-03-01', parcela_atual: 2, parcela_total: 10 });
    const gruposDefault = computeParcelaGroups([row]);
    const gruposExplicito = computeParcelaGroups([row], { primeiraNoMesmoMes: true });
    assertEqual(gruposDefault[0].months[0].ym, '2026-03', 'default continua "mesmo mes" — comportamento ja validado para importacao');
    assertEqual(gruposExplicito[0].months[0].ym, '2026-03');
  });

  it('computeParcelaGroups com primeiraNoMesmoMes:false comeca no mes SEGUINTE ao vencimento', () => {
    const row = rowParcelamento({ vencimento: '2026-03-01', parcela_atual: 2, parcela_total: 10 });
    const grupos = computeParcelaGroups([row], { primeiraNoMesmoMes: false });
    assertEqual(grupos[0].months[0].ym, '2026-04', 'com o novo parametro false, pula pro mes seguinte (marco ja foi pago)');
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

  it('marca pra remover previsoes ANTIGAS da MESMA compra (previsto true, sem origemManual) — wipe-and-regenerate', () => {
    const key = computeParcelaKey('LOJA EXEMPLO', '2026-04-10', 3);
    const antiga = { id: 'seed_velho', previsto: true, origemManual: false, parcelaKey: key };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [antiga], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, ['seed_velho']);
  });

  it('NAO remove previsao de compra alheia — bug real (2026-08-14): reimportar um documento que substitui outro apagava previsoes de OUTRA compra parcelada da mesma conta, so por nao estar mencionada no arquivo novo', () => {
    const outraCompra = { id: 'seed_outra', previsto: true, origemManual: false, parcelaKey: computeParcelaKey('OUTRA LOJA', '2026-01-01', 6) };
    const { toRemoveIds } = syncPredictions([rowParcelamento()], [outraCompra], CONTA, FORMA);
    assertDeepEqual(toRemoveIds, [], 'a previsao de uma compra nao mencionada nas linhas desta importacao tem que sobreviver');
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

  it('grupo expoe parcelaAtual e valor da parcela mais avancada — sem isso a tela nao tinha como mostrar "parcela X de Y" pra quem esta na parcela 1/n (fora de months, que so mostra as RESTANTES)', () => {
    const key = computeParcelaKey('LOJA EXEMPLO', '2026-02-10', 6);
    const rowParcela2 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-03-28', vencimento: '2026-04-01', valor: 50, parcela_atual: 2, parcela_total: 6, key,
    };
    const rowParcela3 = {
      tipo: 'parcelamento', descricao: 'LOJA EXEMPLO',
      data: '2026-04-28', vencimento: '2026-05-01', valor: 50, parcela_atual: 3, parcela_total: 6, key,
    };
    const groups = computeParcelaGroups([rowParcela2, rowParcela3]);
    assertEqual(groups[0].parcelaAtual, 3, 'a mais avancada das duas (3/6) e a que representa o estado atual do grupo');
    assertEqual(groups[0].valor, 50);
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
    const previsao = { id: 'seed_algumacoisa', previsto: true, parcelaKey: key, parcela_atual: 2, data: '2026-05-30', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const { updatedTransactions, removedIds } = autoConfirmParcelas([rowParcelamento()], [previsao], null, CONTA, FORMA);
    assert(updatedTransactions[0].id !== previsao.id);
    assert(updatedTransactions[0].id.startsWith('confirmed_'));
    assertDeepEqual(removedIds, [previsao.id], 'o id antigo da previsao precisa ser removido explicitamente');
  });

  it('com candidato previsto, escolhe o de data MAIS PROXIMA do vencimento desta fatura entre varios', () => {
    // Ambas as previsoes precisam ter o MESMO parcela_atual da linha da
    // fatura (2, o padrao de rowParcelamento): candidatos so podem ser da
    // MESMA parcela que a linha representa, nunca de uma parcela diferente
    // da mesma compra — sem isso, uma previsao de OUTRA parcela (ex.: 4/5)
    // podia ser "roubada" como candidata de uma linha que na verdade
    // representa a parcela 2/5, bug real visto em producao.
    const longe = { id: 'seed_longe', previsto: true, parcelaKey: key, parcela_atual: 2, data: '2026-04-01', categoria: 'outros', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const perto = { id: 'seed_perto', previsto: true, parcelaKey: key, parcela_atual: 2, data: '2026-05-29', categoria: 'lazer', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [longe, perto], null, CONTA, FORMA);
    // "longe" nao e candidato escolhido: fica intocado na lista (nao e responsabilidade
    // do autoConfirmParcelas limpar previsoes nao usadas, isso e syncPredictions). Por
    // isso localiza a transacao CONFIRMADA em vez de assumir indice fixo no array.
    const confirmada = updatedTransactions.find((t) => t.previsto === false);
    assertEqual(confirmada.categoria, 'lazer', 'devia ter escolhido o candidato mais perto do vencimento (perto), herdando a categoria dele');
  });

  it('candidato previsto de OUTRA parcela da mesma compra (parcelaKey igual, parcela_atual diferente) NUNCA e "roubado" como candidato desta linha', () => {
    // Bug real de producao: uma linha de fatura representando a parcela 2/5
    // "roubava" a previsao seed da parcela 4/5 (mesma parcelaKey, MESMA
    // compra, mas parcela_atual DIFERENTE) como se fosse o candidato certo
    // a confirmar — a previsao errada virava confirmada com o numero da
    // parcela ERRADO, e a parcela 2/5 de verdade (lancamento manual ou outra
    // previsao) ficava sem candidato algum, gerando confirmacao duplicada.
    const previsaoDeOutraParcela = { id: 'seed_parcela_4', previsto: true, parcelaKey: key, parcela_atual: 4, data: '2026-04-01', categoria: 'outros', descricao: 'LOJA EXEMPLO (parcela prevista)' };
    // rowParcelamento() representa a parcela_atual 2 (padrao) — sem candidato
    // de parcela_atual 2 disponivel, mas parcela_atual > 1, confirma sozinha
    // (regra ja existente), SEM tocar na previsao da parcela 4.
    const { updatedTransactions, confirmed } = autoConfirmParcelas([rowParcelamento()], [previsaoDeOutraParcela], null, CONTA, FORMA);
    assertEqual(updatedTransactions.length, 2, 'a previsao da parcela 4 fica intocada, e a parcela 2 (row) confirma como uma transacao SEPARADA');
    const previsaoIntocada = updatedTransactions.find((t) => t.id === 'seed_parcela_4');
    assert(previsaoIntocada, 'a previsao da parcela 4 nao pode ser removida nem alterada por uma linha que representa a parcela 2');
    assertEqual(previsaoIntocada.previsto, true);
    const novaConfirmada = updatedTransactions.find((t) => t.id !== 'seed_parcela_4');
    assertEqual(novaConfirmada.parcela_atual, 2, 'a nova confirmada precisa ser a parcela 2 (da row), nunca herdar o numero 4 da previsao errada');
    assertEqual(novaConfirmada.categoria, CATEGORIA_A_CLASSIFICAR, 'sem candidato nem irmao real da MESMA parcela, cai em A_CLASSIFICAR — nao herda categoria de uma previsao de parcela diferente');
    assertEqual(confirmed.length, 1);
  });

  it('sem candidato previsto mas com IRMAO REAL de OUTRA parcela da mesma compra (parcela_atual diferente), herda a categoria mas cria uma transacao SEPARADA pra esta parcela', () => {
    // parcela_atual 1 != row.parcela_atual (2 por padrao) — irmaoReal aqui e
    // uma parcela DIFERENTE da mesma compra (ex.: 1/3 ja confirmada antes),
    // nao a mesma linha que row representa. Precisa herdar a categoria dela
    // (mesmo raciocinio de sempre), mas SEM reaproveitar o id: sao parcelas
    // diferentes, cada uma com seu proprio registro.
    const irmaoReal = { id: 'confirmed_outro', previsto: false, parcelaKey: key, parcela_atual: 1, categoria: 'transporte' };
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [irmaoReal], null, CONTA, FORMA);
    assertEqual(updatedTransactions.length, 2, 'irmaoReal (parcela 1) permanece intocado, e a parcela 2 (row) vira uma transacao NOVA e separada');
    const novaConfirmada = updatedTransactions.find((t) => t.id !== irmaoReal.id);
    assertEqual(novaConfirmada.categoria, 'transporte', 'herda a categoria do irmao mesmo sendo parcela diferente');
    assertEqual(novaConfirmada.parcela_atual, 2);
    assert(novaConfirmada.id.startsWith('confirmed_'), 'parcela diferente do irmao real NUNCA reaproveita o id dele');
  });

  it('sem candidato previsto mas com IRMAO REAL da MESMA parcelaKey e MESMO parcela_atual (a propria parcela ja lancada manualmente), ATUALIZA o registro existente em vez de duplicar', () => {
    // Bug real de producao: reimportar a mesma fatura (ou uma 2a fatura que
    // ainda traz a MESMA parcela) criava uma transacao confirmed_... NOVA do
    // zero quando ja existia um lancamento manual real com essa parcela —
    // o manual ficava "solto" (nunca marcado como usado, reaparecia em "No
    // app, nao na fatura") e a nova confirmada virava uma copia duplicada em
    // "Conciliado automaticamente".
    const irmaoReal = { id: 'tx_manual_parcela_2', previsto: false, parcelaKey: key, parcela_atual: 2, categoria: 'transporte' };
    const { updatedTransactions, confirmed } = autoConfirmParcelas([rowParcelamento()], [irmaoReal], null, CONTA, FORMA);
    assertEqual(updatedTransactions.length, 1, 'nao pode duplicar: so 1 transacao no resultado, o irmaoReal ATUALIZADO');
    assertEqual(updatedTransactions[0].id, 'tx_manual_parcela_2', 'reaproveita o id do lancamento manual existente, nunca cria confirmed_... novo');
    assertEqual(updatedTransactions[0].categoria, 'transporte');
    assertEqual(updatedTransactions[0].previsto, false);
    assertEqual(confirmed.length, 1);
  });

  it('sem candidato e sem irmao real, cai em A_CLASSIFICAR', () => {
    const { updatedTransactions } = autoConfirmParcelas([rowParcelamento()], [], null, CONTA, FORMA);
    assertEqual(updatedTransactions[0].categoria, CATEGORIA_A_CLASSIFICAR);
  });

  it('transacao confirmada grava faturaVencimento com o vencimento REAL da fatura, alem de data=dataCorte', () => {
    const row = { tipo: 'parcelamento', descricao: 'LOJA TESTE', data: '2025-10-01', parcela_atual: 4, parcela_total: 9, valor: 100, vencimento: '2026-01-30' };
    const { confirmed } = autoConfirmParcelas([row], [], '2025-12-23', 'acc_1', 'pm_credito');
    assertEqual(confirmed.length, 1);
    assertEqual(confirmed[0].after.data, '2025-12-23', 'data continua sendo a dataCorte, sem mudanca de comportamento ja aceito');
    assertEqual(confirmed[0].after.faturaVencimento, '2026-01-30', 'faturaVencimento e o vencimento real da fatura, campo novo');
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

describe('parcelas: parcelaGroupsDaConta (reconstroi grupos a partir de TRANSACTIONS, usado pela aba Parcelas)', () => {
  const CONTA = 'acc_cartao_teste';

  it('compra nova (so previsoes, nenhuma confirmada) usa a previsao de MENOR parcela_atual como ancora — nao a ultima, que zeraria "remaining" e sumiria o grupo', () => {
    const key = computeParcelaKey('LOJA NOVA', '2026-08-01', 5);
    const previsoes = [2, 3, 4, 5].map((n) => ({
      id: `seed_${n}`, previsto: true, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA NOVA (parcela prevista)', data: `2026-${String(8 + n - 1).padStart(2, '0')}-01`,
      parcela_atual: n, parcela_total: 5, valor: 100,
    }));
    const grupos = parcelaGroupsDaConta(previsoes, CONTA);
    assertEqual(grupos.length, 1, 'a compra tem que aparecer como 1 grupo, nao sumir por causa da previsao mais avancada (5/5, remaining=0)');
    assertEqual(grupos[0].parcelaAtual, 2, 'ancora e a previsao de MENOR parcela_atual (2/5) — a proxima a vencer');
    assertEqual(grupos[0].remaining, 3);
  });

  it('com uma confirmada (parcela 2/5) e previsoes restantes (3/5..5/5), a ancora e a CONFIRMADA — nunca uma previsao', () => {
    const key = computeParcelaKey('LOJA MISTA', '2026-08-01', 5);
    const confirmada = {
      id: 'confirmed_x', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA MISTA', data: '2026-09-01', parcela_atual: 2, parcela_total: 5, valor: 100,
    };
    const previsoes = [3, 4, 5].map((n) => ({
      id: `seed_${n}`, previsto: true, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA MISTA (parcela prevista)', data: `2026-${String(8 + n - 1).padStart(2, '0')}-01`,
      parcela_atual: n, parcela_total: 5, valor: 100,
    }));
    const grupos = parcelaGroupsDaConta([confirmada, ...previsoes], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].parcelaAtual, 2, 'a confirmada (2/5) e a ancora, mesmo com previsoes de numero maior (3,4,5) tambem presentes');
    assertEqual(grupos[0].remaining, 3);
  });

  it('duas confirmadas da mesma compra (faturas diferentes): a ancora e a de MAIOR parcela_atual entre as confirmadas', () => {
    const key = computeParcelaKey('LOJA DUAS FATURAS', '2026-02-10', 6);
    const confirmada2 = {
      id: 'confirmed_2', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA DUAS FATURAS', data: '2026-03-28', parcela_atual: 2, parcela_total: 6, valor: 50,
    };
    const confirmada3 = {
      id: 'confirmed_3', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA DUAS FATURAS', data: '2026-04-28', parcela_atual: 3, parcela_total: 6, valor: 50,
    };
    const grupos = parcelaGroupsDaConta([confirmada2, confirmada3], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].parcelaAtual, 3, 'entre confirmadas, vence a de maior parcela_atual (3/6) — a mais recente');
    assertEqual(grupos[0].remaining, 3);
  });

  it('transaction de OUTRO cartao (contaId diferente) nao entra no grupo desta conta', () => {
    const key = computeParcelaKey('LOJA OUTRA CONTA', '2026-08-01', 3);
    const t = { id: 'confirmed_y', previsto: false, parcelaKey: key, contaId: 'acc_outro_cartao', descricao: 'LOJA OUTRA CONTA', data: '2026-08-01', parcela_atual: 1, parcela_total: 3, valor: 30 };
    assertDeepEqual(parcelaGroupsDaConta([t], CONTA), []);
  });

  it('usa faturaVencimento (nao data=dataCorte) como ancora, E comeca no MES SEGUINTE ao vencimento (nao no mesmo mes) — fix definitivo: mes ja pago nao aparece mais como parcela futura', () => {
    const key = computeParcelaKey('LOJA VENCIMENTO', '2025-10-01', 9);
    // Cenario real do usuario: fatura vence 30/01/2026 e confirma a parcela
    // 4/9. O mes de JANEIRO (mes do vencimento desta fatura) JA FOI PAGO —
    // a primeira parcela RESTANTE (5/9) precisa cair em FEVEREIRO, nao em
    // janeiro. Confirmado pelo usuario: fatura de 30/06/2026 traz a ultima
    // parcela (9/9), entao fevereiro..junho sao os 5 meses restantes.
    const confirmada = {
      id: 'confirmed_z', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA VENCIMENTO', data: '2025-12-23', faturaVencimento: '2026-01-30',
      parcela_atual: 4, parcela_total: 9, valor: 100,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 5, 'restam 5 parcelas (5/9 a 9/9)');
    assertEqual(grupos[0].months[0].ym, '2026-02', 'a primeira parcela restante (5/9) cai em FEVEREIRO — o mes de janeiro (vencimento desta fatura) ja foi pago, nao pode aparecer como restante');
    assertEqual(grupos[0].months[0].numero, 5);
    assertEqual(grupos[0].months[4].ym, '2026-06', 'a ultima parcela restante (9/9) cai em junho — fevereiro a junho sao os 5 meses seguintes a janeiro, confirmado pelo usuario via fatura real de 30/06 trazendo 9/9');
  });

  it('sem faturaVencimento (transacao confirmada ANTES do fix, ou lancamento manual), cai no fallback t.data — mas AINDA ASSIM comeca no mes seguinte, ja que a ancora e uma transacao CONFIRMADA (o mesmo fix definitivo se aplica a esse fallback)', () => {
    const key = computeParcelaKey('LOJA SEM VENCIMENTO', '2026-01-01', 4);
    const confirmada = {
      id: 'confirmed_w', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA SEM VENCIMENTO', data: '2026-02-15',
      parcela_atual: 2, parcela_total: 4, valor: 50,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].months[0].ym, '2026-03', 'sem faturaVencimento, usa t.data como antes (fallback, sem migracao retroativa) — mas por ser ancora CONFIRMADA, o mes de t.data (fevereiro) ja foi pago, entao a primeira parcela restante cai em marco');
  });

  it('ancora CONFIRMADA que OMITE a chave `previsto` (formato real de parcelamento manual, i===0, ver ui/lancamentos-parcelado.js) ainda comeca no mes SEGUINTE, nao reverte ao default "mesmo mes"', () => {
    // Parcelamento MANUAL cria a parcela 1 sem a chave `previsto` no objeto
    // (nao `previsto: false`, a chave simplesmente nao existe) — t.previsto
    // fica `undefined`. Sem coercao pra booleano estrito, `undefined` cai no
    // default de desestruturacao de computeParcelaGroups (`= true`), fazendo
    // o mes da propria parcela 1 (ja "paga", e a ancora confirmada) reaparecer
    // como parcela futura — o mesmo bug que o fix de faturaVencimento
    // corrigiu para faturas importadas, mas ainda presente aqui.
    const key = computeParcelaKey('LOJA PARCELAMENTO MANUAL', '2026-08-01', 4);
    const confirmadaSemPrevisto = {
      id: 'tx_manual_1', parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA PARCELAMENTO MANUAL', data: '2026-08-01',
      parcela_atual: 1, parcela_total: 4, valor: 50,
      // sem `previsto` de proposito — replica o objeto real de
      // lancamentos-parcelado.js (i===0), que nunca inclui essa chave.
    };
    const grupos = parcelaGroupsDaConta([confirmadaSemPrevisto], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 3, 'restam 3 parcelas (2/4, 3/4, 4/4)');
    assertEqual(grupos[0].months[0].ym, '2026-09', 'primeira parcela restante cai no mes SEGUINTE ao vencimento da ancora (agosto ja "pago"), nao em agosto de novo');
  });

  it('ancora sendo uma PREVISAO (so ha previsoes pra essa parcelaKey) tambem cai no fallback t.data — e isso e o comportamento ESPERADO, nao um bug latente', () => {
    // Previsoes NUNCA tem faturaVencimento (so autoConfirmParcelas grava esse
    // campo, e so em confirmadas), entao a ancora prevista sempre passa pelo
    // mesmo fallback `t.data` do teste acima. A diferenca e que aqui isso e
    // seguro por construcao: `data` de uma previsao ja e o mes sintetico
    // `ym + '-01'' gravado por syncPredictions, nao uma dataCorte de fatura —
    // entao nao ha risco de "mes errado" equivalente ao bug que faturaVencimento
    // corrigiu para transacoes confirmadas.
    const key = computeParcelaKey('LOJA SO PREVISAO', '2026-08-01', 5);
    const previsao = {
      id: 'seed_1', previsto: true, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA SO PREVISAO (parcela prevista)', data: '2026-09-01', // mes sintetico (ym + '-01')
      parcela_atual: 2, parcela_total: 5, valor: 40,
    };
    const grupos = parcelaGroupsDaConta([previsao], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].months[0].ym, '2026-09', 'previsao sem faturaVencimento usa t.data (o mes sintetico), que ja e o vencimento projetado correto');
  });

  it('ancora confirmada SEM origem de autoConfirmParcelas (ex.: salva via "+lancar" manual) tambem usa faturaVencimento quando presente', () => {
    // Replica o formato exato que lancamentos-form.js agora grava quando o
    // rascunho do "+lancar" (conciliacao-fatura.js) carrega faturaVencimento:
    // previsto: false (novaTransaction sempre grava esse campo explicitamente),
    // data = data da COMPRA (nao vencimento), faturaVencimento = vencimento
    // real da fatura que o usuario clicou "+lancar".
    const transactions = [{
      id: 'tx_lancar_manual_1', descricao: 'LOJA EXEMPLO', data: '2025-12-22',
      faturaVencimento: '2026-01-30', valor: 157.51,
      parcela_atual: 1, parcela_total: 4, parcelaKey: computeParcelaKey('LOJA EXEMPLO', '2025-12-22', 4),
      previsto: false, contaId: 'acc_1',
    }];
    const grupos = parcelaGroupsDaConta(transactions, 'acc_1');
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 3);
    // Ancora confirmada -> mes SEGUINTE ao vencimento (fevereiro), nao o mes
    // da data de compra (dezembro) nem o mesmo mes do vencimento (janeiro).
    assertEqual(grupos[0].months[0].ym, '2026-02');
    assertEqual(grupos[0].months[2].ym, '2026-04');
  });

  it('grupo cuja ancora e uma PREVISAO (nenhuma transacao confirmada pra essa parcelaKey) marca ancoraNaoConfirmada: true', () => {
    const key = computeParcelaKey('LOJA SO PREVISAO ANCORA', '2026-08-01', 5);
    const previsao = {
      id: 'seed_ancora_1', previsto: true, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA SO PREVISAO ANCORA (parcela prevista)', data: '2026-09-01',
      parcela_atual: 2, parcela_total: 5, valor: 40,
    };
    const grupos = parcelaGroupsDaConta([previsao], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].ancoraNaoConfirmada, true, 'ancora prevista significa data estimada, precisa avisar o usuario');
  });

  it('grupo cuja ancora e uma transacao CONFIRMADA marca ancoraNaoConfirmada: false', () => {
    const key = computeParcelaKey('LOJA CONFIRMADA ANCORA', '2026-01-01', 4);
    const confirmada = {
      id: 'confirmed_ancora_1', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA CONFIRMADA ANCORA', data: '2026-01-25',
      faturaVencimento: '2026-01-30', parcela_atual: 2, parcela_total: 4, valor: 100,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].ancoraNaoConfirmada, false, 'ancora confirmada significa vencimento real, nao precisa avisar');
  });
});

describe('parcelas: outrasParcelasParaAtualizar', () => {
  const key = computeParcelaKey('LOJA X', '2026-01-01', 3);
  const p1 = { id: 't1', previsto: false, parcelaKey: key, categoria: 'a_classificar', parcela_atual: 1 };
  const p2 = { id: 't2', previsto: false, parcelaKey: key, categoria: 'a_classificar', parcela_atual: 2 };
  const p3 = { id: 't3', previsto: false, parcelaKey: key, categoria: 'a_classificar', parcela_atual: 3 };

  it('acha as outras parcelas confirmadas da mesma compra com categoria diferente', () => {
    const editada = { ...p1, categoria: 'alimentacao' };
    const r = outrasParcelasParaAtualizar(editada, [editada, p2, p3]);
    assertDeepEqual(r.map((t) => t.id), ['t2', 't3']);
  });

  it('nao inclui a propria transacao editada', () => {
    const editada = { ...p1, categoria: 'alimentacao' };
    const r = outrasParcelasParaAtualizar(editada, [editada, p2, p3]);
    assert(!r.some((t) => t.id === 't1'));
  });

  it('nao inclui parcela que ja tem a MESMA categoria (nada a atualizar)', () => {
    const editada = { ...p1, categoria: 'alimentacao' };
    const p2Igual = { ...p2, categoria: 'alimentacao' };
    const r = outrasParcelasParaAtualizar(editada, [editada, p2Igual, p3]);
    assertDeepEqual(r.map((t) => t.id), ['t3']);
  });

  it('INCLUI previsoes (previsto:true) com categoria diferente — sem isso as parcelas seguintes so herdam a categoria na proxima importacao de fatura (syncPredictions), nao na hora', () => {
    const editada = { ...p1, categoria: 'alimentacao' };
    const previsao = { id: 't4', previsto: true, parcelaKey: key, categoria: 'a_classificar', parcela_atual: 3 };
    const r = outrasParcelasParaAtualizar(editada, [editada, previsao]);
    assertDeepEqual(r.map((t) => t.id), ['t4']);
  });

  it('nao inclui parcela de OUTRA compra (parcelaKey diferente)', () => {
    const editada = { ...p1, categoria: 'alimentacao' };
    const outraCompra = { id: 't5', previsto: false, parcelaKey: computeParcelaKey('LOJA Y', '2026-01-01', 3), categoria: 'a_classificar' };
    const r = outrasParcelasParaAtualizar(editada, [editada, outraCompra]);
    assertDeepEqual(r.map((t) => t.id), []);
  });

  it('transacao sem parcelaKey (nao e parcela) devolve lista vazia', () => {
    const semParcela = { id: 't1', previsto: false, categoria: 'alimentacao' };
    assertDeepEqual(outrasParcelasParaAtualizar(semParcela, [semParcela, p2]), []);
  });
});
