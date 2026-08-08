# Aba Parcelas: fix de âncora + Cadastros: descrição e layout de regras — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a aba Parcelas, que mostra parcelas já pagas como futuras (usa a data de corte da fatura como âncora em vez do vencimento real), adicionar um campo de descrição opcional em Categorias (visível como tooltip na lista), realinhar a lista de Regras de classificação em colunas fixas, e adicionar um texto de ajuda contextual sobre expressão regular no formulário de regras.

**Architecture:** `autoConfirmParcelas` (`domain/parcelas.js`) passa a gravar `faturaVencimento` (o vencimento real da fatura) na transação confirmada, além do `data` (=dataCorte, inalterado). `parcelaGroupsDaConta` (mesmo arquivo) passa a usar `t.faturaVencimento || t.data` como âncora — fallback cobre transações confirmadas antes deste fix, sem migração retroativa (decisão já validada). `domain/categories.js` ganha um campo opcional `descricao`, sem mudança de índice/schema do IndexedDB. `ui/cadastros-categorias.js` ganha um terceiro campo no formulário e um `title` condicional na lista. `ui/cadastros-regras.js` troca a classe `item-cadastro` por uma nova `item-regra` (CSS Grid, 3 colunas de botão) e ganha um parágrafo de ajuda condicional ao tipo de correspondência.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime. Testes via `node tools/run-tests.mjs` (puro) e `tools/tests.html` (browser). Verificação visual via Playwright MCP.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot, teste ou fixture, mesmo temporário.
- Datas ISO internamente (`YYYY-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Campo novo em objeto de domínio (`categoria.descricao`, `transaction.faturaVencimento`) NÃO exige mudança de `DB_VERSION` — IndexedDB não valida schema de objeto, só a lista de stores/índices em `core/db-schema.js`. Não tocar `db-schema.js` neste plano.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado (`el`, `id`, `ym`). Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Sem migração retroativa: parcelamentos confirmados ANTES deste fix continuam com o comportamento atual até a PRÓXIMA fatura daquele cartão ser importada — decisão já validada com o usuário, não implementar script de migração.

---

### Task 1: Fix — `faturaVencimento` como âncora correta em `parcelaGroupsDaConta`

**Files:**
- Modify: `src/domain/parcelas.js`
- Test: `tests/parcelas.test.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: `autoConfirmParcelas` passa a incluir `faturaVencimento: row.vencimento` no objeto `updated` (a transação confirmada). `parcelaGroupsDaConta` passa a usar `t.faturaVencimento || t.data` em vez de `t.data` ao montar `vencimento` da linha reconstruída. Nenhuma assinatura de função muda.

Causa raiz: a transação confirmada por `autoConfirmParcelas` grava
`data: dataCorte || row.vencimento` (dataCorte é a data de FECHAMENTO do
período de compras, tipicamente no mês ANTERIOR ao vencimento — ex.: fatura
vence 30/01, fecha ~23/12). `parcelaGroupsDaConta` (usado pela aba Parcelas)
reconstrói o grupo de parcelamento a partir dessa transação salva, usando
`t.data` como se fosse o vencimento real da fatura — isso ancora a projeção
de parcelas futuras na data de CORTE, não no vencimento, fazendo a sequência
de meses previstos incluir o mês já pago e "escorregar" um mês para trás.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Adicionar a `tests/parcelas.test.js`, dentro do describe
`'parcelas: parcelaGroupsDaConta (reconstroi grupos a partir de TRANSACTIONS, usado pela aba Parcelas)'`:

```js
  it('usa faturaVencimento (nao data=dataCorte) como ancora, quando presente — fix do bug real: parcela ja paga aparecendo como futura', () => {
    const key = computeParcelaKey('LOJA VENCIMENTO', '2025-10-01', 9);
    // Cenario real do usuario: fatura vence 30/01/2026, mas a transacao
    // confirmada grava data=dataCorte (23/12/2025, mes ANTERIOR ao
    // vencimento) — sem o fix, parcelaGroupsDaConta ancorava em dezembro
    // (t.data) em vez de janeiro (faturaVencimento), fazendo a projecao
    // comecar um mes cedo demais e incluir um mes ja pago.
    const confirmada = {
      id: 'confirmed_z', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA VENCIMENTO', data: '2025-12-23', faturaVencimento: '2026-01-30',
      parcela_atual: 4, parcela_total: 9, valor: 100,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 5, 'restam 5 parcelas (5/9 a 9/9)');
    assertEqual(grupos[0].months[0].ym, '2026-01', 'a primeira parcela restante (5/9) cai no MESMO mes civil do vencimento real (janeiro), nao do dataCorte (dezembro)');
    assertEqual(grupos[0].months[0].numero, 5);
    assertEqual(grupos[0].months[4].ym, '2026-05', 'a ultima parcela restante (9/9) cai em maio — fevereiro a maio seriam os 4 meses seguintes a janeiro, jan+4=maio');
  });

  it('sem faturaVencimento (transacao confirmada ANTES do fix, ou lancamento manual), cai no fallback t.data — sem regressao no comportamento atual', () => {
    const key = computeParcelaKey('LOJA SEM VENCIMENTO', '2026-01-01', 4);
    const confirmada = {
      id: 'confirmed_w', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA SEM VENCIMENTO', data: '2026-02-15',
      parcela_atual: 2, parcela_total: 4, valor: 50,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].months[0].ym, '2026-02', 'sem faturaVencimento, usa t.data como antes (fallback, sem migracao retroativa)');
  });
```

Adicionar também a `tests/parcelas.test.js`, num describe existente para
`autoConfirmParcelas` (procurar o describe já existente — provavelmente
`'parcelas: autoConfirmParcelas'` — e seguir o padrão de fixture já usado
nele):

```js
  it('transacao confirmada grava faturaVencimento com o vencimento REAL da fatura, alem de data=dataCorte', () => {
    const row = { tipo: 'parcelamento', descricao: 'LOJA TESTE', data: '2025-10-01', parcela_atual: 4, parcela_total: 9, valor: 100, vencimento: '2026-01-30' };
    const { confirmed } = autoConfirmParcelas([row], [], '2025-12-23', 'acc_1', 'pm_credito');
    assertEqual(confirmed.length, 1);
    assertEqual(confirmed[0].after.data, '2025-12-23', 'data continua sendo a dataCorte, sem mudanca de comportamento ja aceito');
    assertEqual(confirmed[0].after.faturaVencimento, '2026-01-30', 'faturaVencimento e o vencimento real da fatura, campo novo');
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — `faturaVencimento` ainda não é gravado nem lido.

- [ ] **Step 3: Implementar em `src/domain/parcelas.js`**

Em `autoConfirmParcelas`, localizar o objeto `updated` (dentro do loop
`for (const row of faturaRows || [])`):

```js
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
```

Adicionar `faturaVencimento: row.vencimento,` logo após `data: dataCorte || row.vencimento,`:

```js
    const updated = {
      id: newId,
      descricao: descricaoBase,
      valor: row.valor,
      data: dataCorte || row.vencimento,
      // Vencimento REAL da fatura (nunca a dataCorte) — usado por
      // parcelaGroupsDaConta (aba Parcelas) pra ancorar corretamente a
      // projecao de parcelas futuras. `data` continua sendo dataCorte de
      // proposito (comportamento ja aceito pra exibicao em Lancamentos);
      // este campo existe so pra dar a quem precisa do vencimento real um
      // jeito de recupera-lo sem reconstruir a partir do id.
      faturaVencimento: row.vencimento,
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
```

Em `parcelaGroupsDaConta`, localizar:

```js
  const rowsDoGrupo = [...porKey.values()].map((t) => ({
    tipo: 'parcelamento',
    descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''),
    data: t.data, vencimento: t.data,
    parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor,
    key: t.parcelaKey,
  }));
```

Trocar `vencimento: t.data` por `vencimento: t.faturaVencimento || t.data`:

```js
  const rowsDoGrupo = [...porKey.values()].map((t) => ({
    tipo: 'parcelamento',
    descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''),
    data: t.data,
    // faturaVencimento (campo novo, gravado por autoConfirmParcelas a partir
    // desta correcao) e o vencimento REAL da fatura — t.data e a dataCorte,
    // que NAO deve ser usada como ancora de projecao (bug corrigido: parcela
    // ja paga aparecia como futura). Fallback pra t.data cobre transacoes
    // confirmadas ANTES deste fix, sem migracao retroativa (decisao ja
    // validada) — nesses casos o comportamento e o mesmo de hoje.
    vencimento: t.faturaVencimento || t.data,
    parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor,
    key: t.parcelaKey,
  }));
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os 3 testes novos.

- [ ] **Step 5: Commit**

```bash
git add src/domain/parcelas.js tests/parcelas.test.js
git commit -m "Corrige aba Parcelas: usa vencimento real da fatura como ancora, nao a data de corte"
```

---

### Task 2: Campo de descrição opcional em Categorias

**Files:**
- Modify: `src/domain/categories.js`
- Modify: `src/ui/cadastros-categorias.js`
- Test: `tests/categories.test.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: `novaCategoria(nome, cor, todas)` continua com a mesma assinatura (não ganha parâmetro novo — `descricao` é preenchida depois, no formulário, como qualquer outro campo editável); o objeto categoria pode ter `descricao` (string, opcional, pode ser `''` ou ausente). `validateCategoria` não muda (descrição nunca é obrigatória, nada a validar).

- [ ] **Step 1: Escrever o teste que falha primeiro**

Ler `tests/categories.test.js` primeiro para confirmar a convenção de
fixture já usada nele. Adicionar:

```js
describe('categories: descricao opcional', () => {
  it('categoria pode ser salva com descricao, e o campo sobrevive ida e volta', () => {
    const cat = { id: 'cat_x', nome: 'Teste', cor: '#111111', descricao: 'Gastos com teste' };
    const erros = validateCategoria(cat, []);
    assertEqual(erros.length, 0, 'descricao nunca e obrigatoria, nao deveria gerar erro de validacao');
  });

  it('categoria sem descricao continua valida (campo opcional)', () => {
    const cat = { id: 'cat_y', nome: 'Sem descricao', cor: '#222222' };
    const erros = validateCategoria(cat, []);
    assertEqual(erros.length, 0);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que passam já no primeiro run**

Run: `node tools/run-tests.mjs`
Expected: PASSOU sem mudança de código — `validateCategoria` já não valida
campos além de nome/duplicidade, então `descricao` já é aceita sem nenhuma
mudança no domínio. Este teste existe pra travar esse comportamento
explicitamente (documentar a intenção), não pra guiar uma implementação.
Se por algum motivo falhar, investigar `validateCategoria` antes de
prosseguir — não deveria.

- [ ] **Step 3: Editar `src/ui/cadastros-categorias.js`**

Em `editarCategoria`, adicionar o campo de descrição. Localizar:

```js
async function editarCategoria(cat, todas, aoMudar) {
  const inputNome = el('input', { type: 'text', value: cat.nome });
  const inputCor = el('input', { type: 'color', value: cat.cor });
  const escolha = await abrirModal({
    titulo: cat.nome ? 'Editar categoria' : 'Nova categoria',
    corpo: el('div', { class: 'form' }, [
      campo('Nome', inputNome),
      campo('Cor', inputCor),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizada = { ...cat, nome: inputNome.value.trim(), cor: inputCor.value };
  const erros = validateCategoria(atualizada, todas);
  if (erros.length) return mostrarErros(erros);

  await saveCategoria(atualizada);
  toast('Categoria salva.', 'ok');
  await aoMudar();
}
```

Trocar para:

```js
async function editarCategoria(cat, todas, aoMudar) {
  const inputNome = el('input', { type: 'text', value: cat.nome });
  const inputCor = el('input', { type: 'color', value: cat.cor });
  const inputDescricao = el('textarea', { rows: '2', text: cat.descricao || '' });
  const escolha = await abrirModal({
    titulo: cat.nome ? 'Editar categoria' : 'Nova categoria',
    corpo: el('div', { class: 'form' }, [
      campo('Nome', inputNome),
      campo('Cor', inputCor),
      campo('Descrição (opcional)', inputDescricao),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizada = { ...cat, nome: inputNome.value.trim(), cor: inputCor.value, descricao: inputDescricao.value.trim() };
  const erros = validateCategoria(atualizada, todas);
  if (erros.length) return mostrarErros(erros);

  await saveCategoria(atualizada);
  toast('Categoria salva.', 'ok');
  await aoMudar();
}
```

Confirmar se `el()` (`src/ui/components.js`) aceita `text` como conteúdo
inicial para `<textarea>` da mesma forma que aceita para outros elementos
— ler `components.js` antes de assumir; se `textarea` precisar de
`value` em vez de `text`/filho, ajustar para o padrão real da função `el`.

- [ ] **Step 4: Mostrar a descrição como tooltip na lista**

Em `secaoCategorias`, localizar:

```js
      el('span', { class: 'item-nome', text: c.nome }),
```

Trocar para (só adiciona `title` quando `descricao` não estiver vazia):

```js
      el('span', { class: 'item-nome', text: c.nome, ...(c.descricao ? { title: c.descricao } : {}) }),
```

- [ ] **Step 5: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os 2 novos.

- [ ] **Step 6: Commit**

```bash
git add src/domain/categories.js src/ui/cadastros-categorias.js tests/categories.test.js
git commit -m "Adiciona descricao opcional em categorias, exibida como tooltip na lista"
```

---

### Task 3: Layout em colunas fixas na lista de Regras de classificação

**Files:**
- Modify: `src/ui/cadastros-regras.js`
- Modify: `styles.css`

**Interfaces:** nenhuma interface nova — mudança de apresentação.

Causa raiz: `secaoRegras` usa `class: 'item-cadastro'`, uma classe
COMPARTILHADA entre 4 telas de Cadastros (categorias, formas, contas,
regras) — `styles.css`, flexbox `flex-wrap: wrap` sem larguras fixas.
Regras tem 3 botões (Editar/Ativar-Desativar/Excluir) contra 2 nas outras
telas — trocar `.item-cadastro` para grid mudaria o layout das outras 3
também. Precisa de uma classe própria só para Regras.

- [ ] **Step 1: Editar `src/ui/cadastros-regras.js`**

Localizar:

```js
  const lista = el('div', { class: 'lista-cadastro' },
    ordenadas.map((r) => el('div', { class: `item-cadastro${r.ativa === false ? ' inativo' : ''}` }, [
      el('span', { class: 'item-nome', text: `${r.padrao}${r.ativa === false ? ' — desativada' : ''}` }),
      el('span', { class: 'item-meta', text: `${ROTULO_TIPO_MATCH[r.tipoMatch]} · ${ROTULO_ESCOPO[r.escopo]} · ${nomeCategoria(r.categoriaId)} · ${r.acertos || 0} acerto(s) · ${r.origem === 'aprendida' ? 'aprendida' : 'manual'}` }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarRegra(r, categorias, aoMudar) }),
      el('button', { class: 'btn btn-mini', text: r.ativa === false ? 'Ativar' : 'Desativar', onclick: () => alternarAtiva(r, aoMudar) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirRegra(r, aoMudar) }),
    ]))
  );
```

Trocar `item-cadastro` por `item-regra` (mantendo `inativo` como
modificador) e agrupar os 3 botões num container próprio para virarem uma
única "coluna" de ações no grid:

```js
  const lista = el('div', { class: 'lista-cadastro' },
    ordenadas.map((r) => el('div', { class: `item-regra${r.ativa === false ? ' inativo' : ''}` }, [
      el('span', { class: 'item-nome', text: `${r.padrao}${r.ativa === false ? ' — desativada' : ''}` }),
      el('span', { class: 'item-meta', text: `${ROTULO_TIPO_MATCH[r.tipoMatch]} · ${ROTULO_ESCOPO[r.escopo]} · ${nomeCategoria(r.categoriaId)} · ${r.acertos || 0} acerto(s) · ${r.origem === 'aprendida' ? 'aprendida' : 'manual'}` }),
      el('div', { class: 'item-regra-acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarRegra(r, categorias, aoMudar) }),
        el('button', { class: 'btn btn-mini', text: r.ativa === false ? 'Ativar' : 'Desativar', onclick: () => alternarAtiva(r, aoMudar) }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirRegra(r, aoMudar) }),
      ]),
    ]))
  );
```

- [ ] **Step 2: Adicionar o CSS em `styles.css`**

Ao final do arquivo:

```css
/* Lista de Regras de classificacao: classe propria (nao item-cadastro,
   compartilhada com categorias/formas/contas) porque Regras tem 3 botoes
   de acao contra 2 nas outras telas — precisa de layout proprio pra nao
   afetar as outras 3. Mesma tecnica ja usada em .item-lancamento: grid
   com colunas fixas, texto principal ocupando o espaco restante. */
.item-regra {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  row-gap: 2px;
  padding: 8px 0;
  border-bottom: 1px solid var(--linha);
}
.item-regra:last-child { border-bottom: none; }
.item-regra.inativo { opacity: 0.6; }

.item-regra > .item-nome {
  grid-column: 1;
  grid-row: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.item-regra > .item-meta {
  grid-column: 1;
  grid-row: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.item-regra-acoes {
  grid-column: 2;
  grid-row: 1 / 3;
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.item-regra-acoes .btn { flex: 0 0 auto; }
```

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão (nenhum teste Node cobre CSS/layout).

- [ ] **Step 4: Commit**

```bash
git add src/ui/cadastros-regras.js styles.css
git commit -m "Alinha lista de Regras de classificacao em colunas fixas, sem afetar outras telas de Cadastros"
```

---

### Task 4: Ajuda contextual sobre expressão regular no formulário de Regras

**Files:**
- Modify: `src/ui/cadastros-regras.js`

**Interfaces:** nenhuma interface nova — elemento de UI condicional.

A funcionalidade de regex já existe (`tipoMatch: 'regex'`, já testada e
validada em `domain/classification.js`) — este é só um texto de ajuda no
formulário, já que o usuário não sabia que a opção existia.

- [ ] **Step 1: Editar `editarRegra` em `src/ui/cadastros-regras.js`**

Localizar:

```js
async function editarRegra(regra, categorias, aoMudar) {
  const inpPadrao = el('input', { type: 'text', value: regra.padrao });
  const selTipoMatch = el('select', {}, Object.entries(ROTULO_TIPO_MATCH).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.tipoMatch ? { selected: 'selected' } : {}) })
  ));
  const selEscopo = el('select', {}, Object.entries(ROTULO_ESCOPO).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.escopo ? { selected: 'selected' } : {}) })
  ));
  const selCategoria = el('select', {}, categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === regra.categoriaId ? { selected: 'selected' } : {}) })
  ));

  const escolha = await abrirModal({
    titulo: regra.padrao ? 'Editar regra' : 'Nova regra',
    corpo: el('div', { class: 'form' }, [
      campo('Padrão (descrição canônica)', inpPadrao),
      campo('Tipo de correspondência', selTipoMatch),
      campo('Vale para', selEscopo),
      campo('Categoria', selCategoria),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
```

Trocar para (adiciona `ajudaRegex`, um `<p>` que começa escondido e alterna
visibilidade no `change` de `selTipoMatch`):

```js
async function editarRegra(regra, categorias, aoMudar) {
  const inpPadrao = el('input', { type: 'text', value: regra.padrao });
  const selTipoMatch = el('select', {}, Object.entries(ROTULO_TIPO_MATCH).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.tipoMatch ? { selected: 'selected' } : {}) })
  ));
  const selEscopo = el('select', {}, Object.entries(ROTULO_ESCOPO).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.escopo ? { selected: 'selected' } : {}) })
  ));
  const selCategoria = el('select', {}, categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === regra.categoriaId ? { selected: 'selected' } : {}) })
  ));
  const ajudaRegex = el('p', {
    class: 'ajuda',
    style: selTipoMatch.value === 'regex' ? '' : 'display:none',
    text: 'Expressão regular JavaScript padrão. Exemplos: "^UBER" casa descrições que COMEÇAM com UBER; "MERCADO|SUPERMERCADO" casa qualquer uma das duas, em qualquer posição.',
  });
  selTipoMatch.addEventListener('change', () => {
    ajudaRegex.style.display = selTipoMatch.value === 'regex' ? '' : 'none';
  });

  const escolha = await abrirModal({
    titulo: regra.padrao ? 'Editar regra' : 'Nova regra',
    corpo: el('div', { class: 'form' }, [
      campo('Padrão (descrição canônica)', inpPadrao),
      campo('Tipo de correspondência', selTipoMatch),
      ajudaRegex,
      campo('Vale para', selEscopo),
      campo('Categoria', selCategoria),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
```

(o resto da função, a partir de `if (escolha !== 'salvar') return;`, não muda).

Verificar se a classe `ajuda` já existe em `styles.css` com estilo
apropriado (usada em `lancamentos-form.js` para o indicador de parcela) —
não deve precisar de CSS novo, só reaproveitar.

- [ ] **Step 2: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão (mudança é DOM puro, sem teste Node cobrindo este formulário).

- [ ] **Step 3: Commit**

```bash
git add src/ui/cadastros-regras.js
git commit -m "Adiciona ajuda contextual sobre expressao regular no formulario de Regras"
```

---

### Task 5: Verificação visual em navegador real (Playwright)

**Files:** nenhum arquivo novo — task de verificação; correções pontuais em `src/domain/parcelas.js`, `src/ui/cadastros-categorias.js`, `src/ui/cadastros-regras.js` ou `styles.css` se algo visual não bater com o esperado.

**Interfaces:**
- Consumes: app rodando localmente (servidor estático), Playwright MCP (`browser_navigate`, `browser_run_code_unsafe` para seed sintético via `storage.put`/`putMany`, `browser_click`, `browser_select_option`, `browser_take_screenshot` com `fullPage:true`).

- [ ] **Step 1: Subir servidor estático local e seedar dados 100% sintéticos**

Nunca usar nome, número de conta/cartão ou valor real — só identificadores
fictícios. Seed mínimo: 1 cartão, uma transaction confirmada de parcela
(ex.: 4/9) com `faturaVencimento` setado corretamente (simulando uma
importação de fatura pós-fix), 2-3 categorias (uma com descrição, uma
sem), 3-4 regras de classificação variando tipoMatch (incluindo pelo
menos uma 'regex') e `ativa` (pelo menos uma desativada).

- [ ] **Step 2: Verificar Task 1 — aba Parcelas**

Abrir a aba Parcelas, confirmar que a parcela seedada (ex.: confirmada
como 4/9 com `faturaVencimento` no mês certo) projeta as parcelas
restantes (5/9 a 9/9) a partir do MÊS SEGUINTE ao vencimento real, nunca
incluindo o mês da dataCorte. Conferir também que o total mensal no topo
da aba não inclui o mês já pago.

- [ ] **Step 3: Verificar Task 2 — descrição de categoria**

Em Cadastros → Categorias, abrir o formulário de edição da categoria com
descrição seedada, confirmar que o campo aparece preenchido. Passar o
mouse sobre o nome dela na lista e confirmar que o tooltip mostra a
descrição. Confirmar que a categoria SEM descrição não mostra tooltip
vazio (nenhum atributo `title` ou `title=""`).

- [ ] **Step 4: Verificar Task 3 — layout de Regras**

Em Cadastros → Regras de classificação, screenshot da lista com pelo
menos 3 regras (incluindo uma desativada), em viewport estreito (375px) e
desktop — confirmar visualmente que Editar/Ativar-Desativar/Excluir
ficam alinhados na mesma coluna vertical entre itens de padrão/meta de
tamanhos diferentes. Confirmar que Categorias/Formas/Contas continuam com
o layout de ANTES (não afetadas por esta mudança).

- [ ] **Step 5: Verificar Task 4 — ajuda de regex**

No formulário de Nova Regra, confirmar que o texto de ajuda está
escondido por padrão (tipo "Exata" ou "Contém" selecionado), e aparece ao
trocar o seletor para "Expressão regular". Trocar de volta e confirmar
que esconde novamente.

- [ ] **Step 6: Verificar dark mode**

Repetir os screenshots relevantes (aba Parcelas, lista de Regras,
tooltip de categoria se capturável) com
`page.emulateMedia({colorScheme:'dark'})`.

- [ ] **Step 7: Corrigir o que a verificação achar**

Problemas encontrados são corrigidos diretamente nos arquivos desta mesma
task, não em task nova. Repetir os screenshots relevantes até confirmar.

- [ ] **Step 8: Rodar a suíte completa uma última vez**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 9: Commit (se o Step 7 gerou mudança)**

```bash
git commit -m "Ajusta Parcelas/Cadastros apos verificacao visual"
```

Se nenhuma mudança foi necessária, pular o commit.
