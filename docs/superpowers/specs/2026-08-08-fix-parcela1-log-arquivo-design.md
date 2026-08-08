# Fix da âncora de parcela 1/n via "+lançar" + nome do arquivo no log (design)

## 1. Contexto

Dois achados relatados pelo usuário após o deploy anterior:

- A aba Parcelas mostra o mês da COMPRA (não o vencimento da fatura) como
  se fosse a primeira parcela restante, mas SÓ para compras cuja parcela
  1/n foi lançada manualmente via botão "+ lançar" da Conciliação de
  fatura — parcelas que chegam com `parcela_atual >= 2` na primeira
  fatura importada não têm esse problema, porque nesses casos
  `autoConfirmParcelas` confirma automaticamente e grava `faturaVencimento`
  corretamente.
- O log de auditoria exportado, no evento `importacao_fatura`, não diz de
  qual arquivo a fatura veio — o resumo tem só contagens.

## 2. Aba Parcelas — segunda causa raiz (âncora de "+lançar")

### 2.1 Por que só a parcela 1/n é afetada

`autoConfirmParcelas` (`src/domain/parcelas.js:259`) só confirma
automaticamente uma linha de fatura com `parcela_atual > 1` (ou quando já
existe candidato/lançamento manual prévio). Uma parcela 1/n genuína NUNCA
é auto-confirmada — ela aparece no balde "Na fatura, não lançado no app" e
exige clique manual em "+ lançar" (`src/ui/conciliacao-fatura.js:26-58`).

Esse botão preenche um rascunho com `data: item.data` — que é a DATA DA
COMPRA (ex.: 22/12), não o vencimento da fatura (ex.: 30/01). O rascunho
não carrega vencimento nenhum. O formulário de Lançamentos
(`src/ui/lancamentos-form.js`) salva esse rascunho como transação
confirmada (`novaTransaction`, `previsto: false` por padrão) com
`data = 22/12` e SEM `faturaVencimento`.

Em `parcelaGroupsDaConta` (`src/domain/parcelas.js:184`), o fallback
`t.faturaVencimento || t.data` cai em `t.data` = 22/12 (data da compra) —
não um vencimento de jeito nenhum. Projetar parcelas restantes a partir da
data de COMPRA, em vez do vencimento da fatura, empurra tudo ~1 mês para
trás: por isso a parcela 2/4 aparece em janeiro (mês da fatura anterior à
que realmente a cobra) em vez de fevereiro.

Isso é uma causa raiz DIFERENTE do bug corrigido na sessão anterior
(offset mesmo-mês vs. mês-seguinte) — aqui o problema é a fonte do
vencimento em si, não o cálculo de offset, para este caminho específico
(âncora vinda de "+ lançar" em vez de importação automática).

### 2.2 Fix

O botão "+ lançar" de uma linha de parcelamento
(`src/ui/conciliacao-fatura.js`, função `itemFatura`) já recebe `contaId`
mas não a fatura inteira — precisa também do vencimento da fatura
(`fatura.vencimento`, disponível em `renderBaldesFatura`, que já tem
`fatura` como parâmetro). Propagar esse vencimento no rascunho, junto com
`parcela_atual`/`parcela_total`/`parcelaKey`:

```js
// itemFatura ganha um parâmetro extra `faturaVencimento`
...(item.parcela_atual ? {
  parcela_atual: item.parcela_atual,
  parcela_total: item.parcela_total,
  parcelaKey: computeParcelaKey(item.descricao, item.data, item.parcela_total),
  faturaVencimento,
} : {}),
```

`lancamentos-form.js` propaga esse campo do rascunho pro registro salvo,
do mesmo jeito que já propaga `parcela_atual`/`parcela_total`/`parcelaKey`:

```js
...(!emEdicao && rascunho && rascunho.parcela_atual ? {
  parcela_atual: rascunho.parcela_atual,
  parcela_total: rascunho.parcela_total,
  parcelaKey: rascunho.parcelaKey,
  ...(rascunho.faturaVencimento ? { faturaVencimento: rascunho.faturaVencimento } : {}),
} : {}),
```

Com isso, `parcelaGroupsDaConta` passa a achar `t.faturaVencimento`
preenchido também para âncoras vindas de "+ lançar", e o fix de offset da
sessão anterior (`primeiraNoMesmoMes: !!t.previsto`) já cuida do resto
sem nenhuma mudança adicional — a âncora é confirmada (`previsto: false`
via `novaTransaction`), então cai automaticamente no ramo "mês seguinte".

Nenhuma mudança em `autoConfirmParcelas`/`syncPredictions`/importação de
fatura por linha já auto-confirmada — o fix é só na fonte do vencimento
usado por transações confirmadas manualmente através deste botão
específico.

### 2.3 Sem migração retroativa

Transações já lançadas manualmente ANTES deste fix continuam sem
`faturaVencimento` e continuam usando o fallback `t.data` (mesmo
comportamento de hoje) — mesma decisão já validada em sessões anteriores.
O usuário pode reconciliar casos antigos editando a data manualmente se
quiser corrigi-los, mas isso é ação do usuário, não migração automática.

## 3. Log de auditoria — nome do arquivo no resumo de importação de fatura

`commitImportacaoEGravar` (`src/ui/conciliacao-import.js:128`) monta o
resumo do evento `importacao_fatura` sem citar o arquivo. O statement
salvo (`plano.statementToPut.arquivo`) já guarda o nome do arquivo
original (gravado pelo importador, ex. `santander-cartao-pdf.js:262`).
Fix: incluir esse nome no resumo:

```js
const resumo = args.tipo === 'fatura'
  ? `Importou fatura (${plano.statementToPut.arquivo}): ${totalLinhas} linha(s), ${confirmadas} confirmada(s) automaticamente, ${previstas} prevista(s), ${pagamentos} pagamento(s)`
  : `Importou extrato: ${totalLinhas} linha(s), ${pagamentos} pagamento(s) de fatura reconhecido(s)`;
```

Só o resumo de `importacao_fatura` ganha o nome do arquivo — extrato não
foi pedido pelo usuário, e mantém o formato atual.

## 4. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture (usar descrições/valores fictícios nos testes, nunca os
  exemplos reais do usuário).
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Sem migração retroativa em `parcelas.js` — decisão já validada em
  sessões anteriores.

## 5. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Cenário real confirmado: fatura de 30/01 com parcela 1/4 lançada via
      "+ lançar", fatura seguinte confirma 2/4 automaticamente → aba
      Parcelas mostra parcelas restantes a partir de FEVEREIRO (não
      janeiro)
- [ ] Comportamento de `syncPredictions`/importação automática (linhas
      `parcela_atual >= 2` já na primeira fatura) NÃO muda
- [ ] Log exportado (`.json`) mostra o nome do arquivo no resumo de
      `importacao_fatura`
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
