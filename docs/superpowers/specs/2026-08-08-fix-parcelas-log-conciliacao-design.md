# Fix definitivo da aba Parcelas + timestamp legível no log + layout da Conciliação de extrato (design)

## 1. Contexto

Três achados relatados pelo usuário depois do deploy anterior:

- A aba Parcelas AINDA mostra o mês já pago como se fosse uma parcela
  futura — a correção anterior (campo `faturaVencimento`) resolveu a fonte
  do vencimento, mas não o cálculo que decide a partir de QUAL mês projetar.
- O log de auditoria exportado (`.json`) mostra `timestamp` como número
  puro (epoch), ilegível ao abrir o arquivo.
- A Conciliação de extrato tem os 3 selects (Natureza/Categoria/Forma) mal
  alinhados — o botão "+ lançar" individual (sessão anterior) bagunçou o
  CSS calibrado para compensar só o checkbox — e um selo "A Classificar"
  redundante com o próprio select de Categoria.

## 2. Aba Parcelas — causa raiz definitiva

### 2.1 O que a correção anterior resolveu (e o que não resolveu)

A sessão anterior corrigiu QUAL vencimento é usado como âncora
(`faturaVencimento`, o vencimento real da fatura, em vez de `data` =
dataCorte). Isso estava certo e continua certo. O que não foi notado: o
cálculo de quantos meses projetar a partir desse vencimento
(`computeParcelaGroups`, `addMonths(r.vencimento, k - 1)`) usa SEMPRE "o
mesmo mês civil do vencimento" como primeira parcela restante — regra
introduzida no commit `654c498` para resolver um problema DIFERENTE:
lacuna de mês durante a IMPORTAÇÃO de uma fatura nova.

### 2.2 Por que a mesma regra quebra em dois contextos diferentes

`computeParcelaGroups` é compartilhada por dois chamadores com
necessidades opostas:

- **`syncPredictions`** (chamado durante a importação de uma fatura):
  `row.vencimento` é o vencimento da fatura que ACABOU de confirmar
  aquela parcela — ainda não existe nenhuma previsão para esse mês
  civil ainda (foi removida pela própria confirmação). Se a primeira
  previsão pulasse para o mês seguinte, e a próxima fatura real vencer
  no MESMO mês civil da fatura atual (ex.: 30/01 e 01/03 não, mas 01/03
  e 30/03 sim), esse mês ficaria sem nenhuma entrada até a fatura
  seguinte chegar. Por isso "mesmo mês" é o comportamento CORRETO aqui
  — já validado com teste ponta a ponta.
- **`parcelaGroupsDaConta`** (aba Parcelas, a qualquer momento, não só
  durante importação): quando a âncora é uma transação CONFIRMADA
  (`!previsto`), o vencimento usado (`faturaVencimento`) é de uma
  parcela que JÁ FOI PAGA naquele mês. Usar "mesmo mês" faz esse mês já
  pago aparecer de novo como se fosse a primeira parcela RESTANTE — o
  bug relatado. A primeira parcela restante deveria ser o MÊS SEGUINTE.
- Quando a âncora em `parcelaGroupsDaConta` é uma PREVISÃO (só existem
  previsões para aquela parcelaKey — compra nova ainda não confirmada
  por nenhuma fatura), `t.data` já é um mês sintético FUTURO
  (`ym + '-01'`, gravado por `syncPredictions`), não um mês pago — nesse
  caso "mesmo mês" continua correto e já é coberto por teste existente
  (`tests/parcelas.test.js`, describe `parcelaGroupsDaConta`, teste
  "ancora sendo uma PREVISAO").

### 2.3 Fix

`computeParcelaGroups` ganha um parâmetro opcional (ex.:
`primeiraNoMesmoMes`, default `true` — preserva o comportamento de
`syncPredictions` sem mudar sua chamada). `parcelaGroupsDaConta` passa
`primeiraNoMesmoMes: false` SOMENTE quando a âncora escolhida
(`melhorAncoraDeParcela`) é uma transação CONFIRMADA (`!previsto`) —
nesse caso o vencimento é de um mês já pago, e a primeira parcela
restante deve começar no mês seguinte (`addMonths(vencimento, k)`, sem o
`-1`). Quando a âncora é uma previsão, mantém `primeiraNoMesmoMes: true`
(comportamento atual, já correto para esse caso).

Nenhuma mudança em `syncPredictions`/`autoConfirmParcelas`/importação de
fatura — o bug de lacuna de mês continua resolvido exatamente como estava.

## 3. Log de auditoria — timestamp legível no export

`registrarEvento` continua gravando `timestamp: Date.now()` internamente
(número, mais barato para ordenar — `listarEventos` já ordena por
`timestamp` decrescente, sem mudança). O que muda é só a EXPORTAÇÃO
(`exportarLog`, `ui/lancamentos.js`): antes de serializar, mapear cada
evento adicionando um campo `dataHora` (string formatada, ex.:
`08/08/2026 14:32:10`, usando `toLocaleString('pt-BR')` ou equivalente já
disponível no projeto) — SEM remover `timestamp` (mantém o número bruto
também, útil para reprocessamento automatizado por quem já usa o log
assim). O `.json` exportado passa a ter os dois campos lado a lado por
evento; abrir o arquivo em qualquer editor já mostra a data/hora legível
sem precisar converter manualmente.

## 4. Conciliação de extrato — layout dos 3 selects + selo redundante

### 4.1 Causa raiz do desalinhamento

`.item-form-lote > .item-descricao { flex: 1 1 calc(100% - 30px) }` e as
regras de `margin-left: 30px` nos selects/meta/selo foram calibradas para
compensar SÓ a largura do checkbox (30px). O botão "+ lançar" individual
(sessão anterior) foi inserido antes da descrição sem ajustar esses
cálculos — o espaço reservado não compensa mais checkbox + botão juntos,
quebrando o alinhamento esperado dos 3 selects em uma linha.

### 4.2 Fix — layout

Recalcular a largura reservada para compensar checkbox + botão juntos
(a soma real de suas larguras + gaps, não mais só 30px). Os 3 selects
(Natureza/Categoria/Forma) ficam SEMPRE em 3 colunas fixas na mesma
linha, decisão já validada (sem quebrar em mobile) — usar `flex: 1 1 0`
ou grid de 3 colunas, com `min-width: 0` em cada select para não
estourar em telas estreitas (texto do select pode truncar se precisar,
prioridade é manter as 3 colunas sempre visíveis lado a lado).

### 4.3 Fix — remover selo redundante

`selo-categoria-sugerida` (o `<span>` "A Classificar" ou "sugerido:
{nome}") é removido do layout quando NÃO há regra aplicada
(`regraAplicada` nulo) E a categoria selecionada já é
`CATEGORIA_A_CLASSIFICAR` — nesse caso o próprio `<select>` de Categoria
já mostra "A Classificar" selecionado, o selo é informação duplicada.
Quando HÁ uma regra aplicada (`regraAplicada` truthy), o selo continua
aparecendo com "sugerido: {nome da categoria}" — esse caso não é
redundante, avisa que o valor já pré-selecionado no select veio de uma
sugestão automática, informação que o select sozinho não comunica.

## 5. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Sem migração retroativa em `parcelas.js` — decisão já validada em
  sessão anterior, segue valendo (transações confirmadas sem
  `faturaVencimento` continuam usando o fallback `t.data`, sem alteração
  aqui).

## 6. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Cenário real do usuário confirmado: fatura 30/01 confirma parcela
      4/9 → aba Parcelas mostra parcelas restantes de FEVEREIRO a JUNHO
      (não janeiro a maio)
- [ ] Comportamento de `syncPredictions`/importação de fatura NÃO muda —
      testes existentes de "lacuna de mês" continuam passando sem
      alteração
- [ ] Log exportado (`.json`) mostra `dataHora` legível ao lado de
      `timestamp`, verificado abrindo o arquivo exportado
- [ ] Os 3 selects da Conciliação de extrato ficam em 3 colunas na mesma
      linha, em desktop E mobile, verificado em navegador real
- [ ] Selo "A Classificar" não aparece mais quando não há regra
      aplicada; selo "sugerido: X" continua aparecendo quando há
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
