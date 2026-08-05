# Lançamentos: redesign + fixes de Conciliação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar a aba Lançamentos no layout/navegação do app anterior (navegação por mês com setas, filtro de natureza, preview de parcelamento, lista com ações lado a lado, atalhos de backup/importar/apagar tudo) e corrigir dois bugs pontuais na aba Conciliação (aviso de fatura já importada, botão de exportar sempre visível).

**Architecture:** `ui/lancamentos.js` ganha estado de módulo `viewDate` (substitui `filtros.mes` como fonte de verdade do mês exibido), um `<select>` de natureza novo na barra de filtros (domínio já suporta `f.naturezas`, zero mudança em `domain/`), um preview de texto no parcelamento existente (`lancamentos-parcelado.js` já tem o checkbox+campos, só falta o preview), CSS dedicado para as ações do item de lançamento (não mais `.acoes` genérico), e uma seção de rodapé reusando `exportarBackup`/`importarBackup`/`resetAllData` já existentes no domínio. `ui/conciliacao-import.js` ganha uma checagem de id determinístico já existente contra os documentos já salvos. O botão de exportação completa migra de `conciliacao-fatura.js` para `conciliacao.js`.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime. Testes via `node tools/run-tests.mjs` (puro) e `tools/tests.html` (browser). Verificação visual via Playwright MCP.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot, teste ou fixture, mesmo temporário.
- Datas ISO internamente (`YYYY-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Valores monetários sempre positivos; sinal via `natureza`/`sinal`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Nenhum arquivo deve passar de ~250 linhas. `lancamentos.js` já está em 432 linhas antes deste plano (violação pré-existente, registrada na Fase 3) — este plano é a oportunidade de dividir o arquivo; ver Task 1.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado (`el`, `id`, `ym`). Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Reusar lógica de domínio já existente sempre que possível: `splitParcelas`, `findParcelaDuplicates`, `computeParcelaKey` (`domain/parcelas.js`), `exportarBackup`/`importarBackup`/`detectarVersaoDoArquivo` (`importers/backup-xlsx.js`), `resetAllData` (`core/storage.js`), `buildFullReconciliationRows` (`domain/reconcile-card.js`) — nenhuma desta lista precisa de mudança de assinatura ou comportamento neste plano.

---

### Task 1: Extrair `ui/lancamentos-filtros.js` — navegação por mês + barra de filtros (com natureza)

**Files:**
- Create: `src/ui/lancamentos-filtros.js`
- Modify: `src/ui/lancamentos.js` (remove `barraFiltros`, `formaFiltroAtual`, `contaFiltroAtual`, `somenteAutoFiltroAtual`; importa do novo arquivo; troca `filtros.mes` por `viewDate`)
- Test: `tests/lancamentos.test.js` (mover os testes de `formaFiltroAtual`/`contaFiltroAtual`/`somenteAutoFiltroAtual`, se existirem lá, para um novo `tests/lancamentos-filtros.test.js`; adicionar testes das funções puras novas)

**Interfaces:**
- Consumes: `NATUREZAS` de `../domain/transactions.js` (já existe); `campo`/`rotuloComStatus` de `./cadastros-comuns.js` (já existem); `el` de `./components.js`.
- Produces: `export function viewDateParaMes(viewDate) => 'YYYY-MM'` (formata `viewDate` no formato que `filterTransactions` espera); `export function mesParaViewDate(mesYYYYMM) => Date`; `export function nomeMesAno(viewDate) => 'Agosto de 2026'` (via `toLocaleDateString('pt-BR', {month:'long', year:'numeric'})`, capitalizado); `export function formaFiltroAtual(filtros)`, `export function contaFiltroAtual(filtros)`, `export function naturezaFiltroAtual(filtros)`, `export function somenteAutoFiltroAtual(filtros)` (as 4 primeiras já existem 3 delas em `lancamentos.js` — mova-as, não reimplemente); `export function montarNavegacaoMes(viewDate, aoMudar)` (retorna o elemento `‹ Mês Ano ›`, chama `aoMudar(novoViewDate)` ao clicar nas setas); `export function montarBarraFiltros(ctx, filtros, aoMudar)` (retorna o elemento da barra com forma/conta/natureza/checkbox, chama `aoMudar()` a cada mudança — `ctx` é `{formas, contas}` como hoje). `lancamentos.js` (Task 2) importa e usa todas essas.

Este é o arquivo que resolve a violação da constraint de ~250 linhas: `lancamentos.js` hoje tem 432 linhas; extrair a navegação de mês e a barra de filtros para este arquivo novo tira ~70 linhas de lá, e o arquivo novo fica bem abaixo do limite.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Criar `tests/lancamentos-filtros.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import {
  viewDateParaMes, mesParaViewDate, nomeMesAno,
  formaFiltroAtual, contaFiltroAtual, naturezaFiltroAtual, somenteAutoFiltroAtual,
} from '../src/ui/lancamentos-filtros.js';

describe('lancamentos-filtros: conversão viewDate <-> mês', () => {
  it('viewDateParaMes formata YYYY-MM com zero à esquerda', () => {
    assertEqual(viewDateParaMes(new Date(2026, 0, 1)), '2026-01');
    assertEqual(viewDateParaMes(new Date(2026, 10, 1)), '2026-11');
  });

  it('mesParaViewDate lê YYYY-MM e sempre cai no dia 1', () => {
    const d = mesParaViewDate('2026-08');
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 7);
    assertEqual(d.getDate(), 1);
  });

  it('ida e volta preserva o mês', () => {
    assertEqual(viewDateParaMes(mesParaViewDate('2026-03')), '2026-03');
  });
});

describe('lancamentos-filtros: nomeMesAno', () => {
  it('formata mês por extenso com ano, capitalizado', () => {
    const nome = nomeMesAno(new Date(2026, 7, 1));
    assert(nome.toLowerCase().includes('agosto'), nome);
    assert(nome.includes('2026'), nome);
    assertEqual(nome[0], nome[0].toUpperCase());
  });
});

describe('lancamentos-filtros: leitura pura dos filtros', () => {
  it('formaFiltroAtual lê o primeiro item de filtros.formas', () => {
    assertEqual(formaFiltroAtual({ formas: ['pm_pix'] }), 'pm_pix');
    assertEqual(formaFiltroAtual({}), '');
  });

  it('contaFiltroAtual lê o primeiro item de filtros.contas', () => {
    assertEqual(contaFiltroAtual({ contas: ['acc_1'] }), 'acc_1');
    assertEqual(contaFiltroAtual({}), '');
  });

  it('naturezaFiltroAtual lê o primeiro item de filtros.naturezas', () => {
    assertEqual(naturezaFiltroAtual({ naturezas: ['receita'] }), 'receita');
    assertEqual(naturezaFiltroAtual({}), '');
    assertEqual(naturezaFiltroAtual({ naturezas: [] }), '');
  });

  it('somenteAutoFiltroAtual devolve booleano', () => {
    assertEqual(somenteAutoFiltroAtual({ somenteAuto: true }), true);
    assertEqual(somenteAutoFiltroAtual({}), false);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — módulo `../src/ui/lancamentos-filtros.js` não existe.

- [ ] **Step 3: Criar `src/ui/lancamentos-filtros.js`**

```js
// Navegação por mês (setas ‹ › ) e barra de filtros (forma, conta,
// natureza, só-automático) da aba Lançamentos. Extraído de lancamentos.js
// para manter os dois arquivos abaixo de ~250 linhas — layout portado do
// app anterior (Pessoal/07 Financeiro/Cartão de Credito/gastos-app),
// adaptado para os filtros multi-conta/forma/natureza que o app anterior
// não tinha.

import { el } from './components.js';
import { campo, rotuloComStatus } from './cadastros-comuns.js';
import { NATUREZAS } from '../domain/transactions.js';

export function viewDateParaMes(viewDate) {
  return viewDate.getFullYear() + '-' + String(viewDate.getMonth() + 1).padStart(2, '0');
}

export function mesParaViewDate(mesYYYYMM) {
  const [ano, mes] = mesYYYYMM.split('-').map(Number);
  return new Date(ano, mes - 1, 1);
}

export function nomeMesAno(viewDate) {
  const bruto = viewDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return bruto.charAt(0).toUpperCase() + bruto.slice(1);
}

export function formaFiltroAtual(filtros) {
  return ((filtros || {}).formas || [])[0] || '';
}

export function contaFiltroAtual(filtros) {
  return ((filtros || {}).contas || [])[0] || '';
}

export function naturezaFiltroAtual(filtros) {
  return ((filtros || {}).naturezas || [])[0] || '';
}

export function somenteAutoFiltroAtual(filtros) {
  return !!(filtros || {}).somenteAuto;
}

function rotuloNatureza(n) {
  return {
    despesa: 'Gasto',
    receita: 'Recebimento (não conta como gasto)',
    transferencia: 'Transferência entre contas próprias',
    pagamento_fatura: 'Pagamento de fatura',
  }[n];
}

// `aoMudar(novoViewDate)` é chamado com o mês já ajustado — quem chama
// (lancamentos.js) decide como recalcular filtros e re-renderizar.
export function montarNavegacaoMes(viewDate, aoMudar) {
  const mudarMes = (delta) => {
    const novo = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    aoMudar(novo);
  };
  return el('div', { class: 'nav-mes' }, [
    el('button', { class: 'btn btn-mini', type: 'button', text: '‹', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }),
    el('span', { class: 'nav-mes-label', text: nomeMesAno(viewDate) }),
    el('button', { class: 'btn btn-mini', type: 'button', text: '›', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }),
  ]);
}

// `ctx` = { formas, contas }. `aoMudar()` é chamado sem argumento — os
// listeners já escreveram direto em `filtros` (mesmo padrão do
// lancamentos.js original) antes de chamar.
export function montarBarraFiltros(ctx, filtros, aoMudar) {
  // A barra de filtro mostra formas/contas/naturezas mesmo desativadas: o
  // usuário pode querer olhar o histórico de algo que já não usa.
  const formaAtual = formaFiltroAtual(filtros);
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => { filtros.formas = selForma.value ? [selForma.value] : []; await aoMudar(); });

  const contaAtual = contaFiltroAtual(filtros);
  const selConta = el('select', {}, [
    el('option', { value: '', text: 'Todas as contas/cartões', ...(contaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === contaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selConta.addEventListener('change', async () => { filtros.contas = selConta.value ? [selConta.value] : []; await aoMudar(); });

  const naturezaAtual = naturezaFiltroAtual(filtros);
  const selNatureza = el('select', {}, [
    el('option', { value: '', text: 'Todas', ...(naturezaAtual === '' ? { selected: 'selected' } : {}) }),
    ...NATUREZAS.map((n) => el('option', { value: n, text: rotuloNatureza(n), ...(n === naturezaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selNatureza.addEventListener('change', async () => { filtros.naturezas = selNatureza.value ? [selNatureza.value] : []; await aoMudar(); });

  const chkAuto = el('input', { type: 'checkbox', ...(somenteAutoFiltroAtual(filtros) ? { checked: 'checked' } : {}) });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await aoMudar(); });

  return el('div', { class: 'filtros' }, [
    campo('Forma', selForma),
    campo('Conta/cartão', selConta),
    campo('Natureza', selNatureza),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}
```

- [ ] **Step 4: Editar `src/ui/lancamentos.js`**

Trocar o import de `campo, mostrarErros, opcoesAtivas, rotuloComStatus` (linha 14) para manter só o que ainda é usado localmente, e adicionar o import do novo arquivo:

```js
import { campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import {
  viewDateParaMes, mesParaViewDate, montarNavegacaoMes, montarBarraFiltros,
} from './lancamentos-filtros.js';
```

Trocar o estado de módulo (linhas 27-39):

```js
let filtros = { mes: monthKey(todayISO()) };
let editandoId = null;

export function resetLancamentos() {
  editandoId = null;
  filtros = { mes: monthKey(todayISO()) };
}
```

por:

```js
let viewDate = mesParaViewDate(monthKey(todayISO()));
let filtros = {};
let editandoId = null;

export function resetLancamentos() {
  editandoId = null;
  viewDate = mesParaViewDate(monthKey(todayISO()));
  filtros = {};
}
```

Remover as funções `formaFiltroAtual`, `contaFiltroAtual`, `somenteAutoFiltroAtual` (linhas 119-129) e a função `barraFiltros` inteira (linhas 368-405) — agora vivem em `lancamentos-filtros.js`.

Em `renderLancamentos()` (linha 131), calcular `filtros.mes` a partir de `viewDate` antes de filtrar, e trocar a chamada de `barraFiltros(ctx)` por `montarNavegacaoMes`+`montarBarraFiltros`:

```js
export async function renderLancamentos() {
  const painel = document.getElementById('tabLancamentos');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };
  filtros.mes = viewDateParaMes(viewDate);
  const visiveis = filterTransactions(transacoes, filtros)
    .sort((a, b) => (a.data < b.data ? 1 : -1));

  painel.innerHTML = '';
  painel.append(
    montarNavegacaoMes(viewDate, async (novoViewDate) => { viewDate = novoViewDate; await renderLancamentos(); }),
    await formulario(ctx, transacoes),
    montarBarraFiltros(ctx, filtros, renderLancamentos),
    el('div', { class: 'total-periodo', text: `Total de gastos no período: ${fmtBRL(sumDespesas(visiveis))}` }),
    listagem(visiveis, ctx)
  );
}
```

Note a ordem: navegação de mês PRIMEIRO (cabeçalho), depois o formulário, depois a barra de filtros — mesma ordem visual do app anterior (mês no topo da página, formulário logo abaixo, filtros da lista mais abaixo ainda, perto da lista que eles afetam). Confirmar contra o brief: a spec (seção 2.1/2.2) não fixa a ordem exata entre formulário e barra de filtros — esta é uma decisão de implementação; manter o formulário visualmente próximo do topo (como hoje) e a barra de filtros perto da lista (como no app anterior, onde os filtros de lista ficavam com a lista) é a leitura mais fiel ao pedido "portar o layout".

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os novos testes de `lancamentos-filtros.test.js`. Se `tests/lancamentos.test.js` tinha testes de `formaFiltroAtual`/`contaFiltroAtual`/`somenteAutoFiltroAtual` importados de `lancamentos.js`, atualize esses imports para vir de `lancamentos-filtros.js` (ou remova-os de lá se já duplicados no arquivo novo — sem duplicar cobertura).

- [ ] **Step 6: Commit**

```bash
git add src/ui/lancamentos-filtros.js src/ui/lancamentos.js tests/lancamentos-filtros.test.js tests/lancamentos.test.js
git commit -m "Extrai navegacao por mes e barra de filtros para lancamentos-filtros.js, adiciona filtro de natureza"
```

---

### Task 2: CSS da navegação por mês + filtro de natureza

**Files:**
- Modify: `styles.css` (novo bloco para `.nav-mes`)

**Interfaces:**
- Consumes: variáveis de tema já existentes (`--papel`, `--tinta`, `--tinta-fraca`, `--linha`, `--font-display` — já usado no `h1`). Classes consumidas: `nav-mes`, `nav-mes-label`, geradas por `montarNavegacaoMes` (Task 1).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Adicionar o bloco de CSS**

Ao final de `styles.css`:

```css
/* --- Navegação de mês (Lançamentos) --- */

.nav-mes {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px 0 4px;
}
.nav-mes-label {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--tinta);
  min-width: 160px;
  text-align: center;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "Estiliza a navegacao por mes de Lancamentos"
```

---

### Task 3: Preview de valor por parcela no formulário de parcelamento

**Files:**
- Modify: `src/ui/lancamentos-parcelado.js` (`campoParceladoEModal`)

**Interfaces:**
- Consumes: `splitParcelas` de `../domain/parcelas.js` (já importado); `fmtBRL` de `../core/money.js` (já importado).
- Produces: `campoParceladoEModal` passa a retornar também um elemento de preview dentro de `painelExtra` (não muda a assinatura do retorno — `checkbox`, `painelExtra`, `confirmarEObterLancamentos` continuam os mesmos três campos que `lancamentos.js` já consome).

O checkbox e os campos que ele revela já existem (`lancamentos-parcelado.js:63-91`) — o único gap real contra o app anterior é a AUSÊNCIA do texto de preview ("Nx de R$Y,YY (total R$Z,ZZ) — um lançamento por mês a partir da data escolhida"), que o app anterior mostra abaixo dos dois campos, atualizado a cada `input`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

`lancamentos-parcelado.js` não tem teste próprio hoje (é DOM puro) — mas a FORMATAÇÃO do texto de preview pode ser extraída como função pura testável. Criar `tests/lancamentos-parcelado.test.js`:

```js
import { describe, it, assertEqual } from './harness.js';
import { textoPreviewParcela } from '../src/ui/lancamentos-parcelado.js';

describe('lancamentos-parcelado: textoPreviewParcela', () => {
  it('formata Nx de R$Y (total R$Z) quando valor e parcelas são válidos', () => {
    const texto = textoPreviewParcela(1200, 6);
    assertEqual(texto, '6x de R$ 200,00 (total R$ 1.200,00) — um lançamento por mês a partir da data escolhida.');
  });

  it('divide por centavos, primeira parcela absorve o resto', () => {
    const texto = textoPreviewParcela(100, 3);
    assertEqual(texto, '3x de R$ 33,34 (total R$ 100,00) — um lançamento por mês a partir da data escolhida.');
  });

  it('devolve null quando valor total é inválido', () => {
    assertEqual(textoPreviewParcela(null, 6), null);
    assertEqual(textoPreviewParcela(NaN, 6), null);
  });

  it('devolve null quando número de parcelas é menor que 2', () => {
    assertEqual(textoPreviewParcela(1200, 1), null);
    assertEqual(textoPreviewParcela(1200, 0), null);
    assertEqual(textoPreviewParcela(1200, null), null);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — `textoPreviewParcela` não é exportado por `lancamentos-parcelado.js`.

- [ ] **Step 3: Implementar em `src/ui/lancamentos-parcelado.js`**

Adicionar a função pura logo após os imports (antes de `montarLancamentosParcelados`):

```js
// Pura: o texto de prévia mostrado abaixo dos campos "Valor total"/"Nº de
// parcelas" — mesma mensagem do app anterior. `null` quando os dados ainda
// não são suficientes pra calcular (campo vazio, número < 2), pra quem
// chama decidir esconder o preview em vez de mostrar um texto quebrado.
export function textoPreviewParcela(valorTotal, numParcelas) {
  if (valorTotal === null || valorTotal === undefined || !Number.isFinite(valorTotal)) return null;
  if (!numParcelas || numParcelas < 2) return null;
  const vals = splitParcelas(valorTotal, numParcelas);
  return `${numParcelas}x de ${fmtBRL(vals[0])} (total ${fmtBRL(valorTotal)}) — um lançamento por mês a partir da data escolhida.`;
}
```

Em `campoParceladoEModal`, adicionar o elemento de preview e a lógica de atualização. Trocar:

```js
export function campoParceladoEModal(ctx) {
  const chkParcelado = el('input', { type: 'checkbox' });
  const inpValorTotal = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const inpNumParcelas = el('input', { type: 'text', inputmode: 'numeric', placeholder: '2' });
  const painelExtra = el('div', { class: 'linha-form', style: 'display:none' }, [
    ctx.campo('Valor total', inpValorTotal), ctx.campo('Nº de parcelas', inpNumParcelas),
  ]);
  chkParcelado.addEventListener('change', () => {
    painelExtra.style.display = chkParcelado.checked ? '' : 'none';
  });
```

por:

```js
export function campoParceladoEModal(ctx) {
  const chkParcelado = el('input', { type: 'checkbox' });
  const inpValorTotal = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const inpNumParcelas = el('input', { type: 'text', inputmode: 'numeric', placeholder: '2' });
  const previewParcela = el('div', { class: 'preview-parcela', style: 'display:none' });
  const painelExtra = el('div', { class: 'painel-parcelado', style: 'display:none' }, [
    el('div', { class: 'linha-form' }, [ctx.campo('Valor total', inpValorTotal), ctx.campo('Nº de parcelas', inpNumParcelas)]),
    previewParcela,
  ]);
  chkParcelado.addEventListener('change', () => {
    painelExtra.style.display = chkParcelado.checked ? '' : 'none';
  });

  const atualizarPreview = () => {
    const valorTotal = ctx.parseMoneyBR(inpValorTotal.value);
    const numParcelas = parseInt(inpNumParcelas.value, 10);
    const texto = textoPreviewParcela(valorTotal, numParcelas);
    previewParcela.textContent = texto || '';
    previewParcela.style.display = texto ? '' : 'none';
  };
  inpValorTotal.addEventListener('input', atualizarPreview);
  inpNumParcelas.addEventListener('input', atualizarPreview);
```

(o resto da função, a partir de `async function confirmarEObterLancamentos`, não muda).

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo `lancamentos-parcelado.test.js` novo.

- [ ] **Step 5: Adicionar CSS do preview**

Ao final de `styles.css`:

```css
.preview-parcela {
  flex: 1 1 100%;
  font-size: 0.78rem;
  color: var(--latao);
  padding: 2px 0;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/lancamentos-parcelado.js tests/lancamentos-parcelado.test.js styles.css
git commit -m "Adiciona preview de valor por parcela no formulario de compra parcelada"
```

---

### Task 4: Ações do item de lançamento lado a lado (fix de CSS)

**Files:**
- Modify: `src/ui/lancamentos.js` (`listagem`, troca a classe `acoes` do item por uma classe própria)
- Modify: `styles.css` (nova classe, substitui a herança problemática de `.acoes .btn { flex: 1 1 160px }`)

**Interfaces:** nenhuma interface nova — mudança de apresentação.

Causa raiz confirmada: o item de lançamento usa `class: 'acoes'` (mesma classe genérica usada em formulários de Cadastros), e essa classe tem a regra `.acoes .btn { flex: 1 1 160px; }` — cada botão exige no mínimo 160px, e numa linha de lançamento (que raramente tem 320px+ de sobra ao lado da descrição/valor) os dois botões de `flex-wrap:wrap` quebram para linhas separadas. `.btn-mini` já tenta `flex: 0 0 auto`, mas perde na especificidade porque `.acoes .btn` (2 classes) é declarado depois de `.btn-mini` (1 classe) no arquivo.

- [ ] **Step 1: Editar `src/ui/lancamentos.js`**

Em `listagem` (função que monta cada item), trocar a classe do container de ações. Localizar:

```js
      el('div', { class: 'acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluir(t) }),
      ]),
```

Trocar para:

```js
      el('div', { class: 'item-lancamento-acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluir(t) }),
      ]),
```

- [ ] **Step 2: Adicionar CSS**

Ao final de `styles.css`:

```css
/* Ações do item de lançamento (editar/excluir): classe própria, não
   `.acoes` genérico — `.acoes .btn { flex: 1 1 160px }` forçava cada
   botão a pedir 160px mínimo, e numa linha estreita de lançamento os dois
   quebravam pra linhas separadas em vez de ficarem lado a lado. */
.item-lancamento-acoes {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
.item-lancamento-acoes .btn { flex: 0 0 auto; }
```

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem mudança no total (nenhum teste Node cobre HTML/CSS de listagem).

- [ ] **Step 4: Commit**

```bash
git add src/ui/lancamentos.js styles.css
git commit -m "Corrige botoes de editar/excluir empilhados: classe propria em vez de .acoes generico"
```

---

### Task 5: Rodapé de Lançamentos — backup, importar, apagar tudo

**Files:**
- Modify: `src/ui/lancamentos.js` (adiciona seção de rodapé em `renderLancamentos`)
- Modify: `src/ui/cadastros-backup.js` (extrai a lógica de import de arquivo para uma função compartilhada, se o corpo ficar idêntico — ver Step 3)
- Test: nenhum novo teste Node (é UI/DOM, mesma natureza dos botões de backup que `cadastros-backup.js` já não testa em Node)

**Interfaces:**
- Consumes: `exportarBackup`, `importarBackup`, `detectarVersaoDoArquivo` de `../importers/backup-xlsx.js` (já existem, mesma assinatura); `resetAllData` de `../core/storage.js` (já existe); `confirmar` de `./components.js` (já existe, usado para excluir lançamento — reusar aqui NÃO é suficiente sozinho: apagar tudo precisa do texto de aviso específico do app anterior, não o `confirmar()` genérico de uma linha — ver Step 2).
- Produces: nenhuma interface nova exportada — é conteúdo de tela.

- [ ] **Step 1: Decidir compartilhamento de lógica com `cadastros-backup.js`**

Ler `src/ui/cadastros-backup.js` inteiro antes de implementar (arquivo pequeno, ~89 linhas). Se a lógica de `baixarBackup()` e o listener de `inputArquivo` puderem ser extraídos sem mudar comportamento (mesmo fluxo de erro/toast/aviso), extraia para `src/ui/backup-comum.js`:

```js
// Lógica compartilhada de exportar/importar backup completo — usada tanto
// pela seção "Backup" de Cadastros quanto pelo rodapé de Lançamentos (Fase
// "redesign Lançamentos"). Fica em módulo próprio pra não duplicar a lógica
// de detecção de versão/tratamento de erro em dois lugares.

import { el, toast, abrirModal } from './components.js';
import { campo } from './cadastros-comuns.js';
import { listAccounts, TIPO_CARTAO } from '../domain/accounts.js';
import { exportarBackup, importarBackup, detectarVersaoDoArquivo } from '../importers/backup-xlsx.js';

export async function baixarBackup() {
  const blob = await exportarBackup();
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `backup-livro-de-gastos-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup gerado.', 'ok');
}

export function montarInputImportarBackup(aoMudar) {
  const inputArquivo = el('input', { type: 'file', accept: '.xlsx', class: 'oculto' });
  inputArquivo.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try {
      const buffer = await arquivo.arrayBuffer();
      const versao = detectarVersaoDoArquivo(buffer);
      if (!versao) { toast('Esse arquivo não parece ser um backup do app.', 'erro'); return; }
      let cartaoTitularId = null;
      if (versao === 1) {
        const cartoes = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO);
        cartaoTitularId = await escolherCartaoParaImportacao(cartoes);
        if (cartaoTitularId === false) return;
      }
      const { contagens, avisos } = await importarBackup(buffer, { cartaoTitularId, formaCreditoId: 'pm_credito' });
      const total = Object.values(contagens).reduce((a, b) => a + b, 0);
      toast(`${total} registro(s) importados. Os dados que já estavam no aparelho foram mantidos.`, 'ok');
      if (avisos.length) await abrirModal({ titulo: 'Atenção', corpo: avisos.join('\n\n') });
      await aoMudar();
    } catch (e) {
      toast('Não consegui ler esse backup: ' + e.message, 'erro');
    } finally {
      ev.target.value = '';
    }
  });
  return inputArquivo;
}

async function escolherCartaoParaImportacao(cartoes) {
  if (!cartoes.length) return null;
  if (cartoes.length === 1) return cartoes[0].id;
  const sel = el('select', {}, cartoes.map((c) => el('option', { value: c.id, text: c.nome })));
  const escolha = await abrirModal({
    titulo: 'Backup do app anterior',
    corpo: el('div', { class: 'form' }, [
      el('p', { text: 'Se este for um backup do app anterior, os lançamentos são todos de cartão de crédito. A qual cartão associá-los?' }),
      campo('Cartão', sel),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'ok', rotulo: 'Importar' }],
  });
  return escolha === 'ok' ? sel.value : false;
}
```

Editar `src/ui/cadastros-backup.js` para importar e usar `baixarBackup`/`montarInputImportarBackup` de `./backup-comum.js` em vez das versões locais, removendo a duplicação (`escolherCartaoParaImportacao` e o listener de `inputArquivo` saem de `cadastros-backup.js`).

- [ ] **Step 2: Adicionar o rodapé em `src/ui/lancamentos.js`**

Adicionar import:

```js
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';
import { resetAllData } from '../core/storage.js';
```

Adicionar uma função `rodape(aoMudar)`:

```js
function rodape(aoMudar) {
  const inputImportar = montarInputImportarBackup(aoMudar);
  return el('div', { class: 'rodape-lancamentos' }, [
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', type: 'button', text: 'Backup completo', onclick: baixarBackup }),
      el('label', { class: 'btn', for: 'inputImportarBackupLancamentos', style: 'text-align:center; cursor:pointer;' }, ['Importar backup']),
    ]),
    (() => { inputImportar.id = 'inputImportarBackupLancamentos'; return inputImportar; })(),
    el('button', {
      class: 'link-perigo', type: 'button', text: 'Apagar todos os dados do app',
      onclick: () => apagarTudo(aoMudar),
    }),
  ]);
}

async function apagarTudo(aoMudar) {
  const ok = window.confirm(
    'Isso apaga TODOS os lançamentos, categorias, contas, formas de pagamento e faturas ' +
    'importadas deste aparelho, sem volta. Já fez backup? Toque OK só se tiver certeza.'
  );
  if (!ok) return;
  await resetAllData();
  toast('Todos os dados foram apagados.', 'ok');
  await aoMudar();
}
```

Adicionar `rodape(renderLancamentos)` ao final do `painel.append(...)` em `renderLancamentos()`.

- [ ] **Step 3: Adicionar CSS**

Ao final de `styles.css`:

```css
.rodape-lancamentos {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px dashed var(--linha);
}
.link-perigo {
  background: none;
  border: none;
  color: var(--erro);
  font-size: 0.72rem;
  text-decoration: underline;
  cursor: pointer;
  padding: 6px 0 0;
  align-self: center;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão. Se `cadastros-backup.test.js` ou similar existir e testar algo que mudou de lugar, ajustar imports — mas a lógica em si não muda de comportamento, só de arquivo.

- [ ] **Step 5: Commit**

```bash
git add src/ui/lancamentos.js src/ui/cadastros-backup.js src/ui/backup-comum.js styles.css
git commit -m "Adiciona atalhos de backup/importar/apagar tudo no rodape de Lancamentos"
```

---

### Task 6: Conciliação — aviso de fatura já importada

**Files:**
- Modify: `src/ui/conciliacao-import.js` (`renderPreview`, `analisar`, ou onde fizer mais sentido calcular o id determinístico e checar contra os documentos existentes)
- Test: `tests/conciliacao-import.test.js`

**Interfaces:**
- Consumes: nenhuma função de domínio nova — o id determinístico já é montado inline em `commitImportacao` (`statementToPut.id = \`${contaId}|${tipo}|${statement.vencimento || statement.periodoFim}\``, linha 29). Extrair essa montagem para uma função pura testável e reusar nos dois lugares.
- Produces: `export function idDeterministicoDoDocumento(contaId, tipo, statement)` em `ui/conciliacao-import.js` (ou em `domain/`, se preferir — ver decisão no Step 3).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Adicionar a `tests/conciliacao-import.test.js` (ler o arquivo primeiro para confirmar convenção de import/fixture já usada nele):

```js
describe('conciliacao-import: idDeterministicoDoDocumento', () => {
  it('monta o id a partir de conta, tipo e vencimento', () => {
    const id = idDeterministicoDoDocumento('acc_1', 'fatura', { vencimento: '2026-08-10' });
    assertEqual(id, 'acc_1|fatura|2026-08-10');
  });

  it('cai em periodoFim quando não há vencimento (extrato)', () => {
    const id = idDeterministicoDoDocumento('acc_1', 'extrato', { periodoFim: '2026-08-31' });
    assertEqual(id, 'acc_1|extrato|2026-08-31');
  });
});

describe('conciliacao-import: documentoJaImportado', () => {
  const doc1 = { id: 'acc_1|fatura|2026-08-10', tipo: 'fatura', contaId: 'acc_1', vencimento: '2026-08-10', importadoEm: 1000 };

  it('encontra o documento existente pelo mesmo id determinístico', () => {
    const encontrado = documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-08-10' }, [doc1]);
    assertEqual(encontrado, doc1);
  });

  it('não encontra nada quando o vencimento é diferente', () => {
    const encontrado = documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-09-10' }, [doc1]);
    assertEqual(encontrado, null);
  });

  it('não encontra nada quando a conta é diferente', () => {
    const encontrado = documentoJaImportado('acc_2', 'fatura', { vencimento: '2026-08-10' }, [doc1]);
    assertEqual(encontrado, null);
  });

  it('lista vazia de documentos não encontra nada', () => {
    assertEqual(documentoJaImportado('acc_1', 'fatura', { vencimento: '2026-08-10' }, []), null);
  });
});
```

Ajustar o import do topo do arquivo de teste para incluir `idDeterministicoDoDocumento, documentoJaImportado` de `../src/ui/conciliacao-import.js`.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — as duas funções não existem ainda.

- [ ] **Step 3: Implementar em `src/ui/conciliacao-import.js`**

Adicionar as duas funções puras, antes de `commitImportacao`:

```js
// Mesma montagem de id usada em commitImportacao (statementToPut.id,
// abaixo) — extraída pra função própria pra não duplicar a fórmula entre
// o commit de verdade e o aviso de "já importado" na tela de análise.
export function idDeterministicoDoDocumento(contaId, tipo, statement) {
  return `${contaId}|${tipo}|${statement.vencimento || statement.periodoFim}`;
}

// Devolve o documento já salvo com o MESMO id determinístico, ou null.
// `documentosExistentes` é a lista de statements já salvos da MESMA conta
// (quem chama já filtra por contaId antes de passar aqui).
export function documentoJaImportado(contaId, tipo, statement, documentosExistentes) {
  const id = idDeterministicoDoDocumento(contaId, tipo, statement);
  return (documentosExistentes || []).find((d) => d.id === id) || null;
}
```

Editar `commitImportacao` para reusar `idDeterministicoDoDocumento` em vez de montar o id inline:

```js
const statementToPut = { ...statement, id: idDeterministicoDoDocumento(contaId, tipo, statement), contaId, tipo };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os testes novos, e os testes existentes de `commitImportacao` continuam passando sem mudança (a fórmula do id é a mesma, só extraída).

- [ ] **Step 5: Mostrar o aviso na tela de análise**

Em `renderImportacao` (mesma arquivo), a função `analisar` já chama `adaptadorEscolhido.parse(...)` e guarda o resultado em `estado.resultado`; `renderPreview(resultado)` monta a tela. Antes de chamar `renderPreview`, buscar os documentos existentes da conta e checar duplicata. Editar `analisar`:

```js
  async function analisar(adaptadorEscolhido) {
    if (!adaptadorEscolhido) return;
    if (adaptadorEscolhido.id === 'generic-table' && !estado.mapeamento) {
      toast('Preencha o mapeamento de colunas antes de analisar.', 'erro');
      return;
    }
    try {
      const resultado = await adaptadorEscolhido.parse(estado.buffer, { contaId, arquivo: estado.arquivo, mapeamento: estado.mapeamento });
      const documentosExistentes = await storage.getByIndex('statements', 'by_contaId', contaId);
      const duplicata = documentoJaImportado(contaId, resultado.statement.tipo, resultado.statement, documentosExistentes);
      estado.resultado = resultado;
      renderPreview(resultado, duplicata);
    } catch (e) {
      toast('Não consegui ler esse arquivo: ' + e.message, 'erro');
    }
  }
```

Editar `renderPreview` para receber `duplicata` e mostrar o aviso (usar `formatDateBR` de `../core/dates.js`, importar se ainda não estiver importado no arquivo):

```js
  function renderPreview(resultado, duplicata) {
    const { statement, rows, avisos, checksum } = resultado;
    const linhasChecksum = (checksum.sections || []).map((s) =>
      el('li', { text: `Cartão final ${s.cardEnding || '—'} (${s.secaoTipo}): ${s.ok === false ? 'DIVERGE' : s.ok === true ? 'confere' : 'sem total impresso'}` })
    );

    const botaoConfirmar = el('button', { class: 'btn btn-primario', text: 'Confirmar importação' });
    botaoConfirmar.addEventListener('click', () => confirmarImportacao(statement, rows, checksum));

    areaResultado.innerHTML = '';
    areaResultado.append(
      el('div', { class: 'preview-resultado' }, [
        el('p', { text: `${rows.length} linha(s) lidas.` }),
        statement.totalImpresso != null ? el('p', { text: `Total da fatura: ${fmtBRL(statement.totalImpresso)}` }) : null,
        duplicata ? el('p', { class: 'aviso-erro', text: `Este documento (vencimento ${formatDateBR(statement.vencimento) || statement.vencimento || statement.periodoFim}) já foi importado${duplicata.importadoEm ? ' em ' + new Date(duplicata.importadoEm).toLocaleDateString('pt-BR') : ''}. Confirmar agora vai substituir os dados anteriores por este novo arquivo.` }) : null,
        el('p', { class: checksum.ok === false ? 'aviso-erro' : 'aviso-ok', text: checksum.ok === false ? 'Checksum NÃO confere.' : 'Checksum confere.' }),
        linhasChecksum.length ? el('ul', {}, linhasChecksum) : null,
        avisos.length ? el('ul', { class: 'lista-avisos' }, avisos.map((a) => el('li', { text: a }))) : null,
        el('div', { class: 'acoes' }, [botaoConfirmar]),
      ])
    );
  }
```

Verificar se `fmtBRL` já está importado no arquivo (deve estar, de uma task anterior desta mesma base de código — confirmar no arquivo real antes de adicionar import duplicado). Verificar se `formatDateBR` precisa ser importado de `../core/dates.js` — provavelmente não está, adicionar.

- [ ] **Step 6: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão, todos passando.

- [ ] **Step 7: Commit**

```bash
git add src/ui/conciliacao-import.js tests/conciliacao-import.test.js
git commit -m "Avisa quando o documento analisado ja foi importado antes, na tela de analise"
```

---

### Task 7: Conciliação — botão de exportar sempre visível

**Files:**
- Modify: `src/ui/conciliacao.js` (adiciona o botão, busca `faturasList`/`transactions` completos)
- Modify: `src/ui/conciliacao-fatura.js` (remove o botão de dentro de `renderBaldesFatura`)
- Test: nenhum teste novo — mudança de composição de tela, a função de domínio (`buildFullReconciliationRows`) já é testada em `tests/reconcile-card.test.js`.

**Interfaces:**
- Consumes: `buildFullReconciliationRows` de `../domain/reconcile-card.js` (já existe, já testado); `listTransactions` de `../domain/transactions.js`; `storage.getAll('statements')` (a função hoje busca por `by_contaId` — para o botão global, precisa de TODAS as statements tipo fatura, de todas as contas).
- Produces: nenhuma interface nova.

- [ ] **Step 1: Editar `src/ui/conciliacao-fatura.js`**

Remover a função `exportarConciliacaoCompleta` e o botão de dentro de `renderBaldesFatura`. Localizar:

```js
async function exportarConciliacaoCompleta(faturasList, transactions, accounts) {
  const rows = buildFullReconciliationRows(faturasList, transactions, accounts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conciliacao');
  XLSX.writeFile(wb, `conciliacao-fatura-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function renderBaldesFatura(painel, fatura, faturasList, transactions, accounts) {
  const { autoMatched, matched, faturaUnmatched, appUnmatched } = runReconciliation(fatura, faturasList, transactions, accounts);

  painel.innerHTML = '';
  painel.append(
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar conciliação completa', onclick: () => exportarConciliacaoCompleta(faturasList, transactions, accounts) }),
    ]),
    balde('Conciliado automaticamente', autoMatched.map(itemMatched), 'Nenhum item conciliado automaticamente.'),
    balde('Conciliado', matched.map(itemMatched), 'Nenhum item conciliado.'),
    balde('Na fatura, não lançado no app', faturaUnmatched.map(itemFatura), 'Tudo da fatura já está lançado no app.'),
    balde('No app, não na fatura', appUnmatched.map(itemApp), 'Nenhum lançamento do app ficou de fora da fatura.')
  );
}
```

por:

```js
export async function renderBaldesFatura(painel, fatura, faturasList, transactions, accounts) {
  const { autoMatched, matched, faturaUnmatched, appUnmatched } = runReconciliation(fatura, faturasList, transactions, accounts);

  painel.innerHTML = '';
  painel.append(
    balde('Conciliado automaticamente', autoMatched.map(itemMatched), 'Nenhum item conciliado automaticamente.'),
    balde('Conciliado', matched.map(itemMatched), 'Nenhum item conciliado.'),
    balde('Na fatura, não lançado no app', faturaUnmatched.map(itemFatura), 'Tudo da fatura já está lançado no app.'),
    balde('No app, não na fatura', appUnmatched.map(itemApp), 'Nenhum lançamento do app ficou de fora da fatura.')
  );
}
```

Remover também o import de `buildFullReconciliationRows` se `runReconciliation` for o único símbolo restante usado desse import (conferir o restante do arquivo antes de remover — pode haver outro uso).

- [ ] **Step 2: Editar `src/ui/conciliacao.js`**

Adicionar import de `buildFullReconciliationRows`:

```js
import { buildFullReconciliationRows } from '../domain/reconcile-card.js';
```

Adicionar a função de exportação (movida de `conciliacao-fatura.js`, mesmo corpo) e o botão, montado sempre que há pelo menos uma conta:

```js
async function exportarConciliacaoCompleta(faturasList, transactions, accounts) {
  const rows = buildFullReconciliationRows(faturasList, transactions, accounts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conciliacao');
  XLSX.writeFile(wb, `conciliacao-fatura-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
```

Editar `renderConciliacao` para buscar todas as faturas (de todas as contas, não só a selecionada) e montar o botão:

```js
export async function renderConciliacao() {
  const painel = document.getElementById('tabConciliacao');
  const contas = await listAccounts();
  const documentos = contaSelecionadaId ? await storage.getByIndex('statements', 'by_contaId', contaSelecionadaId) : [];

  painel.innerHTML = '';
  const painelAcoes = contas.length
    ? el('div', { class: 'acoes' }, [
        el('button', {
          class: 'btn', text: 'Exportar conciliação completa',
          onclick: async () => {
            const [transactions, todasFaturas] = await Promise.all([
              listTransactions(),
              storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'fatura')),
            ]);
            await exportarConciliacaoCompleta(todasFaturas, transactions, contas);
          },
        }),
      ])
    : null;
  painel.append(
    montarSeletorContaCartao(contas),
    montarSeletorDocumento(documentos),
    painelAcoes,
    el('div', { id: 'painelImportacao' }),
    el('div', { id: 'painelBaldes' })
  );
  // ... resto da função sem mudança
```

Confirmar que `storage.getAll` já é usado em algum lugar do arquivo ou se precisa ajustar o import de `* as storage from '../core/storage.js'` (já é `import * as storage`, então `storage.getAll` já está disponível sem mudança de import).

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão, todos passando (esta task não muda nenhuma função de domínio, só onde o botão é montado na UI).

- [ ] **Step 4: Commit**

```bash
git add src/ui/conciliacao.js src/ui/conciliacao-fatura.js
git commit -m "Move o botao de exportar conciliacao completa para ficar sempre visivel"
```

---

### Task 8: Verificação visual em navegador real (Playwright)

**Files:** nenhum arquivo novo — task de verificação; correções pontuais em `src/ui/lancamentos.js`, `src/ui/lancamentos-filtros.js`, `src/ui/lancamentos-parcelado.js`, `src/ui/conciliacao.js`, `src/ui/conciliacao-import.js` ou `styles.css` se algo visual não bater com o esperado.

**Interfaces:**
- Consumes: app rodando localmente (servidor estático), Playwright MCP (`browser_navigate`, `browser_evaluate` para seed sintético via `storage.put`/`putMany`, `browser_click`, `browser_select_option`, `browser_take_screenshot` com `fullPage:true`, `browser_run_code_unsafe` para `page.emulateMedia`/`page.setViewportSize`).

- [ ] **Step 1: Subir servidor estático local e seedar dados 100% sintéticos**

Nunca usar nome, número de conta/cartão ou valor real — só identificadores fictícios, seguindo a disciplina já usada nas fases anteriores. Seed mínimo: 1-2 contas/cartões, categorias/formas (via seed padrão se vazio), ~10 transações reais espalhadas em pelo menos 2 meses, 2 naturezas diferentes (despesa e receita, por exemplo), 2 formas e 2 contas — o suficiente pra exercitar todos os filtros novos.

- [ ] **Step 2: Verificar Lançamentos — navegação por mês**

Abrir a aba, confirmar que o cabeçalho mostra "‹ Mês Ano ›" com o mês atual. Clicar em `›`/`‹` e confirmar que a lista/total mudam para refletir o mês vizinho (mesmo sem lançamento nele — deve mostrar lista vazia do mês certo, não travar).

- [ ] **Step 3: Verificar filtro de natureza**

Trocar o `<select>` de natureza e confirmar que a lista filtra corretamente (uma transação de receita não aparece quando o filtro está em "Gasto", por exemplo), combinando com forma/conta como os outros filtros já fazem.

- [ ] **Step 4: Verificar parcelamento**

Marcar o checkbox "É uma compra parcelada?", preencher valor total e número de parcelas, confirmar que o preview aparece e atualiza em tempo real. Desmarcar e confirmar que os campos voltam ao normal (campo "Valor" simples).

- [ ] **Step 5: Verificar lista — botões lado a lado**

Screenshot da lista com pelo menos 1 item, em viewport estreito (375px) e largo (desktop) — confirmar visualmente que Editar/Excluir ficam na mesma linha, não empilhados.

- [ ] **Step 6: Verificar rodapé — backup/apagar tudo**

Confirmar visualmente que os botões "Backup completo"/"Importar backup" e o link "Apagar todos os dados do app" aparecem no rodapé. Não é necessário executar de fato o apagar-tudo neste teste (ação destrutiva, dados sintéticos servem só pra ver a tela — se quiser exercitar de fato, usar o botão de exportar backup, que é não-destrutivo, e conferir que baixa um arquivo sem erro de console).

- [ ] **Step 7: Verificar Conciliação — aviso de duplicata**

Se houver um adaptador testável sem PDF real disponível (ex.: `generic-table` com uma planilha sintética pequena), importar o mesmo documento duas vezes e confirmar que a segunda análise mostra o aviso. Se não houver um caminho de teste de importação sem arquivo real disponível no ambiente de verificação, testar `documentoJaImportado`/`idDeterministicoDoDocumento` já cobre a lógica via teste Node (Task 6) — está OK a verificação visual desta task ficar mais leve aqui, focando em confirmar que o botão de exportar aparece mesmo sem documento selecionado (Step 8).

- [ ] **Step 8: Verificar Conciliação — botão de exportar sempre visível**

Selecionar uma conta sem nenhum documento importado ainda (ou nenhuma conta selecionada) e confirmar que o botão "Exportar conciliação completa" aparece mesmo assim (desde que haja pelo menos 1 conta cadastrada).

- [ ] **Step 9: Verificar dark mode**

Repetir os screenshots relevantes (Lançamentos com navegação de mês, formulário com parcelamento marcado, rodapé) com `page.emulateMedia({colorScheme:'dark'})`.

- [ ] **Step 10: Corrigir o que a verificação achar**

Problemas encontrados são corrigidos diretamente nos arquivos desta mesma task, não em task nova. Repetir os screenshots relevantes até confirmar.

- [ ] **Step 11: Rodar a suíte completa uma última vez**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 12: Commit (se o Step 10 gerou mudança)**

```bash
git commit -m "Ajusta layout de Lancamentos/Conciliacao apos verificacao visual"
```

Se nenhuma mudança foi necessária, pular o commit.

