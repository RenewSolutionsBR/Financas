// commitImportacaoEGravar TOCA STORAGE (put/remove/putMany em statements e
// transactions), diferente de commitImportacao (pura, testada em
// conciliacao-import.test.js) — precisa de IndexedDB real, entao so roda no
// navegador (tools/tests.html), igual accounts.browser.test.js.

import { describe, it, assert, assertEqual } from './harness.js';
import { commitImportacaoEGravar } from '../src/ui/conciliacao-import.js';
import { listarEventos } from '../src/domain/audit-log.js';
import * as storage from '../src/core/storage.js';

const CONTA_CARTAO = 'acc_cartao_audit_1';
const FORMA_CREDITO = { id: 'pm_credito_audit', tipo: 'credito', ativo: true };
const FORMAS = [FORMA_CREDITO, { id: 'pm_debito_audit', tipo: 'debito', ativo: true }];

function rowParcelamento(over) {
  return {
    id: 'row_parc_audit_1', tipo: 'parcelamento', secao: 'despesas',
    descricao: 'LOJA EXEMPLO', data: '2026-04-10', vencimento: '2026-06-01',
    valor: 33.33, parcela_atual: 2, parcela_total: 3,
    ...over,
  };
}

function rowPagamento(over) {
  return {
    id: 'row_pag_audit_1', tipo: null, secao: 'pagamentos_creditos',
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

describe('commitImportacaoEGravar: registra evento de auditoria com contagens', () => {
  it('importar fatura gera 1 evento importacao_fatura com contagem de linhas/confirmadas/previstas/pagamentos', async () => {
    const statement = faturaStatement();
    const antes = (await listarEventos()).length;
    const plano = await commitImportacaoEGravar({
      tipo: 'fatura', contaId: CONTA_CARTAO, statement, rows: statement.rows,
      transactions: [], accounts: [], apelidosTitular: [], allStatements: [], regras: [], formas: FORMAS,
    });
    const eventos = await listarEventos();
    assertEqual(eventos.length, antes + 1);
    assertEqual(eventos[0].tipo, 'importacao_fatura');
    assert(/\d+ linha\(s\)/.test(eventos[0].resumo), 'resumo precisa ter contagem de linhas');
    assert(!/LOJA|EXEMPLO/.test(eventos[0].resumo), 'resumo NUNCA pode conter descricao de item');

    // Limpeza: remove o que foi gravado por este teste (statement, transactions, evento de auditoria).
    await storage.remove('statements', plano.statementToPut.id);
    for (const t of plano.transactionsToPut) await storage.remove('transactions', t.id);
    await storage.remove('auditLog', eventos[0].id);
  });
});
