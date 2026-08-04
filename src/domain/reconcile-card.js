// Conciliação de fatura — PORTADO de reconcile.js do app anterior, já
// validado em produção. Três extensões da spec 7.1: isolamento por cartão
// (plasticosDoTitular), janela de três níveis (getReconciliationWindow), e
// linhas de "Pagamento e Demais Créditos" saem do balde de despesa.

import { plasticosDoTitular } from './accounts.js';
import { computeParcelaKey } from './parcelas.js';

const POOL_SLACK_DAYS = 3;

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

function closestIndexByKey(pool, key, referenceDate) {
  let bestIdx = -1, bestDiff = Infinity;
  pool.forEach((e, i) => {
    if (e.used || e.parcelaKey !== key) return;
    const diff = dateDiffDays(e.data, referenceDate);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });
  return bestIdx;
}

// Nível 1 (período impresso) > nível 2 (encadeamento pelo dataCorte da
// fatura anterior) > nível 3 (estimativa de 35 dias). O nível 1 é
// estritamente mais preciso — não depende da fatura anterior ter sido
// importada — e por isso vence sempre que existir.
export function getReconciliationWindow(fatura, faturasList) {
  if (fatura.periodoCompras && fatura.periodoCompras.inicio && fatura.periodoCompras.fim) {
    return {
      windowStart: new Date(fatura.periodoCompras.inicio + 'T00:00:00'),
      windowEnd: new Date(fatura.periodoCompras.fim + 'T00:00:00'),
      fonte: 'periodo_impresso',
    };
  }
  const sorted = [...faturasList].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  const idx = sorted.findIndex((f) => f.vencimento === fatura.vencimento);
  const windowEnd = fatura.dataCorte ? new Date(fatura.dataCorte) : new Date(fatura.vencimento);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  if (prev && prev.dataCorte) {
    const windowStart = new Date(prev.dataCorte);
    windowStart.setDate(windowStart.getDate() + 1);
    return { windowStart, windowEnd, fonte: 'encadeamento' };
  }
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 35);
  return { windowStart, windowEnd, fonte: 'estimativa' };
}

function getPoolWindow(fatura, faturasList) {
  const { windowStart, windowEnd } = getReconciliationWindow(fatura, faturasList);
  const poolStart = new Date(windowStart); poolStart.setDate(poolStart.getDate() - POOL_SLACK_DAYS);
  const poolEnd = new Date(windowEnd); poolEnd.setDate(poolEnd.getDate() + POOL_SLACK_DAYS);
  return { poolStart, poolEnd, windowStart, windowEnd };
}

function poolDoCartao(fatura, transactions, accounts) {
  const plasticos = new Set(plasticosDoTitular(fatura.contaId, accounts));
  return (transactions || []).filter((t) => !t.previsto && plasticos.has(t.contaId));
}

export function runReconciliation(fatura, faturasList, transactions, accounts) {
  const itensDespesa = (fatura.rows || []).filter((r) => r.secao !== 'pagamentos_creditos');
  const pagamentosCreditos = (fatura.rows || []).filter((r) => r.secao === 'pagamentos_creditos');

  const { poolStart, poolEnd, windowStart, windowEnd } = getPoolWindow(fatura, faturasList);
  const appPool = poolDoCartao(fatura, transactions, accounts)
    .filter((t) => new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd)
    .map((t) => ({ ...t, used: false, dentroDaJanela: new Date(t.data) >= windowStart && new Date(t.data) <= windowEnd }));

  const autoMatched = [];
  const matched = [];
  const faturaUnmatched = [];

  itensDespesa.forEach((item) => {
    let idx = -1;
    if (item.tipo === 'parcelamento') {
      const key = computeParcelaKey(item.descricao, item.data, item.parcela_total);
      idx = closestIndexByKey(appPool, key, item.vencimento);
      if (idx < 0) idx = appPool.findIndex((t) => !t.used && Math.abs(t.valor - item.valor) < 0.01);
    } else {
      idx = appPool.findIndex((t) => !t.used && Math.abs(t.valor - item.valor) < 0.01 && dateDiffDays(t.data, item.data) <= 2);
    }
    if (idx >= 0) {
      appPool[idx].used = true;
      const bucket = appPool[idx].conciliadoAutomaticamente ? autoMatched : matched;
      bucket.push({ fatura: item, app: appPool[idx] });
    } else {
      faturaUnmatched.push(item);
    }
  });
  const appUnmatched = appPool.filter((t) => !t.used && t.dentroDaJanela);

  return { autoMatched, matched, faturaUnmatched, appUnmatched, pagamentosCreditos };
}

export function buildFullReconciliationRows(faturasList, allTransactions, accounts) {
  const pool = (allTransactions || []).filter((t) => !t.previsto).map((t) => ({ ...t, used: false }));
  const rows = [];
  const sorted = [...faturasList].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));

  sorted.forEach((fatura) => {
    const plasticos = new Set(plasticosDoTitular(fatura.contaId, accounts));
    const { poolStart, poolEnd } = getPoolWindow(fatura, faturasList);
    (fatura.rows || []).filter((r) => r.secao !== 'pagamentos_creditos').forEach((item) => {
      let idx = -1;
      if (item.tipo === 'parcelamento') {
        const key = computeParcelaKey(item.descricao, item.data, item.parcela_total);
        idx = closestIndexByKey(pool, key, item.vencimento);
        if (idx < 0) idx = pool.findIndex((t) => !t.used && plasticos.has(t.contaId) && new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd && Math.abs(t.valor - item.valor) < 0.01);
      } else {
        idx = pool.findIndex((t) => !t.used && plasticos.has(t.contaId) && new Date(t.data) >= poolStart && new Date(t.data) <= poolEnd && Math.abs(t.valor - item.valor) < 0.01 && dateDiffDays(t.data, item.data) <= 2);
      }
      const parcela = item.parcela_atual ? `${item.parcela_atual}/${item.parcela_total}` : '';
      if (idx >= 0) {
        const t = pool[idx];
        t.used = true;
        rows.push({ status: t.conciliadoAutomaticamente ? 'Conciliado (automático)' : 'Conciliado', vencimentoFatura: fatura.vencimento, dataFatura: item.data, descricaoFatura: item.descricao, parcela, valorFatura: item.valor, dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: t.categoria, valorLancamento: t.valor });
      } else {
        rows.push({ status: 'Só na fatura', vencimentoFatura: fatura.vencimento, dataFatura: item.data, descricaoFatura: item.descricao, parcela, valorFatura: item.valor, dataLancamento: '', descricaoLancamento: '', categoria: '', valorLancamento: '' });
      }
    });
  });

  pool.filter((t) => !t.used).forEach((t) => {
    rows.push({ status: 'Só no app', vencimentoFatura: '', dataFatura: '', descricaoFatura: '', parcela: '', valorFatura: '', dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: t.categoria, valorLancamento: t.valor });
  });

  rows.sort((a, b) => {
    const da = a.dataLancamento || a.dataFatura, db = b.dataLancamento || b.dataFatura;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return rows;
}
