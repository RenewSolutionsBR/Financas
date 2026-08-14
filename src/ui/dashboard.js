// Aba Dashboard: tile de total do período, rosca por categoria (CSS puro,
// conic-gradient), barras mensais (últimos 12 meses com dado, CSS puro) e
// filtros (ano, mês, forma, conta). Layout replica o dashboard do app
// anterior; o filtro por forma é o único item novo desta fase (spec Fase 3,
// seção 3).

import { el } from './components.js';
import { campo } from './cadastros-comuns.js';
import { fmtBRL } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import {
  listTransactions, filterTransactions, sumDespesas, totaisPorCategoria, totaisPorMes,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts } from '../domain/accounts.js';

// Estado de módulo, mesmo padrão de ui/lancamentos.js: sobrevive a
// re-renders internos (troca de filtro), reseta ao entrar na aba vindo de
// outro lugar não é necessário aqui (dashboard não tem edição em curso para
// perder). `ano` NÃO é inicializado aqui de propósito: o módulo pode ficar
// carregado (PWA) atravessando a virada de ano, então o ano-padrão é
// resolvido a cada render em painelFiltros/tileTotal via `?? todayISO()`,
// nunca gravado de volta a não ser que o usuário escolha explicitamente no
// select (inclusive a opção "Todos os anos", que grava '').
let filtros = {};

function nomeMes(ym) {
  return new Date(ym + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function tileTotal(visiveis) {
  const total = sumDespesas(visiveis);
  const anoRotulo = filtros.ano ?? todayISO().slice(0, 4);
  const rotulo = filtros.mes ? nomeMes(filtros.mes) : (anoRotulo ? `Ano de ${anoRotulo}` : 'Todos os anos');
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
  // `??` (não `||`): filtros.ano pode ser '' de propósito (usuário escolheu
  // "Todos os anos"), e isso é diferente de nunca ter sido definido.
  const anoAtual = filtros.ano ?? todayISO().slice(0, 4);

  const selAno = el('select', {}, [
    el('option', { value: '', text: 'Todos os anos', ...(anoAtual === '' ? { selected: 'selected' } : {}) }),
    ...anos.map((a) =>
      el('option', { value: a, text: a, ...(a === anoAtual ? { selected: 'selected' } : {}) })
    ),
  ]);
  // Grava '' (não `undefined`) quando o usuário escolhe "Todos os anos": é
  // preciso distinguir essa escolha explícita de "nunca escolhido" para que
  // o próprio select continue mostrando "Todos os anos" selecionado nos
  // próximos renders (ver `anoAtual` acima). Para filterTransactions() isso
  // não muda nada — lá `''` e `undefined` já são tratados como "sem filtro".
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
    campo('Ano', selAno),
    campo('Mês', inpMes),
    campo('Forma', selForma),
    campo('Conta/cartão', selConta),
    campo('Categoria', seletorCategorias(ctx.categorias)),
  ]);
}

// `<select multiple>` nativo é ruim em touch (exige Ctrl/Cmd+clique ou
// gestos não óbvios no celular) — por isso um dropdown de checkboxes sobre
// <details>/<summary>, que abre/fecha sem JS de posicionamento e funciona
// igual em mouse e touch.
function seletorCategorias(categorias) {
  const selecionadas = filtros.categorias || [];
  const rotulo = !selecionadas.length
    ? 'Todas as categorias'
    : selecionadas.length === 1
      ? (categorias.find((c) => c.id === selecionadas[0]) || {}).nome || selecionadas[0]
      : `${selecionadas.length} categorias`;

  const detalhes = el('details', { class: 'combo-multi' }, [
    el('summary', { text: rotulo }),
    el('div', { class: 'combo-multi-lista' }, categorias.map((c) => {
      const chk = el('input', {
        type: 'checkbox', value: c.id,
        ...(selecionadas.includes(c.id) ? { checked: 'checked' } : {}),
      });
      chk.addEventListener('change', async () => {
        const atuais = new Set(filtros.categorias || []);
        chk.checked ? atuais.add(c.id) : atuais.delete(c.id);
        filtros.categorias = [...atuais];
        await renderDashboard();
      });
      return el('label', { class: 'combo-multi-item' }, [chk, el('span', { text: c.nome })]);
    })),
  ]);
  return detalhes;
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
  const filtrosComMes = { ano: filtros.ano, mes: filtros.mes, formas: filtros.formas, contas: filtros.contas, categorias: filtros.categorias };
  const filtrosSemMes = { ano: filtros.ano, formas: filtros.formas, contas: filtros.contas, categorias: filtros.categorias };
  const visiveisComMes = filterTransactions(transacoes, filtrosComMes);
  const visiveisSemMes = filterTransactions(transacoes, filtrosSemMes);

  painel.innerHTML = '';
  painel.append(
    painelFiltros(ctx, transacoes),
    tileTotal(visiveisComMes),
    // Todo número desta aba passa por sumDespesas/totaisPor*, que aplicam a
    // regra de ouro (contaComoGasto): só natureza 'despesa' e não previsto.
    // Sem dizer isso na tela, a diferença entre este total e o da aba
    // Parcelas (que é projeção) ou o total impresso numa fatura parecia
    // divergência de cálculo.
    el('p', { class: 'ajuda', text: 'Estes valores são de gastos já lançados e confirmados. Não incluem parcelas futuras previstas, receitas, transferências nem pagamentos de fatura.' }),
    el('h3', { text: 'Gastos por categoria' }),
    roscaCategoria(visiveisComMes, categorias),
    el('h3', { text: 'Últimos meses' }),
    barrasMensais(visiveisSemMes)
  );
}
