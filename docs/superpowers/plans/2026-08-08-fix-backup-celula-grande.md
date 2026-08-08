# Fix do backup completo travando em célula grande — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o botão "Backup completo", que falha silenciosamente quando um `statements.rows` (tipicamente de um extrato com muitos lançamentos) serializa para uma string maior que o limite de célula do formato XLSX (32.767 caracteres), dividindo o valor em múltiplas colunas na exportação e remontando na importação — sem tocar em nenhum importador. Adiciona também tratamento de erro visível no botão de backup.

**Architecture:** `datasetToSheets` (exportação) passa a dividir qualquer valor serializado maior que um limite seguro em colunas extras (`campo__2`, `campo__3`, ...) na mesma linha; `sheetsToDataset` (importação) reconstrói o valor original a partir dessas colunas antes de desserializar. `baixarBackup` (UI) ganha try/catch com toast de erro.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime, SheetJS vendorizado (`vendor/xlsx.full.min.js`, só usado em `exportarBackup`/`importarBackup`, não em `datasetToSheets`/`sheetsToDataset`, que são puras e testadas em Node).

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture. Testes de célula grande usam string sintética repetida (`'x'.repeat(...)`), nunca dado real.
- Comentários e identificadores de negócio em português; termo técnico consagrado em inglês. Commits em português, imperativo, sem emoji.
- Ciclo exportar→importar precisa continuar devolvendo exatamente o mesmo conjunto de dados (invariante já testada em `tests/backup.test.js`, describe `'backup: ciclo completo'`) — incluindo campos divididos em múltiplas colunas.
- Nenhuma mudança em `santander-extrato-xls.js`, `santander-cartao-pdf.js`, ou qualquer outro importador — o fix fica isolado em `src/importers/backup-xlsx.js` e `src/ui/backup-comum.js`.
- Backups exportados ANTES deste fix (sem colunas `__N`) continuam importáveis exatamente como hoje — sem migração, a reconstrução simplesmente não encontra nenhuma coluna `__N` pra esses casos.

---

### Task 1: Dividir célula grande em múltiplas colunas na exportação e remontar na importação

**Files:**
- Modify: `src/importers/backup-xlsx.js:59-75` (`datasetToSheets`), `src/importers/backup-xlsx.js:77-120` (`sheetsToDataset`)
- Test: `tests/backup.test.js`

**Interfaces:**
- Consumes: nada novo — usa `serializarValor`/`desserializarValor` já existentes, sem mudar suas assinaturas.
- Produces: `datasetToSheets` pode gerar colunas extras `${campo}__2`, `${campo}__3`, etc. em qualquer linha cujo campo serializado exceda o limite; `sheetsToDataset` consome e remove essas colunas antes de montar o registro final (elas nunca aparecem como campo do objeto de saída).

- [ ] **Step 1: Escrever os testes (devem falhar primeiro)**

Em `tests/backup.test.js`, adicione um novo describe (após o describe `'backup: ciclo completo'` existente):

```js
describe('backup: celula grande (acima do limite de 32767 caracteres do XLSX)', () => {
  it('campo cujo valor serializado excede o limite e dividido em colunas extras na exportacao', () => {
    const rowsGrandes = Array.from({ length: 2000 }, (_, i) => ({ id: 'r' + i, descricao: 'LINHA DE TESTE NUMERO ' + i, valor: i }));
    const dataset = { statements: [{ id: 'st_grande', tipo: 'extrato', contaId: 'acc_1', rows: rowsGrandes }] };
    const sheets = datasetToSheets(dataset);
    const linha = sheets.statements[0];
    const tamanhoSerializado = JSON.stringify(rowsGrandes).length;
    assert(tamanhoSerializado > 32767, 'pre-condicao do teste: o array sintetico precisa realmente exceder o limite do XLSX');
    assert(typeof linha.rows === 'string' && linha.rows.length <= 30000, 'primeira coluna (rows) nao pode exceder o limite seguro');
    assert('rows__2' in linha, 'valor grande precisa gerar pelo menos uma coluna extra (rows__2)');
  });

  it('ciclo completo (exportar+importar) devolve o array grande EXATAMENTE igual ao original', () => {
    const rowsGrandes = Array.from({ length: 2000 }, (_, i) => ({ id: 'r' + i, descricao: 'LINHA DE TESTE NUMERO ' + i, valor: i }));
    const dataset = { statements: [{ id: 'st_grande', tipo: 'extrato', contaId: 'acc_1', rows: rowsGrandes }] };
    const { dataset: dataset2 } = sheetsToDataset(datasetToSheets(dataset));
    assertDeepEqual(dataset2.statements[0].rows, rowsGrandes, 'array grande nao sobreviveu ao ciclo dividido em colunas');
  });

  it('campo pequeno (abaixo do limite) NAO gera coluna extra — comportamento do caso comum inalterado', () => {
    const sheets = datasetToSheets(DATASET);
    const linha = sheets.statements[0];
    assert(!('rows__2' in linha), 'campo pequeno nao deveria gerar coluna extra');
  });
});
```

Confira que `DATASET` (fixture já existente no topo do arquivo) continua acessível nesse describe — está no escopo do módulo, então sim.

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: os 3 testes novos falham (nenhuma divisão de coluna existe ainda).

- [ ] **Step 3: Implementar a divisão na exportação**

Em `src/importers/backup-xlsx.js`, adicione a constante e a função de divisão logo após `MARCA_JSON` (por volta da linha 28):

```js
// Limite de célula do formato .xlsx e 32767 caracteres (SheetJS lanca
// "Text length must not exceed 32767 characters" e o backup INTEIRO falha
// se um so campo passar disso — visto em producao com statements.rows de
// um extrato com muitos lancamentos). Usa uma folga abaixo do limite real
// pra nunca chegar perto do erro por causa de arredondamento.
const LIMITE_CELULA = 30000;

// Divide uma string grande em pedacos de ate LIMITE_CELULA caracteres.
// Sempre devolve pelo menos 1 pedaco (mesmo pra string vazia), pra manter
// o invariante "campo original sempre e o primeiro pedaco".
function dividirEmPedacos(str) {
  const pedacos = [];
  for (let i = 0; i < str.length; i += LIMITE_CELULA) pedacos.push(str.slice(i, i + LIMITE_CELULA));
  return pedacos.length ? pedacos : [''];
}
```

Depois, altere o loop de `datasetToSheets` que monta cada linha (dentro do `.map((registro) => {...})`, por volta da linha 68-72):

```js
  for (const store of STORES_EXPORTAVEIS) {
    sheets[store] = ((dataset && dataset[store]) || []).map((registro) => {
      const linha = {};
      for (const [k, v] of Object.entries(registro)) {
        const serializado = serializarValor(v);
        if (typeof serializado === 'string' && serializado.length > LIMITE_CELULA) {
          const pedacos = dividirEmPedacos(serializado);
          linha[k] = pedacos[0];
          for (let i = 1; i < pedacos.length; i++) linha[`${k}__${i + 1}`] = pedacos[i];
        } else {
          linha[k] = serializado;
        }
      }
      return linha;
    });
  }
```

- [ ] **Step 4: Implementar a remontagem na importação**

Em `src/importers/backup-xlsx.js`, dentro de `sheetsToDataset`, no loop que monta `dataset[store]` (por volta da linha 104-114), reconstrua os campos divididos ANTES de desserializar:

```js
  const dataset = {};
  for (const store of STORES_EXPORTAVEIS) {
    dataset[store] = (sheets[store] || []).map((linha) => {
      // Remonta campos divididos em colunas extras (campo__2, campo__3, ...)
      // ANTES de desserializar — ver datasetToSheets/dividirEmPedacos. Um
      // backup exportado antes deste fix nunca tem coluna __N, entao esse
      // passo e um no-op pra backups antigos (sem migracao necessaria).
      const linhaMontada = {};
      const extras = {};
      for (const [k, v] of Object.entries(linha)) {
        const match = /^(.+)__(\d+)$/.exec(k);
        if (match) {
          const [, base, indice] = match;
          (extras[base] = extras[base] || [])[Number(indice) - 2] = v;
        } else {
          linhaMontada[k] = v;
        }
      }
      for (const [base, pedacosExtras] of Object.entries(extras)) {
        linhaMontada[base] = linhaMontada[base] + pedacosExtras.join('');
      }

      const registro = {};
      for (const [k, v] of Object.entries(linhaMontada)) {
        const valor = desserializarValor(v);
        if (valor !== undefined) registro[k] = valor;
      }
      return registro;
    });
  }
```

- [ ] **Step 5: Rodar os testes de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS, incluindo os 3 testes novos e todos os testes pré-existentes do arquivo (o teste de ciclo completo com `DATASET` não deve mudar de comportamento — nenhum campo dele passa do limite).

- [ ] **Step 6: Commit**

```bash
git add src/importers/backup-xlsx.js tests/backup.test.js
git commit -m "divide celula grande do backup em colunas extras para nao estourar limite do xlsx"
```

---

### Task 2: Tratamento de erro visível no botão de backup

**Files:**
- Modify: `src/ui/backup-comum.js:12-21` (`baixarBackup`)

**Interfaces:**
- Consumes: `exportarBackup` (sem mudança de assinatura).
- Produces: nenhuma interface nova — só comportamento de erro visível.

- [ ] **Step 1: Implementar o try/catch**

Em `src/ui/backup-comum.js`, envolva o corpo de `baixarBackup` num try/catch, seguindo o mesmo padrão já usado em `montarInputImportarBackup` no mesmo arquivo (linha 53-55):

```js
export async function baixarBackup() {
  try {
    const blob = await exportarBackup();
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `backup-livro-de-gastos-${new Date().toISOString().slice(0, 10)}.xlsx` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('Backup gerado.', 'ok');
  } catch (e) {
    toast('Não consegui gerar o backup: ' + e.message, 'erro');
  }
}
```

- [ ] **Step 2: Rodar a suíte completa**

Run: `node tools/run-tests.mjs`
Expected: código 0, nenhuma falha (esta task não tem teste Node novo — `baixarBackup` toca `document`/`URL.createObjectURL`, é função de UI sem teste automatizado dedicado, mesma situação de `montarInputImportarBackup` no mesmo arquivo).

- [ ] **Step 3: Verificar visualmente no navegador**

Sirva a pasta localmente, seed via console de um `statements.rows` sintético grande (mesmo padrão do Task 1, >32767 caracteres serializado) numa conta de teste, clique "Backup completo" na aba Lançamentos, confirme que o backup baixa com sucesso (Task 1 já deveria ter resolvido a causa raiz) — e opcionalmente force um erro diferente (ex.: chame `baixarBackup` com `storage.getAll` mockado pra rejeitar) só pra confirmar que o toast de erro aparece nesse caso hipotético, sem crashar a página.

- [ ] **Step 4: Commit**

```bash
git add src/ui/backup-comum.js
git commit -m "mostra aviso de erro se o backup completo falhar"
```

---

## Verificação de fim de fase (self-review do plano)

- [x] Cobertura do spec: Task 1 cobre a seção 3 (divisão de célula); Task 2 cobre a seção 4 (tratamento de erro). Nenhuma seção do spec ficou sem task.
- [x] Sem placeholders: código completo em todos os steps.
- [x] Consistência de tipos/nomes: `LIMITE_CELULA`, `dividirEmPedacos`, padrão de nome de coluna `${campo}__N` usados de forma idêntica entre exportação (Task 1, Step 3) e importação (Task 1, Step 4). Nenhuma mudança de assinatura em `serializarValor`/`desserializarValor` (ambas continuam puras, sem saber de divisão de célula).
