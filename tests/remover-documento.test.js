import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { transacoesDoDocumento } from '../src/domain/remover-documento.js';

describe('remover-documento: transacoesDoDocumento (fatura)', () => {
  const docFatura = { id: 'stmt_1', tipo: 'fatura', contaId: 'acc_visa', vencimento: '2026-01-30' };

  it('inclui parcela auto-confirmada (faturaVencimento, sem origemRef)', () => {
    const t = { id: 'confirmed_x', contaId: 'acc_visa', faturaVencimento: '2026-01-30', natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docFatura, [t]);
    assertDeepEqual(paraExcluir.map((x) => x.id), ['confirmed_x']);
  });

  it('inclui lançamento vindo de "+lançar" manual (faturaVencimento + origemRef)', () => {
    const t = { id: 'tx_manual', contaId: 'acc_visa', faturaVencimento: '2026-01-30', origemRef: { statementId: 'stmt_1' }, natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docFatura, [t]);
    assertEqual(paraExcluir.length, 1);
  });

  it('NAO inclui transacao de outro cartao (contaId diferente)', () => {
    const t = { id: 'x', contaId: 'acc_outro', faturaVencimento: '2026-01-30', natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docFatura, [t]);
    assertEqual(paraExcluir.length, 0);
  });

  it('NAO inclui transacao do MESMO cartao mas de outro vencimento', () => {
    const t = { id: 'x', contaId: 'acc_visa', faturaVencimento: '2026-02-28', natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docFatura, [t]);
    assertEqual(paraExcluir.length, 0);
  });

  it('NAO inclui previsao (previsto:true), mesmo com faturaVencimento batendo', () => {
    const t = { id: 'seed_x', contaId: 'acc_visa', faturaVencimento: '2026-01-30', natureza: 'despesa', previsto: true };
    const { paraExcluir } = transacoesDoDocumento(docFatura, [t]);
    assertEqual(paraExcluir.length, 0);
  });

  it('separa pagamento_fatura em pagamentosParaRevisar, NUNCA em paraExcluir', () => {
    // Pagamento pode ter nascido do lado do EXTRATO — apagar cego apagaria
    // um registro com raiz em outro documento.
    const pagamento = { id: 'pg_1', contaId: 'acc_visa', faturaVencimento: '2026-01-30', natureza: 'pagamento_fatura' };
    const despesa = { id: 'tx_1', contaId: 'acc_visa', faturaVencimento: '2026-01-30', natureza: 'despesa' };
    const { paraExcluir, pagamentosParaRevisar } = transacoesDoDocumento(docFatura, [pagamento, despesa]);
    assertDeepEqual(paraExcluir.map((t) => t.id), ['tx_1']);
    assertDeepEqual(pagamentosParaRevisar.map((t) => t.id), ['pg_1']);
  });

  // Cenario real do usuario (2026-08-14): fatura PDF vencimento 30/01,
  // reimportada por planilha com vencimento digitado errado (26/01) —
  // dois documentos distintos, 73 lancamentos duplicados no documento errado.
  it('cenario real: exclui so as transacoes do documento com vencimento ERRADO, preserva as do correto', () => {
    const docErrado = { id: 'stmt_errado', tipo: 'fatura', contaId: 'acc_visa', vencimento: '2026-01-26' };
    const doCorreto = Array.from({ length: 73 }, (_, i) => ({
      id: `tx_correto_${i}`, contaId: 'acc_visa', faturaVencimento: '2026-01-30', natureza: 'despesa',
    }));
    const doErrado = Array.from({ length: 73 }, (_, i) => ({
      id: `tx_errado_${i}`, contaId: 'acc_visa', faturaVencimento: '2026-01-26', natureza: 'despesa',
    }));
    const { paraExcluir } = transacoesDoDocumento(docErrado, [...doCorreto, ...doErrado]);
    assertEqual(paraExcluir.length, 73, 'so as 73 do documento errado');
    assert(paraExcluir.every((t) => t.id.startsWith('tx_errado_')), 'nenhuma do documento correto foi selecionada');
  });
});

describe('remover-documento: transacoesDoDocumento (extrato)', () => {
  const docExtrato = { id: 'stmt_ext', tipo: 'extrato', contaId: 'acc_cc' };

  it('inclui lancamento vindo de "+lançar" do extrato (origemRef.statementId)', () => {
    const t = { id: 'tx_1', contaId: 'acc_cc', origemRef: { statementId: 'stmt_ext' }, natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docExtrato, [t]);
    assertEqual(paraExcluir.length, 1);
  });

  it('NAO inclui lancamento de OUTRO documento de extrato', () => {
    const t = { id: 'tx_1', contaId: 'acc_cc', origemRef: { statementId: 'stmt_outro' }, natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docExtrato, [t]);
    assertEqual(paraExcluir.length, 0);
  });

  it('NAO inclui lancamento manual puro (sem origemRef nenhum)', () => {
    const t = { id: 'tx_1', contaId: 'acc_cc', natureza: 'despesa' };
    const { paraExcluir } = transacoesDoDocumento(docExtrato, [t]);
    assertEqual(paraExcluir.length, 0);
  });
});
