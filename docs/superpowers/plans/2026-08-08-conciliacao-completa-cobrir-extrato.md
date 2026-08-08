# "Exportar conciliação completa" passa a cobrir extrato e mostrar nome de categoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildFullReconciliationRows` (usada pelo botão "Exportar conciliação completa") passa a incluir também lançamentos conciliados com EXTRATO bancário (hoje só cobre fatura de cartão, jogando tudo que veio de extrato no bucket "Só no app"), e a coluna `categoria` passa a mostrar o nome legível em vez do ID interno.

**Architecture:** `buildFullReconciliationRows` (`src/domain/reconcile-card.js`) ganha 3 parâmetros novos (`extratosList`, `apelidosTitular`, `categorias`) e um segundo loop de casamento, reaproveitando `atribuirNatureza` de `reconcile-bank.js` por import — sem duplicar lógica nem alterar o comportamento da conciliação de extrato na aba Conciliação em si. O call site em `conciliacao.js` busca os dados extras e repassa.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Comentários e identificadores de negócio em português; termo técnico consagrado em inglês. Commits em português, imperativo, sem emoji.
- Nenhuma mudança na lógica de casamento de fatura já existente em `buildFullReconciliationRows` (o loop de fatura atual não muda de comportamento, só ganha um loop de extrato depois dele).
- Nenhuma mudança em `reconcile-bank.js`/`runReconciliationBank` — só reuso por import de `atribuirNatureza`, sem duplicar a função nem alterar o comportamento da conciliação de extrato na aba Conciliação.
- `dateDiffDays` já existe em `reconcile-card.js` — não duplicar/importar de `reconcile-bank.js`, usar a que já está no arquivo.
- Ciclo de import `reconcile-card.js` → `reconcile-bank.js` é seguro (confirmado: `reconcile-bank.js` não importa nada de `reconcile-card.js`).

---

### Task 1: `buildFullReconciliationRows` cobre extrato bancário e resolve nome de categoria

**Files:**
- Modify: `src/domain/reconcile-card.js` (função `buildFullReconciliationRows`, assinatura e corpo)
- Modify: `src/ui/conciliacao.js` (call site do botão "Exportar conciliação completa")
- Modify: `tests/reconcile-card.test.js` (testes existentes de `buildFullReconciliationRows` precisam da nova assinatura)

**Interfaces:**
- Consumes: `atribuirNatureza` de `../domain/reconcile-bank.js` (novo import em `reconcile-card.js`).
- Produces: `buildFullReconciliationRows(faturasList, extratosList, allTransactions, accounts, apelidosTitular, categorias)` — nova assinatura de 6 parâmetros (antes: `(faturasList, allTransactions, accounts)`, 3 parâmetros). Cada linha do array retornado ganha `status: 'Só no extrato'` como novo valor possível (além dos já existentes `'Conciliado'`, `'Conciliado (automático)'`, `'Só na fatura'`, `'Só no app'`). Campo `categoria` de cada linha agora é o NOME (ou o próprio ID como fallback se a categoria não existir mais), nunca o ID cru quando a categoria existe.

- [ ] **Step 1: Ler o estado atual de `buildFullReconciliationRows`**

Leia `src/domain/reconcile-card.js` inteiro antes de editar — a função atual (por volta da linha 103-140) e a função `dateDiffDays` já existente no arquivo. Confirme os nomes exatos de variáveis (`pool`, `rows`, `sorted`) antes do próximo step, para não duplicar declarações.

- [ ] **Step 2: Atualizar a assinatura e adicionar resolução de nome de categoria**

Em `src/domain/reconcile-card.js`, adicione o import no topo do arquivo:

```js
import { atribuirNatureza } from './reconcile-bank.js';
```

Adicione esta função auxiliar antes de `buildFullReconciliationRows` (ou logo após `dateDiffDays`, mantendo o estilo do arquivo):

```js
// Resolve o ID de categoria salvo na transacao para o nome legivel. Fallback
// pro proprio ID se a categoria foi excluida depois do lancamento — evita
// quebrar a exportacao por causa de uma referencia orfa, e ainda deixa uma
// pista (o ID) em vez de um campo vazio sem explicacao.
function nomeCategoria(categoriaId, categorias) {
  const c = (categorias || []).find((cat) => cat.id === categoriaId);
  return c ? c.nome : categoriaId;
}
```

Altere a assinatura de `buildFullReconciliationRows`:

```js
export function buildFullReconciliationRows(faturasList, extratosList, allTransactions, accounts, apelidosTitular, categorias) {
```

- [ ] **Step 3: Substituir `t.categoria` cru por `nomeCategoria(t.categoria, categorias)`**

Dentro do loop de fatura já existente, há duas ocorrências de `categoria: t.categoria` na montagem de `rows.push({...})` (uma no ramo "casou", outra em "Só no app" mais abaixo). Substitua AMBAS por `categoria: nomeCategoria(t.categoria, categorias)`. Não altere mais nada da lógica desse loop.

- [ ] **Step 4: Adicionar o loop de extrato**

Logo ANTES do bucket final `pool.filter((t) => !t.used).forEach(...)` (que gera as linhas "Só no app"), adicione:

```js
  const extratosOrdenados = [...(extratosList || [])].sort((a, b) => (a.importadoEm || 0) - (b.importadoEm || 0));
  extratosOrdenados.forEach((extrato) => {
    const comNatureza = (extrato.rows || []).map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));
    comNatureza.forEach((linha) => {
      const idx = pool.findIndex((t) => !t.used && Math.abs(t.valor - linha.valor) < 0.01 && dateDiffDays(t.data, linha.data) <= 2 && (!t.contaId || t.contaId === extrato.contaId));
      if (idx >= 0) {
        const t = pool[idx];
        t.used = true;
        rows.push({ status: t.conciliadoAutomaticamente ? 'Conciliado (automático)' : 'Conciliado', vencimentoFatura: '', dataFatura: linha.data, descricaoFatura: linha.descricao, parcela: '', valorFatura: linha.valor, dataLancamento: t.data, descricaoLancamento: t.descricao, categoria: nomeCategoria(t.categoria, categorias), valorLancamento: t.valor });
      } else {
        rows.push({ status: 'Só no extrato', vencimentoFatura: '', dataFatura: linha.data, descricaoFatura: linha.descricao, parcela: '', valorFatura: linha.valor, dataLancamento: '', descricaoLancamento: '', categoria: '', valorLancamento: '' });
      }
    });
  });
```

Este bloco fica DEPOIS do loop de faturas e ANTES do `pool.filter((t) => !t.used).forEach(...)` que gera "Só no app" — assim transações conciliadas com extrato são marcadas `used: true` antes desse bucket final rodar, e não sobram mais lá.

- [ ] **Step 5: Atualizar o call site em `conciliacao.js`**

Em `src/ui/conciliacao.js`, a função `exportarConciliacaoCompleta` (topo do arquivo) ganha os parâmetros novos:

```js
async function exportarConciliacaoCompleta(faturasList, extratosList, transactions, accounts, apelidosTitular, categorias) {
  try {
    const rows = buildFullReconciliationRows(faturasList, extratosList, transactions, accounts, apelidosTitular, categorias);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conciliacao');
    XLSX.writeFile(wb, `conciliacao-completa-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    toast('Não consegui exportar a conciliação: ' + e.message, 'erro');
  }
}
```

E o `onclick` do botão que a chama (dentro de `renderConciliacao`, procure `Exportar conciliação completa`):

```js
onclick: async () => {
  const [transactions, todasFaturas, todosExtratos, apelidosTitular, categorias] = await Promise.all([
    listTransactions(),
    storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'fatura')),
    storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'extrato')),
    storage.getMeta('apelidosTitular', []),
    listCategorias(),
  ]);
  await exportarConciliacaoCompleta(todasFaturas, todosExtratos, transactions, contas, apelidosTitular, categorias);
},
```

`listCategorias` já está importado no topo de `conciliacao.js` (usado em outro ponto do mesmo arquivo, para `renderBaldesExtrato`) — confirme e reuse o import existente, não duplique.

- [ ] **Step 6: Atualizar os testes existentes pra nova assinatura (devem passar a compilar antes de escrever os testes novos)**

Em `tests/reconcile-card.test.js`, os dois testes existentes do describe `'reconcile-card: buildFullReconciliationRows'` chamam a função com a assinatura ANTIGA de 3 parâmetros. Atualize as duas chamadas:

```js
  it('lancamento sem cartao correspondente em nenhuma fatura sai como "Só no app"', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-10', valor: 50, descricao: 'Solto', categoria: 'cat_inexistente' };
    const rows = buildFullReconciliationRows([], [], [t], contas, [], []);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no app');
    assertEqual(rows[0].categoria, 'cat_inexistente', 'sem categorias cadastradas, cai no fallback do proprio ID');
  });

  it('nao reaproveita o MESMO lancamento em duas faturas diferentes', () => {
    const t = { id: 't1', previsto: false, contaId: TITULAR, data: '2026-05-24', valor: 50, descricao: 'X' };
    const f1 = fat({ id: 'f1', dataCorte: '2026-05-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-24', descricao: 'X', valor: 50, vencimento: '2026-06-01' }] });
    const f2 = fat({ id: 'f2', vencimento: '2026-07-01', dataCorte: '2026-06-25', rows: [{ tipo: 'despesa', secao: 'despesas', data: '2026-05-24', descricao: 'X', valor: 50, vencimento: '2026-07-01' }] });
    const rows = buildFullReconciliationRows([f1, f2], [], [t], contas, [], []);
    const conciliados = rows.filter((r) => r.status.startsWith('Conciliado'));
    assertEqual(conciliados.length, 1, 'o lancamento so pode casar com UMA das duas faturas');
  });
```

Note que o primeiro teste ganhou um `categoria: 'cat_inexistente'` no fixture e uma asserção nova, exercitando o fallback do Step 2 — isso é INTENCIONAL, mantém o teste original relevante à nova responsabilidade da função.

- [ ] **Step 7: Escrever os testes novos (devem falhar primeiro, depois passar)**

Ainda em `tests/reconcile-card.test.js`, adicione ao MESMO describe `'reconcile-card: buildFullReconciliationRows'`:

```js
  it('transacao conciliada com EXTRATO aparece como Conciliado, nao mais Só no app', () => {
    const t = { id: 't1', previsto: false, contaId: 'acc_banco_1', data: '2026-06-10', valor: 55.5, descricao: 'MERCADO EXEMPLO', categoria: 'cat_alimentacao', natureza: 'despesa' };
    const contasComBanco = [...contas, { id: 'acc_banco_1', tipo: 'conta', matchers: [] }];
    const extrato = { id: 'ext1', tipo: 'extrato', contaId: 'acc_banco_1', importadoEm: 1, rows: [{ id: 'r1', descricao: 'MERCADO EXEMPLO', data: '2026-06-10', valor: 55.5, sinal: 'debito' }] };
    const categorias = [{ id: 'cat_alimentacao', nome: 'Alimentação' }];
    const rows = buildFullReconciliationRows([], [extrato], [t], contasComBanco, [], categorias);
    assertEqual(rows.length, 1);
    assert(rows[0].status.startsWith('Conciliado'), 'transacao casada com linha de extrato precisa aparecer como Conciliado, nao Só no app');
    assertEqual(rows[0].categoria, 'Alimentação', 'categoria precisa vir com o NOME, nao o ID');
  });

  it('linha de extrato sem candidato no pool aparece como "Só no extrato"', () => {
    const contasComBanco = [...contas, { id: 'acc_banco_1', tipo: 'conta', matchers: [] }];
    const extrato = { id: 'ext1', tipo: 'extrato', contaId: 'acc_banco_1', importadoEm: 1, rows: [{ id: 'r1', descricao: 'SEM PAR NO APP', data: '2026-06-10', valor: 999, sinal: 'debito' }] };
    const rows = buildFullReconciliationRows([], [extrato], [], contasComBanco, [], []);
    assertEqual(rows.length, 1);
    assertEqual(rows[0].status, 'Só no extrato');
  });
```

- [ ] **Step 8: Rodar os testes**

Run: `node tools/run-tests.mjs`
Expected: todos os testes passam, incluindo os 2 testes existentes atualizados e os 2 novos.

- [ ] **Step 9: Commit**

```bash
git add src/domain/reconcile-card.js src/ui/conciliacao.js tests/reconcile-card.test.js
git commit -m "cobre extrato bancario e resolve nome de categoria na exportacao de conciliacao completa"
```

---

## Verificação de fim de fase (self-review do plano)

- [x] Cobertura do spec: Task 1 cobre as seções 3 (extrato) e 4 (nome de categoria) do spec. Nenhuma seção ficou sem task.
- [x] Sem placeholders: código completo em todos os steps, incluindo a atualização dos 2 testes pré-existentes (fonte comum de teste quebrado silenciosamente se esquecido).
- [x] Consistência de tipos/nomes: `nomeCategoria`, `extratosList`, `categorias` usados de forma idêntica entre `reconcile-card.js` (produção) e `reconcile-card.test.js` (testes) e `conciliacao.js` (call site). Assinatura de 6 parâmetros documentada uma única vez e reusada em todos os pontos.
