// Identidade de parcela, previsões de parcela futura e auto-confirmação por
// fatura — PORTADO do app anterior (reconcile.js), já validado em produção
// com faturas reais de 09/2025 a 06/2026. Isolamento por cartão NÃO é
// responsabilidade deste módulo: quem chama filtra `allFaturaRows`/
// `existingTransactions` para o grupo titular+adicionais certo ANTES de
// chamar (ver Task 8, reconcile-card.js).

import { CATEGORIA_A_CLASSIFICAR } from './categories.js';

function normalizeDescricao(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function computeParcelaKey(descricao, dataCompraOriginal, parcelaTotal) {
  return `${normalizeDescricao(descricao)}|${dataCompraOriginal}|${parcelaTotal}`;
}

// Preserva o "dia" só até onde o mês de destino permitir (dia 30 virando
// fevereiro fica 28/29, não estoura pra março) — sem isso, duas previsões
// seguidas podiam cair no mesmo mês, empurrando a última parcela adiante do
// que realmente aconteceria.
function addMonths(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTarget));
  return target;
}
function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

// Versão ISO de addMonths, exportada para quem precisa de string em vez de
// Date (Task 4, parcelamento manual). Mesmo clamp de dia, uma única
// implementação — o app anterior tinha duas cópias quase idênticas
// (addMonths aqui e addMonthsClamped em app.js) e isso não se repete aqui.
export function addMonthsISO(iso, n) {
  const d = addMonths(iso, n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function computeParcelaGroups(allFaturaRows) {
  const map = new Map();
  for (const r of allFaturaRows || []) {
    if (r.tipo !== 'parcelamento' || !r.parcela_total) continue;
    const key = r.key || computeParcelaKey(r.descricao, r.data, r.parcela_total);
    const cur = map.get(key);
    if (!cur || r.parcela_atual > cur.parcela_atual) map.set(key, { ...r, key });
  }
  const groups = [];
  for (const r of map.values()) {
    const remaining = r.parcela_total - r.parcela_atual;
    if (remaining <= 0) continue;
    const months = [];
    for (let k = 1; k <= remaining; k++) {
      const dt = addMonths(r.vencimento, k);
      months.push({ ym: ymOf(dt), valor: r.valor, numero: r.parcela_atual + k });
    }
    groups.push({ key: r.key, descricao: r.descricao, dataCompraOriginal: r.data, valor: r.valor, parcelaAtual: r.parcela_atual, remaining, parcelaTotal: r.parcela_total, months });
  }
  return groups;
}

// Recria do zero todas as previsões (previsto:true) a partir do histórico
// mais atual, em vez de só acumular por cima das antigas: se a fatura mudou
// o ritmo de cobrança, a previsão antiga fica errada e precisa SUMIR, não só
// ganhar uma nova ao lado. Confirmados nunca são tocados. Previsões de
// parcelamento MANUAL (origemManual:true) ficam de fora da limpeza —
// computeParcelaGroups só enxerga linha de fatura, então nunca as
// regeneraria de qualquer forma.
export function syncPredictions(allFaturaRows, existingTransactions, contaId, formaPagamentoId) {
  const groups = computeParcelaGroups(allFaturaRows);
  const categoriaPorKey = new Map();
  (existingTransactions || []).forEach((t) => {
    if (!t.previsto && t.parcelaKey && t.categoria) categoriaPorKey.set(t.parcelaKey, t.categoria);
  });

  const toRemoveIds = (existingTransactions || [])
    .filter((t) => t.previsto && !t.origemManual)
    .map((t) => t.id);

  const toAdd = [];
  groups.forEach((g) => {
    g.months.forEach((m) => {
      // Chave do id inclui g.key (parcelaKey, unico por compra): so
      // descricao+valor+mes colidia entre parcelamentos DIFERENTES com a
      // mesma descricao e mesmo valor de parcela caindo no mesmo mes -
      // putMany por id sobrescrevia uma previsao com a outra em silencio,
      // fazendo a tela de Lancamentos "pular" pro numero da compra que
      // venceu por ultimo no syncPredictions.
      const safeKey = (g.key + '|' + m.ym).replace(/[^a-zA-Z0-9]/g, '_');
      toAdd.push({
        id: 'seed_' + safeKey,
        descricao: `${g.descricao} (parcela prevista)`,
        valor: m.valor,
        data: m.ym + '-01',
        categoria: categoriaPorKey.get(g.key) || CATEGORIA_A_CLASSIFICAR,
        natureza: 'despesa',
        origem: 'fatura',
        previsto: true,
        contaId,
        formaPagamentoId,
        parcelaKey: g.key,
        parcela_atual: m.numero,
        parcela_total: g.parcelaTotal,
      });
    });
  });

  return { toAdd, toRemoveIds };
}

// Reconstrói os "grupos de parcela" de uma conta/cartão a partir das
// TRANSACTIONS já salvas (confirmadas e previstas), pra alimentar
// computeParcelaGroups sem depender de allFaturaRows (que só existe no
// momento de uma importação) — é o que a aba Parcelas usa pra mostrar
// parcelamentos em aberto a qualquer momento, inclusive antes de qualquer
// fatura nova chegar.
//
// A "âncora" de cada parcelaKey (linha que representa o que JÁ aconteceu)
// segue esta prioridade: (1) a CONFIRMADA (!previsto) de maior
// parcela_atual — nunca uma previsão: syncPredictions sempre gera TODAS as
// previsões restantes de uma vez (2/5, 3/5, 4/5, 5/5, por exemplo), então
// usar o maior parcela_atual ENTRE elas escolheria sempre a ÚLTIMA (5/5,
// remaining=0), fazendo o grupo inteiro sumir mesmo a compra tendo acabado
// de ser importada. (2) Só havendo previsões (compra nova, ainda na
// parcela 1/n, que autoConfirmParcelas nunca confirma sozinha), a de MENOR
// parcela_atual — a próxima a vencer — assim "remaining" conta a partir
// dali em vez de já saltar pra última.
function melhorAncoraDeParcela(a, b) {
  if (!a.previsto && b.previsto) return a;
  if (a.previsto && !b.previsto) return b;
  if (!a.previsto && !b.previsto) return a.parcela_atual > b.parcela_atual ? a : b;
  return a.parcela_atual < b.parcela_atual ? a : b;
}

export function parcelaGroupsDaConta(transactions, contaId) {
  const porKey = new Map();
  (transactions || [])
    .filter((t) => t.parcelaKey && t.parcela_total && t.contaId === contaId)
    .forEach((t) => {
      const atual = porKey.get(t.parcelaKey);
      porKey.set(t.parcelaKey, atual ? melhorAncoraDeParcela(atual, t) : t);
    });
  const rowsDoGrupo = [...porKey.values()].map((t) => ({
    tipo: 'parcelamento',
    descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''),
    data: t.data, vencimento: t.data,
    parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor,
    key: t.parcelaKey,
  }));
  return computeParcelaGroups(rowsDoGrupo);
}

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

export function autoConfirmParcelas(faturaRows, transactions, dataCorte, contaId, formaPagamentoId) {
  const byId = new Map((transactions || []).map((t) => [t.id, t]));
  const confirmed = [];
  const removedIds = [];
  const usedIds = new Set();

  for (const row of faturaRows || []) {
    if (row.tipo !== 'parcelamento') continue;
    const key = computeParcelaKey(row.descricao, row.data, row.parcela_total);
    // parcelaKey identifica a COMPRA inteira, não uma parcela específica —
    // uma previsão da parcela 4/5 (previsto:true, mesma parcelaKey) nunca
    // pode virar candidata pra confirmar a linha da fatura que representa a
    // parcela 2/5 da mesma compra. Sem o filtro por parcela_atual, isso
    // "roubava" uma previsão de uma parcela FUTURA como se fosse a mesma
    // parcela desta linha, deixando pra trás o candidato certo (ou, pior,
    // nenhum candidato de verdade) — bug real visto em produção junto com o
    // de `proprioLancamentoManual` logo abaixo, mesma causa raiz.
    const candidates = (transactions || []).filter((t) => t.previsto && t.parcelaKey === key && t.parcela_atual === row.parcela_atual && !usedIds.has(t.id));
    let candidate = null;
    if (candidates.length) {
      candidates.sort((a, b) => dateDiffDays(a.data, row.vencimento) - dateDiffDays(b.data, row.vencimento));
      candidate = candidates[0];
    }
    if (!candidate && !(row.parcela_atual > 1)) continue; // parcela 1 de verdade: exige confirmação manual

    // Lançamento REAL (não previsto) já existente com a MESMA parcelaKey —
    // pode ser QUALQUER parcela da mesma compra, usado só para herdar a
    // categoria (ex.: a parcela 1/6 já confirmada empresta a categoria pra
    // parcela 2/6 chegando agora). Mantido solto, sem exigir parcela_atual
    // igual, porque herdar categoria de uma parcela IRMÃ (diferente) da
    // mesma compra sempre foi o comportamento esperado.
    const irmaoReal = !candidate ? (transactions || []).find((t) => !t.previsto && t.parcelaKey === key) : null;

    // Caso mais específico: a PRÓPRIA parcela que esta linha representa (mesma
    // parcelaKey E mesmo parcela_atual) já foi lançada manualmente antes (ex.:
    // "+lançar" ou digitada à mão antes da fatura chegar). Sem tratar isso
    // como o registro a ATUALIZAR (em vez de criar um novo), reimportar a
    // fatura (ou importar uma 2ª fatura que ainda traz a MESMA parcela, ex.
    // fatura reemitida) criava uma transação `confirmed_...` NOVA do zero: o
    // lançamento manual original ficava "solto" (nunca virava `usedIds`,
    // reaparecia em "No app, não na fatura") e a nova confirmada aparecia
    // como cópia duplicada em "Conciliado automaticamente" — bug real visto
    // em produção.
    const proprioLancamentoManual = !candidate
      ? (transactions || []).find((t) => !t.previsto && t.parcelaKey === key && t.parcela_atual === row.parcela_atual)
      : null;

    const descricaoBase = (candidate ? candidate.descricao : row.descricao).replace(/\s*\(parcela prevista\)\s*$/i, '');
    const newId = proprioLancamentoManual ? proprioLancamentoManual.id : `confirmed_${key.replace(/[^a-zA-Z0-9]/g, '_')}_${row.vencimento}`;
    if (candidate) {
      usedIds.add(candidate.id);
      if (candidate.id !== newId) { byId.delete(candidate.id); removedIds.push(candidate.id); }
    } else if (proprioLancamentoManual) {
      usedIds.add(proprioLancamentoManual.id);
    }
    const updated = {
      id: newId,
      descricao: descricaoBase,
      valor: row.valor,
      data: dataCorte || row.vencimento,
      categoria: candidate ? candidate.categoria : (irmaoReal ? irmaoReal.categoria : CATEGORIA_A_CLASSIFICAR),
      natureza: 'despesa',
      origem: 'fatura',
      previsto: false,
      conciliadoAutomaticamente: true,
      contaId,
      formaPagamentoId,
      parcela_atual: row.parcela_atual,
      parcela_total: row.parcela_total,
      parcelaKey: key,
    };
    byId.set(updated.id, updated);
    confirmed.push({ before: candidate, after: updated, faturaRow: row });
  }

  return { updatedTransactions: [...byId.values()], confirmed, removedIds };
}

// Divide um total em N parcelas por CENTAVOS inteiros, distribuindo o resto
// (uma unidade de centavo por vez) nas primeiras parcelas — nunca em ponto
// flutuante direto, senão a soma das parcelas diverge do total por residuo.
export function splitParcelas(total, n) {
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / n);
  const remainder = totalCents - baseCents * n;
  const vals = [];
  for (let i = 0; i < n; i++) vals.push((baseCents + (i < remainder ? 1 : 0)) / 100);
  return vals;
}

function normalizeDescLoose(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ' '); }

// Antes de criar uma compra parcelada "do zero" (checkbox manual em
// Lançamentos), verifica se ela já tem algo ligado no app — por identidade
// exata (mesma parcelaKey) ou por uma pista mais fraca (linha de fatura já
// importada com parcela_atual > 1, descrição parecida, valor de parcela
// próximo, data de compra próxima). As TRÊS condições fracas juntas evitam
// disparar aviso pra qualquer compra homônima não relacionada — comerciantes
// recorrentes geram várias linhas de parcelamento genuinamente diferentes
// com a mesma descrição ao longo do tempo.
export function findParcelaDuplicates(transactions, allFaturaRows, desc, data, n, valorParcela) {
  const key = computeParcelaKey(desc, data, n);
  const normDesc = normalizeDescLoose(desc);
  const fuzzyRows = (allFaturaRows || []).filter((r) =>
    r.tipo === 'parcelamento' && r.parcela_atual > 1 &&
    Math.abs(r.valor - valorParcela) < 0.05 &&
    Math.abs((new Date(r.data + 'T00:00:00') - new Date(data + 'T00:00:00')) / 86400000) <= 15 &&
    (normalizeDescLoose(r.descricao).includes(normDesc) || normDesc.includes(normalizeDescLoose(r.descricao)))
  );
  const fuzzyKeys = new Set(fuzzyRows.map((r) => computeParcelaKey(r.descricao, r.data, r.parcela_total)));
  return (transactions || []).filter((t) => t.parcelaKey === key || (t.parcelaKey && fuzzyKeys.has(t.parcelaKey)));
}
