// Integração de domínio da orquestração commitImportacao (Task 12): liga
// statement -> parcelamento/natureza -> regra de registro único de pagamento
// de fatura -> (classificação fica para a tela de extrato/lote, fora daqui).
// Chama a função PURA (sem tocar storage) com arrays já prontos e confere o
// que SERIA gravado — exatamente o pedido do brief (Step 1, parágrafo final).

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { commitImportacao, idDeterministicoDoDocumento, documentoJaImportado } from '../src/ui/conciliacao-import.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

describe('conciliacao-import: idDeterministicoDoDocumento', () => {
  it('monta o id a partir de conta, tipo e vencimento', () => {
    const id = idDeterministicoDoDocumento('acc_1', 'fatura', { vencimento: '2026-08-10' });
    assertEqual(id, 'acc_1|fatura|2026-08-10');
  });

  it('cai em periodoFim quando não há vencimento (extrato)', () => {
    const id = idDeterministicoDoDocumento('acc_1', 'extrato', { periodoFim: '2026-08-31' });
    assertEqual(id, 'acc_1|extrato|2026-08-31');
  });
});

describe('conciliacao-import: documentoJaImportado', () => {
  const doc1 = { id: 'acc_1|fatura|2026-08-10', tipo: 'fatura', contaId: 'acc_1', vencimento: '2026-08-10', importadoEm: 1000 };

  it('encontra o documento existente pelo mesmo id determinístico', () => {
    const encontrado = documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-08-10' }, [doc1]);
    assertEqual(encontrado, doc1);
  });

  it('não encontra nada quando o vencimento é diferente', () => {
    const encontrado = documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-09-10' }, [doc1]);
    assertEqual(encontrado, null);
  });

  it('não encontra nada quando a conta é diferente', () => {
    const encontrado = documentoJaImportado('acc_2', 'fatura', { vencimento: '2026-08-10' }, [doc1]);
    assertEqual(encontrado, null);
  });

  it('lista vazia de documentos não encontra nada', () => {
    assertEqual(documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-08-10' }, []), null);
  });
});

const CONTA_CARTAO = 'acc_cartao_1';
const FORMA_CREDITO = { id: 'pm_credito', tipo: 'credito', ativo: true };
const FORMAS = [FORMA_CREDITO, { id: 'pm_debito', tipo: 'debito', ativo: true }];

function rowParcelamento(over) {
  return {
    id: 'row_parc_1', tipo: 'parcelamento', secao: 'despesas',
    descricao: 'LOJA EXEMPLO', data: '2026-04-10', vencimento: '2026-06-01',
    valor: 33.33, parcela_atual: 2, parcela_total: 3,
    ...over,
  };
}

function rowPagamento(over) {
  return {
    id: 'row_pag_1', tipo: null, secao: 'pagamentos_creditos',
    descricao: 'PAGAMENTO RECEBIDO', data: '2026-05-30', valor: 500,
    ...over,
  };
}

function faturaStatement(over) {
  return {
    tipo: 'fatura', contaId: CONTA_CARTAO, vencimento: '2026-06-01', dataCorte: '2026-05-28',
    adaptador: 'santander-cartao-pdf', arquivo: 'fatura-teste.pdf', importadoEm: 1,
    rows: [rowParcelamento(), rowPagamento()],
    ...over,
  };
}

describe('commitImportacao: fatura com 1 parcelamento + 1 pagamento', () => {
  it('gera exatamente 1 previsao nova (parcela restante) e 1 lancamento pagamento_fatura, sem duplicar', async () => {
    const statement = faturaStatement();
    const resultado = await commitImportacao({
      tipo: 'fatura', contaId: CONTA_CARTAO, statement,
      rows: statement.rows, transactions: [], accounts: [], apelidosTitular: [],
      allStatements: [], regras: [], formas: FORMAS,
    });

    // parcela_atual 2/3 -> 1 previsao restante (3/3); parcela_atual 2 tambem
    // confirma sozinha (autoConfirmParcelas: parcela_atual>1 nao exige
    // candidato previsto), entao 1 transacao CONFIRMADA (despesa) + 1
    // previsao (seed_) de parcela 3/3.
    const confirmadas = resultado.transactionsToPut.filter((t) => !t.previsto && t.natureza === 'despesa');
    const previsoes = resultado.transactionsToPut.filter((t) => t.previsto);
    assertEqual(confirmadas.length, 1, 'a propria parcela importada (2/3) confirma');
    assertEqual(previsoes.length, 1, 'so falta 1 previsao (3/3) — 2/3 ja veio confirmada, nao e mais previsao');
    assertEqual(previsoes[0].parcela_atual, 3);

    const pagamentos = resultado.transactionsToPut.filter((t) => t.natureza === 'pagamento_fatura');
    assertEqual(pagamentos.length, 1, 'exatamente 1 lancamento de pagamento_fatura, nao duplicado');
    assertEqual(pagamentos[0].origem, 'fatura');
    assert(pagamentos[0].id, 'lancamento criado precisa ganhar um id antes de ser devolvido para gravacao');

    assertEqual(resultado.statementToPut.id, `${CONTA_CARTAO}|fatura|${statement.vencimento}`);
  });
});

describe('commitImportacao: extrato com 1 linha pagamento_fatura + 3 despesas', () => {
  it('gera 1 lancamento de pagamento_fatura e ZERO lancamentos para as despesas (ficam para o lote)', async () => {
    const CONTA_CORRENTE = 'acc_corrente_1';
    const CARTAO = { id: CONTA_CARTAO, tipo: 'cartao', matchers: ['MASTER CARD FINAL 0000'] };
    const rows = [
      { id: 'r1', descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', sinal: 'debito', valor: 123.01, data: '2026-05-04', contaId: CONTA_CORRENTE },
      { id: 'r2', descricao: 'COMPRA MERCADO A', sinal: 'debito', valor: 50, data: '2026-05-05', contaId: CONTA_CORRENTE },
      { id: 'r3', descricao: 'COMPRA MERCADO B', sinal: 'debito', valor: 30, data: '2026-05-06', contaId: CONTA_CORRENTE },
      { id: 'r4', descricao: 'COMPRA MERCADO C', sinal: 'debito', valor: 20, data: '2026-05-07', contaId: CONTA_CORRENTE },
    ];
    const statement = { tipo: 'extrato', contaId: CONTA_CORRENTE, adaptador: 'generic-table', arquivo: 'extrato-teste.csv', importadoEm: 1, rows };

    const resultado = await commitImportacao({
      tipo: 'extrato', contaId: CONTA_CORRENTE, statement, rows,
      transactions: [], accounts: [CARTAO], apelidosTitular: [],
      allStatements: [], regras: [], formas: FORMAS,
    });

    assertEqual(resultado.transactionsToPut.length, 1, 'so o pagamento_fatura gera lancamento aqui; despesas esperam +lancar em lote');
    assertEqual(resultado.transactionsToPut[0].natureza, 'pagamento_fatura');
    assertEqual(resultado.transactionsToPut[0].origem, 'extrato');
  });
});

describe('commitImportacao: reimportar a MESMA fatura duas vezes nao duplica nada', () => {
  it('a segunda chamada, encadeada com o resultado da primeira, produz o MESMO conjunto de transacoes', async () => {
    const statement = faturaStatement();
    const base = {
      tipo: 'fatura', contaId: CONTA_CARTAO, statement, rows: statement.rows,
      accounts: [], apelidosTitular: [], allStatements: [], regras: [], formas: FORMAS,
    };

    const r1 = await commitImportacao({ ...base, transactions: [] });

    // Simula o que o app real faria: persistir (put) o plano de r1 e aplicar
    // as remocoes antes da segunda importacao — mesma semantica de
    // commitImportacaoEGravar (putMany sobrescreve por id, remove tira da lista).
    const aplicarPlano = (estadoAnterior, plano) => {
      const semRemovidos = estadoAnterior.filter((t) => !plano.transactionIdsToRemove.includes(t.id));
      const porId = new Map(semRemovidos.map((t) => [t.id, t]));
      for (const t of plano.transactionsToPut) porId.set(t.id, t);
      return [...porId.values()];
    };
    const estadoAposR1 = aplicarPlano([], r1);

    const r2 = await commitImportacao({ ...base, transactions: estadoAposR1, allStatements: [r1.statementToPut] });
    const estadoAposR2 = aplicarPlano(estadoAposR1, r2);

    // Ids deterministicos (Tasks 3/5): confirmados usam namespace confirmed_,
    // previsoes usam seed_ — reimportar reconstroi os MESMOS ids, entao o
    // ESTADO FINAL (por id, apos aplicar o plano de cada importacao) tem que
    // ser identico depois da 2a importacao — nao dobrar de tamanho nem mudar
    // de conteudo so por ter rodado de novo.
    const porIdR1 = new Map(estadoAposR1.filter((t) => t.natureza !== 'pagamento_fatura').map((t) => [t.id, t]));
    const porIdR2 = new Map(estadoAposR2.filter((t) => t.natureza !== 'pagamento_fatura').map((t) => [t.id, t]));
    assertDeepEqual([...porIdR1.keys()].sort(), [...porIdR2.keys()].sort(), 'mesmos ids de parcela/previsao nas duas importacoes');
    assertEqual(estadoAposR2.length, estadoAposR1.length, 'reimportar nao pode crescer a quantidade total de lancamentos');

    // Pagamento de fatura: a 2a chamada tem que reconhecer o lancamento ja
    // existente (mesmo valor/data, dentro da tolerancia) e devolver ja_completo
    // — ou seja, NAO deve aparecer um segundo lancamento novo de pagamento_fatura
    // no resultado combinado (transactionsAposR1 + o que r2 acrescenta de novo).
    const pagamentosR1 = r1.transactionsToPut.filter((t) => t.natureza === 'pagamento_fatura');
    const pagamentosNovosEmR2 = r2.transactionsToPut.filter((t) => t.natureza === 'pagamento_fatura' && !pagamentosR1.some((p) => p.id === t.id));
    assertEqual(pagamentosNovosEmR2.length, 0, 'reimportar nao pode criar um SEGUNDO lancamento de pagamento_fatura');
  });
});

describe('commitImportacao: reimportar fatura corrigida (mesmo vencimento, valor diferente) ATUALIZA a parcela ja confirmada', () => {
  it('a 2a chamada com valor corrigido produz uma transaction confirmada com o valor NOVO no estado final aplicado', async () => {
    const aplicarPlano = (estadoAnterior, plano) => {
      const semRemovidos = estadoAnterior.filter((t) => !plano.transactionIdsToRemove.includes(t.id));
      const porId = new Map(semRemovidos.map((t) => [t.id, t]));
      for (const t of plano.transactionsToPut) porId.set(t.id, t);
      return [...porId.values()];
    };

    const statementOriginal = faturaStatement({ rows: [rowParcelamento({ valor: 33.33 }), rowPagamento()] });
    const base1 = {
      tipo: 'fatura', contaId: CONTA_CARTAO, statement: statementOriginal, rows: statementOriginal.rows,
      accounts: [], apelidosTitular: [], allStatements: [], regras: [], formas: FORMAS,
    };
    const r1 = await commitImportacao({ ...base1, transactions: [] });
    const estadoAposR1 = aplicarPlano([], r1);

    // Mesmo vencimento/parcela_total (mesma id determinística), valor CORRIGIDO
    // de 33.33 para 35.00 — cenario real: fatura reemitida com encargo/correcao.
    const statementCorrigido = faturaStatement({ rows: [rowParcelamento({ valor: 35.00 }), rowPagamento()] });
    const base2 = { ...base1, statement: statementCorrigido, rows: statementCorrigido.rows };
    const r2 = await commitImportacao({ ...base2, transactions: estadoAposR1, allStatements: [r1.statementToPut] });
    const estadoAposR2 = aplicarPlano(estadoAposR1, r2);

    const confirmadaFinal = estadoAposR2.find((t) => t.parcela_atual === 2 && !t.previsto);
    assertEqual(confirmadaFinal.valor, 35.00, 'a reimportacao com valor corrigido precisa atualizar a transaction ja confirmada, nao descarta-la em silencio');
  });
});

describe('commitImportacao: linhas do adaptador SEM vencimento proprio (formato real de PDF)', () => {
  it('carimba row.vencimento a partir do statement antes de confirmar/prever — sem isso toda fatura colidia no mesmo id "..._undefined" e as previsoes nasciam com data NaN-NaN', async () => {
    const aplicarPlano = (estadoAnterior, plano) => {
      const semRemovidos = estadoAnterior.filter((t) => !plano.transactionIdsToRemove.includes(t.id));
      const porId = new Map(semRemovidos.map((t) => [t.id, t]));
      for (const t of plano.transactionsToPut) porId.set(t.id, t);
      return [...porId.values()];
    };
    const base = {
      tipo: 'fatura', contaId: CONTA_CARTAO, accounts: [], apelidosTitular: [], regras: [], formas: FORMAS,
    };

    // Duas faturas de meses DIFERENTES para a MESMA compra parcelada — a
    // linha (row), como o adaptador real devolve, nao tem campo vencimento
    // proprio, so `data` (data da compra).
    const rowSemVencimento = (over) => {
      const r = rowParcelamento(over);
      delete r.vencimento;
      return r;
    };

    const statementMaio = faturaStatement({ vencimento: '2026-05-01', dataCorte: '2026-04-28', rows: [rowSemVencimento({ parcela_atual: 2 }), rowPagamento()] });
    const r1 = await commitImportacao({ ...base, statement: statementMaio, rows: statementMaio.rows, transactions: [], allStatements: [] });
    const estadoAposR1 = aplicarPlano([], r1);

    const statementJunho = faturaStatement({ vencimento: '2026-06-01', dataCorte: '2026-05-28', rows: [rowSemVencimento({ parcela_atual: 3 }), rowPagamento()] });
    const r2 = await commitImportacao({ ...base, statement: statementJunho, rows: statementJunho.rows, transactions: estadoAposR1, allStatements: [r1.statementToPut] });
    const estadoAposR2 = aplicarPlano(estadoAposR1, r2);

    const confirmadas = estadoAposR2.filter((t) => !t.previsto && t.natureza === 'despesa');
    assertEqual(confirmadas.length, 2, 'parcela 2/3 (maio) e 3/3 (junho) sao confirmacoes DISTINTAS — sem o carimbo de vencimento, a de junho sobrescrevia a de maio (mesmo id "..._undefined")');
    assert(confirmadas.every((t) => t.id !== undefined && !t.id.endsWith('_undefined')), 'nenhum id de confirmacao pode terminar em "_undefined"');

    const previsoes = estadoAposR2.filter((t) => t.previsto);
    assert(previsoes.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.data)), 'toda previsao precisa de uma data ISO valida, nunca "NaN-NaN-01"');
  });
});
