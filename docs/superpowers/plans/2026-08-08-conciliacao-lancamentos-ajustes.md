# Conciliação de extrato + Lançamentos: ajustes de UI — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir dois bugs e três gaps de layout relatados pelo usuário: (1) `domain/reconcile-bank.js` mostra lançamentos de origem fatura no balde "No app, não no extrato" da Conciliação, que deveriam ficar exclusivos da conciliação de fatura; (2) a Conciliação de extrato não tem filtros de Natureza/Forma nem ação "+ lançar" individual por linha (só em lote); (3) o campo Data de Lançamentos é texto livre sem máscara nem seletor; (4) a lista de Lançamentos não alinha valor/editar/excluir em colunas fixas quando a descrição varia de tamanho.

**Architecture:** Fix pontual em `domain/reconcile-bank.js` (uma condição a mais no filtro do pool). Uma barra de filtros nova em `ui/conciliacao-extrato.js`, reaproveitando o padrão já existente em `ui/lancamentos-filtros.js` (não extraída para módulo comum — o padrão é pequeno o bastante para duplicar sem violar DRY de forma relevante, ver Task 2). Extração de `lancarUma`/`lancarEmLote` compartilhando lógica de aprendizado de regra. Troca de `<input type=text>` para `<input type=date>` em `lancamentos-form.js`, com leitura ISO direta (sem `parseDateBR`). CSS Grid substituindo o flexbox de `.item-lancamento` em `styles.css`.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime. Testes via `node tools/run-tests.mjs` (puro) e `tools/tests.html` (browser). Verificação visual via Playwright MCP.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot, teste ou fixture, mesmo temporário.
- Datas ISO internamente (`YYYY-MM-DD`), `DD/MM/AAAA` só em `ui/` — exceção deliberada: `<input type=date>` exige e devolve ISO no próprio campo, por definição de plataforma, não é violação da regra.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado (`el`, `id`, `ym`). Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Reusar lógica de domínio/UI já existente sempre que possível: `NATUREZAS`/`rotuloNatureza` (`domain/transactions.js`), `runReconciliationBank` (`domain/reconcile-bank.js`), `aplicarRegra`/`aprenderRegra`/`candidatosRetroativos` (`domain/classification.js`) — nenhuma desta lista precisa de mudança de assinatura neste plano, exceto `runReconciliationBank`/o filtro interno do pool (Task 1).

---

### Task 1: Fix — lançamentos de origem fatura não aparecem mais em "No app, não no extrato"

**Files:**
- Modify: `src/domain/reconcile-bank.js:69`
- Test: `tests/reconcile-bank.test.js`

**Interfaces:**
- Consumes: nada novo — `t.origem` já existe em toda transaction criada por importação de fatura (`autoConfirmParcelas`/`processarPagamentoFatura`, `domain/parcelas.js`/`domain/pagamento-fatura.js`, já gravam `origem: 'fatura'` — conferir no código real antes de escrever o teste, ver Step 1).
- Produces: nenhuma interface nova — mudança de comportamento interno de `runReconciliationBank`.

Causa raiz confirmada: `pool` (linha 69) filtra só `!t.previsto`. Uma
parcela confirmada ou um pagamento de fatura que não casa por valor+data
com nenhuma linha do extrato bancário aparece em `appUnmatched` — balde que
deveria conter só lançamentos esperando conciliação bancária (conta
corrente, pix, dinheiro), nunca algo que já pertence à conciliação de
fatura.

- [ ] **Step 1: Confirmar o valor exato de `origem` gravado por importação de fatura**

Ler `src/domain/parcelas.js` (função `autoConfirmParcelas`) e
`src/domain/pagamento-fatura.js` (função `processarPagamentoFatura`) e
confirmar que ambas gravam `origem: 'fatura'` no registro de transaction
que produzem (não `origemRef` — esse é outro campo, usado para rastrear a
linha de origem, já usado em `extrato`). Se o valor gravado for diferente
do esperado (ex.: não gravam `origem` nenhum, ou usam outro literal),
ajustar o Step 2 e o Step 3 para o valor REAL encontrado no código antes de
prosseguir — não adivinhar.

- [ ] **Step 2: Escrever o teste que falha primeiro**

Adicionar a `tests/reconcile-bank.test.js`, dentro do describe
`'reconcile-bank: runReconciliationBank — 4 baldes e idempotencia'`:

```js
  it('lancamento de ORIGEM FATURA nunca aparece em appUnmatched, mesmo sem casar com nenhuma linha do extrato', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [] };
    const parcelaDeFatura = { id: 't1', previsto: false, natureza: 'despesa', origem: 'fatura', contaId: 'acc_cartao_1', data: '2026-05-05', valor: 349.4 };
    const { appUnmatched } = runReconciliationBank(extrato, [parcelaDeFatura], accounts, apelidos, []);
    assertEqual(appUnmatched.length, 0, 'parcela de fatura pertence a conciliacao de fatura, nunca deveria sobrar no balde de extrato');
  });

  it('lancamento de origem EXTRATO (ou sem origem definida) continua aparecendo normalmente em appUnmatched quando nao casa', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [] };
    const semOrigem = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50 };
    const { appUnmatched } = runReconciliationBank(extrato, [semOrigem], accounts, apelidos, []);
    assertEqual(appUnmatched.length, 1, 'lancamento manual/de extrato sem casamento ainda precisa aparecer, senao o usuario nunca sabe que falta reconciliar');
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — o primeiro teste novo (`appUnmatched.length` será 1, não 0).

- [ ] **Step 3: Implementar o fix em `src/domain/reconcile-bank.js`**

Localizar (linha 69):

```js
  const pool = (transactions || []).filter((t) => !t.previsto).map((t) => ({ ...t, used: false }));
```

Trocar para:

```js
  // Lançamentos de origem fatura (parcelas confirmadas, pagamentos de
  // fatura) pertencem exclusivamente à conciliação de fatura
  // (conciliacao-fatura.js) — nunca deveriam sobrar aqui em "No app, não
  // no extrato" só porque não casaram por valor/data com nenhuma linha do
  // extrato bancário.
  const pool = (transactions || []).filter((t) => !t.previsto && t.origem !== 'fatura').map((t) => ({ ...t, used: false }));
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os dois testes novos.

- [ ] **Step 5: Commit**

```bash
git add src/domain/reconcile-bank.js tests/reconcile-bank.test.js
git commit -m "Corrige Conciliacao de extrato: lancamentos de origem fatura nao aparecem mais em No app nao no extrato"
```

---

### Task 2: Filtros de Natureza e Forma na Conciliação de extrato

**Files:**
- Modify: `src/ui/conciliacao-extrato.js`
- Test: `tests/conciliacao-extrato-filtros.test.js` (novo)

**Interfaces:**
- Consumes: `NATUREZAS`, `rotuloNatureza` de `../domain/transactions.js` (já existem, já usados em `lancamentos-filtros.js` — mesmo padrão, sem mudança de assinatura).
- Produces: `export function filtrarPorNaturezaEForma(itens, { natureza, formaPagamentoId }, extrairNatureza, extrairForma)` — função pura genérica o bastante para filtrar tanto pares `{extrato, app}` (baldes matched/autoMatched, usa `par.app.natureza`/`par.app.formaPagamentoId`) quanto transactions cruas (`appUnmatched`, usa `t.natureza`/`t.formaPagamentoId`) quanto linhas de extrato (`extratoUnmatched`, usa `linha.natureza`, sem forma — `extrairForma` pode devolver `null` sempre para esse caso). `renderBaldesExtrato` (mesmo arquivo) passa a montar e usar essa função nos 4 baldes.

Este é o único novo `describe` deste plano com uma decisão de design: em vez
de 4 filtros ad-hoc (um por balde), uma função pura reaproveitada nos 4,
parametrizada por como extrair natureza/forma de cada tipo de item — os 4
baldes têm formatos de item DIFERENTES (`{extrato, app}` vs `transaction`
vs `linha` crua), então a função não pode assumir um shape fixo.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Criar `tests/conciliacao-extrato-filtros.test.js`:

```js
import { describe, it, assertEqual } from './harness.js';
import { filtrarPorNaturezaEForma } from '../src/ui/conciliacao-extrato.js';

const extrairDePar = (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId });
const extrairDeTransaction = (t) => ({ natureza: t.natureza, formaPagamentoId: t.formaPagamentoId });
const extrairDeLinha = (l) => ({ natureza: l.natureza, formaPagamentoId: null });

describe('conciliacao-extrato: filtrarPorNaturezaEForma', () => {
  const pares = [
    { app: { natureza: 'despesa', formaPagamentoId: 'pm_pix' } },
    { app: { natureza: 'receita', formaPagamentoId: 'pm_pix' } },
    { app: { natureza: 'despesa', formaPagamentoId: 'pm_dinheiro' } },
  ];

  it('sem filtro nenhum, devolve tudo', () => {
    const r = filtrarPorNaturezaEForma(pares, {}, extrairDePar);
    assertEqual(r.length, 3);
  });

  it('filtra por natureza', () => {
    const r = filtrarPorNaturezaEForma(pares, { natureza: 'despesa' }, extrairDePar);
    assertEqual(r.length, 2);
  });

  it('filtra por forma de pagamento', () => {
    const r = filtrarPorNaturezaEForma(pares, { formaPagamentoId: 'pm_pix' }, extrairDePar);
    assertEqual(r.length, 2);
  });

  it('combina natureza E forma (AND, nao OR)', () => {
    const r = filtrarPorNaturezaEForma(pares, { natureza: 'despesa', formaPagamentoId: 'pm_pix' }, extrairDePar);
    assertEqual(r.length, 1);
  });

  it('funciona com transactions cruas (appUnmatched)', () => {
    const transacoes = [{ natureza: 'despesa', formaPagamentoId: 'pm_pix' }, { natureza: 'receita', formaPagamentoId: 'pm_pix' }];
    const r = filtrarPorNaturezaEForma(transacoes, { natureza: 'receita' }, extrairDeTransaction);
    assertEqual(r.length, 1);
  });

  it('funciona com linhas de extrato cru (sem forma) — filtro de forma nao exclui nada quando extrairForma devolve null', () => {
    const linhas = [{ natureza: 'despesa' }, { natureza: 'transferencia' }];
    const r = filtrarPorNaturezaEForma(linhas, { formaPagamentoId: 'pm_pix' }, extrairDeLinha);
    assertEqual(r.length, 2, 'linha crua nao tem forma ainda — filtro de forma so vale para itens que a extraem de verdade');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — `filtrarPorNaturezaEForma` não é exportado por `conciliacao-extrato.js`.

- [ ] **Step 3: Implementar em `src/ui/conciliacao-extrato.js`**

Adicionar import no topo:

```js
import { NATUREZAS, rotuloNatureza } from '../domain/transactions.js';
```

Adicionar a função pura, antes de `runReconciliationBank`'s uso (logo após os imports):

```js
// Pura: filtra qualquer lista de itens por natureza/forma, dado como
// extrair {natureza, formaPagamentoId} de CADA TIPO de item — os 4 baldes
// de extrato têm formatos de item diferentes (par {extrato,app}, transaction
// crua, linha crua sem forma ainda) e nao dá pra assumir um shape fixo.
// `extrairForma` que devolve sempre null (linha crua) faz o filtro de forma
// nunca excluir nada para esse tipo de item, de proposito.
export function filtrarPorNaturezaEForma(itens, { natureza, formaPagamentoId } = {}, extrair) {
  return (itens || []).filter((item) => {
    const { natureza: n, formaPagamentoId: f } = extrair(item);
    if (natureza && n !== natureza) return false;
    if (formaPagamentoId && f !== null && f !== formaPagamentoId) return false;
    if (formaPagamentoId && f === null) return false;
    return true;
  });
}
```

Note: a última condição (`f === null` some do resultado quando o filtro de
forma está ativo) é intencional só para itens cujo `extrair` DEVOLVE forma
de verdade (transaction/par) — para linha crua o teste do Step 1 já
confirma que o filtro de forma nunca chega a excluir nada porque
`extrairDeLinha` é chamado só nos baldes que não usam filtro de forma (ver
Step 4, o balde `extratoUnmatched` monta a UI sem o `<select>` de forma).

- [ ] **Step 4: Adicionar a barra de filtros e aplicar nos 4 baldes**

Em `renderBaldesExtrato`, adicionar estado de módulo para os filtros atuais
(mesmo padrão de `filtros` em `lancamentos.js`, mas escopado à função —
usar `let` no topo do arquivo, resetado implicitamente a cada chamada de
`renderBaldesExtrato` não é possível porque precisa sobreviver ao próprio
re-render disparado pelo `<select>`; seguir o padrão real: variável de
módulo, mesma estratégia de `contaSelecionadaId` em `conciliacao.js`):

```js
let filtroNatureza = '';
let filtroForma = '';
```

Montar a barra (função nova no mesmo arquivo, antes de `renderBaldesExtrato`):

```js
function montarBarraFiltrosExtrato(formas, aoMudar) {
  const selNatureza = el('select', {}, [
    el('option', { value: '', text: 'Todas as naturezas', ...(filtroNatureza === '' ? { selected: 'selected' } : {}) }),
    ...NATUREZAS.map((n) => el('option', { value: n, text: rotuloNatureza(n), ...(n === filtroNatureza ? { selected: 'selected' } : {}) })),
  ]);
  selNatureza.addEventListener('change', () => { filtroNatureza = selNatureza.value; aoMudar(); });

  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(filtroForma === '' ? { selected: 'selected' } : {}) }),
    ...formas.map((f) => el('option', { value: f.id, text: f.nome, ...(f.id === filtroForma ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', () => { filtroForma = selForma.value; aoMudar(); });

  return el('div', { class: 'filtros' }, [
    el('label', { class: 'campo' }, [el('span', { text: 'Natureza' }), selNatureza]),
    el('label', { class: 'campo' }, [el('span', { text: 'Forma' }), selForma]),
  ]);
}
```

Em `renderBaldesExtrato`, logo após calcular `autoMatched, matched,
extratoUnmatched, appUnmatched` (linha 153), aplicar o filtro:

```js
  const filtroAtivo = { natureza: filtroNatureza, formaPagamentoId: filtroForma };
  const autoMatchedFiltrado = filtrarPorNaturezaEForma(autoMatched, filtroAtivo, (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId }));
  const matchedFiltrado = filtrarPorNaturezaEForma(matched, filtroAtivo, (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId }));
  const appUnmatchedFiltrado = filtrarPorNaturezaEForma(appUnmatched, filtroAtivo, (t) => ({ natureza: t.natureza, formaPagamentoId: t.formaPagamentoId }));
  const extratoUnmatchedFiltrado = filtrarPorNaturezaEForma(extratoUnmatched, { natureza: filtroNatureza }, (l) => ({ natureza: l.natureza, formaPagamentoId: null }));
```

Trocar as 4 variáveis usadas no `painel.append(...)` final (autoMatched →
autoMatchedFiltrado, matched → matchedFiltrado, appUnmatched →
appUnmatchedFiltrado) e a construção de `linhasFormulario` (que hoje usa
`extratoUnmatched.map(...)`) para usar `extratoUnmatchedFiltrado.map(...)`.
Adicionar `montarBarraFiltrosExtrato(formas, () => renderBaldesExtrato(painel, extrato, transactions, accounts, apelidosTitular, categorias, formas, regras, aoMudar))`
como primeiro filho do `painel.append(...)`.

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo `conciliacao-extrato-filtros.test.js`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/conciliacao-extrato.js tests/conciliacao-extrato-filtros.test.js
git commit -m "Adiciona filtros de natureza e forma na Conciliacao de extrato"
```

---

### Task 3: "+ lançar" individual por linha no balde de extrato não lançado

**Files:**
- Modify: `src/ui/conciliacao-extrato.js`
- Test: `tests/conciliacao-extrato-lancar.test.js` (novo, se `lancarUma`/lógica de agrupamento puder ser testada sem DOM — ver Step 1) OU verificação só via Playwright na Task 5 se a extração não render função pura testável.

**Interfaces:**
- Consumes: `novaTransaction`, `saveTransactions` (`../domain/transactions.js`), `aprenderRegra`, `candidatosRetroativos` (`../domain/classification.js`) — já usados por `lancarEmLote`, sem mudança de assinatura.
- Produces: `lancarSelecionadas(linhasFormulario, ctx, aoConcluir)` — renomeia o corpo atual de `lancarEmLote` para aceitar QUALQUER lista de linhas selecionadas (não só as marcadas por checkbox), e dois wrappers finos: `lancarEmLote` (filtra por `estado.selecionado`, comportamento idêntico ao de hoje) e `lancarUma(lf, ctx, aoConcluir)` (chama `lancarSelecionadas([lf], ctx, aoConcluir)` direto, ignorando o checkbox).

O gap: o balde de fatura já tem "+ lançar" por item
(`conciliacao-fatura.js:26-58`); o balde de extrato só tem "+ lançar em
lote", que exige marcar o checkbox mesmo para lançar 1 item só.

- [ ] **Step 1: Refatorar `lancarEmLote` para expor `lancarSelecionadas` reusável**

Em `src/ui/conciliacao-extrato.js`, localizar a função `lancarEmLote`
(linha 92 do arquivo atual, antes da Task 2). Trocar a assinatura:

```js
async function lancarEmLote(linhasFormulario, ctx, aoConcluir) {
  const selecionadas = linhasFormulario.filter((lf) => lf.estado.selecionado);
  if (!selecionadas.length) return;
  // ... resto do corpo IGUAL, trocando toda referencia a `selecionadas` continua igual
```

por:

```js
// Corpo compartilhado entre "+ lançar em lote" (linhas com checkbox
// marcado) e "+ lançar" individual (uma linha só, sem depender do
// checkbox) — mesma lógica de gravação + aprendizado de regra +
// aplicação retroativa nos dois casos.
async function lancarSelecionadas(selecionadas, ctx, aoConcluir) {
  if (!selecionadas.length) return;
  // ... resto do corpo IGUAL (troca so o nome do parametro recebido, o
  // corpo interno ja usa "selecionadas" a partir daqui, sem mudanca)
```

Ao final do arquivo (ou logo após a nova `lancarSelecionadas`), adicionar
os dois wrappers finos:

```js
async function lancarEmLote(linhasFormulario, ctx, aoConcluir) {
  await lancarSelecionadas(linhasFormulario.filter((lf) => lf.estado.selecionado), ctx, aoConcluir);
}

async function lancarUma(lf, ctx, aoConcluir) {
  await lancarSelecionadas([lf], ctx, aoConcluir);
}
```

- [ ] **Step 2: Adicionar o botão "+ lançar" em cada linha**

Em `montarLinhaFormulario` (mesmo arquivo), localizar o retorno de
`linhaEl` (função já existente, monta `chk, descricao, meta, selNatureza,
selCategoria, selForma, selo`). Adicionar um botão logo após `chk`:

```js
  const botaoLancarUma = el('button', { class: 'btn btn-mini', type: 'button', text: '+ lançar' });
```

E no retorno de `montarLinhaFormulario`, incluir `botaoLancarUma` no array
de filhos de `linhaEl` (logo após `chk`) e devolvê-lo também no objeto de
retorno (`{ linhaEl, linha, estado, selCategoria, botaoLancarUma }`) —
`renderBaldesExtrato` precisa do elemento para plugar o listener depois de
`ctx`/`aoMudar` estarem disponíveis (mesmo padrão do botão de lote, que
tem o listener plugado FORA de `montarLinhaFormulario`, em
`renderBaldesExtrato`, pela mesma razão: `ctx`/`aoMudar` não existem ainda
no escopo de `montarLinhaFormulario`).

- [ ] **Step 3: Plugar o listener em `renderBaldesExtrato`**

Onde `linhasFormulario` é construído (`extratoUnmatchedFiltrado.map((linha) => montarLinhaFormulario(linha, ctx))`,
resultado da Task 2), adicionar logo depois:

```js
  linhasFormulario.forEach((lf) => lf.botaoLancarUma.addEventListener('click', () => lancarUma(lf, ctx, aoMudar)));
```

- [ ] **Step 4: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão — esta task não muda nenhuma função pura testável
em Node isoladamente (a refatoração de `lancarEmLote`/`lancarSelecionadas`
é só reorganização interna de um módulo de UI, já coberta indiretamente
pelos testes de domínio que `lancarSelecionadas` consome). Nenhum teste
novo Node necessário — a verificação real desta task é visual/funcional,
feita na Task 5 (Playwright).

- [ ] **Step 5: Commit**

```bash
git add src/ui/conciliacao-extrato.js
git commit -m "Adiciona lancar individual por linha no balde de extrato nao lancado"
```

---

### Task 4: Campo de Data em Lançamentos vira `<input type=date>` nativo

**Files:**
- Modify: `src/ui/lancamentos-form.js`
- Test: nenhum teste Node novo — o formulário já não tem teste unitário de submit isolado (é DOM puro, coberto por `tests/lancamentos.browser.test.js`); a Task 5 (Playwright) verifica o comportamento real.

**Interfaces:** nenhuma interface nova — mudança de tipo de input e formato de valor lido.

- [ ] **Step 1: Editar `src/ui/lancamentos-form.js`**

Localizar (linha 39):

```js
  const inpData = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'DD/MM/AAAA', value: formatDateBR(emEdicao ? emEdicao.data : (rascunho ? rascunho.data : todayISO())) });
```

Trocar para:

```js
  const inpData = el('input', { type: 'date', value: emEdicao ? emEdicao.data : (rascunho ? rascunho.data : todayISO()) });
```

Localizar os DOIS pontos que leem `parseDateBR(inpData.value)`:

1. Dentro do bloco de compra parcelada (`base.data = parseDateBR(inpData.value)`, próximo à linha 181):

```js
        const base = {
          descricao: inpDescricao.value.trim(),
          data: parseDateBR(inpData.value),
```

Trocar para:

```js
        const base = {
          descricao: inpDescricao.value.trim(),
          data: inpData.value,
```

2. No lançamento único (`const data = parseDateBR(inpData.value);`, próximo à linha 221):

```js
      const data = parseDateBR(inpData.value);
```

Trocar para:

```js
      const data = inpData.value;
```

Remover `parseDateBR` do import de `../core/dates.js` (linha 19) se não
sobrar nenhum outro uso no arquivo — conferir com uma busca no arquivo
antes de remover (`formatDateBR`/`todayISO` continuam sendo usados,
`parseDateBR` pode não ter mais nenhuma chamada).

- [ ] **Step 2: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão — nenhum teste Node cobre este formulário
diretamente (é DOM). Se `tests/lancamentos-form.test.js` importar
`parseDateBR` do próprio `lancamentos-form.js` esperando que ele reexporte
algo relacionado a data, conferir e ajustar — não deve ser o caso (o
arquivo de teste testa `interpretarValor`/`tipoContaParaForma`/etc, funções
puras de `lancamentos-form-helpers.js`, não o formulário em si).

- [ ] **Step 3: Commit**

```bash
git add src/ui/lancamentos-form.js
git commit -m "Troca campo de Data por input nativo type=date em Lancamentos"
```

---

### Task 5: Lista de Lançamentos — valor/editar/excluir em colunas fixas, descrição truncada

**Files:**
- Modify: `styles.css` (`.item-lancamento` e filhos, linhas 378-429)

**Interfaces:** nenhuma interface nova — mudança de CSS puro, `lancamentos.js` (`listagem`) não muda de estrutura DOM (mesmas classes `lanc-principal`, `lanc-descricao`, `lanc-meta`, `lanc-valor`, `item-lancamento-acoes` já existentes).

- [ ] **Step 1: Substituir o bloco de CSS de `.item-lancamento`**

Em `styles.css`, localizar o bloco atual (linhas 378-429, de
`.item-lancamento {` até o fechamento de `.lanc-valor {}`). Substituir
inteiro por:

```css
.item-lancamento {
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  row-gap: 2px;
  padding: 10px 0;
  border-bottom: 1px solid var(--linha);
}
.item-lancamento:last-child { border-bottom: none; }

/* Receita, transferência e pagamento de fatura não contam como gasto: a
   opacidade reduzida marca visualmente que o valor não entra no total do
   período, sem precisar de outra coluna de texto explicando. */
.item-lancamento.nao-gasto { opacity: 0.65; }

.lanc-principal {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lanc-descricao {
  font-size: 0.92rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.selo-auto {
  flex: 0 0 auto;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--latao);
  border: 1px solid var(--latao);
  border-radius: 3px;
  padding: 1px 5px;
}

.lanc-meta {
  grid-column: 1;
  grid-row: 2;
  font-size: 0.78rem;
  color: var(--tinta-fraca);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.lanc-valor {
  grid-column: 2;
  grid-row: 1 / 3;
  font-family: var(--font-mono);
  font-size: 0.9rem;
  font-weight: 600;
  text-align: right;
  min-width: 84px;
}
```

E localizar o bloco `.item-lancamento-acoes` (já existente, adicionado na
fase anterior — provavelmente perto do final do arquivo). Adicionar
`grid-column: 3; grid-row: 1 / 3;` a ele:

```css
.item-lancamento-acoes {
  grid-column: 3;
  grid-row: 1 / 3;
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
```

(o resto da regra `.item-lancamento-acoes .btn { flex: 0 0 auto; }`
continua igual, não remover).

- [ ] **Step 2: Adicionar `title` com a descrição completa em `lancamentos.js`**

Em `src/ui/lancamentos.js`, função `listagem`, localizar:

```js
        el('span', { class: 'lanc-descricao', text: `${t.descricao}${t.parcela_atual ? ` (${t.parcela_atual}/${t.parcela_total})` : ''}` }),
```

Trocar para (adiciona `title` para o texto completo aparecer em hover/long-press quando truncado):

```js
        el('span', { class: 'lanc-descricao', title: `${t.descricao}${t.parcela_atual ? ` (${t.parcela_atual}/${t.parcela_total})` : ''}`, text: `${t.descricao}${t.parcela_atual ? ` (${t.parcela_atual}/${t.parcela_total})` : ''}` }),
```

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão (nenhum teste Node cobre CSS/layout).

- [ ] **Step 4: Commit**

```bash
git add styles.css src/ui/lancamentos.js
git commit -m "Alinha valor/editar/excluir em colunas fixas na lista de Lancamentos, trunca descricao longa"
```

---

### Task 6: Verificação visual em navegador real (Playwright)

**Files:** nenhum arquivo novo — task de verificação; correções pontuais em `src/ui/conciliacao-extrato.js`, `src/ui/lancamentos.js`, `src/ui/lancamentos-form.js` ou `styles.css` se algo visual não bater com o esperado.

**Interfaces:**
- Consumes: app rodando localmente (servidor estático), Playwright MCP (`browser_navigate`, `browser_run_code_unsafe` para seed sintético via `storage.put`/`putMany`, `browser_click`, `browser_select_option`, `browser_take_screenshot` com `fullPage:true`).

- [ ] **Step 1: Subir servidor estático local e seedar dados 100% sintéticos**

Nunca usar nome, número de conta/cartão ou valor real — só identificadores
fictícios. Seed mínimo: 1 conta corrente + 1 cartão, formas/categorias
padrão, um extrato bancário sintético com pelo menos 1 linha não casada
(natureza despesa) e uma transaction de origem `'fatura'` que não casa com
nada no extrato (para verificar a Task 1), ~6 lançamentos em Lançamentos
com pelo menos uma descrição bem longa (para verificar a Task 5).

- [ ] **Step 2: Verificar Task 1 — origem fatura fora do balde de extrato**

Abrir Conciliação, selecionar a conta corrente com o extrato sintético
importado, confirmar que a transaction de origem `'fatura'` seedada NÃO
aparece no balde "No app, não no extrato".

- [ ] **Step 3: Verificar Task 2 — filtros de natureza/forma**

Trocar os `<select>` de natureza/forma na Conciliação de extrato e
confirmar que os baldes aplicáveis filtram corretamente (uma linha de
natureza diferente da escolhida desaparece).

- [ ] **Step 4: Verificar Task 3 — lançar individual**

Clicar em "+ lançar" numa linha do balde "No extrato, não lançado no app"
SEM marcar nenhum checkbox, confirmar que só aquela linha é lançada
(desaparece do balde, aparece em Lançamentos) e as outras linhas
permanecem pendentes.

- [ ] **Step 5: Verificar Task 4 — campo de Data**

Abrir o formulário de Lançamentos, confirmar que o campo Data mostra o
seletor nativo do navegador (ou aceita digitação conforme o SO) e que
salvar um lançamento com data escolhida no seletor grava a data correta
(conferir na listagem depois de salvar).

- [ ] **Step 6: Verificar Task 5 — colunas fixas + truncamento**

Screenshot da lista de Lançamentos com a descrição longa seedada, em
viewport estreito (375px) e largo (desktop) — confirmar visualmente que
valor/editar/excluir ficam alinhados na mesma posição horizontal entre
itens de descrição curta e longa, e que a descrição longa trunca com "..."
em vez de quebrar linha ou empurrar as outras colunas.

- [ ] **Step 7: Verificar dark mode**

Repetir os screenshots relevantes (Conciliação de extrato com filtros,
lista de Lançamentos) com `page.emulateMedia({colorScheme:'dark'})`.

- [ ] **Step 8: Corrigir o que a verificação achar**

Problemas encontrados são corrigidos diretamente nos arquivos desta mesma
task, não em task nova. Repetir os screenshots relevantes até confirmar.

- [ ] **Step 9: Rodar a suíte completa uma última vez**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 10: Commit (se o Step 8 gerou mudança)**

```bash
git commit -m "Ajusta Conciliacao de extrato e Lancamentos apos verificacao visual"
```

Se nenhuma mudança foi necessária, pular o commit.
