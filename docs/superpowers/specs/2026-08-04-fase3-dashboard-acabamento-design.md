# Fase 3 — Dashboard, acabamento e documentação (design)

## 1. Contexto

Fases 1 e 2 entregaram um app utilizável em produção: cadastros, lançamentos,
importação/conciliação de fatura e extrato, memória de classificação. A aba
Dashboard existe só como placeholder (`<p class="vazio">O painel de gastos
chega na Fase 3.</p>`, `index.html`) — não há `src/ui/dashboard.js`, é
construção do zero, não revisão.

Esta é a última fase da Fase 2 do spec original
(`docs/superpowers/specs/2026-07-29-financas-multi-conta-design.md`,
seção 12), com escopo ajustado por decisão do usuário durante o
brainstorming desta fase (ver seção 2).

## 2. Escopo (decidido com o usuário)

- **Dashboard**: replica o dashboard do app anterior — tile de total do
  período, rosca por categoria, barras mensais — **mais** um filtro por
  forma de pagamento que não existia antes. Sem gráfico novo quebrado por
  forma (isso ficou fora, YAGNI por agora).
- **Lançamentos**: adicionar filtro por conta/cartão na `barraFiltros`
  (motor já suporta via `filterTransactions`, só falta o `<select>`) —
  item identificado como pendente ao fim da Fase 2.
- **Polimento visual**: revisão de responsividade (tela pequena) e dark
  mode em todas as abas, incluindo o Dashboard novo.
- **Suíte de testes completa**: fechar lacunas reais de cobertura,
  conferidas contra a seção 10 do spec original.
- **Documentação final**: `MANUAL_USUARIO.md`, `DOCUMENTACAO_TECNICA.md`,
  `CONTEUDO_PROJETO.md`.
- **Deploy final** no GitHub Pages.

## 3. Dashboard — `ui/dashboard.js`

### 3.1 Dados (domínio, puro, testável em Node)

`domain/transactions.js` já tem, desde a Fase 1: `sumDespesas`,
`filterTransactions` (já suporta `f.mes`, `f.ano`, `f.formas`, `f.contas`),
`totaisPorForma`. Faltam dois agregadores novos, mesmo estilo de
`totaisPorForma` (recebem `transactions` já filtradas, devolvem `Map`):

```js
// Soma por categoria — mesma guarda de valor ilegível que totaisPorForma/
// sumDespesas: um valor que não é número finito não pode contaminar o total
// do grupo.
export function totaisPorCategoria(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    if (!Number.isFinite(valor)) continue;
    const chave = t.categoria || CATEGORIA_A_CLASSIFICAR;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

// Soma por mês (YYYY-MM, via monthKey de core/dates.js) — usada nas barras.
// NÃO aplica filtro de mês (isso zeraria a série numa barra só); aplica os
// demais filtros (forma, conta) do jeito que filterTransactions já faz.
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

Ambas em `domain/transactions.js`, ao lado de `totaisPorForma`. Import de
`CATEGORIA_A_CLASSIFICAR` de `domain/categories.js` (já existe desde a
Fase 1).

### 3.2 Tela

`renderDashboard()` monta a partir de `listTransactions()`/`listAccounts()`/
`listFormas()`/`listCategorias()`, mesmo padrão de `renderLancamentos()`.
Filtros em estado de módulo (`ano`, `mes`, `formas`, `contas`), reconstruídos
a cada render.

- **Filtros**: ano (`<select>` com os anos que aparecem em `transactions`),
  mês (`<input type=month>`, mesmo padrão de Lançamentos), forma de
  pagamento (`<select>` single-choice — mesmo padrão já usado no filtro de
  forma de `barraFiltros` em `lancamentos.js`, não `<select multiple>`),
  conta/cartão (mesmo padrão).
- **Tile de total**: `sumDespesas(filterTransactions(transactions, filtros))`,
  rótulo com o período ativo.
- **Rosca por categoria**: `totaisPorCategoria` sobre a lista já filtrada
  (respeita todos os filtros, inclusive mês). CSS puro via
  `conic-gradient`, paleta categórica da skill `dataviz` (acessível em claro
  e escuro).
- **Barras mensais**: `totaisPorMes` sobre a lista filtrada **por
  forma/conta mas não por mês** (senão a série colapsa em 1 barra) —
  últimos 12 meses com dado, fixo, sem controle de janela na tela. CSS puro
  (`<div>`s com `height`/`width` proporcional ao maior valor da janela).

### 3.3 Roteamento

`src/app.js`: import `renderDashboard`, adiciona `Dashboard: renderDashboard`
em `RENDERIZADORES` (mesmo padrão das abas anteriores). Remove o placeholder
`<p class="vazio">` de `#tabDashboard` em `index.html`.

## 4. Lançamentos — filtro de conta/cartão

Em `barraFiltros` (`ui/lancamentos.js`): um `<select>` a mais, mesmo padrão
do `selForma` existente (linha ~371), com `ctx.contas` (já carregado em
`ctx`, nenhum fetch novo) — cartões e contas juntos na mesma lista, ou
agrupados por `<optgroup>` se ficar mais claro (mesma decisão visual do
seletor de Conciliação, spec original: cartões primeiro rotulados como
tal, contas depois). Atualiza `filtros.contas = [valor]` e chama
`renderLancamentos()` de novo — `filterTransactions` já lê `f.contas`.

## 5. Polimento visual

- **Responsividade**: `styles.css` ganha breakpoint(s) para tela pequena.
  Pontos de maior risco: barra de abas (`tabbar`), listas/tabelas de
  Lançamentos e Conciliação (linhas com várias colunas de meta-informação),
  os gráficos novos do Dashboard (barras/rosca precisam caber sem overflow
  horizontal).
- **Dark mode**: hoje só 1 `@media (prefers-color-scheme: dark)` em
  `styles.css` — revisão cobre todas as abas e, especificamente, as cores
  dos gráficos novos (paleta categórica que funcione nos dois temas).
- **Verificação**: Playwright real, pelo menos 2 tamanhos de tela (celular
  e desktop) e os dois temas, antes de considerar concluído — não é
  suficiente "parecer bom" na revisão de código. Skills `dataviz` e
  `frontend-design` aplicadas na hora de implementar (pendência já
  registrada no spec original, seção 11).

## 6. Suíte de testes completa

- Testes Node (puro) para `totaisPorCategoria`/`totaisPorMes`:
  agregação correta, valor ilegível não contamina o grupo, mês sem dado
  não aparece no Map (não gera entrada zerada).
- Revisar a lista de cobertura da seção 10 do spec original contra o que
  já existe: a Fase 2 já cobriu boa parte com nomes de arquivo diferentes
  dos originalmente listados (`reconcile-card.test.js`,
  `reconcile-bank.test.js`, `pagamento-fatura.test.js`,
  `classification.test.js`, `santander-cartao-pdf.test.js` +
  `santander-cartao-pdf-extrair.test.js`, `santander-extrato-xls.test.js`
  cobrem o que a seção 10 chamava de `importers.test.js`). Verificar se
  `migration.test.js` (conversão v1→v2) já existe e está completo — se sim,
  não recriar; se houver lacuna real, fechar.
- Não recriar testes já existentes sob nomes diferentes só para bater com
  a nomenclatura do spec de 2026-07-29.

## 7. Documentação final

Três arquivos em `docs/` (raiz do repo, ao lado de `index.html` — local
óbvio para quem chega no repositório, não dentro de `docs/superpowers/`
que é área de processo interno):

- **`MANUAL_USUARIO.md`**: como usar cada aba (Lançamentos, Conciliação,
  Parcelas, Dashboard, Cadastros), linguagem não técnica, screenshots
  opcionais (sem dado real, se houver).
- **`DOCUMENTACAO_TECNICA.md`**: arquitetura (`core`/`domain`/`importers`/
  `ui`, por que a separação existe), schema do IndexedDB
  (`core/db-schema.js`), convenções de id (`seed_`/`confirmed_`/`uid()`),
  a regra de ouro (`natureza === 'despesa' && !previsto`), como rodar os
  testes (`node tools/run-tests.mjs` e `tools/tests.html`).
- **`CONTEUDO_PROJETO.md`**: histórico do projeto (Fases 1/2/3, decisões
  importantes — ex. isolamento por cartão, janela de 3 níveis, regra de
  registro único do pagamento de fatura), pendências conhecidas que
  ficaram fora de escopo (deliberadamente, com o motivo).

## 8. Global Constraints (herdadas do spec original, seguem valendo)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, screenshot,
  teste ou fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Valores monetários sempre positivos; sinal via `natureza`/`sinal`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Nenhum arquivo deve passar de ~250 linhas.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.

## 9. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] `tools/tests.html` mostra todos os testes verdes, inclusive os de
      navegador
- [ ] Dashboard verificado em navegador real (Playwright), 2 tamanhos de
      tela, 2 temas — tiles/rosca/barras com dado real de teste, filtros
      (ano/mês/forma/conta) mudando o resultado corretamente
- [ ] Filtro de conta em Lançamentos funcionando, mesmo padrão visual do
      filtro de forma
- [ ] Os 3 documentos escritos e revisados
- [ ] Deploy final no GitHub Pages confirmado funcionando (PWA instala,
      abas carregam, sem erro de console)
- [ ] Nenhum dado pessoal em nenhum artefato desta fase (mesma disciplina
      de privacidade das fases anteriores)
