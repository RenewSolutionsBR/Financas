# Log de Auditoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar um log técnico de eventos (data/hora, tipo, resumo textual sem dados sensíveis) toda vez que a base de dados local é alterada, com um botão para exportar esse log como `.json`.

**Architecture:** Store nova `auditLog` no IndexedDB (bump de `DB_VERSION` para 3), módulo `domain/audit-log.js` com `registrarEvento`/`listarEventos` puros de UI, chamado a partir de cada ponto de escrita já existente (lançamentos, conciliação, cadastros, backup, apagar dados). Botão "Exportar log" no rodapé de Lançamentos.

**Tech Stack:** Vanilla JS ES modules, IndexedDB nativo, zero dependências novas.

## Global Constraints

- Repositório é PÚBLICO: nenhum evento pode guardar descrição, valor específico, nome de conta/cartão ou qualquer dado que identifique uma compra ou pessoa — só contagens e tipos.
- Commits em português, imperativo, sem emoji.
- Trabalhar direto na `main`, sem branch de feature.
- Teto de ~250 linhas por arquivo (soft constraint já seguido no projeto).
- Limite de 500 eventos no log: ao ultrapassar, os mais antigos são removidos automaticamente.

---

### Task 1: Schema — nova store `auditLog` (DB_VERSION 3)

**Files:**
- Modify: `src/core/db-schema.js`
- Test: nenhum arquivo de teste dedicado a `db-schema.js` existe hoje (os testes de `migrateV1ToV2` moram em `tests/migration.test.js`) — esta task não precisa de teste próprio, a Task 2 já testa a store nova indiretamente ao gravar/ler nela.

**Interfaces:**
- Produz: store `auditLog` no schema, `keyPath: 'id'`, sem índices adicionais.

- [ ] **Step 1: Adicionar a store no schema**

Em `src/core/db-schema.js`, mudar:

```js
export const DB_VERSION = 2;
```
para:
```js
export const DB_VERSION = 3;
```

E adicionar ao array `STORES` (depois de `classificationRules`, antes de `meta`):

```js
{ nome: 'auditLog', keyPath: 'id', indices: [] },
```

- [ ] **Step 2: Rodar a suíte completa pra confirmar que nada quebrou**

Rodar: `node tools/run-tests.mjs`
Esperado: todos os testes existentes continuam passando (a store nova não afeta `migrateV1ToV2` nem nenhum store existente).

- [ ] **Step 3: Commit**

```bash
git add src/core/db-schema.js
git commit -m "Adiciona store auditLog ao schema (DB_VERSION 3)"
```

---

### Task 2: Domínio — `registrarEvento`/`listarEventos` com limite de 500

**Files:**
- Create: `src/domain/audit-log.js`
- Test: `tests/audit-log.test.js`

**Interfaces:**
- Consome: `storage.put`, `storage.getAll`, `storage.remove` (de `../core/storage.js`); `uid` (de `../core/ids.js`).
- Produz:
  - `export async function registrarEvento(tipo, resumo)` — grava um evento `{ id, timestamp, tipo, resumo }` e aplica o limite de 500 (remove os mais antigos além do limite).
  - `export async function listarEventos()` — devolve todos os eventos, mais recente primeiro (`sort` por `timestamp` desc).
  - `export const TIPOS_EVENTO` — objeto com as constantes de tipo, pra quem chama não digitar string solta:
    ```js
    export const TIPOS_EVENTO = {
      IMPORTACAO_FATURA: 'importacao_fatura',
      IMPORTACAO_EXTRATO: 'importacao_extrato',
      LANCAMENTO_CRIADO: 'lancamento_criado',
      LANCAMENTO_EDITADO: 'lancamento_editado',
      LANCAMENTO_EXCLUIDO: 'lancamento_excluido',
      LANCAR_DA_CONCILIACAO: 'lancar_da_conciliacao',
      CADASTRO_ATUALIZADO: 'cadastro_atualizado',
      APAGAR_TRANSACOES: 'apagar_transacoes',
      APAGAR_TUDO: 'apagar_tudo',
      BACKUP_IMPORTADO: 'backup_importado',
    };
    ```

- [ ] **Step 1: Escrever o teste de `registrarEvento` grava e `listarEventos` devolve ordenado**

Criar `tests/audit-log.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import { registrarEvento, listarEventos, TIPOS_EVENTO } from '../src/domain/audit-log.js';
import * as storage from '../src/core/storage.js';

describe('audit-log: registrarEvento + listarEventos', () => {
  it('grava um evento com id, timestamp, tipo e resumo', async () => {
    await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, 'Lançamento criado');
    const eventos = await listarEventos();
    const encontrado = eventos.find((e) => e.resumo === 'Lançamento criado');
    assert(encontrado, 'o evento precisa aparecer em listarEventos');
    assert(encontrado.id, 'precisa ter id');
    assert(typeof encontrado.timestamp === 'number', 'timestamp precisa ser number (Date.now())');
    assertEqual(encontrado.tipo, TIPOS_EVENTO.LANCAMENTO_CRIADO);
    await storage.remove('auditLog', encontrado.id);
  });

  it('listarEventos devolve mais recente PRIMEIRO', async () => {
    const e1 = { id: 'audit_teste_1', timestamp: 1000, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: 'Antigo' };
    const e2 = { id: 'audit_teste_2', timestamp: 2000, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: 'Recente' };
    await storage.put('auditLog', e1);
    await storage.put('auditLog', e2);
    const eventos = await listarEventos();
    const idxAntigo = eventos.findIndex((e) => e.id === 'audit_teste_1');
    const idxRecente = eventos.findIndex((e) => e.id === 'audit_teste_2');
    assert(idxRecente < idxAntigo, 'evento mais recente (timestamp maior) precisa vir ANTES do mais antigo na lista');
    await storage.remove('auditLog', 'audit_teste_1');
    await storage.remove('auditLog', 'audit_teste_2');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (audit-log.js ainda não existe)**

Rodar: `node tools/run-tests.mjs`
Esperado: FALHA com erro de módulo não encontrado (`Cannot find module '../src/domain/audit-log.js'`).

- [ ] **Step 3: Implementar `src/domain/audit-log.js`**

```js
// Log tecnico de eventos de escrita na base, pra facilitar debug de
// problemas como "por que este lancamento nao aparece na conciliacao" —
// NUNCA guarda descricao, valor especifico, nome de conta/cartao ou
// qualquer dado que identifique uma compra ou pessoa: so contagens e
// tipos, porque o repositorio e publico e este log pode ser exportado e
// compartilhado em debug.

import { uid } from '../core/ids.js';
import * as storage from '../core/storage.js';

export const TIPOS_EVENTO = {
  IMPORTACAO_FATURA: 'importacao_fatura',
  IMPORTACAO_EXTRATO: 'importacao_extrato',
  LANCAMENTO_CRIADO: 'lancamento_criado',
  LANCAMENTO_EDITADO: 'lancamento_editado',
  LANCAMENTO_EXCLUIDO: 'lancamento_excluido',
  LANCAR_DA_CONCILIACAO: 'lancar_da_conciliacao',
  CADASTRO_ATUALIZADO: 'cadastro_atualizado',
  APAGAR_TRANSACOES: 'apagar_transacoes',
  APAGAR_TUDO: 'apagar_tudo',
  BACKUP_IMPORTADO: 'backup_importado',
};

const LIMITE_EVENTOS = 500;

export async function registrarEvento(tipo, resumo) {
  await storage.put('auditLog', { id: uid('audit'), timestamp: Date.now(), tipo, resumo });
  await aplicarLimite();
}

export async function listarEventos() {
  const eventos = await storage.getAll('auditLog');
  return eventos.sort((a, b) => b.timestamp - a.timestamp);
}

// Remove os mais ANTIGOS além do limite — o log e uma ferramenta de debug
// recente, nao um historico completo desde o inicio dos tempos.
async function aplicarLimite() {
  const eventos = await listarEventos();
  if (eventos.length <= LIMITE_EVENTOS) return;
  const excedentes = eventos.slice(LIMITE_EVENTOS);
  for (const e of excedentes) await storage.remove('auditLog', e.id);
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Rodar: `node tools/run-tests.mjs`
Esperado: PASS nos 2 testes novos.

- [ ] **Step 5: Escrever teste do limite de 500**

Adicionar a `tests/audit-log.test.js`:

```js
describe('audit-log: limite de 500 eventos', () => {
  it('ao ultrapassar 500, remove os MAIS ANTIGOS primeiro (mantem os mais recentes)', async () => {
    // Popula 502 eventos com timestamps crescentes e ids previsiveis, pra
    // poder limpar so os que este teste criou no final.
    const ids = [];
    for (let i = 0; i < 502; i++) {
      const id = `audit_limite_teste_${i}`;
      ids.push(id);
      await storage.put('auditLog', { id, timestamp: i, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: `Evento ${i}` });
    }
    // registrarEvento aplica o limite como efeito colateral da proxima gravacao.
    await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, 'Gatilho do limite');
    const eventos = await listarEventos();
    assert(eventos.length <= 500, `esperava no maximo 500 eventos, achei ${eventos.length}`);
    const aindaExisteOMaisAntigo = eventos.some((e) => e.id === 'audit_limite_teste_0');
    assert(!aindaExisteOMaisAntigo, 'o evento MAIS ANTIGO (timestamp 0) precisa ter sido removido pelo limite');

    // Limpeza: remove tudo que sobrou deste teste.
    const restantes = await listarEventos();
    for (const e of restantes) {
      if (e.id.startsWith('audit_limite_teste_') || e.resumo === 'Gatilho do limite') {
        await storage.remove('auditLog', e.id);
      }
    }
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Rodar: `node tools/run-tests.mjs`
Esperado: PASS no teste do limite.

- [ ] **Step 7: Commit**

```bash
git add src/domain/audit-log.js tests/audit-log.test.js
git commit -m "Adiciona domain/audit-log.js: registrarEvento, listarEventos, limite de 500"
```

---

### Task 3: Instrumentar lançamentos (criar/editar/excluir/+lançar)

**Files:**
- Modify: `src/ui/lancamentos-form.js`
- Modify: `src/ui/lancamentos.js`
- Test: `tests/lancamentos.browser.test.js` (adicionar casos, não criar arquivo novo)

**Interfaces:**
- Consome: `registrarEvento`, `TIPOS_EVENTO` de `../domain/audit-log.js`.

- [ ] **Step 1: Instrumentar `lancamentos-form.js` — lançamento único (criar/editar) e "+lançar"**

Em `src/ui/lancamentos-form.js`, adicionar o import:

```js
import { registrarEvento, TIPOS_EVENTO } from '../domain/audit-log.js';
```

No fluxo de lançamento único (função `salvar`, depois de `await saveTransaction(registro);`, ANTES de `await storage.setMeta('ultimaFormaUsada', ...)` ou logo depois — a ordem entre as duas não importa, mas registrar depois do save confirma que a gravação teve sucesso):

```js
await saveTransaction(registro);
await registrarEvento(
  emEdicao ? TIPOS_EVENTO.LANCAMENTO_EDITADO
    : (rascunho ? TIPOS_EVENTO.LANCAR_DA_CONCILIACAO : TIPOS_EVENTO.LANCAMENTO_CRIADO),
  emEdicao ? 'Lançamento editado'
    : (rascunho ? 'Lançamento criado a partir da Conciliação' : 'Lançamento criado')
);
```

- [ ] **Step 2: Instrumentar o fluxo de compra parcelada (mesma função, ramo `chkParcelado.checked`)**

Depois de `await saveTransactions(resultado.lista);`:

```js
await saveTransactions(resultado.lista);
await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, `Compra parcelada criada: ${resultado.lista.length} parcela(s)`);
```

- [ ] **Step 3: Instrumentar exclusão em `lancamentos.js`**

Em `src/ui/lancamentos.js`, adicionar o import:

```js
import { registrarEvento, TIPOS_EVENTO } from '../domain/audit-log.js';
```

Na função `excluir`, depois de `await removeTransaction(t.id);`:

```js
async function excluir(t) {
  if (!(await confirmar(`Excluir "${t.descricao}"?`))) return;
  await removeTransaction(t.id);
  await registrarEvento(TIPOS_EVENTO.LANCAMENTO_EXCLUIDO, 'Lançamento excluído');
  toast('Lançamento excluído.', 'ok');
  await renderLancamentos();
}
```

- [ ] **Step 4: Escrever teste — lançamento criado gera evento**

Em `tests/lancamentos.browser.test.js`, adicionar (perto do teste de reentrância do submit, mesmo padrão de `montarPainel`/`resetLancamentos`/`renderLancamentos`):

```js
describe('lancamentos (DOM real): log de auditoria', () => {
  it('salvar um lançamento novo registra um evento lancamento_criado', async () => {
    const { listarEventos, TIPOS_EVENTO } = await import('../src/domain/audit-log.js');
    montarPainel();
    resetLancamentos();
    await renderLancamentos();

    const antes = (await listarEventos()).length;
    const form = document.querySelector('.form-lancamento');
    const inputs = form.querySelectorAll('input');
    inputs[0].value = '10/07/2026';
    inputs[1].value = '5,00';
    inputs[2].value = 'Teste log auditoria';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));

    const eventos = await listarEventos();
    assert(eventos.length > antes, 'precisa ter pelo menos 1 evento novo');
    assertEqual(eventos[0].tipo, TIPOS_EVENTO.LANCAMENTO_CRIADO);

    const todos = await listTransactions();
    const achado = todos.find((t) => t.descricao === 'Teste log auditoria');
    if (achado) await removeTransaction(achado.id);
  });
});
```

- [ ] **Step 5: Rodar os testes (navegador) e confirmar PASS**

Abrir `tools/tests.html` no navegador (ou usar Playwright), confirmar que o novo teste passa e nenhum teste existente quebrou.

- [ ] **Step 6: Commit**

```bash
git add src/ui/lancamentos-form.js src/ui/lancamentos.js tests/lancamentos.browser.test.js
git commit -m "Registra eventos de auditoria ao criar/editar/excluir lancamento e +lancar da Conciliacao"
```

---

### Task 4: Instrumentar importação de fatura/extrato

**Files:**
- Modify: `src/ui/conciliacao-import.js`
- Test: `tests/conciliacao-import.test.js`

**Interfaces:**
- Consome: `registrarEvento`, `TIPOS_EVENTO` de `../domain/audit-log.js`.
- Consome (já existe): `commitImportacao` devolve `{ statementToPut, transactionsToPut, transactionIdsToRemove }` — usar o tamanho desses arrays pra montar o resumo com contagens.

- [ ] **Step 1: Adicionar o import**

Em `src/ui/conciliacao-import.js`:

```js
import { registrarEvento, TIPOS_EVENTO } from '../domain/audit-log.js';
```

- [ ] **Step 2: Instrumentar `commitImportacaoEGravar`**

`commitImportacaoEGravar` é a única função deste arquivo que TOCA STORAGE (comentário do próprio arquivo: "commitImportacao em si permanece pura e testável"). O evento de auditoria é side-effect de gravação, então entra aqui, não em `commitImportacao`:

```js
export async function commitImportacaoEGravar(args) {
  const plano = await commitImportacao(args);
  await storage.put('statements', plano.statementToPut);
  for (const id of plano.transactionIdsToRemove) await storage.remove('transactions', id);
  if (plano.transactionsToPut.length) await storage.putMany('transactions', plano.transactionsToPut);

  const totalLinhas = (plano.statementToPut.rows || []).length;
  const confirmadas = plano.transactionsToPut.filter((t) => !t.previsto && t.origem === 'fatura').length;
  const previstas = plano.transactionsToPut.filter((t) => t.previsto).length;
  const pagamentos = plano.transactionsToPut.filter((t) => t.natureza === 'pagamento_fatura').length;
  const resumo = args.tipo === 'fatura'
    ? `Importou fatura: ${totalLinhas} linha(s), ${confirmadas} confirmada(s) automaticamente, ${previstas} prevista(s), ${pagamentos} pagamento(s)`
    : `Importou extrato: ${totalLinhas} linha(s), ${pagamentos} pagamento(s) de fatura reconhecido(s)`;
  await registrarEvento(
    args.tipo === 'fatura' ? TIPOS_EVENTO.IMPORTACAO_FATURA : TIPOS_EVENTO.IMPORTACAO_EXTRATO,
    resumo
  );

  return plano;
}
```

- [ ] **Step 3: Escrever teste — importar fatura registra evento com contagens**

Em `tests/conciliacao-import.test.js`, adicionar (perto dos testes de `commitImportacao`, mas chamando `commitImportacaoEGravar` desta vez — que precisa de IndexedDB real, então este teste só roda no ambiente de testes que já inicializa storage; verificar no início do arquivo se `commitImportacaoEGravar` já é importado/testado em algum lugar, senão seguir o padrão dos testes de `storage.browser.test.js` para IndexedDB real):

```js
import { commitImportacaoEGravar } from '../src/ui/conciliacao-import.js';
import { listarEventos } from '../src/domain/audit-log.js';

describe('commitImportacaoEGravar: registra evento de auditoria com contagens', () => {
  it('importar fatura gera 1 evento importacao_fatura com contagem de linhas/confirmadas/previstas/pagamentos', async () => {
    const statement = faturaStatement();
    const antes = (await listarEventos()).length;
    await commitImportacaoEGravar({
      tipo: 'fatura', contaId: CONTA_CARTAO, statement, rows: statement.rows,
      transactions: [], accounts: [], apelidosTitular: [], allStatements: [], regras: [], formas: FORMAS,
    });
    const eventos = await listarEventos();
    assertEqual(eventos.length, antes + 1);
    assertEqual(eventos[0].tipo, 'importacao_fatura');
    assert(/\d+ linha\(s\)/.test(eventos[0].resumo), 'resumo precisa ter contagem de linhas');
    assert(!/LOJA|EXEMPLO/.test(eventos[0].resumo), 'resumo NUNCA pode conter descricao de item');
  });
});
```

Nota para quem implementar: se este teste precisar de `storage` real (IndexedDB) e o arquivo `conciliacao-import.test.js` hoje só testa `commitImportacao` (pura, sem storage), pode ser necessário mover este teste específico para um arquivo `.browser.test.js` novo ou existente — checar o padrão do projeto (`tests/*.browser.test.js` vs `tests/*.test.js`) antes de escrever, e ajustar a localização se `commitImportacaoEGravar` não puder rodar no harness Node puro.

- [ ] **Step 4: Rodar os testes e confirmar PASS**

Rodar: `node tools/run-tests.mjs` (ou o navegador, dependendo de onde o teste foi colocado no Step 3).

- [ ] **Step 5: Commit**

```bash
git add src/ui/conciliacao-import.js tests/conciliacao-import.test.js
git commit -m "Registra evento de auditoria ao importar fatura/extrato, com contagens"
```

---

### Task 5: Instrumentar cadastros, apagar dados e importar backup

**Files:**
- Modify: `src/domain/accounts.js` (`saveAccount`)
- Modify: `src/domain/payment-methods.js` (`saveForma`)
- Modify: `src/domain/categories.js` (`saveCategoria`)
- Modify: `src/core/storage.js` (`resetTransacoes`, `resetAllData`) — **ver nota abaixo sobre dependência circular**
- Modify: `src/ui/backup-comum.js` (`montarInputImportarBackup`)
- Test: `tests/accounts.test.js` (saveAccount), `tests/payment-methods.test.js` (saveForma), `tests/categories.test.js` (saveCategoria) — os três já existem no projeto.

**Interfaces:**
- Consome: `registrarEvento`, `TIPOS_EVENTO` de `../domain/audit-log.js`.

**⚠️ Atenção — dependência circular em `storage.js`:** `domain/audit-log.js` importa de `core/storage.js` (`storage.put`, `storage.getAll`, `storage.remove`). Se `core/storage.js` importar de volta `domain/audit-log.js` para instrumentar `resetTransacoes`/`resetAllData`, isso cria um ciclo de import (`storage.js` → `audit-log.js` → `storage.js`). ES modules toleram ciclos em certos casos, mas é frágil e vai contra a camada estabelecida do projeto (`core/` nunca deveria depender de `domain/`). **Resolução:** registrar os eventos de `apagar_transacoes`/`apagar_tudo` no CHAMADOR de `resetTransacoes`/`resetAllData` (`src/ui/lancamentos.js`, funções `apagarTransacoes`/`apagarTudo`), não dentro de `storage.js`.

- [ ] **Step 1: Instrumentar `saveAccount`, `saveForma`, `saveCategoria`**

Em `src/domain/accounts.js`, adicionar o import e instrumentar:

```js
import { registrarEvento, TIPOS_EVENTO } from './audit-log.js';
// ...
export async function saveAccount(a) {
  await storage.put('accounts', a);
  await registrarEvento(TIPOS_EVENTO.CADASTRO_ATUALIZADO, 'Cadastro de conta atualizado');
}
```

Mesmo padrão em `src/domain/payment-methods.js` (`saveForma`, resumo `'Cadastro de forma de pagamento atualizado'`) e `src/domain/categories.js` (`saveCategoria`, resumo `'Cadastro de categoria atualizado'`).

Confirmado (checado antes de escrever este plano): nenhum chamador destas três funções usa o valor de retorno — trocar `return storage.put(...)` por `await storage.put(...)` seguido de `await registrarEvento(...)` é seguro.

- [ ] **Step 2: Instrumentar apagar transações/tudo em `lancamentos.js`**

Em `src/ui/lancamentos.js`, nas funções já existentes `apagarTransacoes`/`apagarTudo`:

```js
async function apagarTransacoes(aoMudar) {
  const ok = window.confirm(/* ... */);
  if (!ok) return;
  await storage.resetTransacoes();
  await registrarEvento(TIPOS_EVENTO.APAGAR_TRANSACOES, 'Apagou todas as transações e documentos importados');
  toast('Lançamentos e documentos importados foram apagados.', 'ok');
  await aoMudar();
}

async function apagarTudo(aoMudar) {
  const ok = window.confirm(/* ... */);
  if (!ok) return;
  await storage.resetAllData();
  await registrarEvento(TIPOS_EVENTO.APAGAR_TUDO, 'Apagou todos os dados do app');
  toast('Todos os dados foram apagados.', 'ok');
  await aoMudar();
}
```

**Cuidado:** `resetAllData()` também apaga a store `auditLog` (ela está em `STORES`, e `resetAllData` itera todas). Isso é intencional — "apagar tudo" deve mesmo apagar o log também —, mas significa que o evento `apagar_tudo` precisa ser registrado DEPOIS do reset (como no código acima), senão ele é apagado junto com o resto e nunca sobrevive pra contar a própria história. Confirmar esse comportamento é aceitável (o evento "apagar tudo" não sobrevive à própria ação) — é a leitura mais simples e consistente com o que a store realmente guarda.

- [ ] **Step 3: Instrumentar importação de backup em `backup-comum.js`**

Em `src/ui/backup-comum.js`, adicionar o import e instrumentar dentro do listener de `change`, depois de `const { contagens, avisos } = await importarBackup(...)`:

```js
const total = Object.values(contagens).reduce((a, b) => a + b, 0);
await registrarEvento(TIPOS_EVENTO.BACKUP_IMPORTADO, `Importou backup: ${total} registro(s)`);
toast(`${total} registro(s) importados. ...`, 'ok');
```

- [ ] **Step 4: Escrever testes**

Para cada `save*`, adicionar um caso simples no arquivo de teste correspondente (`tests/accounts.test.js`, `tests/payment-methods.test.js`, `tests/categories.test.js`):

```js
it('saveAccount registra evento de auditoria cadastro_atualizado', async () => {
  const { listarEventos } = await import('../src/domain/audit-log.js');
  const antes = (await listarEventos()).length;
  await saveAccount({ id: 'acc_teste_audit', tipo: TIPO_CONTA, nome: 'Teste Audit', ativo: true, agencia: '1', numero: '2' });
  const eventos = await listarEventos();
  assertEqual(eventos.length, antes + 1);
  assertEqual(eventos[0].tipo, 'cadastro_atualizado');
  await storage.remove('accounts', 'acc_teste_audit');
});
```

Para `apagarTransacoes`/`apagarTudo`: se `lancamentos.js` já tem teste `.browser.test.js` cobrindo o rodapé, adicionar um caso ali seguindo o mesmo padrão de clicar no botão e checar `listarEventos()`. Se não houver teste de DOM pra esses botões ainda, um teste direto de `storage.resetTransacoes()` + verificação manual do evento (chamando `registrarEvento` explicitamente, já que a UI não é testável sem DOM) é aceitável — mas prefira testar via clique real no botão se o padrão de `lancamentos.browser.test.js` permitir (`montarPainel`/`renderLancamentos`).

Para `montarInputImportarBackup`: se já existe teste de importação de backup (`tests/backup-xlsx.test.js` ou similar), adicionar a checagem de evento lá; senão, este ponto específico pode ficar coberto só pela revisão de código (o padrão é idêntico aos outros pontos já testados) — anotar isso explicitamente no relatório da task se for o caso.

- [ ] **Step 5: Rodar a suíte completa (Node + navegador) e confirmar PASS**

Rodar: `node tools/run-tests.mjs` e abrir `tools/tests.html` no navegador.
Esperado: todos os testes passam, incluindo os novos.

- [ ] **Step 6: Commit**

```bash
git add src/domain/accounts.js src/domain/payment-methods.js src/domain/categories.js src/ui/lancamentos.js src/ui/backup-comum.js tests/
git commit -m "Registra eventos de auditoria em cadastros, apagar dados e importar backup"
```

---

### Task 6: Botão "Exportar log" em Lançamentos

**Files:**
- Modify: `src/ui/lancamentos.js` (função `rodape`)
- Test: `tests/lancamentos.browser.test.js`

**Interfaces:**
- Consome: `listarEventos` de `../domain/audit-log.js`.

- [ ] **Step 1: Implementar a função de exportação**

Em `src/ui/lancamentos.js`, adicionar:

```js
async function exportarLog() {
  const eventos = await listarEventos();
  const blob = new Blob([JSON.stringify(eventos, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `log-financas-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Log exportado.', 'ok');
}
```

- [ ] **Step 2: Adicionar o botão no rodapé, ao lado de "Backup completo"**

Na função `rodape`, dentro do `el('div', { class: 'acoes' }, [...])` que já tem o botão de Backup completo:

```js
el('div', { class: 'acoes' }, [
  el('button', { class: 'btn', type: 'button', text: 'Backup completo', onclick: baixarBackup }),
  el('label', { class: 'btn', for: 'inputImportarBackupLancamentos', style: 'text-align:center; cursor:pointer;' }, ['Importar backup']),
  el('button', { class: 'btn', type: 'button', text: 'Exportar log', onclick: exportarLog }),
]),
```

- [ ] **Step 3: Escrever teste — botão existe e chama listarEventos**

Em `tests/lancamentos.browser.test.js`:

```js
describe('lancamentos (DOM real): botão Exportar log', () => {
  it('o rodapé tem um botão "Exportar log"', async () => {
    montarPainel();
    resetLancamentos();
    await renderLancamentos();
    const botao = [...document.querySelectorAll('.rodape-lancamentos button')].find((b) => b.textContent === 'Exportar log');
    assert(botao, 'precisa existir um botão "Exportar log" no rodapé');
  });
});
```

(Testar o download em si — clique disparando `URL.createObjectURL` — não é prático em ambiente de teste sem mock de download; o teste de presença do botão + a cobertura de `listarEventos` já testada na Task 2 são suficientes. Se quiser reforçar, pode espiar `URL.createObjectURL` com um stub simples, mas não é obrigatório.)

- [ ] **Step 4: Rodar os testes e confirmar PASS**

Abrir `tools/tests.html` no navegador, confirmar que o teste novo passa.

- [ ] **Step 5: Verificação visual manual**

Abrir o app localmente (servidor estático), ir em Lançamentos, clicar em "Exportar log", confirmar que baixa um `.json` com os eventos acumulados durante a sessão de testes/uso.

- [ ] **Step 6: Commit**

```bash
git add src/ui/lancamentos.js tests/lancamentos.browser.test.js
git commit -m "Adiciona botao Exportar log no rodape de Lancamentos"
```

---

### Task 7: Revisão final e checklist de fim de fase

- [ ] **Step 1: Rodar a suíte completa (Node + navegador) uma última vez**

```bash
node tools/run-tests.mjs
```
E abrir `tools/tests.html` no navegador. Confirmar 0 falhas novas (as 2 falhas pré-existentes conhecidas — filtro de forma e guarda de reentrância — continuam sendo flakiness de estado residual de IndexedDB entre execuções, não regressão desta feature).

- [ ] **Step 2: Conferir que nenhum resumo de evento vaza dado sensível**

Grep manual por `resumo:` e pelos textos passados a `registrarEvento(...)` em todos os arquivos modificados — confirmar que nenhum interpola `descricao`, `valor` de item específico, `nome` de conta/cartão. Só contagens (`${N} linha(s)`, `${N} registro(s)`) e frases fixas.

- [ ] **Step 3: Testar exportação do log fim a fim, manualmente**

No navegador: importar uma fatura de teste, criar um lançamento, editar, excluir, apagar transações — depois clicar em "Exportar log" e abrir o `.json` baixado, conferir que os eventos aparecem na ordem certa (mais recente primeiro) com resumos corretos.

- [ ] **Step 4: Push para origin/main**

```bash
git push origin main
```
