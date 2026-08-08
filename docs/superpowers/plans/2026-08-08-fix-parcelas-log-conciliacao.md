# Fix definitivo de Parcelas + timestamp legível no log + layout da Conciliação de extrato — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir definitivamente a aba Parcelas (o mês já pago ainda aparecia como parcela futura, mesmo após o fix anterior de `faturaVencimento`), tornar o `timestamp` do log de auditoria legível na exportação `.json`, e corrigir o layout quebrado dos 3 selects (Natureza/Categoria/Forma) na Conciliação de extrato, removendo o selo "A Classificar" redundante.

**Architecture:** `computeParcelaGroups` (`domain/parcelas.js`) ganha um parâmetro opcional que diferencia dois usos que hoje compartilham a mesma regra de cálculo indevidamente: `syncPredictions` (importação de fatura, continua "mesmo mês" — comportamento já validado) vs `parcelaGroupsDaConta` (aba Parcelas, passa a usar "mês seguinte" quando a âncora é uma transação CONFIRMADA). `exportarLog` (`ui/lancamentos.js`) mapeia os eventos adicionando `dataHora` antes de serializar, sem remover `timestamp`. `.item-form-lote` (`styles.css`) migra de flexbox com margens calculadas manualmente para CSS Grid (mesmo padrão já usado em `.item-lancamento`/`.item-regra` de sessões anteriores) — mais robusto a mudanças futuras de conteúdo. O selo de categoria sugerida (`conciliacao-extrato.js`) passa a ser condicional.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime. Testes via `node tools/run-tests.mjs` (puro) e `tools/tests.html` (browser). Verificação visual via Playwright MCP.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot, teste ou fixture, mesmo temporário.
- Datas ISO internamente (`YYYY-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado (`el`, `id`, `ym`). Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Sem migração retroativa em `parcelas.js` — decisão já validada em sessão anterior, sem mudança nesta fase (transações confirmadas sem `faturaVencimento` continuam usando o fallback `t.data`).
- `syncPredictions`/`autoConfirmParcelas`/o fluxo de importação de fatura NÃO podem mudar de comportamento — testes existentes de "lacuna de mês" (commit `654c498`) continuam passando sem alteração de assert.

---

### Task 1: Fix definitivo — `computeParcelaGroups` diferencia importação (mesmo mês) de aba Parcelas com âncora confirmada (mês seguinte)

**Files:**
- Modify: `src/domain/parcelas.js`
- Test: `tests/parcelas.test.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: `computeParcelaGroups(allFaturaRows, { primeiraNoMesmoMes = true } = {})` — parâmetro novo, opcional, com default `true` (preserva o comportamento atual para TODAS as chamadas existentes que não passam o segundo argumento). `syncPredictions` continua chamando sem o segundo argumento (default `true`, sem mudança). `parcelaGroupsDaConta` passa `{ primeiraNoMesmoMes: false }` apenas quando a âncora escolhida por `melhorAncoraDeParcela` é uma transação CONFIRMADA (`!t.previsto`); quando a âncora é uma PREVISÃO, continua passando `true` (ou omitindo o argumento, já que `true` é o default).

Causa raiz: `addMonths(r.vencimento, k - 1)` faz a primeira parcela
"restante" cair no MESMO mês civil do vencimento passado — comportamento
correto para `syncPredictions` (durante importação, evita lacuna de mês
quando duas faturas consecutivas vencem no mesmo mês civil), mas ERRADO
para `parcelaGroupsDaConta` quando a âncora é uma transação CONFIRMADA
(o vencimento dessa transação é de um mês JÁ PAGO — a primeira parcela
restante deveria ser o mês SEGUINTE). Quando a âncora é uma PREVISÃO, o
`t.data`/vencimento já é um mês sintético futuro (`ym + '-01'`,
gravado por `syncPredictions`) — "mesmo mês" continua correto nesse caso,
sem mudança.

- [ ] **Step 1: Escrever os testes que falham primeiro**

Adicionar a `tests/parcelas.test.js`, dentro do describe
`'parcelas: parcelaGroupsDaConta (reconstroi grupos a partir de TRANSACTIONS, usado pela aba Parcelas)'`, substituindo/complementando o teste
existente `'usa faturaVencimento (nao data=dataCorte) como ancora...'`
(ler o teste atual primeiro — ele hoje afirma `months[0].ym === '2026-01'`,
que é o comportamento ERRADO que estamos corrigindo; atualizar o assert
para o valor CORRETO):

```js
  it('usa faturaVencimento (nao data=dataCorte) como ancora, E comeca no MES SEGUINTE ao vencimento (nao no mesmo mes) — fix definitivo: mes ja pago nao aparece mais como parcela futura', () => {
    const key = computeParcelaKey('LOJA VENCIMENTO', '2025-10-01', 9);
    // Cenario real do usuario: fatura vence 30/01/2026 e confirma a parcela
    // 4/9. O mes de JANEIRO (mes do vencimento desta fatura) JA FOI PAGO —
    // a primeira parcela RESTANTE (5/9) precisa cair em FEVEREIRO, nao em
    // janeiro. Confirmado pelo usuario: fatura de 30/06/2026 traz a ultima
    // parcela (9/9), entao fevereiro..junho sao os 5 meses restantes.
    const confirmada = {
      id: 'confirmed_z', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA VENCIMENTO', data: '2025-12-23', faturaVencimento: '2026-01-30',
      parcela_atual: 4, parcela_total: 9, valor: 100,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 5, 'restam 5 parcelas (5/9 a 9/9)');
    assertEqual(grupos[0].months[0].ym, '2026-02', 'a primeira parcela restante (5/9) cai em FEVEREIRO — o mes de janeiro (vencimento desta fatura) ja foi pago, nao pode aparecer como restante');
    assertEqual(grupos[0].months[0].numero, 5);
    assertEqual(grupos[0].months[4].ym, '2026-06', 'a ultima parcela restante (9/9) cai em junho — fevereiro a junho sao os 5 meses seguintes a janeiro, confirmado pelo usuario via fatura real de 30/06 trazendo 9/9');
  });
```

Adicionar também um teste em `computeParcelaGroups` confirmando que o
parâmetro por default preserva o comportamento atual (importação):

```js
  it('computeParcelaGroups SEM o parametro novo (ou com primeiraNoMesmoMes:true) mantem o comportamento atual — nenhuma regressao no fluxo de importacao', () => {
    const row = rowParcelamento({ vencimento: '2026-03-01', parcela_atual: 2, parcela_total: 10 });
    const gruposDefault = computeParcelaGroups([row]);
    const gruposExplicito = computeParcelaGroups([row], { primeiraNoMesmoMes: true });
    assertEqual(gruposDefault[0].months[0].ym, '2026-03', 'default continua "mesmo mes" — comportamento ja validado para importacao');
    assertEqual(gruposExplicito[0].months[0].ym, '2026-03');
  });

  it('computeParcelaGroups com primeiraNoMesmoMes:false comeca no mes SEGUINTE ao vencimento', () => {
    const row = rowParcelamento({ vencimento: '2026-03-01', parcela_atual: 2, parcela_total: 10 });
    const grupos = computeParcelaGroups([row], { primeiraNoMesmoMes: false });
    assertEqual(grupos[0].months[0].ym, '2026-04', 'com o novo parametro false, pula pro mes seguinte (marco ja foi pago)');
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: FALHOU — o teste do Step 1 assertando `'2026-01'` (versão antiga)
precisa ser substituído pelo novo assert `'2026-02'` ANTES de rodar, ou o
teste vai falhar por assert desatualizado, não pela ausência do parâmetro.
Depois de atualizar o assert, rodar de novo: os 3 testes novos/atualizados
devem falhar porque `primeiraNoMesmoMes` ainda não existe.

- [ ] **Step 3: Implementar em `src/domain/parcelas.js`**

Localizar `computeParcelaGroups`:

```js
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
      // addMonths(vencimento, k - 1): a PRIMEIRA parcela restante cai no
      // MESMO mês civil do vencimento desta linha, não no mês seguinte.
      // Duas faturas consecutivas podem vencer no mesmo mês civil (ex.:
      // 01/03 e 30/03) — se a previsão sempre pulasse pro mês seguinte ao
      // vencimento mais recente, o mês da PRÓXIMA fatura real ficava sem
      // NENHUMA entrada (nem confirmada, nem prevista) até essa fatura
      // chegar: a previsão antiga daquele mês já tinha sido removida (pela
      // confirmação que acabou de acontecer), e a nova nascia um mês à
      // frente, deixando uma lacuna visível na aba Lançamentos. A previsão
      // continua sendo uma ESTIMATIVA de 1 parcela por mês civil (nunca
      // tenta prever o dia exato do próximo vencimento) — só não pula mais
      // o primeiro mês depois de uma confirmação.
      const dt = addMonths(r.vencimento, k - 1);
      months.push({ ym: ymOf(dt), valor: r.valor, numero: r.parcela_atual + k });
    }
    groups.push({ key: r.key, descricao: r.descricao, dataCompraOriginal: r.data, valor: r.valor, parcelaAtual: r.parcela_atual, remaining, parcelaTotal: r.parcela_total, months });
  }
  return groups;
}
```

Trocar para:

```js
export function computeParcelaGroups(allFaturaRows, { primeiraNoMesmoMes = true } = {}) {
  const map = new Map();
  for (const r of allFaturaRows || []) {
    if (r.tipo !== 'parcelamento' || !r.parcela_total) continue;
    const key = r.key || computeParcelaKey(r.descricao, r.data, r.parcela_total);
    const cur = map.get(key);
    if (!cur || r.parcela_atual > cur.parcela_atual) map.set(key, { ...r, key });
  }
  // offsetPrimeiraParcela: 0 faz a primeira parcela restante cair no MESMO
  // mes civil do vencimento (comportamento de syncPredictions, durante a
  // importacao de fatura — ver comentario abaixo); 1 pula pro mes SEGUINTE
  // (comportamento de parcelaGroupsDaConta quando a ancora e uma transacao
  // CONFIRMADA, cujo vencimento e de um mes JA PAGO — usar offset 0 nesse
  // caso fazia o mes pago reaparecer como parcela futura, bug real relatado
  // em producao mesmo apos o fix de faturaVencimento).
  const offsetPrimeiraParcela = primeiraNoMesmoMes ? 0 : 1;
  const groups = [];
  for (const r of map.values()) {
    const remaining = r.parcela_total - r.parcela_atual;
    if (remaining <= 0) continue;
    const months = [];
    for (let k = 1; k <= remaining; k++) {
      // addMonths(vencimento, k - 1 + offsetPrimeiraParcela): a PRIMEIRA
      // parcela restante cai no MESMO mês civil do vencimento (offset 0,
      // default — usado por syncPredictions) ou no mês SEGUINTE (offset 1
      // — usado por parcelaGroupsDaConta com âncora confirmada). Duas
      // faturas consecutivas podem vencer no mesmo mês civil (ex.: 01/03 e
      // 30/03) — se a previsão de syncPredictions sempre pulasse pro mês
      // seguinte ao vencimento mais recente, o mês da PRÓXIMA fatura real
      // ficava sem NENHUMA entrada (nem confirmada, nem prevista) até essa
      // fatura chegar — por isso offset 0 é o default e o comportamento de
      // syncPredictions NUNCA muda. A previsão continua sendo uma
      // ESTIMATIVA de 1 parcela por mês civil (nunca tenta prever o dia
      // exato do próximo vencimento).
      const dt = addMonths(r.vencimento, k - 1 + offsetPrimeiraParcela);
      months.push({ ym: ymOf(dt), valor: r.valor, numero: r.parcela_atual + k });
    }
    groups.push({ key: r.key, descricao: r.descricao, dataCompraOriginal: r.data, valor: r.valor, parcelaAtual: r.parcela_atual, remaining, parcelaTotal: r.parcela_total, months });
  }
  return groups;
}
```

Localizar `parcelaGroupsDaConta`:

```js
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
  return computeParcelaGroups(rowsDoGrupo);
}
```

Trocar para (a mudança real: cada linha de `rowsDoGrupo` carrega também se
sua âncora original era confirmada, e `computeParcelaGroups` é chamada
UMA VEZ POR GRUPO agora, já que o parâmetro pode variar por linha — não é
mais uma chamada única com todas as linhas de uma vez):

```js
export function parcelaGroupsDaConta(transactions, contaId) {
  const porKey = new Map();
  (transactions || [])
    .filter((t) => t.parcelaKey && t.parcela_total && t.contaId === contaId)
    .forEach((t) => {
      const atual = porKey.get(t.parcelaKey);
      porKey.set(t.parcelaKey, atual ? melhorAncoraDeParcela(atual, t) : t);
    });
  const grupos = [];
  for (const t of porKey.values()) {
    const row = {
      tipo: 'parcelamento',
      descricao: t.descricao.replace(/\s*\(parcela prevista\)\s*$/i, ''),
      data: t.data,
      // faturaVencimento (gravado por autoConfirmParcelas) e o vencimento
      // REAL da fatura — t.data e a dataCorte, que NAO deve ser usada como
      // ancora de projecao. Fallback pra t.data cobre transacoes
      // confirmadas ANTES deste fix, sem migracao retroativa (decisao ja
      // validada) — nesses casos o comportamento e o mesmo de hoje.
      vencimento: t.faturaVencimento || t.data,
      parcela_atual: t.parcela_atual, parcela_total: t.parcela_total, valor: t.valor,
      key: t.parcelaKey,
    };
    // Ancora CONFIRMADA (!previsto): o vencimento e de um mes JA PAGO — a
    // primeira parcela restante precisa comecar no mes SEGUINTE
    // (primeiraNoMesmoMes:false), senao o mes ja pago reaparece como
    // parcela futura (bug real relatado mesmo apos o fix de
    // faturaVencimento). Ancora PREVISAO: t.data/vencimento ja e um mes
    // sintetico FUTURO (ym + '-01', gravado por syncPredictions) — "mesmo
    // mes" continua correto nesse caso, sem mudanca.
    const primeiraNoMesmoMes = t.previsto;
    grupos.push(...computeParcelaGroups([row], { primeiraNoMesmoMes }));
  }
  return grupos;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node tools/run-tests.mjs`
Expected: todos passando, incluindo os testes novos/atualizados.
IMPORTANTE: confirmar que os testes JÁ EXISTENTES de `syncPredictions`
(describe `'parcelas: computeParcelaGroups + syncPredictions'`, incluindo
o teste `'a PRIMEIRA previsao restante cai no MESMO mes civil...'`)
continuam passando SEM alteração de assert — esse é o comportamento que
não pode regredir.

- [ ] **Step 5: Commit**

```bash
git add src/domain/parcelas.js tests/parcelas.test.js
git commit -m "Corrige definitivamente aba Parcelas: mes ja pago nao aparece mais como parcela futura, sem afetar importacao de fatura"
```

---

### Task 2: Timestamp legível na exportação do log de auditoria

**Files:**
- Modify: `src/ui/lancamentos.js`
- Test: nenhum teste Node novo (função de UI que monta um Blob/download — sem teste Node direto hoje, mesma natureza de `baixarBackup`/`exportarLog` já existentes).

**Interfaces:** nenhuma interface nova exportada — mudança de conteúdo do JSON exportado.

`registrarEvento`/`listarEventos` (`domain/audit-log.js`) NÃO mudam —
`timestamp` continua sendo gravado e ordenado como número (`Date.now()`).
Só a exportação (`exportarLog`, `ui/lancamentos.js`) adiciona um campo
legível.

- [ ] **Step 1: Editar `exportarLog` em `src/ui/lancamentos.js`**

Localizar:

```js
async function exportarLog() {
  const eventos = await listarEventos();
  const blob = new Blob([JSON.stringify(eventos, null, 2)], { type: 'application/json' });
```

Trocar para:

```js
async function exportarLog() {
  const eventos = await listarEventos();
  // dataHora (string legivel) e adicionada so na EXPORTACAO, ao lado do
  // timestamp numerico ja existente (mantido, util pra reprocessamento
  // automatizado) — sem essa conversao, abrir o .json exportado mostrava
  // so o numero epoch, ilegivel sem converter manualmente.
  const eventosComData = eventos.map((e) => ({ ...e, dataHora: new Date(e.timestamp).toLocaleString('pt-BR') }));
  const blob = new Blob([JSON.stringify(eventosComData, null, 2)], { type: 'application/json' });
```

- [ ] **Step 2: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão (nenhum teste Node cobre esta função de UI/download).

- [ ] **Step 3: Commit**

```bash
git add src/ui/lancamentos.js
git commit -m "Adiciona dataHora legivel na exportacao do log de auditoria, ao lado do timestamp numerico"
```

---

### Task 3: Conciliação de extrato — layout dos 3 selects em Grid + selo redundante removido

**Files:**
- Modify: `src/ui/conciliacao-extrato.js`
- Modify: `styles.css`

**Interfaces:** nenhuma interface nova — mudança de apresentação.

Causa raiz do desalinhamento: `.item-form-lote` usa flexbox com
`margin-left: 30px` calibrado para compensar SÓ a largura do checkbox —
o botão "+ lançar" individual (sessão anterior) foi inserido antes da
descrição sem recalcular essas margens, quebrando o alinhamento dos 3
selects. Em vez de recalcular margens manualmente de novo (frágil,
quebrou uma vez já), migrar para CSS Grid — mesmo padrão já usado em
`.item-lancamento`/`.item-regra` (sessões anteriores), mais robusto a
mudanças futuras de conteúdo.

- [ ] **Step 1: Editar `src/ui/conciliacao-extrato.js` — selo condicional**

Localizar `montarLinhaFormulario`:

```js
  const linhaEl = el('div', { class: 'item-balde item-form-lote' }, [
    chk,
    botaoLancarUma,
    el('span', { class: 'item-descricao', text: linha.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(linha.data)} · ${fmtBRL(linha.valor)}` }),
    selNatureza,
    selCategoria,
    selForma,
    el('span', { class: 'selo-categoria-sugerida', text: regraAplicada ? `sugerido: ${nomeCategoria(estado.categoria)}` : 'A Classificar' }),
  ]);
```

Trocar para (o selo só existe no DOM quando há regra aplicada — quando
não há, `estado.categoria` já é `CATEGORIA_A_CLASSIFICAR` e o próprio
`selCategoria` já mostra isso, o selo era redundante):

```js
  const linhaEl = el('div', { class: 'item-balde item-form-lote' }, [
    chk,
    botaoLancarUma,
    el('span', { class: 'item-descricao', text: linha.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(linha.data)} · ${fmtBRL(linha.valor)}` }),
    selNatureza,
    selCategoria,
    selForma,
    // So aparece quando ha uma regra aplicada (sugestao automatica) — sem
    // regra, a categoria selecionada ja e "A Classificar" e o proprio
    // select ja mostra isso, o selo era informacao duplicada.
    regraAplicada ? el('span', { class: 'selo-categoria-sugerida', text: `sugerido: ${nomeCategoria(estado.categoria)}` }) : null,
  ]);
```

- [ ] **Step 2: Substituir o bloco de CSS de `.item-form-lote` por Grid**

Em `styles.css`, localizar (linhas ~522-554, do comentário
`/* A linha de "+ lançar em lote"...` até o fechamento de
`.selo-categoria-sugerida`, e também a linha 683 dentro do
`@media (max-width: 480px)`):

```css
/* A linha de "+ lançar em lote" é a mais carregada da tela: checkbox +
   descrição/meta + 3 seletores (natureza/categoria/forma). Em vez de cada
   <select> ocupar 100% de largura e empilhar um embaixo do outro (o problema
   relatado), eles dividem uma faixa própria abaixo da descrição, lado a
   lado quando cabe e quebrando em grade 2-a-2 em telas estreitas — nunca um
   por linha inteira. */
.item-form-lote {
  align-items: flex-start;
  gap: 6px 10px;
}
.item-form-lote > input[type=checkbox] {
  flex: 0 0 auto;
  margin-top: 3px;
}
.item-form-lote > .item-descricao {
  flex: 1 1 calc(100% - 30px);
}
.item-form-lote > .item-meta {
  flex: 1 1 100%;
  margin-left: 30px;
}
.item-form-lote > select {
  flex: 1 1 140px;
  min-width: 0;
  margin-left: 30px;
  font-size: 0.82rem;
  padding: 6px 8px;
}
.item-form-lote > select:first-of-type { margin-left: 30px; }

.selo-categoria-sugerida {
  flex: 1 1 100%;
  margin-left: 30px;
  font-size: 0.72rem;
  color: var(--latao);
  padding: 2px 0;
}
```

(a última propriedade de `.selo-categoria-sugerida` pode variar
ligeiramente — ler o bloco completo real em `styles.css` antes de
substituir, o trecho acima é o que a Task 2 do plano anterior deixou).

Trocar por (Grid: linha 1 = checkbox + botão + descrição; linha 2 = meta
(largura total); linha 3 = os 3 selects SEMPRE em 3 colunas, mesmo em
mobile — decisão já validada; linha 4 = selo, quando presente):

```css
/* A linha de "+ lançar em lote" é a mais carregada da tela: checkbox +
   botão "+ lançar" + descrição/meta + 3 seletores (natureza/categoria/
   forma). Grid em vez de flexbox com margens calculadas manualmente —
   a versão anterior (margin-left compensando só a largura do checkbox)
   quebrou quando o botão "+ lançar" individual foi adicionado depois,
   porque a margem não foi recalculada para compensar os dois juntos.
   Grid não sofre desse problema: cada elemento vive na célula certa
   independente de quantos irmãos vêm antes dele. Os 3 selects ficam
   SEMPRE em 3 colunas na mesma linha, inclusive em mobile — decisão de
   produto: prioriza consistência visual sobre espaço extra em telas
   estreitas (texto do select trunca se precisar). */
.item-form-lote {
  display: grid;
  grid-template-columns: auto auto 1fr;
  column-gap: 10px;
  row-gap: 6px;
  align-items: start;
}
.item-form-lote > input[type=checkbox] {
  grid-column: 1;
  grid-row: 1;
  margin-top: 3px;
}
.item-form-lote > .btn-mini {
  grid-column: 2;
  grid-row: 1;
}
.item-form-lote > .item-descricao {
  grid-column: 3;
  grid-row: 1;
}
.item-form-lote > .item-meta {
  grid-column: 1 / -1;
  grid-row: 2;
}
.item-form-lote > select {
  grid-row: 3;
  min-width: 0;
  font-size: 0.82rem;
  padding: 6px 8px;
}
/* Os 3 selects dividem a linha inteira em 3 colunas iguais — sobrescreve
   o grid-template-columns externo (auto auto 1fr, pensado pra linha 1)
   só para a linha 3, via um sub-grid manual: cada select ocupa 1/3 da
   largura total do container. */
.item-form-lote {
  grid-template-columns: auto auto 1fr;
}
.item-form-lote > select:nth-of-type(1) { grid-column: 1 / 2; }
.item-form-lote > select:nth-of-type(2) { grid-column: 2 / 3; }
.item-form-lote > select:nth-of-type(3) { grid-column: 3 / 4; }

.selo-categoria-sugerida {
  grid-column: 1 / -1;
  grid-row: 4;
  font-size: 0.72rem;
  color: var(--latao);
  padding: 2px 0;
}
```

NOTA para quem implementar: o `grid-template-columns: auto auto 1fr` da
linha 1 (checkbox, botão, descrição) não bate naturalmente com "3 colunas
iguais" pedido para a linha 3 (selects) usando `nth-of-type` sozinho —
`grid-column: 1/2, 2/3, 3/4` divide o espaço conforme as LARGURAS
definidas por `auto auto 1fr`, não em terços iguais. Antes de aceitar
este CSS como está, teste visualmente (Task 4): se os 3 selects não
ficarem com larguras visualmente parecidas (ex.: o select de Natureza
muito estreito porque herda a coluna `auto` calibrada pro checkbox), trocar
a abordagem para duas regras de grid-template-columns diferentes por
LINHA não é suportado em CSS puro — a alternativa mais simples e robusta
é envolver os 3 selects num `<div class="item-form-lote-selects">` próprio
(flex ou grid interno de 3 colunas iguais, `1fr 1fr 1fr`), fora do grid
externo do container principal. Ajustar `conciliacao-extrato.js` e este
CSS juntos nesse caso — a estrutura acima é o ponto de partida, não um
contrato rígido, já que grid-column por nth-of-type sobre um
grid-template pensado pra outra linha é uma limitação conhecida do CSS
Grid que só se resolve na prática olhando o resultado renderizado.

- [ ] **Step 3: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: sem regressão (nenhum teste Node cobre CSS/layout).

- [ ] **Step 4: Commit**

```bash
git add src/ui/conciliacao-extrato.js styles.css
git commit -m "Corrige layout dos selects na Conciliacao de extrato (grid em vez de margens calculadas), remove selo redundante"
```

---

### Task 4: Verificação visual em navegador real (Playwright)

**Files:** nenhum arquivo novo — task de verificação; correções pontuais em `src/domain/parcelas.js`, `src/ui/lancamentos.js`, `src/ui/conciliacao-extrato.js` ou `styles.css` se algo visual não bater com o esperado — em especial a ressalva da Task 3 sobre o grid dos 3 selects.

**Interfaces:**
- Consumes: app rodando localmente (servidor estático), Playwright MCP (`browser_navigate`, `browser_run_code_unsafe` para seed sintético via `storage.put`/`putMany`, `browser_click`, `browser_take_screenshot` com `fullPage:true`).

- [ ] **Step 1: Subir servidor estático local e seedar dados 100% sintéticos**

Nunca usar nome, número de conta/cartão ou valor real — só identificadores
fictícios. Seed mínimo:
- 1 cartão, 1 transação confirmada de parcela replicando o cenário real do
  usuário (vencimento 30/01/2026, parcela 4/9, `faturaVencimento` setado)
  — confirmar que a aba Parcelas mostra fevereiro a junho, NÃO janeiro a
  maio.
- Alguns eventos de log sintéticos (via `registrarEvento` importado
  dinamicamente) para exportar e abrir o `.json` gerado, conferindo o
  campo `dataHora`.
- 1 conta corrente + 1 extrato bancário sintético com pelo menos 2 linhas
  não casadas — uma delas com uma regra de classificação já aprendida
  (pra ver o selo "sugerido: X" aparecendo) e outra sem regra nenhuma
  (pra confirmar que o selo "A Classificar" NÃO aparece mais).

- [ ] **Step 2: Verificar Task 1 — aba Parcelas**

Abrir a aba Parcelas, confirmar visualmente que a parcela seedada projeta
fevereiro a junho de 2026 (não janeiro a maio), e que o total mensal no
topo da aba não inclui janeiro.

- [ ] **Step 3: Verificar Task 2 — timestamp legível**

Ir em Lançamentos → Exportar log, abrir o arquivo `.json` baixado (via
leitura do arquivo, não precisa abrir num app externo) e confirmar que
cada evento tem tanto `timestamp` (número) quanto `dataHora` (string
legível, formato brasileiro).

- [ ] **Step 4: Verificar Task 3 — layout dos 3 selects + selo**

Na Conciliação de extrato, com o extrato sintético selecionado,
screenshot do balde "No extrato, não lançado no app" em viewport estreito
(375px) e desktop — confirmar visualmente que os 3 selects
(Natureza/Categoria/Forma) ficam em 3 colunas na MESMA linha em AMBOS os
tamanhos de tela (não empilham no mobile). Confirmar que a linha sem
regra aplicada NÃO mostra nenhum selo abaixo dos selects, e a linha COM
regra aplicada mostra "sugerido: {categoria}".

Se os 3 selects não ficarem com larguras visualmente equilibradas (ver
nota da Task 3, Step 2), ajustar o CSS/HTML conforme a alternativa
descrita ali (wrapper próprio pros 3 selects) até o resultado renderizado
ficar correto.

- [ ] **Step 5: Verificar dark mode**

Repetir os screenshots relevantes (aba Parcelas, balde de extrato com os
3 selects) com `page.emulateMedia({colorScheme:'dark'})`.

- [ ] **Step 6: Corrigir o que a verificação achar**

Problemas encontrados são corrigidos diretamente nos arquivos desta mesma
task, não em task nova. Repetir os screenshots relevantes até confirmar.

- [ ] **Step 7: Rodar a suíte completa uma última vez**

Run: `node tools/run-tests.mjs`
Expected: 0 falhas.

- [ ] **Step 8: Commit (se o Step 6 gerou mudança)**

```bash
git commit -m "Ajusta Parcelas/log/Conciliacao apos verificacao visual"
```

Se nenhuma mudança foi necessária, pular o commit.
