// Aba Dashboard: tile de total do período, rosca por categoria (CSS puro,
// conic-gradient), barras mensais (últimos 12 meses com dado, CSS puro) e
// filtros (ano, mês, forma, conta). Layout replica o dashboard do app
// anterior; o filtro por forma é o único item novo desta fase (spec Fase 3,
// seção 3).

import { el } from './components.js';
import { fmtBRL } from '../core/money.js';
import { monthKey, todayISO } from '../core/dates.js';
import {
  listTransactions, filterTransactions, sumDespesas, totaisPorCategoria, totaisPorMes,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts } from '../domain/accounts.js';

// Estado de módulo, mesmo padrão de ui/lancamentos.js: sobrevive a
// re-renders internos (troca de filtro), reseta ao entrar na aba vindo de
// outro lugar não é necessário aqui (dashboard não tem edição em curso para
// perder).
let filtros = { ano: todayISO().slice(0, 4) };

function nomeMes(ym) {
  return new Date(ym + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function tileTotal(visiveis) {
  const total = sumDespesas(visiveis);
  const rotulo = filtros.mes ? nomeMes(filtros.mes) : `Ano de ${filtros.ano || '—'}`;
  return el('div', { class: 'dash-tile-total' }, [
    el('span', { class: 'dash-tile-rotulo', text: rotulo }),
    el('span', { class: 'dash-tile-valor', text: fmtBRL(total) }),
  ]);
}

function roscaCategoria(visiveis, categorias) {
  const totais = totaisPorCategoria(visiveis);
  const somaGeral = [...totais.values()].reduce((a, b) => a + b, 0);
  if (!somaGeral) return el('p', { class: 'vazio', text: 'Nenhum gasto no período para mostrar por categoria.' });

  const nome = (id) => (categorias.find((c) => c.id === id) || {}).nome || id;
  const cor = (id) => (categorias.find((c) => c.id === id) || {}).cor || '#888';

  const entradas = [...totais.entries()].sort((a, b) => b[1] - a[1]);
  let acumulado = 0;
  const fatias = entradas.map(([catId, valor]) => {
    const inicio = (acumulado / somaGeral) * 360;
    acumulado += valor;
    const fim = (acumulado / somaGeral) * 360;
    return `${cor(catId)} ${inicio}deg ${fim}deg`;
  });

  const rosca = el('div', {
    class: 'dash-rosca',
    style: `background: conic-gradient(${fatias.join(', ')});`,
  });

  const legenda = el('ul', { class: 'dash-legenda' }, entradas.map(([catId, valor]) =>
    el('li', {}, [
      el('span', { class: 'dash-legenda-cor', style: `background:${cor(catId)};` }),
      el('span', { class: 'dash-legenda-nome', text: nome(catId) }),
      el('span', { class: 'dash-legenda-valor', text: fmtBRL(valor) }),
    ])
  ));

  return el('div', { class: 'dash-rosca-bloco' }, [rosca, legenda]);
}

function barrasMensais(visiveisSemFiltroDeMes) {
  const totais = totaisPorMes(visiveisSemFiltroDeMes);
  const meses = [...totais.keys()].sort().slice(-12);
  if (!meses.length) return el('p', { class: 'vazio', text: 'Nenhum gasto para mostrar nas barras mensais.' });

  const maior = Math.max(...meses.map((ym) => totais.get(ym)));
  return el('div', { class: 'dash-barras' }, meses.map((ym) => {
    const valor = totais.get(ym);
    const altura = maior > 0 ? Math.round((valor / maior) * 100) : 0;
    return el('div', { class: 'dash-barra-col' }, [
      el('div', { class: 'dash-barra-valor', text: fmtBRL(valor) }),
      el('div', { class: 'dash-barra', style: `height:${altura}%;` }),
      el('div', { class: 'dash-barra-rotulo', text: nomeMes(ym).slice(0, 3) }),
    ]);
  }));
}

function painelFiltros(ctx, transacoes) {
  const anos = [...new Set(transacoes.map((t) => String(t.data || '').slice(0, 4)).filter(Boolean))].sort();
  const anoAtual = filtros.ano || anos[anos.length - 1] || todayISO().slice(0, 4);

  const selAno = el('select', {}, anos.map((a) =>
    el('option', { value: a, text: a, ...(a === anoAtual ? { selected: 'selected' } : {}) })
  ));
  selAno.addEventListener('change', async () => { filtros.ano = selAno.value; await renderDashboard(); });

  const inpMes = el('input', { type: 'month', value: filtros.mes || '' });
  inpMes.addEventListener('change', async () => { filtros.mes = inpMes.value || undefined; await renderDashboard(); });

  const formaAtual = (filtros.formas || [])[0] || '';
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: f.nome, ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => { filtros.formas = selForma.value ? [selForma.value] : []; await renderDashboard(); });

  const contaAtual = (filtros.contas || [])[0] || '';
  const selConta = el('select', {}, [
    el('option', { value: '', text: 'Todas as contas/cartões', ...(contaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.contas.map((c) => el('option', { value: c.id, text: c.nome, ...(c.id === contaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selConta.addEventListener('change', async () => { filtros.contas = selConta.value ? [selConta.value] : []; await renderDashboard(); });

  return el('div', { class: 'filtros' }, [
    el('label', { class: 'campo' }, [el('span', { text: 'Ano' }), selAno]),
    el('label', { class: 'campo' }, [el('span', { text: 'Mês' }), inpMes]),
    el('label', { class: 'campo' }, [el('span', { text: 'Forma' }), selForma]),
    el('label', { class: 'campo' }, [el('span', { text: 'Conta/cartão' }), selConta]),
  ]);
}

export async function renderDashboard() {
  const painel = document.getElementById('tabDashboard');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };

  // Tile e rosca respeitam TODOS os filtros, inclusive mês. As barras usam os
  // mesmos filtros de forma/conta/ano mas ignoram o filtro de mês — senão a
  // série colapsaria numa barra só (mesma razão de totaisPorMes não filtrar
  // mês internamente).
  const filtrosComMes = { ano: filtros.ano, mes: filtros.mes, formas: filtros.formas, contas: filtros.contas };
  const filtrosSemMes = { ano: filtros.ano, formas: filtros.formas, contas: filtros.contas };
  const visiveisComMes = filterTransactions(transacoes, filtrosComMes);
  const visiveisSemMes = filterTransactions(transacoes, filtrosSemMes);

  painel.innerHTML = '';
  painel.append(
    painelFiltros(ctx, transacoes),
    tileTotal(visiveisComMes),
    el('h3', { text: 'Gastos por categoria' }),
    roscaCategoria(visiveisComMes, categorias),
    el('h3', { text: 'Últimos meses' }),
    barrasMensais(visiveisSemMes)
  );
}
