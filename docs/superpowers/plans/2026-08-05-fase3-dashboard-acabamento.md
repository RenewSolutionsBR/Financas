# Fase 3 — Dashboard, acabamento e documentação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a aba Dashboard (tile de total, rosca por categoria, barras mensais, filtros ano/mês/forma/conta), adicionar filtro de conta/cartão em Lançamentos, revisar responsividade e dark mode em todo o app, fechar lacunas reais de cobertura de teste, e escrever os 3 documentos finais do projeto.

**Architecture:** Dois agregadores puros novos (`totaisPorCategoria`, `totaisPorMes`) em `domain/transactions.js`, testáveis em Node sem DOM. `ui/dashboard.js` novo, mesmo padrão de `ui/lancamentos.js` (estado de módulo para filtros, `render*()` chamado pelo roteador de `app.js`). Gráficos são CSS puro (`conic-gradient` para a rosca, `<div>`s com altura proporcional para as barras) — zero dependência nova. `ui/lancamentos.js` ganha um `<select>` a mais na `barraFiltros` existente, mesmo padrão do `selForma` já ali.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime. Testes via `node tools/run-tests.mjs` (puro) e `tools/tests.html` (browser). Verificação visual via Playwright MCP.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot, teste ou fixture. Nunca usar nomes, números de cartão/conta ou valores reais em nenhum artefato, mesmo temporário.
- Datas ISO internamente (`YYYY-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Valores monetários sempre positivos; sinal via `natureza`/`sinal`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Nenhum arquivo deve passar de ~250 linhas.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado (`el`, `id`, `ym`). Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- `filterTransactions`/`totaisPorForma` (já existentes) são o modelo de estilo para os dois agregadores novos: recebem `transactions` já filtradas, devolvem `Map`, ignoram valor não-finito em vez de deixá-lo contaminar o grupo (mesma guarda de `sumDespesas`).
- Dashboard mostra gasto REAL: todo agregador novo usa `contaComoGasto(t)` como guarda, igual a `sumDespesas`/`totaisPorForma` — nunca soma `previsto: true` nem naturezas que não são despesa.

---

### Task 1: Agregadores de dashboard em `domain/transactions.js`

**Files:**
- Modify: `src/domain/transactions.js` (adicionar `totaisPorCategoria`, `totaisPorMes` ao lado de `totaisPorForma`)
- Test: `tests/transactions.test.js` (adicionar `describe` novo)

**Interfaces:**
- Consumes: `contaComoGasto(t)`, `round2(n)` de `../core/money.js` (já importado no arquivo), `monthKey(iso)` de `../core/dates.js` (import novo), `CATEGORIA_A_CLASSIFICAR` de `./categories.js` (import novo).
- Produces: `totaisPorCategoria(transactions) => Map<categoriaId, valor>`, `totaisPorMes(transactions) => Map<'YYYY-MM', valor>`. `ui/dashboard.js` (Task 3) consome as duas.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Adicionar ao final de `tests/transactions.test.js` (o arquivo já importa `describe, it, assert, assertEqual, assertDeepEqual` de `./harness.js` e a função `t(over)` no topo — reusar as duas):

```js
describe('transactions: totais por categoria', () => {
  it('agrupa só o que conta como gasto', () => {
    const lista = [
      t({ id: 'a', valor: 30, categoria: 'casa' }),
      t({ id: 'b', valor: 12.5, categoria: 'casa' }),
      t({ id: 'c', valor: 8, categoria: 'lazer' }),
      t({ id: 'd', valor: 999, categoria: 'casa', natureza: 'receita' }),
      t({ id: 'e', valor: 500, categoria: 'casa', previsto: true }),
    ];
    const totais = totaisPorCategoria(lista);
    assertEqual(totais.get('casa'), 42.5);
    assertEqual(totais.get('lazer'), 8);
  });

  it('lançamento sem categoria cai em A Classificar', () => {
    const mapa = totaisPorCategoria([t({ id: 'a', valor: 10, categoria: undefined })]);
    assertEqual(mapa.get(CATEGORIA_A_CLASSIFICAR), 10);
  });

  it('um valor ilegível não contamina o grupo', () => {
    const lista = [t({ id: 'a', valor: 10, categoria: 'casa' }), t({ id: 'b', valor: 'abc', categoria: 'casa' })];
    assertEqual(totaisPorCategoria(lista).get('casa'), 10);
  });

  it('lista vazia devolve Map vazio', () => {
    assertEqual(totaisPorCategoria([]).size, 0);
  });
});

describe('transactions: totais por mês', () => {
  it('agrupa só o que conta como gasto, por YYYY-MM', () => {
    const lista = [
      t({ id: 'a', data: '2026-05-10', valor: 30 }),
      t({ id: 'b', data: '2026-05-20', valor: 12.5 }),
      t({ id: 'c', data: '2026-06-01', valor: 8 }),
      t({ id: 'd', data: '2026-05-15', valor: 999, natureza: 'receita' }),
    ];
    const totais = totaisPorMes(lista);
    assertEqual(totais.get('2026-05'), 42.5);
    assertEqual(totais.get('2026-06'), 8);
  });

  it('não aplica filtro de mês — quem filtra é o chamador', () => {
    // totaisPorMes soma TUDO que recebe, sem olhar o mês: se filtrasse aqui,
    // a série de barras colapsaria sempre em uma barra só.
    const lista = [t({ id: 'a', data: '2026-01-01', valor: 5 }), t({ id: 'b', data: '2026-12-31', valor: 7 })];
    const totais = totaisPorMes(lista);
    assertEqual(totais.size, 2);
  });

  it('um mês sem dado não aparece no Map (não gera entrada zerada)', () => {
    const totais = totaisPorMes([t({ id: 'a', data: '2026-05-10', valor: 10 })]);
    assert(!totais.has('2026-06'));
    assertEqual(totais.size, 1);
  });

  it('um valor ilegível não contamina o mês', () => {
    const lista = [t({ id: 'a', data: '2026-05-10', valor: 10 }), t({ id: 'b', data: '2026-05-11', valor: NaN })];
    assertEqual(totaisPorMes(lista).get('2026-05'), 10);
  });

  it('lista vazia devolve Map vazio', () => {
    assertEqual(totaisPorMes([]).size, 0);
  });
});
```

Atualizar o import no topo de `tests/transactions.test.js`:

```js
import {
  NATUREZAS, SEM_FORMA, contaComoGasto, validateTransaction, sumDespesas,
  filterTransactions, totaisPorForma, totaisPorCategoria, totaisPorMes, novaTransaction,
} from '../src/domain/transactions.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU em `transactions: totais por categoria` e `transactions: totais por mês` (função não existe / `undefined`).

- [ ] **Step 3: Implementar os dois agregadores**

Em `src/domain/transactions.js`, ajustar os imports do topo:

```js
import { uid } from '../core/ids.js';
import { isValidISO, monthKey } from '../core/dates.js';
import { round2 } from '../core/money.js';
import * as storage from '../core/storage.js';
import { CATEGORIA_A_CLASSIFICAR } from './categories.js';
```

Adicionar logo após `totaisPorForma` (antes de `novaTransaction`):

```js
export function totaisPorCategoria(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    // Mesma guarda de sumDespesas/totaisPorForma: um valor ilegível não pode
    // contaminar o total do grupo inteiro.
    if (!Number.isFinite(valor)) continue;
    const chave = t.categoria || CATEGORIA_A_CLASSIFICAR;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

// Soma por mês (YYYY-MM). NÃO aplica filtro de mês — quem chama já filtrou
// por ano/forma/conta antes (filterTransactions), mas nunca por mês: filtrar
// mês aqui colapsaria a série de barras numa barra só.
export function totaisPorMes(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    if (!Number.isFinite(valor)) continue;
    const chave = monthKey(t.data);
    if (!chave) continue;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos os testes passando, incluindo os novos `describe` de categoria/mês.

- [ ] **Step 5: Commit**

```bash
git add src/domain/transactions.js tests/transactions.test.js
git commit -m "Adiciona agregadores totaisPorCategoria e totaisPorMes para o Dashboard"
```

---

### Task 2: `ui/dashboard.js` — tile de total, rosca por categoria, barras mensais, filtros

**Files:**
- Create: `src/ui/dashboard.js`
- Modify: `src/app.js` (registrar `renderDashboard` em `RENDERIZADORES`)
- Modify: `index.html` (remover placeholder de `#tabDashboard`)

**Interfaces:**
- Consumes: `listTransactions()`, `filterTransactions`, `sumDespesas`, `totaisPorCategoria`, `totaisPorMes` de `../domain/transactions.js` (Task 1); `listCategorias()` de `../domain/categories.js`; `listFormas()` de `../domain/payment-methods.js`; `listAccounts()` de `../domain/accounts.js`; `el` de `./components.js`; `fmtBRL` de `../core/money.js`; `monthKey, todayISO` de `../core/dates.js`.
- Produces: `export async function renderDashboard()` — assinatura idêntica a `renderLancamentos`/`renderParcelas`/`renderConciliacao`, sem argumentos, lê `document.getElementById('tabDashboard')`.

Este é o único task desta fase sem "escreva o teste primeiro": é uma tela de UI que orquestra funções já testadas na Task 1 e em `domain/transactions.js` — o contrato testável é o dos agregadores, não a montagem de DOM. A verificação desta task é visual (Task 5) e a `renderDashboard` em si permanece pequena o bastante para revisão de código pegar erro de composição.

- [ ] **Step 1: Criar `src/ui/dashboard.js`**

```js
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
```

- [ ] **Step 2: Registrar a rota em `src/app.js`**

Adicionar o import e a entrada em `RENDERIZADORES`:

```js
import { renderDashboard } from './ui/dashboard.js';
```

```js
const RENDERIZADORES = {
  Lancamentos: renderLancamentos,
  Cadastros: renderCadastros,
  Parcelas: renderParcelas,
  Conciliacao: renderConciliacao,
  Dashboard: renderDashboard,
};
```

- [ ] **Step 3: Remover o placeholder em `index.html`**

Trocar:

```html
    <section class="tab-panel" id="tabDashboard" role="tabpanel">
      <p class="vazio">O painel de gastos chega na Fase 3.</p>
    </section>
```

por:

```html
    <section class="tab-panel" id="tabDashboard" role="tabpanel"></section>
```

- [ ] **Step 4: Rodar a suíte Node para garantir que nada quebrou**

Run: `node tools/run-tests.mjs`
Expected: mesmo total de testes de antes, todos passando (este arquivo não tem teste Node próprio — é DOM puro).

- [ ] **Step 5: Commit**

```bash
git add src/ui/dashboard.js src/app.js index.html
git commit -m "Cria a aba Dashboard: total do periodo, rosca por categoria, barras mensais e filtros"
```

---

### Task 3: Filtro de conta/cartão em Lançamentos

**Files:**
- Modify: `src/ui/lancamentos.js` (`barraFiltros`, por volta da linha 364-388)
- Test: `tests/lancamentos.test.js`

**Interfaces:**
- Consumes: `ctx.contas` (já carregado em `renderLancamentos`, passado para `barraFiltros(ctx)` — hoje `barraFiltros` só usa `ctx.formas`, vai passar a usar `ctx.contas` também). `filterTransactions` já lê `f.contas` (domain/transactions.js:60), nenhuma mudança de domínio necessária.
- Produces: nenhuma interface nova para outras tasks — mudança contida nesta tela.

- [ ] **Step 1: Ler o teste existente de filtro em `tests/lancamentos.test.js` para confirmar convenção**

Ler o arquivo antes de editar — confirmar se `formaFiltroAtual`/`somenteAutoFiltroAtual` (as duas funções puras espelho do estado do filtro, `ui/lancamentos.js:119-125`) já têm teste próprio nesse arquivo, para seguir o mesmo padrão ao adicionar `contaFiltroAtual`.

- [ ] **Step 2: Escrever o teste que falha primeiro**

Adicionar a `tests/lancamentos.test.js` (mesmo `describe` onde `formaFiltroAtual`/`somenteAutoFiltroAtual` já são testadas, ou um novo `describe('lancamentos: filtro de conta')` se não houver):

```js
describe('lancamentos: filtro de conta', () => {
  it('contaFiltroAtual lê o primeiro item de filtros.contas', () => {
    assertEqual(contaFiltroAtual({ contas: ['acc_1'] }), 'acc_1');
  });

  it('contaFiltroAtual devolve string vazia sem filtro', () => {
    assertEqual(contaFiltroAtual({}), '');
    assertEqual(contaFiltroAtual({ contas: [] }), '');
  });
});
```

Atualizar o import do topo do arquivo para incluir `contaFiltroAtual` ao lado de `formaFiltroAtual`/`somenteAutoFiltroAtual` (a linha de import exata depende do que já está lá — ler o arquivo no Step 1 antes de editar o import).

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — `contaFiltroAtual is not defined` ou `undefined`.

- [ ] **Step 4: Implementar em `src/ui/lancamentos.js`**

Adicionar a função pura ao lado de `formaFiltroAtual`/`somenteAutoFiltroAtual` (linhas 119-125):

```js
export function contaFiltroAtual(filtros) {
  return ((filtros || {}).contas || [])[0] || '';
}
```

Editar `barraFiltros(ctx)` (linhas 364-388) para adicionar o `<select>` de conta, mesmo padrão do `selForma` já ali. Trocar:

```js
function barraFiltros(ctx) {
  const inpMes = el('input', { type: 'month', value: filtros.mes || '' });
  inpMes.addEventListener('change', async () => { filtros.mes = inpMes.value || undefined; await renderLancamentos(); });

  // A barra de filtro mostra todas as formas, inclusive desativadas: o usuário
  // pode querer olhar o histórico de uma forma que não usa mais.
  const formaAtual = formaFiltroAtual(filtros);
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => {
    filtros.formas = selForma.value ? [selForma.value] : [];
    await renderLancamentos();
  });

  const chkAuto = el('input', { type: 'checkbox', ...(somenteAutoFiltroAtual(filtros) ? { checked: 'checked' } : {}) });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await renderLancamentos(); });

  return el('div', { class: 'filtros' }, [
    campo('Mês', inpMes),
    campo('Forma', selForma),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}
```

por:

```js
function barraFiltros(ctx) {
  const inpMes = el('input', { type: 'month', value: filtros.mes || '' });
  inpMes.addEventListener('change', async () => { filtros.mes = inpMes.value || undefined; await renderLancamentos(); });

  // A barra de filtro mostra todas as formas, inclusive desativadas: o usuário
  // pode querer olhar o histórico de uma forma que não usa mais.
  const formaAtual = formaFiltroAtual(filtros);
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => {
    filtros.formas = selForma.value ? [selForma.value] : [];
    await renderLancamentos();
  });

  // Mesmo raciocínio do filtro de forma: mostra contas/cartões desativados
  // também, para não esconder o histórico de algo que o usuário já não usa.
  const contaAtual = contaFiltroAtual(filtros);
  const selConta = el('select', {}, [
    el('option', { value: '', text: 'Todas as contas/cartões', ...(contaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === contaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selConta.addEventListener('change', async () => {
    filtros.contas = selConta.value ? [selConta.value] : [];
    await renderLancamentos();
  });

  const chkAuto = el('input', { type: 'checkbox', ...(somenteAutoFiltroAtual(filtros) ? { checked: 'checked' } : {}) });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await renderLancamentos(); });

  return el('div', { class: 'filtros' }, [
    campo('Mês', inpMes),
    campo('Forma', selForma),
    campo('Conta/cartão', selConta),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos os testes passando, incluindo os novos de `contaFiltroAtual`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/lancamentos.js tests/lancamentos.test.js
git commit -m "Adiciona filtro de conta/cartao na barra de filtros de Lancamentos"
```

---

### Task 4: CSS do Dashboard e polimento de responsividade/dark mode

**Files:**
- Modify: `styles.css` (novo bloco `/* --- Aba Dashboard --- */`, mais revisão de breakpoints existentes)

**Interfaces:**
- Consumes: variáveis de tema já existentes (`--papel`, `--tinta`, `--tinta-fraca`, `--latao`, `--linha`, `--erro`, `--ok`, `--font-mono`) — nenhuma variável nova. Classes consumidas: todas as usadas em `ui/dashboard.js` (Task 2) — `dash-tile-total`, `dash-tile-rotulo`, `dash-tile-valor`, `dash-rosca-bloco`, `dash-rosca`, `dash-legenda`, `dash-legenda-cor`, `dash-legenda-nome`, `dash-legenda-valor`, `dash-barras`, `dash-barra-col`, `dash-barra`, `dash-barra-valor`, `dash-barra-rotulo`.
- Produces: nenhuma interface nova — mudança só de apresentação.

- [ ] **Step 1: Adicionar o bloco de CSS do Dashboard ao final de `styles.css`**

```css
/* --- Aba Dashboard --- */

.dash-tile-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 0;
}
.dash-tile-rotulo { font-size: 0.8rem; text-transform: capitalize; color: var(--tinta-fraca); }
.dash-tile-valor { font-family: var(--font-mono); font-size: 1.8rem; font-weight: 700; }

.dash-rosca-bloco {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  padding: 12px 0;
}
.dash-rosca {
  flex: 0 0 auto;
  width: 160px;
  height: 160px;
  border-radius: 50%;
}
.dash-legenda {
  flex: 1 1 200px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dash-legenda li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}
.dash-legenda-cor {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dash-legenda-nome { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tinta); }
.dash-legenda-valor { flex: 0 0 auto; font-family: var(--font-mono); font-weight: 600; }

.dash-barras {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 0;
  overflow-x: auto;
  min-height: 160px;
}
.dash-barra-col {
  flex: 1 0 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
  justify-content: flex-end;
}
.dash-barra-valor { font-size: 0.65rem; color: var(--tinta-fraca); white-space: nowrap; }
.dash-barra {
  width: 100%;
  min-height: 2px;
  background: var(--latao);
  border-radius: 3px 3px 0 0;
}
.dash-barra-rotulo { font-size: 0.72rem; text-transform: capitalize; color: var(--tinta-fraca); }
```

- [ ] **Step 2: Revisar responsividade — breakpoint de tela pequena**

Ler `styles.css` por inteiro para localizar se já existe algum `@media (max-width: ...)`. Se não existir nenhum, adicionar ao final do arquivo:

```css
@media (max-width: 480px) {
  .tabbar { flex-wrap: wrap; }
  .dash-rosca-bloco { flex-direction: column; align-items: flex-start; }
  .dash-rosca { width: 130px; height: 130px; }
  .item-form-lote > select { flex-basis: 100%; }
}
```

Se já existir um breakpoint, integrar as regras acima nele em vez de criar um segundo bloco duplicado — checar visualmente na Task 5 quais outras telas (Lançamentos, Conciliação) realmente estouram largura em 375px antes de adicionar regra especulativa.

- [ ] **Step 3: Confirmar que o `@media (prefers-color-scheme: dark)` já existente cobre as variáveis novas**

Ler o bloco `@media (prefers-color-scheme: dark)` em `styles.css` (já existe, mencionado no spec seção 5) e confirmar que ele redefine `--papel`, `--tinta`, `--tinta-fraca`, `--linha`, `--latao` — as únicas variáveis usadas no CSS desta task. Como o Dashboard não introduz nenhuma variável nova, não deve ser necessário editar o bloco dark — só confirmar por leitura, não assumir.

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "Estiliza a aba Dashboard e ajusta breakpoint de tela pequena"
```

(Este commit fica pendente de ajuste depois da verificação visual da Task 5 — normal que a Task 5 gere um commit de retoque em cima deste.)

---

### Task 5: Verificação visual em navegador real (Playwright) — Dashboard e responsividade

**Files:** nenhum arquivo novo — esta task só verifica e, se achar problema, corrige `src/ui/dashboard.js` e/ou `styles.css`.

**Interfaces:**
- Consumes: app já rodando localmente (`python -m http.server` ou equivalente, servindo a raiz do projeto), Playwright MCP (`browser_navigate`, `browser_evaluate` para seed sintético via `storage.put`/`putMany`, `browser_select_option`, `browser_take_screenshot` com `fullPage: true`, `browser_run_code_unsafe` com `page.emulateMedia({colorScheme})` e `page.setViewportSize(...)`).

- [ ] **Step 1: Subir servidor estático local e seedar dados 100% sintéticos**

Nunca usar nome, número de conta/cartão ou valor real — só identificadores fictícios (`CATEGORIA EXEMPLO`, `LOJA EXEMPLO`, `Conta Exemplo`), seguindo a mesma disciplina já usada nos testes do parser de fatura.

Seed mínimo via `browser_evaluate`: 1 conta, 1 cartão, `categories`/`paymentMethods` (usar `seedCategoriasIfEmpty`/`seedFormasIfEmpty` se ainda vazias), e ~10 transações de despesa real espalhadas em pelo menos 3 categorias e 3 meses diferentes (incluir 1-2 meses fora do ano corrente, para testar o filtro de ano).

- [ ] **Step 2: Abrir a aba Dashboard e tirar screenshot em desktop, claro e escuro**

`browser_navigate` até a aba Dashboard (clicar em `button[data-tab=Dashboard]`), `browser_take_screenshot(fullPage: true)`. Repetir com `page.emulateMedia({colorScheme: 'dark'})`.

Checar visualmente: tile de total mostra valor plausível para o período; rosca renderiza fatias coloridas proporcionais; legenda lista todas as categorias com gasto; barras mensais mostram até 12 colunas, mais alta = maior gasto.

- [ ] **Step 3: Testar os 4 filtros mudando o resultado**

Trocar ano (`browser_select_option` no `<select>` de ano) e confirmar que o tile/rosca/barras mudam. Repetir para mês (`<input type=month>`, via `browser_evaluate` setando `.value` e disparando `change`, já que `<input type=month>` não tem uma API de fill trivial no Playwright), forma e conta.

- [ ] **Step 4: Testar responsividade em tela pequena**

`page.setViewportSize({width: 375, height: 800})` via `browser_run_code_unsafe`. Screenshot da aba Dashboard, Lançamentos e Conciliação. Checar: nenhum overflow horizontal na página (scroll da página inteira, não dos containers que já têm `overflow-x:auto` de propósito como `.dash-barras`); barra de abas não quebra layout; rosca não estoura a largura da tela.

- [ ] **Step 5: Corrigir o que a verificação achar**

Qualquer problema achado nos Steps 2-4 é corrigido diretamente em `src/ui/dashboard.js` (Task 2) ou `styles.css` (Task 4) nesta mesma task — não abrir uma task nova para isso. Repetir os screenshots relevantes depois da correção até confirmar visualmente.

- [ ] **Step 6: Rodar a suíte completa uma última vez**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 7: Commit (se Step 5 gerou mudança)**

```bash
git add src/ui/dashboard.js styles.css
git commit -m "Ajusta Dashboard apos verificacao visual (responsividade/dark mode)"
```

Se nenhuma mudança foi necessária, pular o commit desta task.

---

### Task 6: Revisão de cobertura de testes contra a seção 10 do spec original

**Files:** variam conforme o que a revisão encontrar — nenhum arquivo fixo previamente.

**Interfaces:** nenhuma nova — esta task só lê e, se achar lacuna real, escreve teste para código já existente (não para código desta fase, que já foi coberto nas Tasks 1 e 3).

- [ ] **Step 1: Ler a seção 10 do spec original**

Ler `docs/superpowers/specs/2026-07-29-financas-multi-conta-design.md`, seção 10 (lista de cobertura de teste esperada).

- [ ] **Step 2: Cruzar cada item da seção 10 contra os arquivos de teste existentes**

Listar `tests/*.test.js` (33 arquivos na raiz de testes, na última contagem) e mapear cada item da seção 10 a um arquivo real, mesmo que o nome não bata literalmente (o spec desta fase já identifica que `reconcile-card.test.js`, `reconcile-bank.test.js`, `pagamento-fatura.test.js`, `classification.test.js`, `santander-cartao-pdf.test.js` + `santander-cartao-pdf-extrair.test.js`, `santander-extrato-xls.test.js` cobrem o que a seção 10 chamava de `importers.test.js` — não recriar sob o nome antigo).

- [ ] **Step 3: Confirmar `migration.test.js` (conversão v1→v2)**

Ler `tests/migration.test.js` e confirmar que cobre o caminho de conversão de schema v1→v2 (`core/db-schema.js`) de ponta a ponta. Já existe no repo — não recriar do zero.

- [ ] **Step 4: Fechar lacunas reais encontradas**

Se o Step 2 ou 3 encontrar um requisito da seção 10 sem nenhum teste correspondente em nenhum arquivo (não um teste "com nome diferente", uma ausência real), escrever o teste no arquivo de teste apropriado ao módulo, seguindo o padrão de `describe`/`it` já usado em todo o repo (ver `tests/transactions.test.js` como referência de estilo). Se não houver lacuna real, este step não produz nenhuma mudança — está tudo bem, é o resultado esperado depois de duas fases já revisadas.

- [ ] **Step 5: Rodar a suíte completa**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 6: Commit (só se o Step 4 produziu mudança)**

```bash
git commit -m "Fecha lacuna de cobertura identificada na revisao da secao 10 do spec original"
```

Se não houve lacuna, pular — não criar commit vazio nem commit "confirma cobertura completa" sem diff.

---

### Task 7: Documentação final — `MANUAL_USUARIO.md`, `DOCUMENTACAO_TECNICA.md`, `CONTEUDO_PROJETO.md`

**Files:**
- Create: `docs/MANUAL_USUARIO.md`
- Create: `docs/DOCUMENTACAO_TECNICA.md`
- Create: `docs/CONTEUDO_PROJETO.md`

**Interfaces:** nenhuma — são documentos, não código.

- [ ] **Step 1: Escrever `docs/MANUAL_USUARIO.md`**

Linguagem não técnica, uma seção por aba (Lançamentos, Conciliação, Parcelas, Dashboard, Cadastros), cobrindo: o que a aba faz, como lançar/importar/filtrar, o que cada botão faz. Sem screenshot com dado real — se incluir imagem, gerar com dado 100% sintético ou omitir.

- [ ] **Step 2: Escrever `docs/DOCUMENTACAO_TECNICA.md`**

Cobrir: arquitetura (`core`/`domain`/`importers`/`ui`, por que a separação existe — ler os comentários de topo de arquivo já presentes em cada camada como fonte, não inventar), schema do IndexedDB (ler `src/core/db-schema.js`), convenções de id (`seed_`/`confirmed_`/`uid()` — ler `src/core/ids.js` e os usos em `domain/parcelas.js`), a regra de ouro (`natureza === 'despesa' && !previsto`, `contaComoGasto` em `domain/transactions.js`), como rodar os testes (`node tools/run-tests.mjs` e `tools/tests.html`).

- [ ] **Step 3: Escrever `docs/CONTEUDO_PROJETO.md`**

Histórico do projeto por fase (Fase 1: cadastros/lançamentos multi-conta; Fase 2: importação/conciliação fatura e extrato; Fase 3: dashboard e acabamento), decisões importantes com o porquê (isolamento por cartão — `plasticosDoTitular` em `domain/accounts.js`; janela de 3 níveis de conciliação — ler `domain/reconcile-card.js`; regra de registro único do pagamento de fatura — `domain/pagamento-fatura.js`), pendências conhecidas fora de escopo com o motivo (ex.: gráfico por forma de pagamento no Dashboard, decidido fora de escopo nesta fase por YAGN — spec Fase 3, seção 2).

- [ ] **Step 4: Revisar os 3 documentos contra o checklist de privacidade**

Reler os 3 arquivos procurando qualquer nome, número de conta/cartão, valor ou dado real que possa ter vazado de exemplos — mesma disciplina de todo o projeto (repositório é público).

- [ ] **Step 5: Commit**

```bash
git add docs/MANUAL_USUARIO.md docs/DOCUMENTACAO_TECNICA.md docs/CONTEUDO_PROJETO.md
git commit -m "Escreve documentacao final: manual do usuario, documentacao tecnica e conteudo do projeto"
```

---

### Task 8: Verificação de fim de fase e deploy

**Files:** nenhum arquivo novo — task de verificação e, se necessário, push.

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a checklist de "Verificação de fim de fase" do spec (seção 9)**

Ler `docs/superpowers/specs/2026-08-04-fase3-dashboard-acabamento-design.md`, seção 9, e confirmar cada item:
- `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- `tools/tests.html` mostra todos os testes verdes, inclusive os de navegador (abrir no Playwright e conferir visualmente — não tem runner headless para os `.browser.test.js`)
- Dashboard verificado em navegador real, 2 tamanhos de tela, 2 temas, filtros mudando o resultado — já feito na Task 5, só confirmar que segue válido depois das Tasks 6-7
- Filtro de conta em Lançamentos funcionando, mesmo padrão visual do filtro de forma — já feito na Task 3, confirmar visualmente uma vez
- Os 3 documentos escritos e revisados — Task 7
- Nenhum dado pessoal em nenhum artefato desta fase

- [ ] **Step 2: Push para `origin/main`**

Confirmar com o usuário antes de dar push (mesmo processo já seguido nesta sessão para os commits anteriores) — a menos que já tenha autorização permanente de "trabalhar direto na main" para o resto desta fase.

```bash
git push origin main
```

- [ ] **Step 3: Confirmar deploy no GitHub Pages**

Esperar propagação (pode levar minutos, já observado nesta sessão), depois `curl` num arquivo alterado (ex.: `src/ui/dashboard.js`) contra a URL pública para confirmar que o servidor já tem a versão nova, mesma técnica já usada nesta sessão para confirmar deploy dos bugfixes anteriores. Reportar ao usuário para testar no navegador/celular real, avisando sobre cache local se o app for um PWA instalado.

