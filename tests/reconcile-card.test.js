import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { getReconciliationWindow, runReconciliation, buildFullReconciliationRows } from '../src/domain/reconcile-card.js';

const TITULAR = 'acc_cartao_titular';
const ADICIONAL = 'acc_cartao_adicional';
const OUTRO_CARTAO = 'acc_cartao_outro';
const contas = [
  { id: TITULAR, tipo: 'cartao' },
  { id: ADICIONAL, tipo: 'cartao', cartaoPaiId: TITULAR },
  { id: OUTRO_CARTAO, tipo: 'cartao' },
];

function fat(over) { return { id: 'f1', vencimento: '2026-06-01', dataCorte: '2026-05-25', contaId: TITULAR, rows: [], ...over }; }

describe('reconcile-card: getReconciliationWindow — precedencia de 3 niveis', () => {
  it('nivel 1: usa o periodo de compras IMPRESSO quando existe, ignorando encadeamento/estimativa', () => {
    const fatura = fat({ periodoCompras: { inicio: '2026-04-26', fim: '2026-05-25' } });
    const { windowStart, windowEnd, fonte } = getReconciliationWindow(fatura, [fatura]);
    assertEqual(fonte, 'periodo_impresso');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-26');
    assertEqual(windowEnd.toISOString().slice(0, 10), '2026-05-25');
  });

  it('nivel 2: sem periodo impresso, encadeia pelo dataCorte da fatura anterior', () => {
    const anterior = fat({ id: 'f0', vencimento: '2026-05-01', dataCorte: '2026-04-25' });
    const atual = fat({ id: 'f1', vencimento: '2026-06-01', dataCorte: '2026-05-25' });
    const { windowStart, fonte } = getReconciliationWindow(atual, [anterior, atual]);
    assertEqual(fonte, 'encadeamento');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-26', 'comeca no dia SEGUINTE ao corte da fatura anterior');
  });

  it('nivel 3: sem periodo impresso e sem fatura anterior, cai na estimativa de 35 dias', () => {
    const atual = fat({ vencimento: '2026-06-01', dataCorte: '2026-05-25' });
    const { windowStart, fonte } = getReconciliationWindow(atual, [atual]);
    assertEqual(fonte, 'estimativa');
    assertEqual(windowStart.toISOString().slice(0, 10), '2026-04-20', '35 dias antes do corte');
  });
});

describe('reconcile-card: runReconciliation — isolamento por cartao', () => {
  it('so pool transacoes do TITULAR e seus ADICIONAIS, nunca de outro cartao', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [] });
    const transactions = [
      { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50 },
      { id: 't2', previsto: false, contaId: ADICIONAL, data: '2026-05-11', valor: 30 },
      { id: 't3', previsto: false, contaId: OUTRO_CARTAO, data: '2026-05-12', valor: 40 },
    ];
    const { appUnmatched } = runReconciliation(fatura, [fatura], transactions, contas);
    assertDeepEqual(appUnmatched.map((t) => t.id).sort(), ['t1', 't2'], 't3 (outro cartao) nunca pode aparecer aqui, mesmo estando na janela de datas certa');
  });

  it('linha da secao pagamentos_creditos NUNCA entra nos baldes de despesa, so em pagamentosCreditos', () => {
    const fatura = fat({
      dataCorte: '2026-05-25',
      rows: [{ tipo: 'despesa', secao: 'pagamentos_creditos', data: '2026-05-05', descricao: 'DEB AUTOM DE FATURA EM C/', valor: 200, vencimento: '2026-06-01' }],
    });
    const { autoMatched, matched, faturaUnmatched, pagamentosCreditos } = runReconciliation(fatura, [fatura], [], contas);
    assertEqual(autoMatched.length + matched.length + faturaUnmatched.length, 0);
    assertEqual(pagamentosCreditos.length, 1);
  });

  it('despesa avulsa casa por valor e ate 2 dias de diferenca de data', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-11', valor: 50 };
    const { matched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(matched.length, 1);
  });

  it('conciliadoAutomaticamente:true no lancamento do app vai pro balde autoMatched, nao matched', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: false, conciliadoAutomaticamente: true, contaId: TITULAR, data: '2026-05-10', valor: 50 };
    const { autoMatched, matched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(autoMatched.length, 1);
    assertEqual(matched.length, 0);
  });

  it('previsto:true nunca entra no pool de candidatos (nao e lancamento efetivado)', () => {
    const fatura = fat({ dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'LOJA X', valor: 50, vencimento: '2026-06-01' }] });
    const t = { id: 't1', previsto: true, contaId: TITULAR, data: '2026-05-10', valor: 50 };
    const { matched, faturaUnmatched } = runReconciliation(fatura, [fatura], [t], contas);
    assertEqual(matched.length, 0);
    assertEqual(faturaUnmatched.length, 1);
  });
});

describe('reconcile-card: buildFullReconciliationRows', () => {
  it('lancamento sem cartao correspondente em nenhuma fatura sai como "Só no app"', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'Solto' };
    const rows = buildFullReconciliationRows([], [t], contas);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no app');
  });

  it('nao reaproveita o MESMO lancamento em duas faturas diferentes', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'X' };
    const f1 = fat({ id: 'f1', dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'X', valor: 50, vencimento: '2026-06-01' }] });
    const f2 = fat({ id: 'f2', vencimento: '2026-07-01', dataCorte: '2026-06-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-10', descricao: 'X', valor: 50, vencimento: '2026-07-01' }] });
    const rows = buildFullReconciliationRows([f1, f2], [t], contas);
    const conciliados = rows.filter((r) => r.status.startsWith('Conciliado'));
    assertEqual(conciliados.length, 1, 'o lancamento so pode casar com UMA das duas faturas');
  });
});
