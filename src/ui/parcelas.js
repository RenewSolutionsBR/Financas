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
import { parcelaGroupsDaConta } from '../domain/parcelas.js';
import { listTransactions } from '../domain/transactions.js';
import { listAccounts, TIPO_CARTAO } from '../domain/accounts.js';

export async function renderParcelas() {
  const painel = document.getElementById('tabParcelas');
  const [transactions, contas] = await Promise.all([listTransactions(), listAccounts()]);
  const cartoes = contas.filter((c) => c.tipo === TIPO_CARTAO);

  const porCartao = new Map(cartoes.map((c) => [c.id, parcelaGroupsDaConta(transactions, c.id)]));
  const todosGrupos = cartoes.flatMap((c) => porCartao.get(c.id));

  painel.innerHTML = '';
  if (!todosGrupos.length) {
    painel.append(el('p', { class: 'vazio', text: 'Nenhuma parcela futura no momento.' }));
    return;
  }

  const porMes = new Map();
  todosGrupos.forEach((g) => g.months.forEach((m) => porMes.set(m.ym, (porMes.get(m.ym) || 0) + m.valor)));
  const meses = [...porMes.keys()].sort();

  // Total geral = soma de TODOS os meses previstos, ou seja, quanto ainda
  // falta pagar somando todos os parcelamentos em aberto. Não é o gasto de
  // um mês nem entra em nenhum total da aba Lançamentos/Dashboard (que só
  // contam gasto confirmado — previsto: true nunca conta, ver a regra de
  // ouro em domain/transactions.js): é projeção de compromisso futuro.
  const totalGeral = meses.reduce((soma, ym) => soma + porMes.get(ym), 0);

  const previsao = el('div', { class: 'secao-parcelas' }, [
    el('h3', { text: 'Previsão de parcelas por mês' }),
    el('div', { class: 'previsao-mensal' }, meses.map((ym) => el('div', { class: 'previsao-mensal-linha' }, [
      el('span', { class: 'previsao-mensal-mes', text: formatMesAno(ym) }),
      el('span', { class: 'previsao-mensal-valor', text: fmtBRL(porMes.get(ym)) }),
    ]))),
    el('div', { class: 'previsao-mensal-linha previsao-mensal-total' }, [
      el('span', { class: 'previsao-mensal-mes', text: `Total geral (${meses.length} ${meses.length === 1 ? 'mês' : 'meses'})` }),
      el('span', { class: 'previsao-mensal-valor', text: fmtBRL(totalGeral) }),
    ]),
    el('p', { class: 'ajuda', text: 'Soma de tudo que ainda falta pagar nos parcelamentos em aberto. São valores previstos: não entram nos totais de Lançamentos nem do Dashboard, que só contam gastos já confirmados.' }),
  ]);

  const secoes = cartoes
    .filter((c) => porCartao.get(c.id).length)
    .map((c) => el('div', { class: 'secao-parcelas' }, [
      el('h3', { text: c.nome }),
      ...porCartao.get(c.id).map((g) => el('div', { class: 'grupo-parcela' }, [
        el('div', { class: 'grupo-parcela-titulo', text: `${g.descricao} — ${fmtBRL(g.valor)}/mês` }),
        // parcela ATUAL (a mais avançada já confirmada/prevista) fica de fora
        // de g.months de propósito (computeParcelaGroups só projeta as
        // RESTANTES) — sem mostrar ela aqui, uma compra recém-importada (ainda
        // na parcela 1/n) parecia não ter nenhuma parcela na aba.
        el('div', { class: 'grupo-parcela-meta', text: `parcela ${g.parcelaAtual} de ${g.parcelaTotal} · faltam ${g.remaining}` }),
        g.ancoraNaoConfirmada
          ? el('p', { class: 'grupo-parcela-aviso', text: 'Datas estimadas — confirme a parcela 1 na aba Conciliação ("+ lançar") para usar o vencimento real.' })
          : null,
        el('ul', {}, g.months.map((m) => el('li', { text: `${formatMesAno(m.ym)} — ${fmtBRL(m.valor)}` }))),
      ])),
    ]));

  painel.append(previsao, el('h3', { text: 'Parcelamentos em aberto' }), ...secoes);
}
