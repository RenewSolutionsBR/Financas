# Conciliação de extrato + Lançamentos: ajustes de UI (design)

## 1. Contexto

Cinco achados relatados pelo usuário depois de usar o app no dia a dia,
dois na aba Conciliação (extrato bancário) e três na aba Lançamentos.
Não são regressões do redesign de 2026-08-05 (já executado e commitado) —
são gaps que sobreviveram a ele.

## 2. Conciliação de extrato — filtros gerais

Hoje `renderBaldesExtrato` (`ui/conciliacao-extrato.js`) não tem nenhum
filtro — mostra os 4 baldes inteiros. Adicionar, no topo do painel de
baldes, uma barra com:

- **Natureza** — `<select>` com "Todas" + as 4 naturezas (mesmo padrão de
  `montarBarraFiltros` em `lancamentos-filtros.js`, reaproveitando
  `NATUREZAS`/`rotuloNatureza` de `domain/transactions.js`).
- **Forma de pagamento** — `<select>` com "Todas" + formas cadastradas.

O filtro se aplica só aos baldes que mostram transações do app já
identificadas por natureza/forma: `Conciliado automaticamente`, `Conciliado`
e `No app, não no extrato` (essas três carregam `t.natureza`/
`t.formaPagamentoId`). O balde `No extrato, não lançado no app` mostra
linhas cruas do extrato que ainda não têm forma definida (só uma sugestão
editável por linha) — o filtro de forma não se aplica a ele; o filtro de
natureza se aplica usando `linha.natureza` (já atribuída por
`atribuirNatureza` antes da lista chegar na tela).

Filtro é só de **exibição**, client-side, sobre os arrays já calculados por
`runReconciliationBank` — nenhuma mudança de domínio.

## 3. Conciliação de extrato — esconder lançamentos de origem fatura

Causa raiz confirmada em `domain/reconcile-bank.js:69`: o `pool` de
`appUnmatched` filtra só `!t.previsto`, sem excluir `t.origem === 'fatura'`.
Uma parcela de cartão confirmada pela importação de fatura (ou um
`pagamento_fatura` já registrado) que não casa por valor+data±2 dias com
nenhuma linha do extrato aparece em "No app, não no extrato" — balde que
deveria conter só lançamentos de conta corrente/pix/dinheiro esperando
reconciliação bancária.

Fix: `pool` passa a filtrar `!t.previsto && t.origem !== 'fatura'`
(`reconcile-bank.js:69`). Lançamentos de fatura pertencem exclusivamente à
conciliação de fatura (`conciliacao-fatura.js`), nunca à de extrato.

## 4. Conciliação de extrato — layout: botões na mesma linha + lançar individual

Hoje o painel de ações da aba (`conciliacao.js`) tem 1 botão sozinho
("Exportar conciliação completa"), e dentro do balde extratoUnmatched
(`conciliacao-extrato.js`) só existe "+ lançar em lote" (exige seleção por
checkbox) — não há ação individual por linha, ao contrário do balde de
fatura que já tem "+ lançar" por item (`conciliacao-fatura.js:26-58`,
`itemFatura`).

Mudanças:
- Cada linha do balde `No extrato, não lançado no app`
  (`montarLinhaFormulario`) ganha um botão "+ lançar" individual ao lado do
  checkbox, que lança SÓ aquela linha imediatamente — reaproveita a mesma
  lógica de `lancarEmLote`, chamada com uma lista de um item só (extrai um
  `lancarUma(lf, ctx, aoConcluir)` que `lancarEmLote` também usa
  internamente, para não duplicar a lógica de aprendizado de regra e
  aplicação retroativa).
- O botão "+ lançar em lote" continua existindo para múltipla seleção.
- Não há necessidade de "3 botões numa linha só" como pedido literal — o
  que existia hoje era 1 botão sozinho no topo da aba; com o filtro (seção 2)
  adicionado ao lado dele, o cabeçalho da aba de conciliação passa a ter a
  barra de filtro + o botão de exportar na mesma linha, resolvendo o
  desconforto visual relatado (ação isolada ocupando uma linha inteira).

## 5. Lançamentos — campo de Data

Trocar `inpData` (`ui/lancamentos-form.js:39`) de
`type: 'text', inputmode: 'numeric'` para `type: 'date'`. O valor precisa
ser passado em ISO (`YYYY-MM-DD`), não mais `formatDateBR`, já que
`<input type=date>` exige esse formato internamente e exibe no formato
local do navegador sozinho. Ajustes:

- `value: emEdicao ? emEdicao.data : (rascunho ? rascunho.data : todayISO())`
  (sem passar por `formatDateBR`).
- Leitura no submit: `inpData.value` já vem em ISO — `parseDateBR(inpData.value)`
  deixa de ser necessário, usar `inpData.value` diretamente nos dois pontos
  que hoje chamam `parseDateBR(inpData.value)` (compra parcelada e
  lançamento único).
- `parseDateBR`/`formatDateBR` continuam existindo e usados em outros
  lugares (exibição na lista, relatórios) — não removidos do módulo
  `core/dates.js`, só deixam de ser necessários neste campo específico.

## 6. Lançamentos — alinhar valor/editar/excluir em colunas fixas

Causa raiz: `.item-lancamento` é flexbox `flex-wrap: wrap` sem larguras
fixas (`styles.css:378-429`) — `.lanc-principal` força quebra de linha
própria (`flex: 1 1 100%`), mas `.lanc-meta` e `.lanc-valor` têm larguras
automáticas, então uma descrição/categoria/forma mais longa em uma linha
empurra `.lanc-valor`/`.item-lancamento-acoes` para posições horizontais
diferentes entre itens.

Fix (CSS Grid no lugar do flex atual para `.item-lancamento`):
- Colunas fixas: `descrição (1fr, truncada com ellipsis) | valor (largura
  fixa, ~90px, alinhado à direita) | ações (largura fixa, ~72px)`.
- `.lanc-principal`/`.lanc-descricao` ganham `overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap` — descrição longa trunca
  com "..." em vez de quebrar linha (confirmado com o usuário).
  `title="{descrição completa}"` no elemento para o texto completo aparecer
  em hover/long-press.
- `.lanc-meta` (data · categoria · forma) desce para uma segunda linha
  dentro da mesma célula de descrição (`grid-column: 1`), já que é
  informação secundária e mais variável em tamanho — só a PRIMEIRA linha
  (descrição + valor + ações) precisa do alinhamento rígido que o usuário
  pediu.
- Mobile (viewport estreito): mesma grid, larguras de valor/ações reduzem
  levemente via `clamp()` ou breakpoint, mas continuam FIXAS entre itens
  (o requisito é alinhamento vertical consistente, não largura idêntica ao
  desktop).

## 7. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/` (exceção: `<input
  type=date>` exige ISO no próprio campo — não é uma regressão da regra,
  é o formato que o input nativo usa por definição de plataforma).
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.

## 8. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Filtro de natureza/forma na Conciliação de extrato funcionando nos
      3 baldes aplicáveis
- [ ] Lançamento de origem fatura não aparece mais em "No app, não no
      extrato" (teste de domínio cobrindo `runReconciliationBank`)
- [ ] "+ lançar" individual funcionando linha a linha no balde de extrato
      não lançado, sem duplicar lógica de `lancarEmLote`
- [ ] Campo de Data abre o seletor nativo e aceita digitação, verificado
      em navegador real (claro e escuro, mobile e desktop)
- [ ] Lista de Lançamentos com valor/editar/excluir alinhados em colunas
      fixas entre itens de descrição variável, descrição truncando com
      "..." quando necessário, verificado visualmente
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
