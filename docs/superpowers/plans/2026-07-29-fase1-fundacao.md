# Fase 1 — Fundação e Cadastros: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o app sucessor já utilizável em produção: cadastros de contas/cartões, formas de pagamento e categorias, lançamentos com forma de pagamento, e importação do backup do app anterior sem perda de dados.

**Architecture:** PWA offline-first em Vanilla JS (ES modules), sem build step e sem framework. Camadas com fronteira estrita: `core/` (utilitários e persistência), `domain/` (regras de negócio, puras sempre que possível), `importers/` (adaptadores de arquivo), `ui/` (orquestração e DOM). Lógica pura não importa IndexedDB nem DOM, o que a torna testável por linha de comando; persistência e UI ficam numa camada fina por cima.

**Tech Stack:** Vanilla JS ES modules · IndexedDB · SheetJS (`xlsx.full.min.js`, vendorizado) · Service Worker · GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-07-29-financas-multi-conta-design.md` — leia as seções 3 (privacidade), 4 (estrutura), 5 (modelo de dados) e 10 (testes) antes de começar.

## Global Constraints

- **Zero build step, zero dependências em runtime.** Nada de `package.json` no app, nada de CDN. Bibliotecas de terceiros vivem em `vendor/`, servidas da mesma origem.
- **Repositório é PÚBLICO.** Nenhum dado pessoal em código, seed, teste ou fixture: sem número de conta, agência, final de cartão real, nome de pessoa ou valor real. Fixtures são anonimizadas.
- **Datas em ISO (`YYYY-MM-DD`) internamente.** Formatação `DD/MM/AAAA` existe apenas na camada `ui/`. Nenhum módulo de `core/` ou `domain/` devolve data formatada.
- **Valores monetários sempre positivos** em `transactions.valor`. O sentido vem de `natureza`.
- **Módulos de `domain/` e `core/` (exceto `storage.js`) não podem importar `storage.js` nem tocar em `document`/`window`.** É o que permite rodar os testes fora do navegador.
- **Nenhum arquivo deve passar de ~250 linhas.** Se passar, é sinal de que tem mais de uma responsabilidade.
- **Toda categoria é buscada por id, nunca por nome.** O id fixo `a_classificar` é contrato.
- **Idioma:** identificadores em português quando nomeiam conceito de negócio (`natureza`, `formaPagamentoId`), inglês para termos técnicos consagrados (`id`, `index`, `hash`). Comentários e mensagens de UI em português.
- **Commits:** mensagem em português, imperativo, sem emoji. Rodapé `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Estrutura de arquivos desta fase

| Arquivo | Responsabilidade |
|---|---|
| `tests/harness.js` | `describe`/`it`/asserções/`runAll`, sem dependências |
| `tests/index.js` | lista os módulos de teste (os dois runners importam daqui) |
| `tools/run-tests.mjs` | executa a suíte no Node |
| `tools/tests.html` | executa a mesma suíte no navegador |
| `src/version.js` | `APP_VERSION` — fonte única, `sw.js` importa daqui |
| `src/core/money.js` | formatação e parsing de moeda BR |
| `src/core/dates.js` | conversões e aritmética de data, tudo em ISO |
| `src/core/text.js` | normalização de texto e escape de HTML |
| `src/core/ids.js` | geração de id e hash estável |
| `src/core/db-schema.js` | definição dos stores v2 e migração v1→v2 (pura) |
| `src/core/storage.js` | plumbing IndexedDB sobre `db-schema.js` |
| `src/domain/categories.js` | seeds e regras de categoria |
| `src/domain/accounts.js` | contas, cartões, titular/adicional, matchers |
| `src/domain/payment-methods.js` | formas de pagamento e seus tipos |
| `src/domain/transactions.js` | validação, natureza, totais e filtros |
| `src/importers/backup-xlsx.js` | export v2 e import v1/v2 de backup |
| `src/ui/components.js` | modal, toast, tabela, confirmação |
| `src/ui/tabs.js` | troca de abas |
| `src/ui/cadastros.js` | tela de Cadastros |
| `src/ui/lancamentos.js` | tela de Lançamentos |
| `src/ui/onboarding.js` | assistente de primeira execução |
| `src/app.js` | boot e roteamento apenas |
| `index.html` `styles.css` `sw.js` `manifest.webmanifest` | shell PWA |

---

### Task 1: Esqueleto do repositório e harness de testes

Sem um comando de teste verificável, nenhuma das tarefas seguintes pode ser conferida. Esta vem primeiro por isso.

**Files:**
- Create: `tests/harness.js`, `tests/index.js`, `tests/harness.test.js`
- Create: `tools/run-tests.mjs`, `tools/tests.html`
- Create: `src/version.js`, `README.md`
- Copy: `vendor/xlsx.full.min.js`, `icons/*` do app anterior

**Interfaces:**
- Consumes: nada
- Produces:
  - `harness.js`: `describe(nome, fn)`, `it(nome, fn)`, `assert(cond, msg)`, `assertEqual(actual, expected, msg)`, `assertDeepEqual(a, b, msg)`, `assertThrows(fn, msg)`, `async runAll() -> { total, passed, failed, results }`
  - `tests/index.js`: `export const TEST_MODULES = ['./harness.test.js', ...]`
  - `version.js`: `export const APP_VERSION = 'v1'`

- [ ] **Step 1: Escrever o teste do próprio harness**

Crie `tests/harness.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual, assertThrows } from './harness.js';

describe('harness', () => {
  it('assertEqual aceita valores iguais', () => {
    assertEqual(2 + 2, 4);
  });

  it('assertEqual rejeita valores diferentes', () => {
    assertThrows(() => assertEqual(1, 2));
  });

  it('assertDeepEqual compara estruturas aninhadas', () => {
    assertDeepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
    assertThrows(() => assertDeepEqual({ a: 1 }, { a: 2 }));
  });

  it('assert falha com mensagem própria', () => {
    try {
      assert(false, 'mensagem esperada');
      throw new Error('deveria ter lançado');
    } catch (e) {
      assertEqual(e.message, 'mensagem esperada');
    }
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module` (nem `harness.js` nem `run-tests.mjs` existem ainda).

- [ ] **Step 3: Implementar o harness**

Crie `tests/harness.js`:

```js
// Harness de testes sem dependências. Roda igual no navegador (tools/tests.html)
// e no Node (tools/run-tests.mjs), porque só usa ES modules puros.

const suites = [];
let current = null;

export function describe(nome, fn) {
  const anterior = current;
  current = { nome, testes: [] };
  suites.push(current);
  fn();
  current = anterior;
}

export function it(nome, fn) {
  if (!current) throw new Error(`it(${nome}) chamado fora de describe()`);
  current.testes.push({ nome, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert falhou');
}

export function assertEqual(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error(msg || `esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(a, b, msg) {
  const sa = estavel(a);
  const sb = estavel(b);
  if (sa !== sb) throw new Error(msg || `esperado ${sb}, recebido ${sa}`);
}

export function assertThrows(fn, msg) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error(msg || 'esperava uma exceção, nenhuma foi lançada');
}

// Serialização com chaves ordenadas: {a:1,b:2} e {b:2,a:1} são iguais para o teste.
function estavel(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(estavel).join(',') + ']';
  const chaves = Object.keys(v).sort();
  return '{' + chaves.map((k) => JSON.stringify(k) + ':' + estavel(v[k])).join(',') + '}';
}

export async function runAll() {
  const results = [];
  let passed = 0;
  let failed = 0;
  for (const suite of suites) {
    for (const teste of suite.testes) {
      try {
        await teste.fn();
        passed++;
        results.push({ suite: suite.nome, teste: teste.nome, ok: true });
      } catch (e) {
        failed++;
        results.push({ suite: suite.nome, teste: teste.nome, ok: false, erro: e.message });
      }
    }
  }
  return { total: passed + failed, passed, failed, results };
}
```

Crie `tests/index.js`:

```js
// Lista central de módulos de teste. Os dois runners importam daqui, porque
// nem o navegador nem o Node conseguem descobrir arquivos por glob sem build.
export const TEST_MODULES = [
  './harness.test.js',
];
```

Crie `tools/run-tests.mjs`:

```js
// Executa a suíte no Node. Não é parte do app: nenhum arquivo de src/ importa daqui.
import { runAll } from '../tests/harness.js';
import { TEST_MODULES } from '../tests/index.js';

for (const mod of TEST_MODULES) {
  await import(new URL(mod.replace('./', '../tests/'), import.meta.url).href);
}

const { total, passed, failed, results } = await runAll();

for (const r of results) {
  if (!r.ok) console.error(`FALHOU  ${r.suite} > ${r.teste}\n        ${r.erro}`);
}
console.log(`\n${passed}/${total} passaram${failed ? `, ${failed} falharam` : ''}`);
process.exit(failed ? 1 : 0);
```

Crie `tools/tests.html`:

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Testes — Livro de Gastos</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1rem; }
    .ok { color: #0a7d32; }
    .falhou { color: #b3261e; font-weight: 600; }
    .erro { color: #b3261e; margin: 0 0 .5rem 1.5rem; font-family: monospace; white-space: pre-wrap; }
    #resumo { font-size: 1.2rem; font-weight: 600; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Testes</h1>
  <div id="resumo">rodando…</div>
  <div id="lista"></div>
  <script type="module">
    import { runAll } from '../tests/harness.js';
    import { TEST_MODULES } from '../tests/index.js';

    for (const mod of TEST_MODULES) await import(`../tests/${mod.replace('./', '')}`);

    const { total, passed, failed, results } = await runAll();
    document.getElementById('resumo').textContent =
      `${passed}/${total} passaram${failed ? `, ${failed} falharam` : ''}`;
    document.getElementById('resumo').className = failed ? 'falhou' : 'ok';

    const lista = document.getElementById('lista');
    for (const r of results) {
      const linha = document.createElement('div');
      linha.className = r.ok ? 'ok' : 'falhou';
      linha.textContent = `${r.ok ? '✓' : '✗'} ${r.suite} > ${r.teste}`;
      lista.appendChild(linha);
      if (!r.ok) {
        const erro = document.createElement('div');
        erro.className = 'erro';
        erro.textContent = r.erro;
        lista.appendChild(erro);
      }
    }
  </script>
</body>
</html>
```

Crie `src/version.js`:

```js
// Fonte única da versão. O service worker importa daqui para nomear o cache,
// de modo que exista um só lugar para alterar a cada publicação.
export const APP_VERSION = 'v1';
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS — `4/4 passaram`, saída com código 0.

- [ ] **Step 5: Copiar vendor, ícones e escrever o README**

```bash
ANTIGO="../../Cartão de Credito/gastos-app"
mkdir -p vendor icons
cp "$ANTIGO/vendor/xlsx.full.min.js" vendor/
cp "$ANTIGO/icons/"*.png icons/
```

`README.md` deve conter: o que é o app, como rodar localmente (`python -m http.server 8000` e abrir `http://localhost:8000`), como rodar os testes nos dois alvos, e o aviso de que o repositório é público e não aceita documentos financeiros.

- [ ] **Step 6: Confirmar que nenhum documento financeiro entrou no repositório**

Run: `git status --porcelain --ignored | grep -E "\.(pdf|xls|xlsx|csv|ofx)$"`
Expected: as linhas encontradas, se houver, devem começar com `!!` (ignoradas). Nenhuma pode estar em staging.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Adiciona esqueleto do repo e harness de testes de dois alvos

O harness roda os mesmos arquivos de teste no navegador e no Node, sem
dependencia nenhuma, para que exista um comando de verificacao antes de
qualquer logica ser escrita.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `core/money.js` e `core/dates.js`

**Files:**
- Create: `src/core/money.js`, `src/core/dates.js`
- Create: `tests/money.test.js`, `tests/dates.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: harness da Task 1
- Produces:
  - `money.js`: `fmtBRL(n) -> string`, `parseMoneyBR(str) -> number|null`, `round2(n) -> number`
  - `dates.js`: `todayISO() -> string`, `isValidISO(s) -> boolean`, `formatDateBR(iso) -> string`, `parseDateBR(str) -> string|null`, `addMonthsClamped(iso, n) -> string`, `diffDays(isoA, isoB) -> number`, `monthKey(iso) -> string`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/money.test.js`:

```js
import { describe, it, assertEqual } from './harness.js';
import { fmtBRL, parseMoneyBR, round2 } from '../src/core/money.js';

describe('money', () => {
  it('formata em real brasileiro', () => {
    assertEqual(fmtBRL(1234.5), 'R$ 1.234,50');
    assertEqual(fmtBRL(0), 'R$ 0,00');
    assertEqual(fmtBRL(-7781.06), 'R$ -7.781,06');
  });

  it('lê valores no formato do extrato', () => {
    assertEqual(parseMoneyBR('-7.781,06'), -7781.06);
    assertEqual(parseMoneyBR('1.149,81'), 1149.81);
    assertEqual(parseMoneyBR('0,25'), 0.25);
    assertEqual(parseMoneyBR('R$ 60,80'), 60.8);
  });

  it('devolve null para o que não é valor', () => {
    assertEqual(parseMoneyBR(''), null);
    assertEqual(parseMoneyBR('   '), null);
    assertEqual(parseMoneyBR(null), null);
    assertEqual(parseMoneyBR('abc'), null);
  });

  it('arredonda para duas casas sem erro de ponto flutuante', () => {
    assertEqual(round2(0.1 + 0.2), 0.3);
    assertEqual(round2(1.005), 1.01);
  });
});
```

Crie `tests/dates.test.js`:

```js
import { describe, it, assertEqual, assert } from './harness.js';
import { isValidISO, formatDateBR, parseDateBR, addMonthsClamped, diffDays, monthKey, todayISO } from '../src/core/dates.js';

describe('dates', () => {
  it('valida ISO', () => {
    assert(isValidISO('2026-06-30'));
    assert(!isValidISO('30/06/2026'));
    assert(!isValidISO('2026-13-01'));
    assert(!isValidISO(''));
  });

  it('converte entre ISO e BR', () => {
    assertEqual(formatDateBR('2026-06-30'), '30/06/2026');
    assertEqual(parseDateBR('30/06/2026'), '2026-06-30');
    assertEqual(parseDateBR('1/5/2026'), '2026-05-01');
  });

  it('devolve null para data BR inválida', () => {
    assertEqual(parseDateBR('32/01/2026'), null);
    assertEqual(parseDateBR('sem data'), null);
    assertEqual(parseDateBR(''), null);
  });

  // O dia 30 caindo em fevereiro precisa virar 28, nunca escorregar para março:
  // sem isso, duas parcelas seguidas caem no mesmo mês.
  it('soma meses sem estourar para o mês seguinte', () => {
    assertEqual(addMonthsClamped('2026-01-30', 1), '2026-02-28');
    assertEqual(addMonthsClamped('2024-01-30', 1), '2024-02-29');
    assertEqual(addMonthsClamped('2026-06-30', 1), '2026-07-30');
    assertEqual(addMonthsClamped('2026-12-15', 1), '2027-01-15');
  });

  it('conta dias entre datas, sempre positivo', () => {
    assertEqual(diffDays('2026-06-30', '2026-06-28'), 2);
    assertEqual(diffDays('2026-06-28', '2026-06-30'), 2);
    assertEqual(diffDays('2026-06-30', '2026-06-30'), 0);
  });

  it('extrai a chave de mês', () => {
    assertEqual(monthKey('2026-06-30'), '2026-06');
  });

  it('todayISO devolve ISO válido', () => {
    assert(isValidISO(todayISO()));
  });
});
```

Adicione a `tests/index.js`:

```js
export const TEST_MODULES = [
  './harness.test.js',
  './money.test.js',
  './dates.test.js',
];
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/core/money.js'`.

- [ ] **Step 3: Implementar `src/core/money.js`**

```js
// Formatação e leitura de valores monetários no padrão brasileiro.
// Não conhece IndexedDB nem DOM: roda igual no navegador e no Node.

export function round2(n) {
  // O deslocamento por notação exponencial evita o erro clássico de
  // Math.round(1.005 * 100) devolver 100 em vez de 101.
  return Number(Math.round(Number(n + 'e2')) + 'e-2');
}

export function fmtBRL(n) {
  const num = Number(n) || 0;
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoneyBR(str) {
  if (str === null || str === undefined) return null;
  const limpo = String(str).replace(/R\$/gi, '').trim();
  if (!limpo) return null;
  // Formato BR: ponto separa milhar, vírgula separa decimal.
  const normalizado = limpo.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  return round2(parseFloat(normalizado));
}
```

- [ ] **Step 4: Implementar `src/core/dates.js`**

```js
// Toda data circula internamente em ISO (YYYY-MM-DD). A conversão para o
// formato brasileiro acontece só na camada de UI.

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(a, m, 0).getDate();
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateBR(iso) {
  if (!isValidISO(iso)) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function parseDateBR(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidISO(iso) ? iso : null;
}

export function addMonthsClamped(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvoAno = a + Math.floor((m - 1 + n) / 12);
  const alvoMes = ((m - 1 + n) % 12 + 12) % 12;
  const ultimoDia = new Date(alvoAno, alvoMes + 1, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${alvoAno}-${String(alvoMes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diffDays(isoA, isoB) {
  const ms = Date.parse(isoA + 'T00:00:00Z') - Date.parse(isoB + 'T00:00:00Z');
  return Math.abs(Math.round(ms / 86400000));
}

export function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS — todos os testes de `money` e `dates` verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Adiciona utilitarios de moeda e data

addMonthsClamped preserva o dia so ate onde o mes de destino permite, para
que uma parcela de dia 30 caindo em fevereiro nao escorregue para marco.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `core/text.js` e `core/ids.js`

**Files:**
- Create: `src/core/text.js`, `src/core/ids.js`
- Create: `tests/text.test.js`, `tests/ids.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: harness da Task 1
- Produces:
  - `text.js`: `normalizeDescricao(s) -> string`, `escapeHtml(s) -> string`
  - `ids.js`: `uid(prefixo) -> string`, `slugId(s) -> string`, `stableHash(partes) -> string`

`normalizeDescricao` é cópia literal do comportamento do app anterior e é usada por `computeParcelaKey` na Fase 2. Alterá-la quebraria a identidade das parcelas já gravadas: só trim, maiúsculas e colapso de espaço, nada de remover acento.

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/text.test.js`:

```js
import { describe, it, assertEqual } from './harness.js';
import { normalizeDescricao, escapeHtml } from '../src/core/text.js';

describe('text', () => {
  it('normaliza descrição sem alterar acentos', () => {
    assertEqual(normalizeDescricao('  padaria   do   joão '), 'PADARIA DO JOÃO');
    assertEqual(normalizeDescricao('MERCADO'), 'MERCADO');
    assertEqual(normalizeDescricao(null), '');
  });

  it('escapa HTML', () => {
    assertEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assertEqual(escapeHtml('a & b'), 'a &amp; b');
    assertEqual(escapeHtml('aspas " e \''), 'aspas &quot; e &#39;');
  });
});
```

Crie `tests/ids.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import { uid, slugId, stableHash } from '../src/core/ids.js';

describe('ids', () => {
  it('uid começa com o prefixo e não repete', () => {
    const a = uid('acc');
    const b = uid('acc');
    assert(a.startsWith('acc_'));
    assert(a !== b);
  });

  it('slugId troca não-alfanumérico por sublinhado', () => {
    assertEqual(slugId('PADARIA DO JOÃO|2026-06-30|3'), 'PADARIA_DO_JO_O_2026_06_30_3');
  });

  // O hash é a identidade da linha importada: reimportar um extrato com período
  // sobreposto precisa gerar exatamente os mesmos ids, senão duplica tudo.
  it('stableHash é determinístico e sensível a cada parte', () => {
    const a = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 3]);
    const b = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 3]);
    const c = stableHash(['acc1', '2026-06-30', '-95.83', 'ENEL', '000000', 4]);
    assertEqual(a, b);
    assert(a !== c);
  });

  it('stableHash não confunde concatenações ambíguas', () => {
    assert(stableHash(['ab', 'c']) !== stableHash(['a', 'bc']));
  });
});
```

Adicione `'./text.test.js'` e `'./ids.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/core/text.js'`.

- [ ] **Step 3: Implementar `src/core/text.js`**

```js
// Normalização de texto. Deliberadamente conservadora: normalizeDescricao é a
// base de computeParcelaKey (Fase 2), e a identidade das parcelas já gravadas
// depende dela não mudar. Remoção de acento e limpeza agressiva pertencem à
// canonicalização de classificação, que é outra função, em outro módulo.

export function normalizeDescricao(s) {
  return String(s === null || s === undefined ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Implementar `src/core/ids.js`**

```js
// Geração de identificadores. stableHash precisa ser determinístico entre
// sessões e aparelhos, então não pode usar aleatoriedade nem a hora atual.

export function uid(prefixo) {
  const tempo = Date.now().toString(36);
  const acaso = Math.random().toString(36).slice(2, 8);
  return `${prefixo}_${tempo}${acaso}`;
}

export function slugId(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[^a-zA-Z0-9]/g, '_');
}

export function stableHash(partes) {
  // O separador   impede que ['ab','c'] e ['a','bc'] colidam.
  const texto = partes.map((p) => String(p)).join(' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Adiciona normalizacao de texto e geracao de identificadores

normalizeDescricao e copia literal do comportamento anterior porque a
identidade das parcelas ja gravadas depende dela. stableHash usa separador
nulo entre as partes para nao colidir em concatenacoes ambiguas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
