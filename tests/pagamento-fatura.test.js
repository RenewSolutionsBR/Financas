import { describe, it, assert, assertEqual } from './harness.js';
import { processarPagamentoFatura } from '../src/domain/pagamento-fatura.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

function linhaExtrato(over) {
  return { id: 'row_extrato_1', statementId: 'stmt_extrato', descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 123.01, data: '2026-05-04', contaId: 'acc_corrente_1', ...over };
}
function linhaFatura(over) {
  return { id: 'row_fatura_1', statementId: 'stmt_fatura_junho', descricao: 'DEB AUTOM DE FATURA EM C/', valor: 123.01, data: '2026-05-04', contaId: null, ...over };
}

describe('pagamento-fatura: extrato chega ANTES da fatura', () => {
  it('cria o lancamento CANONICO a partir do extrato, natureza pagamento_fatura', () => {
    const { acao, transaction } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    assertEqual(acao, 'criado');
    assertEqual(transaction.natureza, 'pagamento_fatura');
    assertEqual(transaction.origem, 'extrato');
    assertEqual(transaction.categoria, CATEGORIA_A_CLASSIFICAR);
    assertEqual(transaction.previsto, false);
  });

  it('quando a fatura seguinte chega depois com a linha correspondente, CASA em vez de criar um segundo lancamento', () => {
    const { transaction: doExtrato } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    // Simula o que o chamador real faz depois de gravar: o lancamento
    // persistido ganha um id. Sem isso, doExtrato.id ficaria undefined e o
    // teste nao provaria nada sobre preservacao de id.
    const doExtratoPersistido = { ...doExtrato, id: 'tx_do_extrato_1' };
    const { acao, transaction } = processarPagamentoFatura(linhaFatura(), 'fatura', [doExtratoPersistido], 'stmt_fatura_maio_paga');
    assertEqual(acao, 'complementado');
    assertEqual(transaction.id, 'tx_do_extrato_1', 'precisa ser o MESMO lancamento do extrato, nao um novo');
  });
});

describe('pagamento-fatura: fatura chega ANTES do extrato', () => {
  it('cria o lancamento PROVISORIO a partir da fatura, com faturaVinculadaId', () => {
    const { acao, transaction } = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    assertEqual(acao, 'criado');
    assertEqual(transaction.origem, 'fatura');
    assertEqual(transaction.faturaVinculadaId, 'stmt_fatura_maio_paga');
  });

  it('quando o extrato chega depois, CASA por valor/data e completa origemRef, sem duplicar', () => {
    const { transaction: daFatura } = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    const daFaturaComId = { ...daFatura, id: 'tx_provisorio_1' };
    const { acao, transaction } = processarPagamentoFatura(linhaExtrato(), 'extrato', [daFaturaComId], null);
    assertEqual(acao, 'complementado');
    assertEqual(transaction.id, 'tx_provisorio_1');
    assertEqual(transaction.origemRef.statementId, 'stmt_extrato', 'origemRef passa a apontar pra linha do extrato, a fonte canonica');
  });
});

describe('pagamento-fatura: em QUALQUER ordem, resultado final e exatamente UM lancamento', () => {
  it('extrato -> fatura: 1 lancamento so, fora do total de gasto', () => {
    const r1 = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    const r2 = processarPagamentoFatura(linhaFatura(), 'fatura', [r1.transaction], 'stmt_fatura_maio_paga');
    assertEqual([r1, r2].filter((r) => r.acao === 'criado').length, 1);
  });

  it('fatura -> extrato: 1 lancamento so, fora do total de gasto', () => {
    const r1 = processarPagamentoFatura(linhaFatura(), 'fatura', [], 'stmt_fatura_maio_paga');
    const r2 = processarPagamentoFatura(linhaExtrato(), 'extrato', [r1.transaction], null);
    assertEqual([r1, r2].filter((r) => r.acao === 'criado').length, 1);
  });
});

describe('pagamento-fatura: reprocessar a MESMA linha nao duplica nem regride', () => {
  it('chamar de novo com o mesmo lancamento ja completo devolve ja_completo, sem mexer em nada', () => {
    const { transaction: existente } = processarPagamentoFatura(linhaExtrato(), 'extrato', [], null);
    const comId = { ...existente, id: 'tx_1' };
    const resultado = processarPagamentoFatura(linhaExtrato(), 'extrato', [comId], null);
    assertEqual(resultado.acao, 'ja_completo');
    assertEqual(resultado.transaction.id, 'tx_1');
  });
});

describe('pagamento-fatura: valores fora da tolerancia NAO casam entre si', () => {
  it('diferenca de valor >= 0.01 nao casa — cria um segundo lancamento em vez de complementar', () => {
    const { transaction: doExtrato } = processarPagamentoFatura(linhaExtrato({ valor: 123.01 }), 'extrato', [], null);
    const { acao } = processarPagamentoFatura(linhaFatura({ valor: 150.00 }), 'fatura', [doExtrato], 'x');
    assertEqual(acao, 'criado', 'valores bem diferentes nao devem ser tratados como o mesmo pagamento');
  });
});
