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

  it('regressao de fuso horario: transacao datada no PRIMEIRO dia do periodo impresso aparece em appUnmatched', () => {
    // Se windowStart for interpretado como meia-noite LOCAL (em vez de UTC,
    // como o resto do modulo), num fuso atras de UTC essa transacao fica
    // "antes" da janela por algumas horas e some silenciosamente do
    // appUnmatched — mesmo sem casar com nenhum item da fatura.
    const fatura = fat({ periodoCompras: { inicio: '2026-04-26', fim: '2026-05-25' }, rows: [] });
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-04-26', valor: 77 };
    const { appUnmatched } = runReconciliation(fatura, [fatura], [t], contas);
    assertDeepEqual(appUnmatched.map((x) => x.id), ['t1'], 'transacao no primeiro dia do periodo impresso nao pode sumir por causa de fuso horario');
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
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'Solto', categoria: 'cat_inexistente' };
    const rows = buildFullReconciliationRows([], [], [t], contas, [], []);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no app');
    assertEqual(rows[0].categoria, 'cat_inexistente', 'sem categorias cadastradas, cai no fallback do proprio ID');
  });

  it('nao reaproveita o MESMO lancamento em duas faturas diferentes', () => {
    // Data escolhida propositalmente na FAIXA DE SOBREPOSICAO real do
    // pool-slack entre f1 (janela estimativa terminando em 2026-05-25,
    // poolEnd = 2026-05-28) e f2 (janela por encadeamento comecando em
    // 2026-05-26, poolStart = 2026-05-23): 2026-05-24 cai dentro das DUAS
    // janelas. Se a data ficasse fora dessa faixa (como '2026-05-10' antes),
    // o teste passaria mesmo sem a protecao de reuso (flag `used`), so
    // porque a janela de uma das faturas ja excluiria a transacao sozinha —
    // o teste ficaria vacuo. Ver sabotagem no relatorio da rodada 2.
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-24', valor: 50, descricao: 'X' };
    const f1 = fat({ id: 'f1', dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-24', descricao: 'X', valor: 50, vencimento: '2026-06-01' }] });
    const f2 = fat({ id: 'f2', vencimento: '2026-07-01', dataCorte: '2026-06-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-24', descricao: 'X', valor: 50, vencimento: '2026-07-01' }] });
    const rows = buildFullReconciliationRows([f1, f2], [], [t], contas, [], []);
    const conciliados = rows.filter((r) => r.status.startsWith('Conciliado'));
    assertEqual(conciliados.length, 1, 'o lancamento so pode casar com UMA das duas faturas');
  });

  it('transacao conciliada com EXTRATO aparece como Conciliado, nao mais Só no app', () => {
    const t = { id: 't1', previsto: false, contaId: 'acc_banco_1', data: '2026-06-10', valor: 55.5, descricao: 'MERCADO EXEMPLO', categoria: 'cat_alimentacao', natureza: 'despesa' };
    const contasComBanco = [...contas, { id: 'acc_banco_1', tipo: 'conta', matchers: [] }];
    const extrato = { id: 'ext1', tipo: 'extrato', contaId: 'acc_banco_1', importadoEm: 1, rows: [{ id: 'r1', descricao: 'MERCADO EXEMPLO', data: '2026-06-10', valor: 55.5, sinal: 'debito' }] };
    const categorias = [{ id: 'cat_alimentacao', nome: 'Alimentação' }];
    const rows = buildFullReconciliationRows([], [extrato], [t], contasComBanco, [], categorias);
    assertEqual(rows.length, 1);
    assert(rows[0].status.startsWith('Conciliado'), 'transacao casada com linha de extrato precisa aparecer como Conciliado, nao Só no app');
    assertEqual(rows[0].categoria, 'Alimentação', 'categoria precisa vir com o NOME, nao o ID');
  });

  it('linha de extrato sem candidato no pool aparece como "Só no extrato"', () => {
    const contasComBanco = [...contas, { id: 'acc_banco_1', tipo: 'conta', matchers: [] }];
    const extrato = { id: 'ext1', tipo: 'extrato', contaId: 'acc_banco_1', importadoEm: 1, rows: [{ id: 'r1', descricao: 'SEM PAR NO APP', data: '2026-06-10', valor: 999, sinal: 'debito' }] };
    const rows = buildFullReconciliationRows([], [extrato], [], contasComBanco, [], []);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no extrato');
  });
});
