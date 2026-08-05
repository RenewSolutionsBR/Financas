// Aba Parcelas: vitrine de computeParcelaGroups (domain/parcelas.js). Não
// escreve nada — só lê transactions e mostra (1) a previsão de parcelas
// somada por mês, em todos os cartões, e (2) o detalhe de cada parcelamento
// em aberto, agrupado por cartão. Layout portado do app anterior
// (renderParcelas em app.js: monthForecast + parcelasList).

function formatMesAno(ym) {
  return new Date(ym + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

import { el } from './components.js';
import { fmtBRL } from '../core/money.js';
import { computeParcelaGroups } from '../domain/parcelas.js';
import { listTransactions } from '../domain/transactions.js';
import { listAccounts, TIPO_CARTAO } from '../domain/accounts.js';

export async function renderParcelas() {
  const painel = document.getElementById('tabParcelas');
  const [transactions, contas] = await Promise.all([listTransactions(), listAccounts()]);
  const cartoes = contas.filter((c) => c.tipo === TIPO_CARTAO);

  // computeParcelaGroups só enxerga LINHA DE FATURA (r.tipo === 'parcelamento'),
  // não transaction — mas cada transaction confirmada por autoConfirmParcelas
  // guarda parcela_atual/parcela_total/parcelaKey/contaId, o suficiente para
  // reconstruir a mesma entrada aqui sem duplicar a fonte de verdade.
  const porCartao = new Map(cartoes.map((c) => [c.id, []]));
  for (const c of cartoes) {
    const rowsDoGrupo = transactions
      .filter((t) => !t.previsto && t.parcelaKey && t.parcela_total && t.contaId === c.id)
      .map((t) => ({ tipo: 'parcelamento', descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''), data: t.data, vencimento: t.data, parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor, key: t.parcelaKey }));
    porCartao.set(c.id, computeParcelaGroups(rowsDoGrupo));
  }

  const todosGrupos = cartoes.flatMap((c) => porCartao.get(c.id));

  painel.innerHTML = '';
  if (!todosGrupos.length) {
    painel.append(el('p', { class: 'vazio', text: 'Nenhuma parcela futura no momento.' }));
    return;
  }

  const porMes = new Map();
  todosGrupos.forEach((g) => g.months.forEach((m) => porMes.set(m.ym, (porMes.get(m.ym) || 0) + m.valor)));
  const meses = [...porMes.keys()].sort();

  const previsao = el('div', { class: 'secao-parcelas' }, [
    el('h3', { text: 'Previsão de parcelas por mês' }),
    el('div', { class: 'previsao-mensal' }, meses.map((ym) => el('div', { class: 'previsao-mensal-linha' }, [
      el('span', { class: 'previsao-mensal-mes', text: formatMesAno(ym) }),
      el('span', { class: 'previsao-mensal-valor', text: fmtBRL(porMes.get(ym)) }),
    ]))),
  ]);

  const secoes = cartoes
    .filter((c) => porCartao.get(c.id).length)
    .map((c) => el('div', { class: 'secao-parcelas' }, [
      el('h3', { text: c.nome }),
      ...porCartao.get(c.id).map((g) => el('div', { class: 'grupo-parcela' }, [
        el('div', { class: 'grupo-parcela-titulo', text: `${g.descricao} — ${g.remaining} parcela(s) restante(s)` }),
        el('ul', {}, g.months.map((m) => el('li', { text: `${m.ym} — ${fmtBRL(m.valor)}` }))),
      ])),
    ]));

  painel.append(previsao, el('h3', { text: 'Parcelamentos em aberto' }), ...secoes);
}
