# "Exportar conciliação completa" ignora extrato bancário (design)

## 1. Contexto

Usuário reportou: depois de restaurar um backup no celular, uma
conciliação de extrato bancário que já tinha feito (lançamentos casados
com as linhas do extrato) aparecia com a descrição do arquivo, mas sem os
lançamentos. Ao exportar a "Conciliação completa", os lançamentos que ele
tinha casado manualmente/automaticamente com o extrato apareciam nas
ÚLTIMAS linhas do arquivo como "Só no app" — como se nunca tivessem sido
conciliados com nada.

Investigação confirmou: **não há corrupção de dado no backup**. Testei o
ciclo completo (seed de conta + transação + extrato casado → export →
limpar tudo → reimportar) e os três registros voltam byte-a-byte
idênticos. O problema é outro: `buildFullReconciliationRows`
(`src/domain/reconcile-card.js:103`), a função por trás do botão
"Exportar conciliação completa", só entende conciliação de FATURA — não
tem nem parâmetro pra receber extratos. O nome do arquivo gerado já
denuncia isso: `conciliacao-fatura-${data}.xlsx`
(`src/ui/conciliacao.js:25`).

## 2. Causa raiz

`buildFullReconciliationRows` recebe só `faturasList` (nunca extratos) e
usa um pool de TODAS as transações não-previstas
(`allTransactions.filter(t => !t.previsto)`). Ele percorre as linhas de
cada FATURA tentando casar com o pool; qualquer transação que sobra sem
casar em NENHUMA fatura — incluindo TODA transação que só existe porque
foi conciliada com um EXTRATO bancário (`atribuirNatureza`/
`runReconciliationBank`, `src/domain/reconcile-bank.js`) — cai no bucket
final "Só no app" (linha 131-133), mesmo que essa transação já tenha
sido perfeitamente casada com uma linha de extrato na aba Conciliação.

Isso não é um bug introduzido por nenhuma sessão anterior — é uma
limitação de escopo que sempre existiu na função (o nome do arquivo
confirma que ela nasceu pensando só em fatura). O sintoma só ficou visível
agora porque o usuário foi conferir a conciliação de extrato depois de um
backup/restore, mas o problema apareceria em qualquer exportação de
conciliação completa que incluísse extrato, com ou sem backup no meio.

## 3. Fix: `buildFullReconciliationRows` passa a cobrir extrato também

### 3.1 Assinatura nova

```js
export function buildFullReconciliationRows(faturasList, extratosList, allTransactions, accounts, apelidosTitular) {
```

`extratosList` e `apelidosTitular` são novos parâmetros — ambos já
disponíveis no call site (`src/ui/conciliacao.js`, `renderConciliacao`,
que já busca `apelidosTitular` pra `renderBaldesExtrato`).

### 3.2 Algoritmo

Depois do loop de faturas existente (linha 108-129, sem nenhuma mudança
de lógica), adicionar um loop equivalente para extratos, ANTES do bucket
final "Só no app" — reaproveitando a MESMA lógica de casamento que
`runReconciliationBank` já usa (`atribuirNatureza` pra classificar cada
linha do extrato, e o mesmo filtro de candidatos por valor/data/contaId):

```js
  const extratosOrdenados = [...(extratosList || [])].sort((a, b) => (a.importadoEm || 0) - (b.importadoEm || 0));
  extratosOrdenados.forEach((extrato) => {
    const comNatureza = (extrato.rows || []).map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));
    comNatureza.forEach((linha) => {
      const idx = pool.findIndex((t) => !t.used && Math.abs(t.valor - linha.valor) < 0.01 && dateDiffDays(t.data, linha.data) <= 2 && (!t.contaId || t.contaId === extrato.contaId));
      if (idx >= 0) {
        const t = pool[idx];
        t.used = true;
        rows.push({ status: t.conciliadoAutomaticamente ? 'Conciliado (automático)' : 'Conciliado', vencimentoFatura: '', dataFatura: linha.data, descricaoFatura: linha.descricao, parcela: '', valorFatura: linha.valor, dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: t.categoria, valorLancamento: t.valor });
      } else {
        rows.push({ status: 'Só no extrato', vencimentoFatura: '', dataFatura: linha.data, descricaoFatura: linha.descricao, parcela: '', valorFatura: linha.valor, dataLancamento: '', descricaoLancamento: '', categoria: '', valorLancamento: '' });
      }
    });
  });
```

Requer importar `atribuirNatureza` de `./reconcile-bank.js` em
`reconcile-card.js` — ciclo de import é seguro (`reconcile-bank.js` não
importa nada de `reconcile-card.js`, confirmar antes de implementar).

`dateDiffDays` já existe em `reconcile-card.js` (mesma função,
implementação idêntica à de `reconcile-bank.js` — não duplicar/importar,
usar a que já está no arquivo).

A coluna `descricaoFatura` no CONTEXTO de uma linha de extrato passa a
significar "descrição da linha do extrato" — nome de coluna mantido por
simplicidade (já é a convenção de reuso de coluna entre fatura/pool
usada pela função hoje: `vencimentoFatura`/`parcela` ficam vazios pra
linha de extrato, que não tem esse conceito). Alternativa de renomear
colunas fica fora de escopo — mudaria o formato pra todo mundo que já usa
a exportação, sem necessidade real.

### 3.3 Atualizar o call site

`src/ui/conciliacao.js`, dentro do `onclick` do botão (linha 40-47):

```js
onclick: async () => {
  const [transactions, todasFaturas, todosExtratos, apelidosTitular] = await Promise.all([
    listTransactions(),
    storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'fatura')),
    storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'extrato')),
    storage.getMeta('apelidosTitular', []),
  ]);
  await exportarConciliacaoCompleta(todasFaturas, todosExtratos, transactions, contas, apelidosTitular);
},
```

`exportarConciliacaoCompleta` (mesma função, já com try/catch da sessão
anterior) ganha os dois parâmetros novos e repassa pra
`buildFullReconciliationRows`. Nome do arquivo exportado muda de
`conciliacao-fatura-${data}.xlsx` pra `conciliacao-completa-${data}.xlsx`
— reflete que agora cobre os dois tipos de documento.

## 4. Achado adicional: coluna `categoria` mostra o ID interno, não o nome

Ao validar a exportação com dados reais, a coluna `categoria` mostrou
valores como `cat_mshit2120az7w7` em vez do nome legível da categoria
("Moradia", "Saúde", etc.). `buildFullReconciliationRows` grava
diretamente `t.categoria` (o ID salvo na transação,
`src/domain/reconcile-card.js:124`/`132`), sem resolver pro nome — a
função nunca recebeu a lista de categorias como parâmetro.

### 4.1 Fix

`buildFullReconciliationRows` ganha mais um parâmetro, `categorias`
(lista já carregada em outros pontos de `conciliacao.js` via
`listCategorias()`):

```js
export function buildFullReconciliationRows(faturasList, extratosList, allTransactions, accounts, apelidosTitular, categorias) {
```

Uma função auxiliar resolve o nome a partir do ID, com fallback pro
próprio ID caso a categoria tenha sido excluída depois do lançamento
(evita quebrar a exportação por causa de uma referência órfã):

```js
function nomeCategoria(categoriaId, categorias) {
  const c = (categorias || []).find((cat) => cat.id === categoriaId);
  return c ? c.nome : categoriaId;
}
```

Substituir toda ocorrência de `t.categoria` na montagem de `rows` (tanto
no loop de fatura existente quanto no novo loop de extrato) por
`nomeCategoria(t.categoria, categorias)`.

Call site (`conciliacao.js`) já busca `listCategorias()` em outros
pontos do mesmo arquivo — reusar a mesma chamada, incluir no
`Promise.all` do `onclick` do botão e repassar pra
`exportarConciliacaoCompleta`/`buildFullReconciliationRows`.

## 5. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture.
- Comentários e identificadores em português; termo técnico consagrado
  em inglês. Commits em português, imperativo, sem emoji.
- Nenhuma mudança na lógica de casamento de fatura existente (linhas
  108-129 de `reconcile-card.js`) — só adição do loop de extrato.
- Nenhuma mudança em `reconcile-bank.js`/`runReconciliationBank` — a nova
  lógica em `reconcile-card.js` reusa `atribuirNatureza` por import, sem
  duplicar a função, mas não deve alterar o comportamento da conciliação
  de extrato na aba Conciliação em si (só a exportação ganha essa
  cobertura).

## 6. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Teste novo confirma que uma transação casada com uma linha de
      EXTRATO aparece como "Conciliado" (ou "Conciliado (automático)") na
      exportação, não mais como "Só no app"
- [ ] Teste confirma que uma linha de extrato sem candidato no pool
      aparece como "Só no extrato"
- [ ] Teste confirma que a coluna `categoria` mostra o NOME, não o ID —
      tanto para linhas de fatura quanto de extrato
- [ ] Teste confirma o fallback: categoria com ID que não existe mais na
      lista de categorias aparece como o próprio ID (não quebra, não fica
      em branco)
- [ ] Testes existentes de conciliação de FATURA (`reconcile-card.test.js`
      ou equivalente) continuam passando sem nenhuma alteração de assert
- [ ] Nome do arquivo exportado muda para `conciliacao-completa-*.xlsx`
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
