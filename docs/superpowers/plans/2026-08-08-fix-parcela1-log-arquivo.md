# Fix da âncora de parcela 1/n via "+ lançar" + nome do arquivo no log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a âncora de vencimento usada pela aba Parcelas para compras cuja parcela 1/n foi lançada manualmente via botão "+ lançar" da Conciliação de fatura, e incluir o nome do arquivo importado no resumo do evento de auditoria `importacao_fatura`.

**Architecture:** O botão "+ lançar" de uma linha de parcelamento passa a propagar o vencimento real da fatura (`fatura.vencimento`) no rascunho que preenche o formulário de Lançamentos; o formulário grava esse valor como `faturaVencimento` na transação confirmada, do mesmo jeito que `autoConfirmParcelas` já faz para linhas auto-confirmadas. Isso faz `parcelaGroupsDaConta` (já corrigido em sessão anterior para diferenciar mesmo-mês/mês-seguinte) usar o vencimento certo também neste caminho. Separadamente, `commitImportacaoEGravar` passa a incluir `statementToPut.arquivo` no resumo do evento de auditoria de importação de fatura.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime, IndexedDB via `src/core/storage.js`.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture. Usar descrições/valores fictícios nos testes (ex.: "LOJA EXEMPLO"), nunca os exemplos reais do usuário (BLESSI, AF INTERNET, etc.).
- Datas ISO internamente (`AAAA-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Sem migração retroativa em `parcelas.js` — transações confirmadas manualmente ANTES deste fix continuam sem `faturaVencimento` e continuam usando o fallback `t.data` (mesmo comportamento de hoje).
- Resumo de evento de auditoria NUNCA pode conter descrição de item individual (regra já testada em `tests/conciliacao-import.browser.test.js:53`) — só contagens e, agora, o nome do arquivo (que não é dado de item, é metadado do statement).

---

### Task 1: Propagar `faturaVencimento` no botão "+ lançar" de parcela

**Files:**
- Modify: `src/ui/conciliacao-fatura.js:26-58` (função `itemFatura`) e `src/ui/conciliacao-fatura.js:81-91` (função `renderBaldesFatura`)
- Modify: `src/ui/lancamentos-form.js:230-238` (bloco que propaga `parcela_atual`/`parcela_total`/`parcelaKey` do rascunho)

**Interfaces:**
- Consumes: `fatura.vencimento` (já existe no objeto `fatura`/`statement` passado para `renderBaldesFatura`, formato ISO `AAAA-MM-DD`).
- Produces: `rascunhoLancamento.faturaVencimento` (novo campo opcional, só presente quando `item.parcela_atual` existe); transação salva por `lancamentos-form.js` ganha `faturaVencimento` quando o rascunho tiver esse campo.

- [ ] **Step 1: Propagar `fatura.vencimento` para `itemFatura`**

Em `src/ui/conciliacao-fatura.js`, altere a assinatura de `itemFatura` para receber o vencimento da fatura e incluí-lo no rascunho só quando a linha for de parcelamento:

```js
function itemFatura(item, contaId, faturaVencimento) {
  return el('div', { class: 'item-balde' }, [
    el('span', { class: 'item-descricao', text: `${item.descricao}${sufixoParcela(item)}` }),
    el('span', { class: 'item-meta', text: `${formatDateBR(item.data)} · ${fmtBRL(item.valor)}` }),
    el('button', {
      class: 'btn btn-mini',
      text: '+ lançar',
      onclick: () => {
        rascunhoLancamento = {
          descricao: item.descricao, data: item.data, valor: item.valor, natureza: 'despesa',
          contaId,
          ...(item.parcela_atual ? {
            parcela_atual: item.parcela_atual,
            parcela_total: item.parcela_total,
            parcelaKey: computeParcelaKey(item.descricao, item.data, item.parcela_total),
            // Vencimento REAL da fatura (nao a data da compra, que e item.data)
            // — sem isso, parcelaGroupsDaConta usava a data da compra como
            // ancora de projecao (empurrando as parcelas restantes ~1 mes pra
            // tras), porque parcela 1/n nunca e auto-confirmada
            // (autoConfirmParcelas exige parcela_atual > 1 ou candidato
            // previo) e so chega em transactions por este botao.
            faturaVencimento,
          } : {}),
        };
        irParaAba('Lancamentos');
      },
    }),
  ]);
}
```

- [ ] **Step 2: Passar `fatura.vencimento` na chamada de `itemFatura`**

Em `renderBaldesFatura`, na linha que monta o balde "Na fatura, não lançado no app":

```js
    balde('Na fatura, não lançado no app', faturaUnmatched.map((item) => itemFatura(item, fatura.contaId, fatura.vencimento)), 'Tudo da fatura já está lançado no app.'),
```

- [ ] **Step 3: Propagar `faturaVencimento` do rascunho pra transação salva**

Em `src/ui/lancamentos-form.js`, no bloco que já propaga `parcela_atual`/`parcela_total`/`parcelaKey` (dentro de `base`, por volta da linha 234):

```js
        ...(!emEdicao && rascunho && rascunho.parcela_atual ? {
          parcela_atual: rascunho.parcela_atual,
          parcela_total: rascunho.parcela_total,
          parcelaKey: rascunho.parcelaKey,
          ...(rascunho.faturaVencimento ? { faturaVencimento: rascunho.faturaVencimento } : {}),
        } : {}),
```

- [ ] **Step 4: Escrever teste para `computeParcelaKey`/fluxo de rascunho (unitário, sem DOM)**

Não há teste de DOM para `conciliacao-fatura.js` hoje (é só wiring de UI). O comportamento correto a testar é a CONSEQUÊNCIA do campo — `parcelaGroupsDaConta` usando `faturaVencimento` de uma transação que NUNCA passou por `autoConfirmParcelas` (i.e., simulando exatamente o que `lancamentos-form.js` agora grava). Adicione em `tests/parcelas.test.js`, dentro do describe existente `'parcelas: parcelaGroupsDaConta'` (ou crie um novo describe se não existir esse nome exato — confira o arquivo antes de editar):

```js
  it('ancora confirmada SEM origem de autoConfirmParcelas (ex.: salva via "+lancar" manual) tambem usa faturaVencimento quando presente', () => {
    // Replica o formato exato que lancamentos-form.js agora grava quando o
    // rascunho do "+lancar" (conciliacao-fatura.js) carrega faturaVencimento:
    // previsto ausente (novaTransaction grava previsto:false por padrao),
    // data = data da COMPRA (nao vencimento), faturaVencimento = vencimento
    // real da fatura que o usuario clicou "+lancar".
    const transactions = [{
      id: 'tx_manual_1', descricao: 'LOJA EXEMPLO', data: '2025-12-22',
      faturaVencimento: '2026-01-30', valor: 157.51,
      parcela_atual: 1, parcela_total: 4, parcelaKey: computeParcelaKey('LOJA EXEMPLO', '2025-12-22', 4),
      previsto: false, contaId: 'acc_1',
    }];
    const grupos = parcelaGroupsDaConta(transactions, 'acc_1');
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].remaining, 3);
    // Ancora confirmada -> mes SEGUINTE ao vencimento (fevereiro), nao o mes
    // da data de compra (dezembro) nem o mesmo mes do vencimento (janeiro).
    assertEqual(grupos[0].months[0].ym, '2026-02');
    assertEqual(grupos[0].months[2].ym, '2026-04');
  });
```

- [ ] **Step 5: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: todos os testes passam, incluindo o novo.

- [ ] **Step 6: Commit**

```bash
git add src/ui/conciliacao-fatura.js src/ui/lancamentos-form.js tests/parcelas.test.js
git commit -m "corrige ancora de vencimento da parcela 1/n lancada via + lancar"
```

---

### Task 2: Nome do arquivo no resumo do evento `importacao_fatura`

**Files:**
- Modify: `src/ui/conciliacao-import.js:128-144` (função `commitImportacaoEGravar`)
- Test: `tests/conciliacao-import.browser.test.js`

**Interfaces:**
- Consumes: `plano.statementToPut.arquivo` (já existe — gravado pelos importadores, ex. `src/importers/santander-cartao-pdf.js:262`).
- Produces: string `resumo` do evento `importacao_fatura` agora inclui o nome do arquivo.

- [ ] **Step 1: Escrever o teste (deve falhar primeiro)**

Em `tests/conciliacao-import.browser.test.js`, adicione uma asserção no teste existente `'importar fatura gera 1 evento importacao_fatura...'` (não crie um describe novo — a fixture `faturaStatement()` já tem `arquivo: 'fatura-teste.pdf'`):

```js
    assert(/\d+ linha\(s\)/.test(eventos[0].resumo), 'resumo precisa ter contagem de linhas');
    assert(eventos[0].resumo.includes('fatura-teste.pdf'), 'resumo precisa citar o nome do arquivo importado');
    assert(!/LOJA|EXEMPLO/.test(eventos[0].resumo), 'resumo NUNCA pode conter descricao de item');
```

- [ ] **Step 2: Rodar o teste no navegador para confirmar que falha**

Run: abrir `tools/tests.html` no navegador (ou usar o Playwright MCP: `browser_navigate` para o arquivo local servido, ver seção de testes browser do README se houver).
Expected: FAIL — resumo ainda não contém `fatura-teste.pdf`.

- [ ] **Step 3: Implementar o fix**

Em `src/ui/conciliacao-import.js`, dentro de `commitImportacaoEGravar`, altere a montagem de `resumo`:

```js
  const resumo = args.tipo === 'fatura'
    ? `Importou fatura (${plano.statementToPut.arquivo}): ${totalLinhas} linha(s), ${confirmadas} confirmada(s) automaticamente, ${previstas} prevista(s), ${pagamentos} pagamento(s)`
    : `Importou extrato: ${totalLinhas} linha(s), ${pagamentos} pagamento(s) de fatura reconhecido(s)`;
```

- [ ] **Step 4: Rodar o teste de novo para confirmar que passa**

Run: mesmo processo do Step 2.
Expected: PASS.

- [ ] **Step 5: Rodar toda a suíte (Node + browser)**

Run: `node tools/run-tests.mjs` (suíte Node) e a suíte browser via `tools/tests.html`.
Expected: código 0, nenhuma falha em nenhuma das duas.

- [ ] **Step 6: Commit**

```bash
git add src/ui/conciliacao-import.js tests/conciliacao-import.browser.test.js
git commit -m "inclui nome do arquivo no resumo do evento de importacao de fatura"
```

---

## Verificação de fim de fase (self-review do plano)

- [x] Cobertura do spec: Task 1 cobre a seção 2 (âncora de parcela 1/n via "+lançar"); Task 2 cobre a seção 3 (nome do arquivo no log). Nenhuma seção do spec ficou sem task.
- [x] Sem placeholders: todos os steps têm código completo, valores exatos, nenhum "TBD"/"implement later".
- [x] Consistência de tipos/nomes: `faturaVencimento` usado com o mesmo nome em `conciliacao-fatura.js`, `lancamentos-form.js` e já existente em `parcelas.js`/`autoConfirmParcelas` (mesma convenção). `rascunhoLancamento.faturaVencimento` → `base.faturaVencimento` → transação salva, sem divergência de nome em nenhum ponto da cadeia.
