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
- **Nenhum módulo pode tocar `indexedDB`, `document` ou `window` no momento da importação.** Só `storage.js` chama `indexedDB`, e sempre dentro de funções, nunca no corpo do módulo. Módulos de `domain/` podem importar `storage.js` para as funções de persistência; o que não podem é ter efeito colateral na importação. É essa regra — e não a proibição de importar — que mantém os testes rodando no Node.
- **Regras puras e persistência ficam separadas dentro do arquivo**, com as funções de persistência agrupadas ao final, sob um comentário `// --- Persistência ---`. Nenhuma função pura pode chamar `storage`.
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
  const num = Number(n);
  if (!Number.isFinite(num)) return NaN;
  if (num === 0) return 0;
  const escalado = num * 100;
  // Duas correções, cada uma para um erro real:
  // 1. A margem de EPSILON relativo compensa o resíduo binário que faz
  //    1.005 * 100 valer 100.49999999999999 e arredondar para baixo.
  // 2. O sinal sai da conta e volta no fim porque Math.round(-100.5) devolve
  //    -100 em JavaScript, enquanto Math.round(100.5) devolve 101 — sem isso,
  //    um lançamento e o seu estorno diferem em um centavo.
  const corrigido = Math.abs(escalado) * (1 + Number.EPSILON);
  return Math.sign(escalado) * Math.round(corrigido) / 100;
}

export function fmtBRL(n) {
  const num = Number(n) || 0;
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoneyBR(str) {
  if (str === null || str === undefined) return null;
  const limpo = String(str).replace(/R\$/gi, '').trim();
  if (!limpo) return null;
  // Formato BR estrito: ponto só como separador de milhar, e portanto sempre
  // seguido de exatamente três dígitos; vírgula como separador decimal.
  // A rigidez é proposital. A versão tolerante lia "12.30" como 1230 — erro de
  // cem vezes, sem nenhum aviso. Um valor que o app não entende com certeza
  // precisa parar na frente do usuário, não entrar calado num total.
  if (!/^-?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(limpo)) return null;
  return round2(parseFloat(limpo.replace(/\./g, '').replace(',', '.')));
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
    // O caso que realmente exercita o separador: as partes contêm espaço, e a
    // fronteira entre elas se desloca. Descrição de extrato tem espaço em quase
    // toda linha ("PIX ENVIADO", "ENEL ENERGIA"), então um separador que seja
    // espaço colide aqui — e uma linha seria descartada como duplicata de outra.
    assert(stableHash(['a b', 'c']) !== stableHash(['a', 'b c']));
    assert(
      stableHash(['acc1', '2026-06-30', '-95.83', 'PIX ENVIADO', 'JOAO', 3]) !==
      stableHash(['acc1', '2026-06-30', '-95.83', 'PIX', 'ENVIADO JOAO', 3])
    );
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

// O separador precisa ser um caractere que nunca aparece dentro de uma
// descricao de extrato. Fica definido por String.fromCharCode(0) em vez de
// literal na string: o caractere NUL e invisivel no editor, e ja foi trocado
// por espaco por engano tanto pelo implementador quanto por quem escreveu
// este plano. Com espaco, ['a b','c'] e ['a','b c'] geram o mesmo hash, e uma
// linha de extrato seria descartada como duplicata de outra.
const SEPARADOR_PARTES = String.fromCharCode(0);

export function stableHash(partes) {
  const texto = partes.map((p) => String(p)).join(SEPARADOR_PARTES);
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

---

### Task 4: `core/db-schema.js` — stores v2 e migração v1→v2

Este módulo é **puro**: descreve os stores e converte estruturas de dados. Não abre banco nenhum. É o que permite testar a migração inteira sem navegador — e a migração é a parte do sistema onde um erro custa os dados reais do usuário.

Leia a seção 5.7 do spec antes de começar.

**Files:**
- Create: `src/core/db-schema.js`
- Create: `tests/migration.test.js`, `tests/fixtures/legacy-v1.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/dates.js` (`isValidISO`), `core/money.js` (`round2`), `core/ids.js` (`stableHash`)
- Produces:
  - `DB_NAME = 'financas'`, `DB_VERSION = 2`, `LEGACY_DB_NAME = 'livro-de-gastos'`
  - `STORES` — array de `{ nome, keyPath, indices: [{ nome, keyPath, unique }] }`
  - `migrateV1ToV2(legado, opcoes) -> { transactions, categories, statements, meta, avisos }`
    - `legado`: `{ expenses, categories, faturas, meta }` (arrays; `meta` é array de `{key, value}`)
    - `opcoes`: `{ cartaoTitularId, formaCreditoId }`
    - `avisos`: array de strings para exibir ao usuário

- [ ] **Step 1: Criar a fixture anonimizada**

Crie `tests/fixtures/legacy-v1.js`. Os dados são inventados e reproduzem só a **forma** dos registros reais: um lançamento simples, uma parcela confirmada automaticamente, uma previsão de origem manual, e uma fatura com duas linhas.

```js
// Fixture anonimizada do banco do app anterior. Nenhum dado real:
// descrições, valores e datas são inventados. Reproduz apenas a estrutura.
export const LEGACY_V1 = {
  expenses: [
    { id: 'e_1', descricao: 'Padaria', valor: 23.5, data: '2026-06-10', categoria: 'alimentacao' },
    {
      id: 'confirmed_LOJA_EXEMPLO_2026_01_15_3_2026-06-30',
      descricao: 'Loja Exemplo', valor: 100, data: '2026-06-23', categoria: 'casa',
      previsto: false, conciliadoAutomaticamente: true,
      parcelaKey: 'LOJA EXEMPLO|2026-01-15|3', parcela_atual: 2, parcela_total: 3,
    },
    {
      id: 'seed_Loja_Exemplo_100_00_2026_07',
      descricao: 'Loja Exemplo (parcela prevista)', valor: 100, data: '2026-07-01',
      categoria: 'casa', previsto: true, origemManual: true, grupo_parcela: 'g_1',
      parcelaKey: 'LOJA EXEMPLO|2026-01-15|3', parcela_atual: 3, parcela_total: 3,
    },
  ],
  categories: [
    { id: 'alimentacao', nome: 'Alimentação', cor: '#8a6d3b' },
    { id: 'casa', nome: 'Casa', cor: '#31708f' },
    { id: 'a_classificar', nome: 'A Classificar', cor: '#999999' },
  ],
  faturas: [
    {
      vencimento: '2026-06-30', dataCorte: '2026-06-23', arquivo: 'fatura.pdf',
      importedAt: 1750000000000,
      rows: [
        { tipo: 'despesa', data: '2026-06-10', descricao: 'Padaria', valor: 23.5, vencimento: '2026-06-30' },
        { tipo: 'parcelamento', data: '2026-01-15', descricao: 'Loja Exemplo', valor: 100, vencimento: '2026-06-30', parcela_atual: 2, parcela_total: 3 },
      ],
    },
  ],
  meta: [{ key: 'lastBackupAt', value: 1750000000000 }],
};
```

- [ ] **Step 2: Escrever os testes que falham**

Crie `tests/migration.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { STORES, DB_NAME, DB_VERSION, migrateV1ToV2 } from '../src/core/db-schema.js';
import { LEGACY_V1 } from './fixtures/legacy-v1.js';

const OPC = { cartaoTitularId: 'acc_cartao_1', formaCreditoId: 'pm_credito' };

describe('db-schema: stores', () => {
  it('declara os sete stores da v2', () => {
    assertDeepEqual(
      STORES.map((s) => s.nome).sort(),
      ['accounts', 'categories', 'classificationRules', 'meta', 'paymentMethods', 'statements', 'transactions'].sort()
    );
  });

  it('usa banco próprio, distinto do app anterior', () => {
    assertEqual(DB_NAME, 'financas');
    assertEqual(DB_VERSION, 2);
  });

  it('transactions tem índices por data, parcelaKey e conta', () => {
    const t = STORES.find((s) => s.nome === 'transactions');
    assertDeepEqual(t.indices.map((i) => i.nome).sort(), ['by_contaId', 'by_data', 'by_parcelaKey']);
  });
});

describe('db-schema: migração v1 para v2', () => {
  it('converte todo expense em transaction de despesa', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(transactions.length, 3);
    assert(transactions.every((t) => t.natureza === 'despesa'));
    assert(transactions.every((t) => t.formaPagamentoId === 'pm_credito'));
    assert(transactions.every((t) => t.contaId === 'acc_cartao_1'));
    assert(transactions.every((t) => t.origem === 'manual'));
  });

  it('preserva os ids literalmente', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    assertDeepEqual(
      transactions.map((t) => t.id).sort(),
      ['e_1', 'confirmed_LOJA_EXEMPLO_2026_01_15_3_2026-06-30', 'seed_Loja_Exemplo_100_00_2026_07'].sort()
    );
  });

  // É exatamente o que o backup .xlsx perdia. Se este teste passar a falhar,
  // a cadeia de parcelas do usuário quebra na primeira fatura importada.
  it('preserva a metainformação de parcela que o backup xlsx descartava', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    const confirmada = transactions.find((t) => t.id.startsWith('confirmed_'));
    assertEqual(confirmada.parcela_atual, 2);
    assertEqual(confirmada.parcela_total, 3);
    assertEqual(confirmada.conciliadoAutomaticamente, true);
    assertEqual(confirmada.parcelaKey, 'LOJA EXEMPLO|2026-01-15|3');

    const prevista = transactions.find((t) => t.id.startsWith('seed_'));
    assertEqual(prevista.previsto, true);
    assertEqual(prevista.origemManual, true);
    assertEqual(prevista.grupo_parcela, 'g_1');
  });

  it('converte fatura em statement do cartão titular', () => {
    const { statements } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(statements.length, 1);
    const s = statements[0];
    assertEqual(s.id, 'acc_cartao_1|fatura|2026-06-30');
    assertEqual(s.tipo, 'fatura');
    assertEqual(s.contaId, 'acc_cartao_1');
    assertEqual(s.vencimento, '2026-06-30');
    assertEqual(s.dataCorte, '2026-06-23');
    assertEqual(s.rows.length, 2);
  });

  it('copia categorias e meta sem alterar', () => {
    const { categories, meta } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(categories.length, 3);
    assert(categories.some((c) => c.id === 'a_classificar'));
    assert(meta.some((m) => m.key === 'lastBackupAt'));
  });

  it('é idempotente: rodar duas vezes produz o mesmo resultado', () => {
    const a = migrateV1ToV2(LEGACY_V1, OPC);
    const b = migrateV1ToV2(LEGACY_V1, OPC);
    assertDeepEqual(a.transactions, b.transactions);
    assertDeepEqual(a.statements, b.statements);
  });

  it('não modifica o objeto de entrada', () => {
    const antes = JSON.stringify(LEGACY_V1);
    migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(JSON.stringify(LEGACY_V1), antes);
  });

  it('avisa quando o legado vem sem faturas (caso do backup xlsx parcial)', () => {
    const { avisos, statements } = migrateV1ToV2({ ...LEGACY_V1, faturas: [] }, OPC);
    assertEqual(statements.length, 0);
    assert(avisos.some((a) => a.toLowerCase().includes('fatura')));
  });

  it('trata previsto gravado como numero, que e como o app anterior grava', () => {
    const legado = { expenses: [
      { id: 'p1', descricao: 'A', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 1 },
      { id: 'p0', descricao: 'B', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 0 },
      { id: 'pt', descricao: 'C', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: true },
    ] };
    const porId = new Map(migrateV1ToV2(legado, OPC).transactions.map((t) => [t.id, t]));
    assertEqual(porId.get('p1').previsto, true);
    assertEqual(porId.get('p0').previsto, false);
    assertEqual(porId.get('pt').previsto, true);
  });

  it('nao deixa duas faturas sem vencimento colidirem no mesmo id', () => {
    const legado = { expenses: [], faturas: [
      { arquivo: 'fatura-A.pdf', rows: [{ valor: 1 }] },
      { arquivo: 'fatura-B.pdf', rows: [{ valor: 2 }, { valor: 3 }] },
    ] };
    const { statements, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(statements.length, 2);
    assert(statements[0].id !== statements[1].id);
    assertEqual(statements[0].vencimento, null);
    assertEqual(avisos.filter((a) => /vencimento/i.test(a)).length, 2);
  });

  it('preserva campo desconhecido do app anterior em vez de descarta-lo', () => {
    const legado = { expenses: [
      { id: 'x', descricao: 'A', valor: 10, data: '2026-06-01', categoria: 'casa', observacao: 'nota do usuario' },
    ] };
    assertEqual(migrateV1ToV2(legado, OPC).transactions[0].observacao, 'nota do usuario');
  });

  it('le valor em string e normaliza negativo, mas descarta ilegivel com aviso', () => {
    const legado = { expenses: [
      { id: 's', descricao: 'A', valor: '23.50', data: '2026-06-01', categoria: 'casa' },
      { id: 'n', descricao: 'B', valor: -50, data: '2026-06-01', categoria: 'casa' },
      { id: 'z', descricao: 'C', valor: 'abc', data: '2026-06-01', categoria: 'casa' },
    ] };
    const { transactions, avisos } = migrateV1ToV2(legado, OPC);
    const porId = new Map(transactions.map((t) => [t.id, t]));
    assertEqual(porId.get('s').valor, 23.5);
    assertEqual(porId.get('n').valor, 50);
    assertEqual(porId.has('z'), false);
    assert(avisos.some((a) => a.includes('"z"')));
  });

  it('tolera legado vazio', () => {
    const r = migrateV1ToV2({}, OPC);
    assertDeepEqual(r.transactions, []);
    assertDeepEqual(r.statements, []);
  });

  it('descarta expense sem data válida, avisando', () => {
    const legado = { ...LEGACY_V1, expenses: [{ id: 'x', descricao: 'sem data', valor: 1, data: null, categoria: 'casa' }] };
    const { transactions, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(transactions.length, 0);
    assert(avisos.some((a) => a.includes('x')));
  });
});
```

Adicione `'./migration.test.js'` a `TEST_MODULES`.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/core/db-schema.js'`.

- [ ] **Step 4: Implementar `src/core/db-schema.js`**

```js
// Descrição do schema e conversão de dados. Módulo PURO: não abre banco, não
// toca em IndexedDB. É o que permite testar a migração inteira fora do
// navegador — e a migração é onde um erro custa os dados reais do usuário.

import { isValidISO } from './dates.js';
import { round2 } from './money.js';
import { stableHash } from './ids.js';

export const DB_NAME = 'financas';
export const DB_VERSION = 2;

// Banco do app anterior, lido apenas para migrar. Mesma origem no GitHub Pages.
export const LEGACY_DB_NAME = 'livro-de-gastos';

export const STORES = [
  {
    nome: 'transactions',
    keyPath: 'id',
    indices: [
      { nome: 'by_data', keyPath: 'data', unique: false },
      { nome: 'by_parcelaKey', keyPath: 'parcelaKey', unique: false },
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
    ],
  },
  { nome: 'accounts', keyPath: 'id', indices: [] },
  { nome: 'paymentMethods', keyPath: 'id', indices: [] },
  { nome: 'categories', keyPath: 'id', indices: [] },
  {
    nome: 'statements',
    keyPath: 'id',
    indices: [
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
      { nome: 'by_tipo', keyPath: 'tipo', unique: false },
    ],
  },
  {
    nome: 'classificationRules',
    keyPath: 'id',
    indices: [{ nome: 'by_padrao', keyPath: 'padrao', unique: false }],
  },
  { nome: 'meta', keyPath: 'key', indices: [] },
];

/**
 * Converte o conteúdo do banco do app anterior no schema v2.
 *
 * Não altera a entrada e não conhece persistência: recebe arrays, devolve
 * arrays. Rodar duas vezes com a mesma entrada produz o mesmo resultado, e
 * como os ids são preservados, uma segunda gravação sobrescreve em vez de
 * duplicar.
 */
export function migrateV1ToV2(legado, opcoes) {
  const { cartaoTitularId, formaCreditoId } = opcoes;
  const expenses = (legado && legado.expenses) || [];
  const faturas = (legado && legado.faturas) || [];
  const avisos = [];

// O app anterior e o backup .xlsx gravam `previsto` ora como booleano, ora
// como 1/0. Comparar com `=== true` classificava uma parcela ainda prevista
// como despesa efetivada, e ela passava a somar no total de gastos.
function ehVerdadeiro(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1';
  }
  return false;
}

// Devolve o valor positivo, ou null se for ilegivel. Null nunca vira zero: um
// valor que o app nao entende precisa parar na frente do usuario em vez de se
// disfarcar de lancamento de R$ 0,00. Mesmo principio de parseMoneyBR.
function valorMigrado(v) {
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.abs(round2(n));
}

  const transactions = [];
  for (const e of expenses) {
    if (!isValidISO(e.data)) {
      avisos.push(`Lançamento "${e.id}" foi descartado por não ter data válida.`);
      continue;
    }
    const valor = valorMigrado(e.valor);
    if (valor === null) {
      avisos.push(`Lançamento "${e.id}" foi descartado porque o valor "${e.valor}" não pôde ser lido.`);
      continue;
    }
    const t = {
      // Espalha a origem primeiro para preservar campos que este codigo nao
      // conhece. O app anterior pode ter acumulado campos que ninguem previu
      // aqui, e descarta-los em silencio e exatamente o defeito do backup
      // .xlsx que esta funcao existe para nao repetir.
      ...e,
      id: e.id,
      data: e.data,
      descricao: e.descricao || '',
      valor,
      categoria: e.categoria || 'a_classificar',
      natureza: 'despesa',
      formaPagamentoId: formaCreditoId,
      contaId: cartaoTitularId,
      origem: 'manual',
      previsto: ehVerdadeiro(e.previsto),
    };
    transactions.push(t);
  }

  const statements = [];
  for (const f of faturas) {
    // Sem vencimento valido, duas faturas geravam o mesmo id terminado em
    // "undefined" e a segunda sobrescrevia a primeira no banco, em silencio.
    // O hash do conteudo da fatura da uma referencia estavel e distinta.
    let referencia = f.vencimento;
    if (!isValidISO(f.vencimento)) {
      referencia = 'sem-vencimento-' + stableHash([
        f.arquivo || '', f.dataCorte || '', (f.rows || []).length, f.importedAt || '',
      ]);
      avisos.push(
        `A fatura "${f.arquivo || 'sem nome'}" não tem vencimento válido e foi importada ` +
        `com uma referência gerada. Confira-a na aba Conciliação.`
      );
    }
    statements.push({
      id: `${cartaoTitularId}|fatura|${referencia}`,
      tipo: 'fatura',
      contaId: cartaoTitularId,
      adaptador: 'santander-cartao-pdf',
      arquivo: f.arquivo || '',
      importadoEm: f.importedAt || null,
      vencimento: isValidISO(f.vencimento) ? f.vencimento : null,
      dataCorte: f.dataCorte || null,
      rows: f.rows || [],
    });
  }

  if (expenses.length > 0 && faturas.length === 0) {
    avisos.push(
      'Nenhuma fatura veio na origem dos dados. Se você migrou por arquivo de backup, ' +
      'as faturas importadas não estão nele: reimporte os PDFs de fatura depois.'
    );
  }

  return {
    transactions,
    categories: ((legado && legado.categories) || []).map((c) => ({ ...c })),
    statements,
    meta: ((legado && legado.meta) || []).map((m) => ({ ...m })),
    avisos,
  };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS — os 12 testes de migração verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Adiciona schema v2 e migracao pura do banco anterior

migrateV1ToV2 nao abre banco e nao altera a entrada: recebe arrays e devolve
arrays, o que permite testar a migracao inteira fora do navegador. Preserva
parcela_atual, parcela_total, conciliadoAutomaticamente e origemManual, que
sao exatamente os campos que o backup xlsx do app anterior descartava.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `core/storage.js` e `importers/legacy-idb.js`

Camada fina sobre IndexedDB. Só ela conhece `indexedDB` — nenhum outro módulo de `core/` ou `domain/` pode importar daqui. Testes desta tarefa rodam **apenas no navegador**, via `tools/tests.html`.

**Files:**
- Create: `src/core/storage.js`, `src/importers/legacy-idb.js`
- Create: `tests/storage.browser.test.js`
- Modify: `tests/index.js`, `tools/run-tests.mjs`

**Interfaces:**
- Consumes: `core/db-schema.js` (`DB_NAME`, `DB_VERSION`, `STORES`, `LEGACY_DB_NAME`, `migrateV1ToV2`)
- Produces:
  - `storage.js`: `getAll(store)`, `get(store, key)`, `put(store, valor)`, `putMany(store, valores)`, `remove(store, key)`, `clearStore(store)`, `resetAllData()`, `getByIndex(store, indice, valor)`, `getMeta(key, fallback)`, `setMeta(key, valor)`
  - `legacy-idb.js`: `legacyDatabaseExists() -> Promise<boolean>`, `readLegacyDatabase() -> Promise<{expenses, categories, faturas, meta}>`, `importLegacyInto(opcoes) -> Promise<{transactions, statements, avisos}>`

- [ ] **Step 1: Marcar os testes de navegador para o runner do Node pular**

Os testes que dependem de IndexedDB não rodam no Node. Em vez de fingir que rodam, o runner os ignora explicitamente, pela convenção de nome `*.browser.test.js`.

Em `tests/index.js`, separe as duas listas:

```js
// Testes de lógica pura: rodam nos dois alvos.
export const TEST_MODULES = [
  './harness.test.js',
  './money.test.js',
  './dates.test.js',
  './text.test.js',
  './ids.test.js',
  './migration.test.js',
];

// Testes que dependem de IndexedDB ou DOM: só no navegador.
export const BROWSER_ONLY_MODULES = [
  './storage.browser.test.js',
];
```

Em `tools/tests.html`, importe as duas listas e carregue ambas. Em `tools/run-tests.mjs`, importe só `TEST_MODULES` e imprima ao final:

```js
import { TEST_MODULES, BROWSER_ONLY_MODULES } from '../tests/index.js';
// ... após o resumo:
console.log(`${BROWSER_ONLY_MODULES.length} módulo(s) só de navegador não rodaram aqui: abra tools/tests.html`);
```

- [ ] **Step 2: Escrever o teste de navegador**

Crie `tests/storage.browser.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import * as storage from '../src/core/storage.js';

describe('storage', () => {
  it('grava e lê um registro', async () => {
    await storage.put('categories', { id: 'teste_1', nome: 'Teste', cor: '#000' });
    const lido = await storage.get('categories', 'teste_1');
    assertEqual(lido.nome, 'Teste');
    await storage.remove('categories', 'teste_1');
    assertEqual(await storage.get('categories', 'teste_1'), undefined);
  });

  it('putMany grava em lote', async () => {
    await storage.putMany('categories', [
      { id: 'teste_a', nome: 'A', cor: '#111' },
      { id: 'teste_b', nome: 'B', cor: '#222' },
    ]);
    const todas = await storage.getAll('categories');
    assert(todas.some((c) => c.id === 'teste_a'));
    assert(todas.some((c) => c.id === 'teste_b'));
    await storage.remove('categories', 'teste_a');
    await storage.remove('categories', 'teste_b');
  });

  it('putMany ignora lista vazia, nula ou ausente sem quebrar', async () => {
    // O guard existe pelos dois ultimos casos: sem ele, .map lanca TypeError.
    await storage.putMany('categories', []);
    await storage.putMany('categories', null);
    await storage.putMany('categories', undefined);
  });

  it('busca por índice', async () => {
    await storage.put('transactions', {
      id: 'teste_t1', data: '2026-06-10', descricao: 'x', valor: 1,
      categoria: 'casa', natureza: 'despesa', contaId: 'acc_x',
    });
    const achados = await storage.getByIndex('transactions', 'by_contaId', 'acc_x');
    assertEqual(achados.length, 1);
    assertEqual(achados[0].id, 'teste_t1');
    await storage.remove('transactions', 'teste_t1');
  });

  it('meta guarda pares chave/valor', async () => {
    assertEqual(await storage.getMeta('inexistente', 'padrao'), 'padrao');
    await storage.setMeta('teste_meta', 42);
    assertEqual(await storage.getMeta('teste_meta'), 42);
    await storage.remove('meta', 'teste_meta');
  });
});
```

- [ ] **Step 3: Rodar no Node e confirmar que a suíte pura continua verde**

Run: `node tools/run-tests.mjs`
Expected: PASS, com a linha final avisando que 1 módulo só de navegador não rodou.

- [ ] **Step 4: Implementar `src/core/storage.js`**

Baseie-se em `../../Cartão de Credito/gastos-app/src/storage.js`, que já resolve dois problemas reais: `onblocked` com mensagem útil, e `onversionchange` fechando a conexão em vez de travar o upgrade quando outra aba atualiza o schema. Mantenha os dois. A diferença é que os stores agora vêm de `STORES`, não são criados um a um à mão.

```js
// Única porta de entrada do IndexedDB. Nenhum módulo de domain/ importa daqui.

import { DB_NAME, DB_VERSION, STORES } from './db-schema.js';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      for (const def of STORES) {
        const store = db.objectStoreNames.contains(def.nome)
          ? tx.objectStore(def.nome)
          : db.createObjectStore(def.nome, { keyPath: def.keyPath });
        for (const idx of def.indices) {
          if (!store.indexNames.contains(idx.nome)) {
            store.createIndex(idx.nome, idx.keyPath, { unique: idx.unique });
          }
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Se outra aba subir o schema, fechamos esta conexão em vez de travar o
      // upgrade indefinidamente — problema clássico de IndexedDB multi-aba.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(
      'Abertura do banco bloqueada por outra aba deste app. Feche as outras abas e recarregue.'
    ));
  });
  // Uma abertura que falhou nao pode ficar cacheada: sem isso, toda chamada
  // seguinte rejeitava com o mesmo erro ate a pagina ser recarregada, e fechar
  // a aba que bloqueava - que e o que a propria mensagem manda fazer - nao
  // adiantava nada. O catch cria so um ramo derivado para limpar o cache; o
  // return devolve a promessa original, para quem chamou receber a rejeicao.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function store(db, nome, modo) {
  let tx;
  try {
    tx = modo === 'readwrite'
      ? db.transaction(nome, modo, { durability: 'strict' })
      : db.transaction(nome, modo);
  } catch (e) {
    // Motores antigos rejeitam a assinatura de 3 argumentos.
    tx = db.transaction(nome, modo);
  }
  return tx.objectStore(nome);
}

function promessa(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(nome) {
  return promessa(store(await openDB(), nome, 'readonly').getAll());
}

export async function get(nome, key) {
  return promessa(store(await openDB(), nome, 'readonly').get(key));
}

export async function put(nome, valor) {
  return promessa(store(await openDB(), nome, 'readwrite').put(valor));
}

export async function putMany(nome, valores) {
  if (!valores || !valores.length) return;
  const s = store(await openDB(), nome, 'readwrite');
  await Promise.all(valores.map((v) => promessa(s.put(v))));
}

export async function remove(nome, key) {
  return promessa(store(await openDB(), nome, 'readwrite').delete(key));
}

export async function clearStore(nome) {
  return promessa(store(await openDB(), nome, 'readwrite').clear());
}

export async function resetAllData() {
  for (const def of STORES) await clearStore(def.nome);
}

export async function getByIndex(nome, indice, valor) {
  const s = store(await openDB(), nome, 'readonly');
  return promessa(s.index(indice).getAll(valor));
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}
```

- [ ] **Step 5: Implementar `src/importers/legacy-idb.js`**

O ponto delicado: abrir o banco antigo **sem informar versão**. `indexedDB.open(nome)` sem segundo argumento conecta na versão existente sem disparar `onupgradeneeded`, então lemos sem alterar nada. Se o banco não existir, essa chamada o *criaria* vazio — por isso `legacyDatabaseExists()` consulta `indexedDB.databases()` antes, e há um segundo guarda checando se os stores esperados existem.

```js
// Leitura do banco do app anterior (livro-de-gastos). Os dois apps ficam sob a
// mesma origem no GitHub Pages, e IndexedDB é isolado por origem e não por
// caminho — então este banco é visível aqui.
//
// Esta leitura NUNCA escreve no banco antigo: o app anterior segue íntegro e
// utilizável como retaguarda durante a transição.

import { LEGACY_DB_NAME, migrateV1ToV2 } from '../core/db-schema.js';
import * as storage from '../core/storage.js';

const STORES_LEGADO = ['expenses', 'categories', 'faturas', 'meta'];

export async function legacyDatabaseExists() {
  if (!indexedDB.databases) return false; // Firefox antigo: trate como ausente.
  try {
    const bancos = await indexedDB.databases();
    return bancos.some((b) => b.name === LEGACY_DB_NAME);
  } catch (e) {
    return false;
  }
}

function abrirSomenteLeitura() {
  return new Promise((resolve, reject) => {
    // Sem número de versão: conecta na versão atual sem disparar upgrade.
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      // Só acontece se o banco não existia. Abortamos para não deixar um banco
      // vazio para trás.
      req.transaction.abort();
      reject(new Error('O banco do app anterior não existe nesta origem.'));
    };
  });
}

export async function readLegacyDatabase() {
  const db = await abrirSomenteLeitura();
  try {
    const faltando = STORES_LEGADO.filter((n) => !db.objectStoreNames.contains(n));
    if (faltando.length === STORES_LEGADO.length) {
      throw new Error('O banco encontrado não tem o formato do app anterior.');
    }
    const resultado = {};
    for (const nome of STORES_LEGADO) {
      resultado[nome] = db.objectStoreNames.contains(nome)
        ? await new Promise((resolve, reject) => {
            const req = db.transaction(nome, 'readonly').objectStore(nome).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          })
        : [];
    }
    return resultado;
  } finally {
    db.close();
  }
}

export async function importLegacyInto(opcoes) {
  const legado = await readLegacyDatabase();
  const { transactions, categories, statements, meta, avisos } = migrateV1ToV2(legado, opcoes);
  // Ordem deliberada: categorias antes de transactions, para que nenhum
  // lançamento fique apontando para uma categoria que ainda não existe se a
  // gravação for interrompida no meio.
  await storage.putMany('categories', categories);
  await storage.putMany('transactions', transactions);
  await storage.putMany('statements', statements);
  await storage.putMany('meta', meta);
  return { transactions, statements, avisos };
}
```

- [ ] **Step 6: Verificar no navegador**

```bash
python -m http.server 8000
```

Abra `http://localhost:8000/tools/tests.html`.
Expected: todos os testes verdes, incluindo os 5 de `storage`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Adiciona camada de persistencia e leitura do banco anterior

storage.js e o unico modulo que conhece IndexedDB, e cria os stores a partir
de STORES em vez de um a um. legacy-idb.js abre o banco do app anterior sem
informar versao, o que conecta na versao existente sem disparar upgrade: le
sem alterar, e o app anterior segue utilizavel como retaguarda.

Testes que dependem de IndexedDB ficam em *.browser.test.js e sao pulados
explicitamente pelo runner do Node, em vez de fingir que rodaram.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `domain/categories.js`

Padrão que as três tarefas de domínio seguintes repetem: **regras puras exportadas separadamente da persistência**. As funções puras (validação, seed, derivações) não importam `storage.js` e são testadas no Node; as funções `list*`/`save*`/`remove*` são invólucros finos que só chamam `storage`.

**Files:**
- Create: `src/domain/categories.js`
- Create: `tests/categories.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/ids.js` (`uid`), `core/storage.js` (só nas funções de persistência)
- Produces:
  - `CATEGORIA_A_CLASSIFICAR = 'a_classificar'`
  - `PALETA` — array de cores hex
  - `DEFAULT_CATEGORIES` — array de `{ id, nome, cor }`
  - `validateCategoria(cat, todas) -> string[]`
  - `garantirAClassificar(todas) -> Categoria[]` (devolve a lista com a categoria fixa presente)
  - `novaCategoria(nome, cor, todas) -> Categoria`
  - `listCategorias()`, `saveCategoria(c)`, `removeCategoria(id)`, `seedCategoriasIfEmpty()`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/categories.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import {
  CATEGORIA_A_CLASSIFICAR, DEFAULT_CATEGORIES,
  validateCategoria, garantirAClassificar, novaCategoria,
} from '../src/domain/categories.js';

describe('categories', () => {
  it('o seed inclui a categoria fixa de id a_classificar', () => {
    assert(DEFAULT_CATEGORIES.some((c) => c.id === CATEGORIA_A_CLASSIFICAR));
  });

  it('o seed inclui tarifas e impostos bancários', () => {
    assert(DEFAULT_CATEGORIES.some((c) => /tarifa/i.test(c.nome)));
  });

  it('o seed não repete ids nem nomes', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    const nomes = DEFAULT_CATEGORIES.map((c) => c.nome.toLowerCase());
    assertEqual(new Set(ids).size, ids.length);
    assertEqual(new Set(nomes).size, nomes.length);
  });

  it('rejeita nome vazio', () => {
    const erros = validateCategoria({ id: 'x', nome: '  ' }, []);
    assert(erros.length > 0);
  });

  it('rejeita nome repetido, ignorando caixa e espaço', () => {
    const todas = [{ id: 'casa', nome: 'Casa' }];
    assert(validateCategoria({ id: 'nova', nome: ' casa ' }, todas).length > 0);
    // Editar a própria categoria com o mesmo nome é válido.
    assertEqual(validateCategoria({ id: 'casa', nome: 'Casa' }, todas).length, 0);
  });

  it('garantirAClassificar acrescenta a categoria fixa quando falta', () => {
    const resultado = garantirAClassificar([{ id: 'casa', nome: 'Casa', cor: '#111' }]);
    assert(resultado.some((c) => c.id === CATEGORIA_A_CLASSIFICAR));
    assertEqual(resultado.length, 2);
  });

  it('garantirAClassificar não duplica quando já existe', () => {
    const entrada = [{ id: CATEGORIA_A_CLASSIFICAR, nome: 'Outro nome', cor: '#111' }];
    const resultado = garantirAClassificar(entrada);
    assertEqual(resultado.length, 1);
    // Respeita o rename feito pelo usuário: só o id é contrato, o nome não.
    assertEqual(resultado[0].nome, 'Outro nome');
  });

  it('novaCategoria gera id único e escolhe cor da paleta', () => {
    const c = novaCategoria('Pets', null, []);
    assert(c.id.startsWith('cat_'));
    assert(/^#[0-9a-f]{6}$/i.test(c.cor));
  });
});
```

Adicione `'./categories.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/domain/categories.js'`.

- [ ] **Step 3: Implementar `src/domain/categories.js`**

```js
// Regras de categoria. A parte pura não importa storage e é testada no Node;
// as funções de persistência são invólucros finos no fim do arquivo.

import { uid } from '../core/ids.js';
import * as storage from '../core/storage.js';

// Id fixo, contrato do sistema. É buscado SEMPRE por id, nunca por nome: o
// usuário pode renomear a categoria à vontade sem quebrar nada.
export const CATEGORIA_A_CLASSIFICAR = 'a_classificar';

export const PALETA = [
  '#8a6d3b', '#31708f', '#3c763d', '#a94442', '#6f5499',
  '#00695c', '#bf6516', '#5d4037', '#455a64', '#827717',
];

export const DEFAULT_CATEGORIES = [
  { id: 'alimentacao', nome: 'Alimentação', cor: PALETA[0] },
  { id: 'moradia', nome: 'Moradia', cor: PALETA[1] },
  { id: 'transporte', nome: 'Transporte', cor: PALETA[2] },
  { id: 'saude', nome: 'Saúde', cor: PALETA[3] },
  { id: 'lazer', nome: 'Lazer', cor: PALETA[4] },
  { id: 'educacao', nome: 'Educação', cor: PALETA[5] },
  { id: 'servicos', nome: 'Serviços e assinaturas', cor: PALETA[6] },
  { id: 'tarifas_bancarias', nome: 'Tarifas e impostos bancários', cor: PALETA[7] },
  { id: 'outros', nome: 'Outros', cor: PALETA[8] },
  { id: CATEGORIA_A_CLASSIFICAR, nome: 'A Classificar', cor: PALETA[9] },
];

export function validateCategoria(cat, todas) {
  const erros = [];
  if (!cat || typeof cat !== 'object') return ['Categoria inválida.'];
  const nome = String(cat.nome || '').trim();
  if (!nome) erros.push('O nome da categoria não pode ficar em branco.');
  const repetida = (todas || []).some(
    (c) => c.id !== cat.id && String(c.nome || '').trim().toLowerCase() === nome.toLowerCase()
  );
  if (repetida) erros.push(`Já existe uma categoria chamada "${nome}".`);
  return erros;
}

export function garantirAClassificar(todas) {
  const lista = [...(todas || [])];
  if (!lista.some((c) => c.id === CATEGORIA_A_CLASSIFICAR)) {
    // Copia em vez de empurrar o objeto do proprio DEFAULT_CATEGORIES: as telas
    // recebem esta lista e podem editar um item no lugar, e isso vazaria para a
    // constante do modulo, contaminando todo seed seguinte da sessao.
    lista.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === CATEGORIA_A_CLASSIFICAR) });
  }
  return lista;
}

export function novaCategoria(nome, cor, todas) {
  const lista = todas || [];
  const usadas = new Set(lista.map((c) => c.cor));
  // Primeira cor livre da paleta, em vez de indexar pelo tamanho da lista: sem
  // isso, duas chamadas seguidas sobre a mesma lista devolviam a mesma cor.
  const corLivre = PALETA.find((c) => !usadas.has(c)) || PALETA[lista.length % PALETA.length];
  return {
    id: uid('cat'),
    nome: String(nome || '').trim(),
    cor: cor || corLivre,
  };
}

// --- Persistência ---

export async function listCategorias() {
  return garantirAClassificar(await storage.getAll('categories'));
}

export async function saveCategoria(c) {
  return storage.put('categories', c);
}

export async function removeCategoria(id) {
  if (id === CATEGORIA_A_CLASSIFICAR) {
    throw new Error('A categoria "A Classificar" não pode ser excluída: ela é o destino de tudo que ainda não foi classificado.');
  }
  return storage.remove('categories', id);
}

export async function seedCategoriasIfEmpty() {
  const existentes = await storage.getAll('categories');
  if (existentes.length) {
    // Instalação antiga sem a categoria fixa: acrescenta sem tocar no resto.
    if (!existentes.some((c) => c.id === CATEGORIA_A_CLASSIFICAR)) {
      await storage.put('categories', { ...DEFAULT_CATEGORIES.find((c) => c.id === CATEGORIA_A_CLASSIFICAR) });
    }
    return false;
  }
  await storage.putMany('categories', DEFAULT_CATEGORIES);
  return true;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona regras de categoria com seed e categoria fixa A Classificar

A categoria a_classificar e localizada sempre por id, nunca por nome, para
sobreviver a rename do usuario. Nao pode ser excluida porque e o destino de
tudo que ainda nao foi classificado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `domain/accounts.js` — contas, cartões, titular e adicional

Leia a seção 5.1.1 do spec: uma fatura cobre mais de um plástico, o adicional é marcado com `@` no PDF, e o banco debita um valor consolidado na conta do titular.

**Files:**
- Create: `src/domain/accounts.js`
- Create: `tests/accounts.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/ids.js` (`uid`), `core/text.js` (`normalizeDescricao`), `core/storage.js`
- Produces:
  - `TIPO_CONTA = 'conta'`, `TIPO_CARTAO = 'cartao'`
  - `validateAccount(acc, todas) -> string[]`
  - `suggestMatchers(acc) -> string[]`
  - `isAdicional(acc) -> boolean`
  - `plasticosDoTitular(titularId, todas) -> string[]` (inclui o próprio titular)
  - `contaPagadoraEfetiva(acc, todas) -> string|null`
  - `contaQueCasaDescricao(descricao, todas) -> Account|null`
  - `novaConta(dados) -> Account`, `novoCartao(dados) -> Account`
  - `listAccounts()`, `saveAccount(a)`, `removeAccount(id)`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/accounts.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  TIPO_CONTA, TIPO_CARTAO, validateAccount, suggestMatchers, isAdicional,
  plasticosDoTitular, contaPagadoraEfetiva, contaQueCasaDescricao, novaConta, novoCartao,
} from '../src/domain/accounts.js';

const CONTA = { id: 'acc_cc', tipo: TIPO_CONTA, nome: 'Conta Corrente', instituicao: 'Banco X', agencia: '0001', numero: '12345-6' };
const TITULAR = { id: 'acc_t', tipo: TIPO_CARTAO, nome: 'Cartão Titular', instituicao: 'Banco X', bandeira: 'visa', final: '1111', diaVencimento: 30, contaPagadoraId: 'acc_cc', matchers: ['FINAL 1111'] };
const ADICIONAL = { id: 'acc_a', tipo: TIPO_CARTAO, nome: 'Cartão Adicional', instituicao: 'Banco X', bandeira: 'visa', final: '2222', cartaoPaiId: 'acc_t' };
const TODAS = [CONTA, TITULAR, ADICIONAL];

describe('accounts: validação', () => {
  it('exige nome', () => {
    assert(validateAccount({ ...CONTA, id: 'novo', nome: '' }, TODAS).length > 0);
  });

  it('exige final de 4 dígitos em cartão', () => {
    assert(validateAccount({ ...TITULAR, id: 'novo', final: '11' }, TODAS).length > 0);
    assert(validateAccount({ ...TITULAR, id: 'novo', final: 'abcd' }, TODAS).length > 0);
  });

  it('exige agência e número em conta', () => {
    assert(validateAccount({ ...CONTA, id: 'novo', agencia: '' }, TODAS).length > 0);
  });

  it('rejeita cartão adicional que aponta para outro adicional', () => {
    const erros = validateAccount({ ...ADICIONAL, id: 'novo', cartaoPaiId: 'acc_a' }, TODAS);
    assert(erros.some((e) => /adicional/i.test(e)));
  });

  it('rejeita cartão que aponta para si mesmo como pai', () => {
    assert(validateAccount({ ...ADICIONAL, cartaoPaiId: 'acc_a' }, TODAS).length > 0);
  });

  it('rejeita conta pagadora que não é conta', () => {
    const erros = validateAccount({ ...TITULAR, id: 'novo', contaPagadoraId: 'acc_a' }, TODAS);
    assert(erros.some((e) => /conta/i.test(e)));
  });

  it('aceita cadastros válidos', () => {
    assertEqual(validateAccount(CONTA, TODAS).length, 0);
    assertEqual(validateAccount(TITULAR, TODAS).length, 0);
    assertEqual(validateAccount(ADICIONAL, TODAS).length, 0);
  });
});

describe('accounts: titular e adicional', () => {
  it('reconhece o adicional pelo cartaoPaiId', () => {
    assert(isAdicional(ADICIONAL));
    assert(!isAdicional(TITULAR));
    assert(!isAdicional(CONTA));
  });

  it('lista todos os plásticos de um titular, incluindo ele mesmo', () => {
    assertDeepEqual(plasticosDoTitular('acc_t', TODAS).sort(), ['acc_a', 'acc_t']);
  });

  // O adicional não tem conta pagadora própria: quem paga é a do titular.
  it('resolve a conta pagadora do adicional pela do titular', () => {
    assertEqual(contaPagadoraEfetiva(ADICIONAL, TODAS), 'acc_cc');
    assertEqual(contaPagadoraEfetiva(TITULAR, TODAS), 'acc_cc');
    assertEqual(contaPagadoraEfetiva(CONTA, TODAS), null);
  });
});

describe('accounts: matchers', () => {
  it('sugere matcher a partir de bandeira e final', () => {
    const s = suggestMatchers({ tipo: TIPO_CARTAO, bandeira: 'master', final: '7777' });
    assert(s.some((m) => m.includes('7777')));
  });

  it('não sugere matcher para conta corrente', () => {
    assertDeepEqual(suggestMatchers(CONTA), []);
  });

  it('encontra o cartão cujo matcher aparece na descrição do extrato', () => {
    const achado = contaQueCasaDescricao('DEBITO AUT.  FATURA CARTAO VISA    FINAL 1111', TODAS);
    assertEqual(achado.id, 'acc_t');
  });

  it('devolve null quando nenhum matcher casa', () => {
    assertEqual(contaQueCasaDescricao('PIX ENVIADO  Alguem', TODAS), null);
  });
});

describe('accounts: construtores', () => {
  it('novaConta e novoCartao geram id com prefixo próprio', () => {
    assert(novaConta({ nome: 'X' }).id.startsWith('acc_'));
    assertEqual(novoCartao({ nome: 'Y', final: '3333' }).tipo, TIPO_CARTAO);
  });
});
```

Adicione `'./accounts.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/domain/accounts.js'`.

- [ ] **Step 3: Implementar `src/domain/accounts.js`**

```js
// Contas correntes e cartões. Um cartão adicional aponta para o titular por
// cartaoPaiId: a fatura e o débito em conta pertencem ao titular, mas cada
// gasto guarda de qual plástico saiu (ver spec 5.1.1).

import { uid } from '../core/ids.js';
import { normalizeDescricao } from '../core/text.js';
import * as storage from '../core/storage.js';

export const TIPO_CONTA = 'conta';
export const TIPO_CARTAO = 'cartao';

export function isAdicional(acc) {
  return acc.tipo === TIPO_CARTAO && !!acc.cartaoPaiId;
}

export function validateAccount(acc, todas) {
  const erros = [];
  const outras = (todas || []).filter((a) => a.id !== acc.id);

  if (!String(acc.nome || '').trim()) erros.push('O nome não pode ficar em branco.');
  if (acc.tipo !== TIPO_CONTA && acc.tipo !== TIPO_CARTAO) erros.push('Tipo inválido.');

  if (acc.tipo === TIPO_CONTA) {
    if (!String(acc.agencia || '').trim()) erros.push('Informe a agência.');
    if (!String(acc.numero || '').trim()) erros.push('Informe o número da conta.');
  }

  if (acc.tipo === TIPO_CARTAO) {
    if (!/^\d{4}$/.test(String(acc.final || ''))) {
      erros.push('O final do cartão deve ter exatamente 4 dígitos.');
    }
    if (acc.cartaoPaiId) {
      if (acc.cartaoPaiId === acc.id) {
        erros.push('Um cartão não pode ser adicional de si mesmo.');
      } else {
        const pai = outras.find((a) => a.id === acc.cartaoPaiId);
        if (!pai) erros.push('O cartão titular informado não existe.');
        else if (pai.tipo !== TIPO_CARTAO) erros.push('O titular de um adicional precisa ser um cartão.');
        else if (isAdicional(pai)) erros.push('Um cartão adicional não pode ser titular de outro adicional.');
      }
    }
    if (acc.cartaoPaiId && acc.contaPagadoraId) {
      erros.push('Um cartão adicional não tem conta pagadora própria: quem paga é a conta do cartão titular.');
    }
    if (acc.contaPagadoraId) {
      const conta = outras.find((a) => a.id === acc.contaPagadoraId);
      if (!conta) erros.push('A conta pagadora informada não existe.');
      else if (conta.tipo !== TIPO_CONTA) erros.push('A conta pagadora precisa ser uma conta corrente.');
    }
  }

  return erros;
}

export function suggestMatchers(acc) {
  if (acc.tipo !== TIPO_CARTAO || !acc.final) return [];
  const bandeira = String(acc.bandeira || '').toUpperCase();
  const sugestoes = [`FINAL ${acc.final}`];
  if (bandeira) sugestoes.push(`${bandeira} FINAL ${acc.final}`);
  return sugestoes;
}

export function plasticosDoTitular(titularId, todas) {
  const lista = todas || [];
  // Se vier o id de um adicional, resolve para o titular antes: devolver so o
  // proprio adicional seria um resultado incompleto com cara de valido, e os
  // gastos dos irmaos ficariam de fora da conciliacao sem ninguem notar.
  const alvo = lista.find((a) => a.id === titularId);
  const raizId = alvo && alvo.cartaoPaiId ? alvo.cartaoPaiId : titularId;
  const ids = [raizId];
  for (const a of lista) if (a.cartaoPaiId === raizId) ids.push(a.id);
  return ids;
}

export function contaPagadoraEfetiva(acc, todas) {
  if (!acc || acc.tipo !== TIPO_CARTAO) return null;
  // O pai vem primeiro de proposito: um adicional nao tem conta pagadora
  // propria, e um cadastro malformado com os dois campos preenchidos nao pode
  // fazer a conciliacao confrontar o debito contra a conta errada.
  if (acc.cartaoPaiId) {
    const pai = (todas || []).find((a) => a.id === acc.cartaoPaiId);
    return pai ? pai.contaPagadoraId || null : null;
  }
  return acc.contaPagadoraId || null;
}

export function contaQueCasaDescricao(descricao, todas) {
  const alvo = normalizeDescricao(descricao);
  for (const a of todas || []) {
    for (const m of a.matchers || []) {
      if (m && casaMatcher(alvo, normalizeDescricao(m))) return a;
    }
  }
  return null;
}

// Casamento por substring, mas sem deixar um matcher terminado em digito casar
// dentro de um numero maior: sem a ancora, o matcher "FINAL 151" casava com a
// descricao de um cartao final 1511, e o pagamento iria para o cartao errado.
function casaMatcher(alvo, matcher) {
  if (!matcher) return false;
  const escapado = matcher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9])${escapado}(?![0-9])`).test(alvo);
}

export function novaConta(dados) {
  // Sem matchers: e campo de cartao, e contaQueCasaDescricao percorre matchers
  // de qualquer registro - uma conta corrente entraria na disputa a toa.
  return { id: uid('acc'), tipo: TIPO_CONTA, ativo: true, ...dados };
}

export function novoCartao(dados) {
  const base = { id: uid('acc'), tipo: TIPO_CARTAO, ativo: true, ...dados };
  return { ...base, matchers: dados.matchers || suggestMatchers(base) };
}

// --- Persistência ---

export async function listAccounts() {
  return storage.getAll('accounts');
}

export async function saveAccount(a) {
  return storage.put('accounts', a);
}

export async function removeAccount(id) {
  const todas = await listAccounts();
  const filhos = todas.filter((a) => a.cartaoPaiId === id);
  if (filhos.length) {
    throw new Error(`Não dá para excluir: existem ${filhos.length} cartão(ões) adicional(is) ligados a este. Exclua-os primeiro ou desative este cartão.`);
  }
  return storage.remove('accounts', id);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona cadastro de contas e cartoes com titular e adicional

Uma fatura Santander cobre mais de um plastico, e o banco debita um valor
consolidado na conta do titular. cartaoPaiId modela isso: o adicional herda a
conta pagadora do titular, e plasticosDoTitular da o conjunto que a
conciliacao de fatura precisa considerar junto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `domain/payment-methods.js` — formas de pagamento

O `tipo` é o que carrega comportamento; `nome` é só rótulo e o usuário pode mudar. Os `padroesExtrato` já entram no seed porque saem de graça da leitura do extrato real, e a Fase 2 os consome sem alteração de schema.

**Files:**
- Create: `src/domain/payment-methods.js`
- Create: `tests/payment-methods.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/ids.js` (`uid`), `core/text.js` (`normalizeDescricao`), `core/storage.js`
- Produces:
  - `TIPOS_FORMA` — array de strings
  - `DEFAULT_PAYMENT_METHODS` — array de `{ id, nome, tipo, conciliaCom, padroesExtrato, cor, ordem, ativo }`
  - `conciliaComDoTipo(tipo) -> 'fatura'|'extrato'|'nenhum'`
  - `validatePaymentMethod(pm, todas) -> string[]`
  - `formaPorPrefixoExtrato(descricao, todas) -> PaymentMethod|null`
  - `novaForma(dados, todas) -> PaymentMethod`
  - `listFormas()`, `saveForma(pm)`, `removeForma(id, transactions)`, `seedFormasIfEmpty()`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/payment-methods.test.js`:

```js
import { describe, it, assert, assertEqual } from './harness.js';
import {
  TIPOS_FORMA, DEFAULT_PAYMENT_METHODS, conciliaComDoTipo,
  validatePaymentMethod, formaPorPrefixoExtrato, novaForma,
} from '../src/domain/payment-methods.js';

describe('payment-methods: seed', () => {
  it('cobre as sete formas do spec', () => {
    assertEqual(DEFAULT_PAYMENT_METHODS.length, 7);
    const tipos = DEFAULT_PAYMENT_METHODS.map((p) => p.tipo);
    for (const t of TIPOS_FORMA.filter((t) => t !== 'outro')) assert(tipos.includes(t));
  });

  it('todo item do seed tem tipo válido e ordem única', () => {
    const ordens = DEFAULT_PAYMENT_METHODS.map((p) => p.ordem);
    assertEqual(new Set(ordens).size, ordens.length);
    assert(DEFAULT_PAYMENT_METHODS.every((p) => TIPOS_FORMA.includes(p.tipo)));
  });

});

describe('payment-methods: comportamento por tipo', () => {
  it('crédito concilia por fatura; débito, pix e boleto por extrato', () => {
    assertEqual(conciliaComDoTipo('credito'), 'fatura');
    assertEqual(conciliaComDoTipo('debito'), 'extrato');
    assertEqual(conciliaComDoTipo('pix'), 'extrato');
    assertEqual(conciliaComDoTipo('boleto'), 'extrato');
    assertEqual(conciliaComDoTipo('transferencia'), 'extrato');
  });

  // Dinheiro não passa por documento nenhum: nunca aparece em fatura nem extrato.
  it('dinheiro não concilia com documento algum', () => {
    assertEqual(conciliaComDoTipo('dinheiro'), 'nenhum');
    assertEqual(conciliaComDoTipo('outro'), 'nenhum');
  });
});

describe('payment-methods: validação', () => {
  const todas = [{ id: 'pm_pix', nome: 'Pix', tipo: 'pix', ordem: 1 }];

  it('exige nome e tipo válido', () => {
    assert(validatePaymentMethod({ id: 'x', nome: '', tipo: 'pix' }, todas).length > 0);
    assert(validatePaymentMethod({ id: 'x', nome: 'X', tipo: 'inexistente' }, todas).length > 0);
  });

  it('rejeita nome repetido, ignorando caixa', () => {
    assert(validatePaymentMethod({ id: 'x', nome: 'pix', tipo: 'pix' }, todas).length > 0);
    assertEqual(validatePaymentMethod({ id: 'pm_pix', nome: 'Pix', tipo: 'pix' }, todas).length, 0);
  });
});

describe('payment-methods: inferência pelo extrato', () => {
  const todas = DEFAULT_PAYMENT_METHODS;

  it('infere a forma pelo prefixo da descrição do extrato', () => {
    assertEqual(formaPorPrefixoExtrato('PIX ENVIADO                 Fulano', todas).tipo, 'pix');
    assertEqual(formaPorPrefixoExtrato('PAGAMENTO DE BOLETO OUTROS BANCOS  Empresa', todas).tipo, 'boleto');
    assertEqual(formaPorPrefixoExtrato('TED RECEBIDA                Empresa', todas).tipo, 'transferencia');
  });

  it('devolve null quando nenhum prefixo casa', () => {
    assertEqual(formaPorPrefixoExtrato('ALGO QUE NAO EXISTE', todas), null);
  });

  it('escolhe o prefixo mais especifico quando dois casam', () => {
    // 'DEBITO AUT.' (debito) e 'DEBITO AUT. FATURA' (credito) casam os dois.
    // Vence o mais longo, senao o pagamento da fatura vira debito comum.
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT.  FATURA CARTAO VISA    FINAL 0000', todas).tipo, 'credito');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', todas).tipo, 'credito');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. CTA ENERGIA ELETRICA   Concessionaria', todas).tipo, 'debito');
  });

  it('o prefixo mais longo vence independente da ordem do array', () => {
    const curta = { id: 'a', nome: 'Curta', tipo: 'debito', padroesExtrato: ['DEBITO AUT.'] };
    const longa = { id: 'b', nome: 'Longa', tipo: 'credito', padroesExtrato: ['DEBITO AUT. FATURA'] };
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FATURA X', [curta, longa]).id, 'b');
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. FATURA X', [longa, curta]).id, 'b');
  });

  it('forma desativada nao classifica', () => {
    const inativa = { id: 'i', nome: 'Inativa', tipo: 'debito', ativo: false, padroesExtrato: ['DEBITO AUT.'] };
    assertEqual(formaPorPrefixoExtrato('DEBITO AUT. ALGO', [inativa]), null);
  });

  it('so casa no comeco da linha', () => {
    assertEqual(formaPorPrefixoExtrato('PAGTO REF PIX ENVIADO', todas), null);
  });

  it('tipo desconhecido nao concilia com nada', () => {
    assertEqual(conciliaComDoTipo('inventado'), 'nenhum');
    assertEqual(conciliaComDoTipo(undefined), 'nenhum');
  });

  it('recusa excluir forma em uso, dizendo quantos lancamentos usam', async () => {
    const transacoes = [
      { id: 't1', formaPagamentoId: 'pm_pix' },
      { id: 't2', formaPagamentoId: 'pm_pix' },
      { id: 't3', formaPagamentoId: 'pm_boleto' },
    ];
    let erro = null;
    try { await removeForma('pm_pix', transacoes); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria ter recusado');
    assert(erro.message.includes('2'), `mensagem nao diz quantos: ${erro.message}`);
    assert(/desative/i.test(erro.message), 'mensagem nao oferece a saida de desativar');
  });
});

describe('payment-methods: construtor', () => {
  it('novaForma deriva conciliaCom do tipo e põe no fim da ordem', () => {
    const f = novaForma({ nome: 'Vale', tipo: 'outro' }, DEFAULT_PAYMENT_METHODS);
    assertEqual(f.conciliaCom, 'nenhum');
    assertEqual(f.ordem, DEFAULT_PAYMENT_METHODS.length + 1);
    assert(f.id.startsWith('pm_'));
  });
});
```

Adicione `'./payment-methods.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/domain/payment-methods.js'`.

- [ ] **Step 3: Implementar `src/domain/payment-methods.js`**

```js
// Formas de pagamento. O `tipo` carrega comportamento (com o que concilia, se
// gera fatura); o `nome` é só rótulo e o usuário pode renomear à vontade.

import { uid } from '../core/ids.js';
import { normalizeDescricao } from '../core/text.js';
import * as storage from '../core/storage.js';

export const TIPOS_FORMA = ['credito', 'debito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'outro'];

const CONCILIA_POR_TIPO = {
  credito: 'fatura',
  debito: 'extrato',
  pix: 'extrato',
  boleto: 'extrato',
  transferencia: 'extrato',
  dinheiro: 'nenhum',
  outro: 'nenhum',
};

// Tipo desconhecido cai em 'nenhum', nao em 'extrato': um typo no tipo nao pode
// fazer a forma entrar calada na conciliacao de extrato como se fosse valida.
export function conciliaComDoTipo(tipo) {
  return CONCILIA_POR_TIPO[tipo] || 'nenhum';
}

// Prefixos observados no extrato real, usados para inferir a forma de pagamento
// de uma linha importada. Sem número de conta nem nome de pessoa: são rótulos
// do próprio banco.
export const DEFAULT_PAYMENT_METHODS = [
  { id: 'pm_credito', nome: 'Cartão de Crédito', tipo: 'credito', ordem: 1, cor: '#31708f',
    // Prefixos mais especificos que o 'DEBITO AUT.' generico do debito: sem
    // eles, o pagamento da fatura do cartao era classificado como cartao de
    // debito, que e justamente o que a regra do prefixo mais longo existe para
    // evitar. Sao as duas grafias observadas no extrato real.
    padroesExtrato: ['DEBITO AUT. FATURA', 'DEBITO AUT. FAT.CARTAO', 'PAGAMENTO FATURA CARTAO'] },
  { id: 'pm_debito', nome: 'Cartão de Débito', tipo: 'debito', ordem: 2, cor: '#3c763d', padroesExtrato: ['COMPRA CARTAO DEBITO', 'DEBITO AUT.'] },
  { id: 'pm_pix', nome: 'Pix', tipo: 'pix', ordem: 3, cor: '#00695c', padroesExtrato: ['PIX ENVIADO', 'PIX RECEBIDO'] },
  { id: 'pm_dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', ordem: 4, cor: '#827717', padroesExtrato: [] },
  { id: 'pm_boleto', nome: 'Boleto', tipo: 'boleto', ordem: 5, cor: '#bf6516', padroesExtrato: ['PAGAMENTO DE BOLETO'] },
  { id: 'pm_transferencia', nome: 'Transferência (TED/DOC)', tipo: 'transferencia', ordem: 6, cor: '#6f5499', padroesExtrato: ['TED RECEBIDA', 'TED ENVIADA', 'DOC'] },
  { id: 'pm_outro', nome: 'Outro', tipo: 'outro', ordem: 7, cor: '#455a64', padroesExtrato: [] },
].map((p) => ({ ...p, conciliaCom: conciliaComDoTipo(p.tipo), ativo: true }));

export function validatePaymentMethod(pm, todas) {
  const erros = [];
  if (!pm || typeof pm !== 'object') return ['Forma de pagamento inválida.'];
  const nome = String(pm.nome || '').trim();
  if (!nome) erros.push('O nome da forma de pagamento não pode ficar em branco.');
  if (!TIPOS_FORMA.includes(pm.tipo)) erros.push(`Tipo inválido. Use um destes: ${TIPOS_FORMA.join(', ')}.`);
  const repetida = (todas || []).some(
    (p) => p.id !== pm.id && String(p.nome || '').trim().toLowerCase() === nome.toLowerCase()
  );
  if (repetida) erros.push(`Já existe uma forma de pagamento chamada "${nome}".`);
  return erros;
}

export function formaPorPrefixoExtrato(descricao, todas) {
  const alvo = normalizeDescricao(descricao);
  let melhor = null;
  let maiorPadrao = 0;
  for (const forma of todas || []) {
    // Forma desativada nao classifica nada: o usuario a tirou de circulacao, e
    // ela continuar capturando linhas novas do extrato contraria isso.
    if (forma.ativo === false) continue;
    for (const padrao of forma.padroesExtrato || []) {
      const p = normalizeDescricao(padrao);
      // Prefixo mais longo vence: o banco usa rótulos que são prefixo uns dos
      // outros, e o mais específico é o que descreve a operação de verdade.
      if (p && alvo.startsWith(p) && p.length > maiorPadrao) {
        melhor = forma;
        maiorPadrao = p.length;
      }
    }
  }
  return melhor;
}

export function novaForma(dados, todas) {
  const ordens = (todas || []).map((p) => p.ordem || 0);
  return {
    id: uid('pm'),
    ativo: true,
    padroesExtrato: [],
    ordem: (ordens.length ? Math.max(...ordens) : 0) + 1,
    ...dados,
    conciliaCom: conciliaComDoTipo(dados.tipo),
  };
}

// --- Persistência ---

export async function listFormas() {
  const todas = await storage.getAll('paymentMethods');
  return todas.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

export async function saveForma(pm) {
  return storage.put('paymentMethods', pm);
}

export async function removeForma(id, transactions) {
  const emUso = (transactions || []).filter((t) => t.formaPagamentoId === id).length;
  if (emUso) {
    throw new Error(`Esta forma de pagamento está em uso por ${emUso} lançamento(s). Desative-a em vez de excluir, para não perder o histórico.`);
  }
  return storage.remove('paymentMethods', id);
}

export async function seedFormasIfEmpty() {
  const existentes = await storage.getAll('paymentMethods');
  if (existentes.length) return false;
  await storage.putMany('paymentMethods', DEFAULT_PAYMENT_METHODS);
  return true;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona cadastro de formas de pagamento

O tipo carrega comportamento e o nome e so rotulo, entao renomear nao quebra
nada. formaPorPrefixoExtrato escolhe o prefixo mais longo porque os rotulos do
banco sao prefixo uns dos outros e o mais especifico descreve a operacao real.
Excluir forma em uso e bloqueado: a saida e desativar, para nao perder
historico.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `domain/transactions.js` — natureza, totais e filtros

Aqui mora a **regra de ouro** do spec: gasto é `natureza === 'despesa' && !previsto`. Todo total do app passa por `sumDespesas`. Se essa função estiver errada, o número que o usuário lê está errado.

**Files:**
- Create: `src/domain/transactions.js`
- Create: `tests/transactions.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/ids.js` (`uid`), `core/dates.js` (`isValidISO`, `monthKey`), `core/money.js` (`round2`), `core/storage.js`
- Produces:
  - `NATUREZAS = ['despesa', 'receita', 'transferencia', 'pagamento_fatura']`
  - `contaComoGasto(t) -> boolean`
  - `validateTransaction(t) -> string[]`
  - `sumDespesas(transactions) -> number`
  - `filterTransactions(transactions, filtros) -> Transaction[]`
  - `totaisPorForma(transactions) -> Map<formaPagamentoId, number>`
  - `novaTransaction(dados) -> Transaction`
  - `listTransactions()`, `saveTransaction(t)`, `saveTransactions(lista)`, `removeTransaction(id)`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/transactions.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  NATUREZAS, contaComoGasto, validateTransaction, sumDespesas,
  filterTransactions, totaisPorForma, novaTransaction,
} from '../src/domain/transactions.js';

function t(over) {
  return {
    id: 'x', data: '2026-06-10', descricao: 'Compra', valor: 10, categoria: 'casa',
    natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_cc', ...over,
  };
}

describe('transactions: o que conta como gasto', () => {
  it('despesa real conta', () => {
    assert(contaComoGasto(t()));
  });

  // Estes três são a razão de existir o campo natureza: o extrato traz todos e
  // somá-los dobraria o gasto ou inventaria gasto que não houve.
  it('receita, transferência e pagamento de fatura não contam', () => {
    assert(!contaComoGasto(t({ natureza: 'receita' })));
    assert(!contaComoGasto(t({ natureza: 'transferencia' })));
    assert(!contaComoGasto(t({ natureza: 'pagamento_fatura' })));
  });

  it('previsão não conta, mesmo sendo despesa', () => {
    assert(!contaComoGasto(t({ previsto: true })));
  });

  it('soma apenas o que conta como gasto, sem residuo de ponto flutuante', () => {
    const lista = [
      t({ id: 'a', valor: 0.1 }),
      t({ id: 'b', valor: 0.29 }),
      t({ id: 'c', valor: 23.45 }),
      t({ id: 'd', valor: 7781.06 }),
      t({ id: 'e', valor: 50, natureza: 'receita' }),
      t({ id: 'f', valor: 30, natureza: 'pagamento_fatura' }),
      t({ id: 'g', valor: 20, natureza: 'transferencia' }),
      t({ id: 'h', valor: 99, previsto: true }),
    ];
    // Sem round2 a soma nativa daria 7804.900000000001. Os valores importam:
    // 0.1 + 0.2 + 23.45 + 7781.06 soma EXATO em ponto flutuante, e um teste com
    // eles passaria mesmo sem round2 - foi preciso trocar 0.2 por 0.29.
    assertEqual(sumDespesas(lista), 7804.9);
  });

  it('cem centavos somam exatamente um real', () => {
    // Sem round2 isto daria 1.0000000000000007.
    const centavos = Array.from({ length: 100 }, (_, i) => t({ id: 'c' + i, valor: 0.01 }));
    assertEqual(sumDespesas(centavos), 1);
  });

  it('um valor ilegivel nao contamina o total', () => {
    const lista = [t({ id: 'a', valor: 10 }), t({ id: 'b', valor: 'abc' }), t({ id: 'c', valor: 5 })];
    // Perder um registro e ruim; zerar o mes inteiro em silencio e pior.
    assertEqual(sumDespesas(lista), 15);
  });

  it('soma de lista vazia é zero', () => {
    assertEqual(sumDespesas([]), 0);
  });
});

describe('transactions: validação', () => {
  it('aceita lançamento completo', () => {
    assertEqual(validateTransaction(t()).length, 0);
  });

  it('exige descrição, data ISO válida e categoria', () => {
    assert(validateTransaction(t({ descricao: '' })).length > 0);
    assert(validateTransaction(t({ data: '10/06/2026' })).length > 0);
    assert(validateTransaction(t({ categoria: '' })).length > 0);
  });

  it('exige forma de pagamento', () => {
    assert(validateTransaction(t({ formaPagamentoId: null })).length > 0);
  });

  it('rejeita natureza desconhecida', () => {
    assert(validateTransaction(t({ natureza: 'inventada' })).length > 0);
  });

  it('rejeita valor zero ou negativo: o sentido vem da natureza', () => {
    assert(validateTransaction(t({ valor: 0 })).length > 0);
    assert(validateTransaction(t({ valor: -10 })).length > 0);
  });
});

describe('transactions: filtros', () => {
  const lista = [
    t({ id: 'a', data: '2026-05-10', formaPagamentoId: 'pm_pix', contaId: 'acc_1', categoria: 'casa' }),
    t({ id: 'b', data: '2026-06-10', formaPagamentoId: 'pm_credito', contaId: 'acc_2', categoria: 'lazer' }),
    t({ id: 'c', data: '2026-06-20', formaPagamentoId: 'pm_pix', contaId: 'acc_2', categoria: 'casa', classificadoAutomaticamente: true }),
  ];

  it('sem filtro devolve tudo', () => {
    assertEqual(filterTransactions(lista, {}).length, 3);
  });

  it('filtra por mês', () => {
    assertDeepEqual(filterTransactions(lista, { mes: '2026-06' }).map((x) => x.id), ['b', 'c']);
  });

  it('filtra por ano', () => {
    assertEqual(filterTransactions(lista, { ano: '2026' }).length, 3);
    assertEqual(filterTransactions(lista, { ano: '2025' }).length, 0);
  });

  it('filtra por várias formas de pagamento ao mesmo tempo', () => {
    assertDeepEqual(filterTransactions(lista, { formas: ['pm_pix'] }).map((x) => x.id), ['a', 'c']);
    assertEqual(filterTransactions(lista, { formas: ['pm_pix', 'pm_credito'] }).length, 3);
  });

  it('filtra por conta e por categoria', () => {
    assertEqual(filterTransactions(lista, { contas: ['acc_2'] }).length, 2);
    assertDeepEqual(filterTransactions(lista, { categorias: ['lazer'] }).map((x) => x.id), ['b']);
  });

  it('filtra os classificados automaticamente, para revisão', () => {
    assertDeepEqual(filterTransactions(lista, { somenteAuto: true }).map((x) => x.id), ['c']);
  });

  it('combina filtros com E lógico', () => {
    assertDeepEqual(filterTransactions(lista, { mes: '2026-06', formas: ['pm_pix'] }).map((x) => x.id), ['c']);
  });

  it('filtro vazio de lista não elimina nada', () => {
    assertEqual(filterTransactions(lista, { formas: [] }).length, 3);
  });
});

describe('transactions: totais por forma', () => {
  it('agrupa só o que conta como gasto', () => {
    const lista = [
      t({ id: 'a', valor: 100, formaPagamentoId: 'pm_pix' }),
      t({ id: 'b', valor: 40, formaPagamentoId: 'pm_pix' }),
      t({ id: 'c', valor: 70, formaPagamentoId: 'pm_credito' }),
      t({ id: 'd', valor: 999, formaPagamentoId: 'pm_pix', natureza: 'receita' }),
    ];
    const totais = totaisPorForma(lista);
    assertEqual(totais.get('pm_pix'), 140);
    assertEqual(totais.get('pm_credito'), 70);
  });
});

describe('transactions: construtor', () => {
  it('novaTransaction assume despesa e gera id com prefixo', () => {
    const nova = novaTransaction({ descricao: 'X', valor: 5, data: '2026-06-01', categoria: 'casa', formaPagamentoId: 'pm_pix' });
    assertEqual(nova.natureza, 'despesa');
    assertEqual(nova.origem, 'manual');
    assert(nova.id.startsWith('tx_'));
  });

  it('novaTransaction guarda o valor sempre positivo', () => {
    assertEqual(novaTransaction({ valor: -30 }).valor, 30);
  });
});
```

Adicione `'./transactions.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/domain/transactions.js'`.

- [ ] **Step 3: Implementar `src/domain/transactions.js`**

```js
// Lançamentos. A regra de ouro do sistema mora aqui: gasto é despesa não
// prevista, e só. Receita, transferência entre contas próprias e pagamento de
// fatura são registrados e exibíveis, mas nunca somam como gasto — é o que
// impede o extrato e a fatura do cartão de contarem o mesmo dinheiro duas vezes.

import { uid } from '../core/ids.js';
import { isValidISO, monthKey } from '../core/dates.js';
import { round2 } from '../core/money.js';
import * as storage from '../core/storage.js';

export const NATUREZAS = ['despesa', 'receita', 'transferencia', 'pagamento_fatura'];

export function contaComoGasto(t) {
  return t.natureza === 'despesa' && !t.previsto;
}

export function validateTransaction(t) {
  const erros = [];
  if (!t || typeof t !== 'object') return ['Lançamento inválido.'];
  if (!String(t.descricao || '').trim()) erros.push('A descrição não pode ficar em branco.');
  if (!isValidISO(t.data)) erros.push('Informe uma data válida.');
  if (!t.categoria) erros.push('Escolha uma categoria.');
  if (!t.formaPagamentoId) erros.push('Escolha a forma de pagamento.');
  if (!NATUREZAS.includes(t.natureza)) erros.push(`Natureza inválida. Use uma destas: ${NATUREZAS.join(', ')}.`);
  const valor = Number(t.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    erros.push('O valor precisa ser maior que zero. O sentido do lançamento vem da natureza, não do sinal.');
  }
  return erros;
}

export function sumDespesas(transactions) {
  let total = 0;
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    // Um valor ilegivel e ignorado em vez de contaminar a soma: sem isso, um
    // unico registro corrompido tornava o total NaN, e fmtBRL exibia NaN como
    // "R$ 0,00" - o mes inteiro aparecia zerado sem nenhum sinal de erro.
    if (!Number.isFinite(valor)) continue;
    total += valor;
  }
  return round2(total);
}

export function filterTransactions(transactions, filtros) {
  const f = filtros || {};
  // Uma lista vazia significa "não filtrar por isso", e não "não trazer nada":
  // é o estado inicial de um seletor de múltipla escolha.
  const listaAtiva = (v) => Array.isArray(v) && v.length > 0;
  return (transactions || []).filter((t) => {
    if (f.mes && monthKey(t.data) !== f.mes) return false;
    if (f.ano && String(t.data || '').slice(0, 4) !== String(f.ano)) return false;
    if (listaAtiva(f.formas) && !f.formas.includes(t.formaPagamentoId)) return false;
    if (listaAtiva(f.contas) && !f.contas.includes(t.contaId)) return false;
    if (listaAtiva(f.categorias) && !f.categorias.includes(t.categoria)) return false;
    if (listaAtiva(f.naturezas) && !f.naturezas.includes(t.natureza)) return false;
    if (f.somenteAuto && !t.classificadoAutomaticamente) return false;
    if (f.somenteGastos && !contaComoGasto(t)) return false;
    return true;
  });
}

// Chave para lancamento sem forma de pagamento: a tela precisa de um rotulo, e
// a chave literal `undefined` no Map nao rotula nada.
export const SEM_FORMA = 'sem_forma';

export function totaisPorForma(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    if (!Number.isFinite(valor)) continue;
    const chave = t.formaPagamentoId || SEM_FORMA;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

export function novaTransaction(dados) {
  return {
    id: uid('tx'),
    natureza: 'despesa',
    origem: 'manual',
    previsto: false,
    ...dados,
    valor: Math.abs(Number((dados && dados.valor) || 0)),
  };
}

// --- Persistência ---

export async function listTransactions() {
  return storage.getAll('transactions');
}

export async function saveTransaction(t) {
  return storage.put('transactions', t);
}

export async function saveTransactions(lista) {
  return storage.putMany('transactions', lista);
}

export async function removeTransaction(id) {
  return storage.remove('transactions', id);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS. A suíte pura deve ter mais de 60 testes neste ponto.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona lancamentos com natureza, totais e filtros

contaComoGasto e a regra de ouro do sistema: despesa nao prevista, e so.
Receita, transferencia entre contas proprias e pagamento de fatura ficam
registrados e visiveis mas fora de qualquer total, que e o que impede o
extrato e a fatura de contarem o mesmo dinheiro duas vezes.

Em filterTransactions, lista vazia significa nao filtrar por aquilo, nao
trazer nada: e o estado inicial de um seletor de multipla escolha.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `importers/backup-xlsx.js` — backup completo

O backup do app anterior perdia faturas e metainformação de parcela (spec 5.7). Este exporta **todos os stores**, e é o teste desta tarefa que garante que a limitação não se repita: um ciclo exportar→importar precisa devolver exatamente o mesmo conjunto de dados.

**Files:**
- Create: `src/importers/backup-xlsx.js`
- Create: `tests/backup.test.js`
- Modify: `tests/index.js`

**Interfaces:**
- Consumes: `core/db-schema.js` (`STORES`, `migrateV1ToV2`), `core/storage.js`, `src/version.js`; `XLSX` global (vendor)
- Produces:
  - `SCHEMA_VERSION_BACKUP = 2`
  - `datasetToSheets(dataset) -> { [nomeAba]: object[] }`
  - `sheetsToDataset(sheets) -> { dataset, versao, avisos }`
  - `detectBackupVersion(nomesDeAbas) -> 1|2|null`
  - `exportarBackup() -> Promise<Blob>`
  - `importarBackup(arrayBuffer, opcoes) -> Promise<{ contagens, avisos }>`

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/backup.test.js`:

```js
import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { datasetToSheets, sheetsToDataset, detectBackupVersion, SCHEMA_VERSION_BACKUP } from '../src/importers/backup-xlsx.js';

const DATASET = {
  transactions: [
    { id: 'tx_1', data: '2026-06-10', descricao: 'Compra', valor: 23.5, categoria: 'casa', natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_1', previsto: false },
    { id: 'tx_2', data: '2026-06-23', descricao: 'Parcelada', valor: 100, categoria: 'casa', natureza: 'despesa', formaPagamentoId: 'pm_credito', contaId: 'acc_2', previsto: false, parcelaKey: 'PARCELADA|2026-01-15|3', parcela_atual: 2, parcela_total: 3, conciliadoAutomaticamente: true, origemRef: { statementId: 'acc_2|fatura|2026-06-30', linhaId: 'ab12cd34' } },
  ],
  accounts: [{ id: 'acc_1', tipo: 'conta', nome: 'Conta', agencia: '0001', numero: '1234', matchers: [] }],
  paymentMethods: [{ id: 'pm_pix', nome: 'Pix', tipo: 'pix', conciliaCom: 'extrato', padroesExtrato: ['PIX ENVIADO'], ordem: 1, ativo: true }],
  categories: [{ id: 'casa', nome: 'Casa', cor: '#111111' }],
  statements: [{ id: 'acc_2|fatura|2026-06-30', tipo: 'fatura', contaId: 'acc_2', vencimento: '2026-06-30', dataCorte: '2026-06-23', rows: [{ tipo: 'despesa', data: '2026-06-10', descricao: 'Compra', valor: 23.5 }] }],
  classificationRules: [{ id: 'r_1', padrao: 'PADARIA', tipoMatch: 'exato', escopo: 'extrato', categoriaId: 'casa', origem: 'aprendida', acertos: 3, ativa: true }],
  meta: [{ key: 'lastBackupAt', value: 1750000000000 }],
};

describe('backup: identificação', () => {
  it('reconhece o backup do app anterior pelas abas', () => {
    assertEqual(detectBackupVersion(['Backup_Lancamentos', 'Backup_Categorias']), 1);
  });

  it('reconhece o backup novo', () => {
    assertEqual(detectBackupVersion(Object.keys(datasetToSheets(DATASET))), 2);
  });

  it('devolve null para planilha que não é backup', () => {
    assertEqual(detectBackupVersion(['Plan1']), null);
  });
});

describe('backup: ciclo completo', () => {
  // Este é o teste que impede a limitação do backup anterior de voltar.
  it('exportar e importar devolve exatamente os mesmos dados', () => {
    const sheets = datasetToSheets(DATASET);
    const { dataset, versao } = sheetsToDataset(sheets);
    assertEqual(versao, SCHEMA_VERSION_BACKUP);
    for (const store of Object.keys(DATASET)) {
      assertDeepEqual(dataset[store], DATASET[store], `store ${store} não sobreviveu ao ciclo`);
    }
  });

  it('preserva campos aninhados: rows da fatura e origemRef', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    assertEqual(dataset.statements[0].rows.length, 1);
    assertEqual(dataset.statements[0].rows[0].valor, 23.5);
    assertEqual(dataset.transactions[1].origemRef.linhaId, 'ab12cd34');
  });

  it('preserva booleanos e não os transforma em texto', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    assertEqual(dataset.transactions[1].conciliadoAutomaticamente, true);
    assertEqual(dataset.transactions[0].previsto, false);
  });

  it('grava a versão do schema numa aba própria', () => {
    const sheets = datasetToSheets(DATASET);
    assert(sheets._backup_info);
    assert(sheets._backup_info.some((r) => r.chave === 'schemaVersion' && Number(r.valor) === SCHEMA_VERSION_BACKUP));
  });

  it('dataset vazio produz backup válido e vazio', () => {
    const { dataset } = sheetsToDataset(datasetToSheets({}));
    assertDeepEqual(dataset.transactions, []);
  });
});

describe('backup: caminho degradado do formato anterior', () => {
  it('avisa que faturas não vêm no backup do app anterior', () => {
    const sheets = {
      Backup_Lancamentos: [{ id: 'e_1', descricao: 'X', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 0, parcelaKey: '' }],
      Backup_Categorias: [{ id: 'casa', nome: 'Casa', cor: '#111' }],
    };
    const { versao, avisos } = sheetsToDataset(sheets);
    assertEqual(versao, 1);
    assert(avisos.some((a) => /fatura/i.test(a)));
  });
});
```

Adicione `'./backup.test.js'` a `TEST_MODULES`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tools/run-tests.mjs`
Expected: FAIL — `Cannot find module '../src/importers/backup-xlsx.js'`.

- [ ] **Step 3: Implementar `src/importers/backup-xlsx.js`**

Uma célula de planilha só guarda escalar. Campos aninhados (`statements.rows`, `origemRef`, `matchers`) viram JSON numa célula e voltam a ser objeto na leitura — por isso os testes de ciclo completo importam tanto.

```js
// Backup completo do app. Ao contrário do backup do app anterior, exporta
// TODOS os stores, inclusive statements: um ciclo exportar→importar precisa
// devolver exatamente o mesmo conjunto de dados, e o teste de ciclo garante
// que essa limitação não volte.

import { STORES, migrateV1ToV2 } from '../core/db-schema.js';
import { APP_VERSION } from '../version.js';
import * as storage from '../core/storage.js';

export const SCHEMA_VERSION_BACKUP = 2;

const ABA_INFO = '_backup_info';
const STORES_EXPORTAVEIS = STORES.map((s) => s.nome);

// Prefixo que marca um valor serializado como JSON. Sem ele, não dá para
// distinguir a string "[1,2]" digitada pelo usuário de um array de verdade.
const MARCA_JSON = '@json:';

function serializarValor(v) {
  // undefined vira celula vazia e some na volta, que e o certo: o campo nao
  // existia. Mas null e string vazia sao valores de verdade e precisam voltar
  // como null e string vazia - por isso viajam marcados, e nao como celula
  // vazia. Sem isso, o `null` que db-schema usa como sentinela em statements
  // virava ausencia de campo depois de um backup e restore.
  if (v === undefined) return '';
  if (v === null) return MARCA_JSON + 'null';
  if (v === '') return MARCA_JSON + '""';
  // Uma string que por acaso comeca com o proprio marcador tambem viaja
  // marcada, senao voltaria como o valor que o marcador representa: um usuario
  // que digitasse "@json:null" numa descricao veria virar null na restauracao.
  if (typeof v === 'string' && v.startsWith(MARCA_JSON)) return MARCA_JSON + JSON.stringify(v);
  if (typeof v === 'object') return MARCA_JSON + JSON.stringify(v);
  if (typeof v === 'boolean') return MARCA_JSON + JSON.stringify(v);
  return v;
}

function desserializarValor(v) {
  if (typeof v === 'string' && v.startsWith(MARCA_JSON)) {
    try {
      return JSON.parse(v.slice(MARCA_JSON.length));
    } catch (e) {
      return v;
    }
  }
  return v === '' ? undefined : v;
}

export function datasetToSheets(dataset) {
  const sheets = {
    [ABA_INFO]: [
      { chave: 'schemaVersion', valor: SCHEMA_VERSION_BACKUP },
      { chave: 'appVersion', valor: APP_VERSION },
      { chave: 'exportadoEm', valor: new Date().toISOString() },
    ],
  };
  for (const store of STORES_EXPORTAVEIS) {
    sheets[store] = ((dataset && dataset[store]) || []).map((registro) => {
      const linha = {};
      for (const [k, v] of Object.entries(registro)) linha[k] = serializarValor(v);
      return linha;
    });
  }
  return sheets;
}

export function sheetsToDataset(sheets) {
  const nomes = Object.keys(sheets || {});
  const versao = detectBackupVersion(nomes);
  const avisos = [];

  if (versao === 1) {
    const expenses = (sheets.Backup_Lancamentos || []).map((r) => ({
      id: r.id != null ? String(r.id) : null,
      descricao: r.descricao || '',
      valor: Number(r.valor) || 0,
      data: typeof r.data === 'string' ? r.data.slice(0, 10) : r.data,
      categoria: r.categoria || 'a_classificar',
      previsto: !!Number(r.previsto),
      parcelaKey: r.parcelaKey || undefined,
    }));
    avisos.push(
      'Este é um backup do app anterior. Ele não contém as faturas importadas nem os ' +
      'campos de parcela (número da parcela, marca de conciliação automática). Depois de ' +
      'restaurar, reimporte os PDFs das faturas para recuperar essa parte.'
    );
    return {
      versao: 1,
      avisos,
      dataset: { expenses, categories: sheets.Backup_Categorias || [], faturas: [], meta: [] },
    };
  }

  const dataset = {};
  for (const store of STORES_EXPORTAVEIS) {
    dataset[store] = (sheets[store] || []).map((linha) => {
      const registro = {};
      for (const [k, v] of Object.entries(linha)) {
        const valor = desserializarValor(v);
        if (valor !== undefined) registro[k] = valor;
      }
      return registro;
    });
  }
  // Devolve o que foi detectado, sem inventar versao: com um `||` aqui, uma
  // planilha qualquer virava "backup v2 vazio" e a guarda de importarBackup
  // nunca disparava - o usuario via "restaurado" tendo escolhido o arquivo
  // errado.
  return { versao, avisos, dataset };
}

export function detectBackupVersion(nomesDeAbas) {
  const nomes = nomesDeAbas || [];
  if (nomes.includes(ABA_INFO) || nomes.includes('transactions')) return 2;
  if (nomes.includes('Backup_Lancamentos')) return 1;
  return null;
}

// --- Integração com SheetJS e storage ---

export async function exportarBackup() {
  const dataset = {};
  for (const store of STORES_EXPORTAVEIS) dataset[store] = await storage.getAll(store);
  const sheets = datasetToSheets(dataset);
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  for (const [nome, linhas] of Object.entries(sheets)) {
    const aba = nome.slice(0, 31);
    // O formato xlsx limita nome de aba a 31 caracteres. Se dois stores
    // truncarem para o mesmo nome, o SheetJS lanca um erro obscuro e o backup
    // inteiro falha - melhor parar aqui, dizendo qual e o problema.
    if (usados.has(aba)) throw new Error(`Dois stores geram o mesmo nome de aba ("${aba}"). Renomeie um deles.`);
    usados.add(aba);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba);
  }
  const saida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await storage.setMeta('lastBackupAt', Date.now());
  return new Blob([saida], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function importarBackup(arrayBuffer, opcoes) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = {};
  for (const nome of wb.SheetNames) {
    sheets[nome] = XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' });
  }

  const { dataset, versao, avisos } = sheetsToDataset(sheets);
  if (!versao) throw new Error('Este arquivo não parece ser um backup do app.');

  const final = versao === 1 ? migrateV1ToV2(dataset, opcoes) : dataset;
  if (versao === 1) avisos.push(...final.avisos);

  const contagens = {};
  // Categorias e cadastros antes de transactions: se a gravação for
  // interrompida, nenhum lançamento fica apontando para algo inexistente.
  for (const store of ['categories', 'accounts', 'paymentMethods', 'statements', 'classificationRules', 'transactions', 'meta']) {
    const lista = final[store] || [];
    await storage.putMany(store, lista);
    contagens[store] = lista.length;
  }
  return { contagens, avisos };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node tools/run-tests.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona backup completo com teste de ciclo fechado

O backup do app anterior perdia faturas e campos de parcela. Aqui todos os
stores sao exportados, e o teste de ciclo exportar-importar exige que o
dataset volte identico - e o que impede a limitacao anterior de voltar.

Campos aninhados viram JSON marcado numa celula, porque celula de planilha so
guarda escalar; a marca distingue um array de verdade da string que parece um.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Shell da UI — `index.html`, `styles.css`, `components.js`, `tabs.js`, `app.js`

Estrutura visual e navegação, sem nenhuma tela de conteúdo ainda. A verificação aqui é visual e manual: as abas trocam, o app carrega sem erro de console, e o tema respeita claro e escuro.

Copie `styles.css` de `../../Cartão de Credito/gastos-app/styles.css` como ponto de partida — o tema "livro contábil" (paper/ink/brass) é decisão de produto já validada — e acrescente as variáveis de tema escuro.

**Files:**
- Create: `index.html`, `styles.css`, `src/ui/components.js`, `src/ui/tabs.js`, `src/app.js`
- Create: `manifest.webmanifest` e `sw.js` em versão mínima. O `index.html` os referencia, e sem eles há 404 real no console de qualquer usuário — não só do verificador. O `sw.js` desta tarefa **não pode ter listener de `fetch`**: é um marcador inerte até a Tarefa 15 pôr o service worker de verdade, e um placeholder que cacheasse algo deixaria conteúdo velho grudado no aparelho.

**Interfaces:**
- Consumes: todos os módulos de `domain/`
- Produces:
  - `components.js`: `el(tag, attrs, filhos) -> HTMLElement`, `toast(msg, tipo)`, `abrirModal({ titulo, corpo, acoes }) -> Promise<string|null>`, `confirmar(msg) -> Promise<boolean>`
  - `tabs.js`: `initTabs(onTrocar)` (guarda o callback no módulo), `irParaAba(nome)`
  - `app.js`: `boot()` chamado no fim do módulo

- [ ] **Step 1: Criar `index.html`**

Cinco abas conforme spec §9. Cada painel entra vazio; as tarefas seguintes preenchem.

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f4efe4">
  <title>Livro de Gastos</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="cabecalho">
    <h1>Livro de Gastos</h1>
    <div id="statusApp" class="status" role="status" aria-live="polite"></div>
  </header>

  <nav class="tabbar" role="tablist">
    <button class="tab-btn active" data-tab="Lancamentos" role="tab" aria-selected="true">Lançamentos</button>
    <button class="tab-btn" data-tab="Conciliacao" role="tab" aria-selected="false">Conciliação</button>
    <button class="tab-btn" data-tab="Parcelas" role="tab" aria-selected="false">Parcelas</button>
    <button class="tab-btn" data-tab="Dashboard" role="tab" aria-selected="false">Dashboard</button>
    <button class="tab-btn" data-tab="Cadastros" role="tab" aria-selected="false">Cadastros</button>
  </nav>

  <main>
    <section class="tab-panel active" id="tabLancamentos" role="tabpanel"></section>
    <section class="tab-panel" id="tabConciliacao" role="tabpanel">
      <p class="vazio">A conciliação de fatura e extrato chega na Fase 2.</p>
    </section>
    <section class="tab-panel" id="tabParcelas" role="tabpanel">
      <p class="vazio">A previsão de parcelas chega na Fase 2.</p>
    </section>
    <section class="tab-panel" id="tabDashboard" role="tabpanel">
      <p class="vazio">O painel de gastos chega na Fase 3.</p>
    </section>
    <section class="tab-panel" id="tabCadastros" role="tabpanel"></section>
  </main>

  <div id="modalRaiz"></div>
  <div id="toastRaiz" aria-live="polite"></div>

  <script src="vendor/xlsx.full.min.js"></script>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar `src/ui/components.js`**

```js
// Blocos de UI reutilizáveis. Nenhuma regra de negócio mora aqui.

export function el(tag, attrs, filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  // A comparacao explicita tambem aqui: `filhos || []` transformava um filho 0
  // solto (fora de array) em lista vazia antes de o laco comecar, e a guarda
  // de dentro do laco nunca era alcancada.
  const lista = filhos === null || filhos === undefined ? [] : [].concat(filhos);
  for (const filho of lista) {
    // Comparacao explicita em vez de truthy: um filho 0 e legitimo e frequente
    // num app de dinheiro ("R$ 0,00", "0 lancamentos"), e o teste de truthy o
    // descartava calado. false continua sendo filtrado de proposito, porque e
    // o resultado do padrao `condicao && el(...)`.
    if (filho === null || filho === undefined || filho === false) continue;
    node.appendChild(typeof filho === 'object' ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

export function toast(msg, tipo) {
  const raiz = document.getElementById('toastRaiz');
  const node = el('div', { class: `toast ${tipo || 'info'}`, text: msg });
  raiz.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

/**
 * Modal com ações nomeadas. Devolve o id da ação escolhida, ou null se o
 * usuário fechou sem escolher. Existe em vez de window.confirm porque vários
 * fluxos precisam de mais de duas saídas.
 */
export function abrirModal({ titulo, corpo, acoes }) {
  return new Promise((resolve) => {
    const raiz = document.getElementById('modalRaiz');
    const fechar = (valor) => { raiz.innerHTML = ''; document.removeEventListener('keydown', aoTeclar); resolve(valor); };
    const aoTeclar = (ev) => { if (ev.key === 'Escape') fechar(null); };
    document.addEventListener('keydown', aoTeclar);

    const botoes = (acoes || [{ id: 'ok', rotulo: 'OK' }]).map((a) =>
      el('button', { class: `btn ${a.classe || ''}`, text: a.rotulo, onclick: () => fechar(a.id) })
    );

    raiz.appendChild(
      el('div', { class: 'overlay', onclick: (ev) => { if (ev.target.classList.contains('overlay')) fechar(null); } }, [
        el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { text: titulo }),
          typeof corpo === 'string' ? el('p', { text: corpo }) : corpo,
          el('div', { class: 'modal-acoes' }, botoes),
        ]),
      ])
    );
    botoes[botoes.length - 1].focus();
  });
}

export async function confirmar(msg) {
  const r = await abrirModal({
    titulo: 'Confirmar',
    corpo: msg,
    acoes: [
      { id: 'cancelar', rotulo: 'Cancelar' },
      { id: 'ok', rotulo: 'Confirmar', classe: 'btn-perigo' },
    ],
  });
  return r === 'ok';
}
```

- [ ] **Step 3: Criar `src/ui/tabs.js` e `src/app.js`**

`src/ui/tabs.js`:

```js
// O callback de renderização fica no módulo, não é passado a cada chamada:
// outras telas navegam por irParaAba(nome) e precisam que a aba de destino
// seja renderizada, não apenas exibida vazia.
let aoTrocar = null;

export function initTabs(onTrocar) {
  aoTrocar = onTrocar;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => irParaAba(btn.dataset.tab));
  });
}

export function irParaAba(nome) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const ativo = b.dataset.tab === nome;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', String(ativo));
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'tab' + nome);
  });
  if (aoTrocar) aoTrocar(nome);
}
```

`src/app.js`:

```js
// Boot e roteamento. Nenhuma regra de negócio e nenhuma manipulação de dados
// mora aqui: este arquivo só decide o que renderizar.

import { initTabs } from './ui/tabs.js';
import { toast } from './ui/components.js';
import { seedCategoriasIfEmpty } from './domain/categories.js';
import { seedFormasIfEmpty } from './domain/payment-methods.js';

// As telas entram nas tarefas 12 a 14. Cada uma acrescenta o próprio import e
// a própria linha em RENDERIZADORES ao ser criada — nada de import comentado
// esperando por um arquivo que ainda não existe.
const RENDERIZADORES = {};

async function renderizar(aba) {
  const fn = RENDERIZADORES[aba];
  if (fn) await fn();
}

async function boot() {
  try {
    await seedCategoriasIfEmpty();
    await seedFormasIfEmpty();
    initTabs(renderizar);
    await renderizar('Lancamentos');
    registrarServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    toast('Erro ao iniciar o app: ' + e.message, 'erro');
    throw e;
  }
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js');
}

boot();
```

- [ ] **Step 4: Ajustar `styles.css` para tema claro e escuro**

Copie o `styles.css` do app anterior e mova as cores para variáveis, acrescentando o bloco de tema escuro:

```css
:root {
  --papel: #f4efe4;
  --tinta: #2b2622;
  --tinta-fraca: #6b6259;
  /* Escurecido para passar em AA contra --papel: a variavel existia sem uso
     e reprovava em contraste, o que so apareceria quando alguem a usasse. */
  --latao: #8a6620;
  --linha: #d9cfbc;
  --erro: #b3261e;
  --ok: #0a7d32;
}

@media (prefers-color-scheme: dark) {
  :root {
    --papel: #1c1a17;
    --tinta: #ebe4d8;
    --tinta-fraca: #a09688;
    --latao: #d3a850;
    --linha: #3a352e;
    --erro: #f2b8b5;
    --ok: #7ddb9c;
  }
}

body { background: var(--papel); color: var(--tinta); }
```

Toda regra existente que usava cor literal passa a usar a variável correspondente. A tabbar precisa rolar horizontalmente em tela estreita, porque agora são cinco abas:

```css
.tabbar { display: flex; overflow-x: auto; scrollbar-width: none; }
.tabbar::-webkit-scrollbar { display: none; }
.tab-btn { flex: 0 0 auto; }
```

- [ ] **Step 5: Verificar no navegador**

```bash
python -m http.server 8000
```

Abra `http://localhost:8000/`. Confirme, nesta ordem:
1. As cinco abas aparecem e trocam ao toque.
2. O console não tem **nenhum** erro. As abas de conteúdo ainda estão vazias, e é isso que se espera nesta tarefa.
3. Em tela de 360px de largura a tabbar rola sem quebrar o layout.
4. Alternando o tema do sistema entre claro e escuro, o texto continua legível.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Adiciona shell da UI com cinco abas e tema claro e escuro

app.js so decide o que renderizar: nenhuma regra de negocio e nenhuma
manipulacao de dados mora nele. abrirModal devolve o id da acao escolhida em
vez de um booleano porque varios fluxos precisam de mais de duas saidas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: aba Cadastros — Contas & Cartões, Formas, Categorias e Backup

Quatro seções numa aba. Toda validação vem de `domain/`: esta camada só coleta o formulário, chama `validate*`, e mostra os erros devolvidos. Nenhuma regra é reimplementada aqui.

**Um arquivo por seção.** O código abaixo está agrupado por seção com comentários `// --- Nome ---`; cada grupo vira um arquivo próprio, em torno de 80 linhas, e as seções não se conhecem entre si. `cadastros.js` fica sendo só a montagem da aba.

**Files:**
- Create: `src/ui/cadastros.js` — monta a aba chamando as quatro seções e expõe `renderCadastros()`
- Create: `src/ui/cadastros-contas.js` — exporta `secaoContas(aoMudar)`
- Create: `src/ui/cadastros-formas.js` — exporta `secaoFormas(aoMudar)`
- Create: `src/ui/cadastros-categorias.js` — exporta `secaoCategorias(aoMudar)`
- Create: `src/ui/cadastros-backup.js` — exporta `secaoBackup(aoMudar)`
- Create: `src/ui/cadastros-comuns.js` — `secao(titulo, filhos)`, `campo(rotulo, controle)`, `mostrarErros(erros)`, usados por mais de uma seção
- Modify: `styles.css` (classes `.cadastro-secao`, `.lista-cadastro`, `.erro-form`, `.chip-cor`)

Cada seção recebe `aoMudar` — a função a chamar depois de salvar ou excluir — em vez de importar `renderCadastros`, o que criaria ciclo de importação entre a aba e suas seções. `cadastros.js` passa a própria `renderCadastros` como esse callback.

O código a seguir é o conteúdo completo das seções; distribua cada grupo no seu arquivo, trocando as chamadas diretas a `renderCadastros()` por `aoMudar()`.

**Interfaces:**
- Consumes: `domain/accounts.js`, `domain/payment-methods.js`, `domain/categories.js`, `domain/transactions.js` (`listTransactions`, para o guarda de exclusão), `ui/components.js`, `importers/backup-xlsx.js`
- Produces:
  - `cadastros.js`: `renderCadastros() -> Promise<void>`
  - cada `cadastros-*.js`: `secao<Nome>(aoMudar) -> Promise<HTMLElement>`
  - `cadastros-comuns.js`: `secao(titulo, filhos) -> HTMLElement`, `campo(rotulo, controle) -> HTMLElement`, `mostrarErros(erros) -> void`

- [ ] **Step 1: Implementar `src/ui/cadastros.js`**

```js
// Aba Cadastros. Coleta formulário, delega validação para domain/ e exibe os
// erros devolvidos. Nenhuma regra de negócio é reimplementada aqui.

import { el, toast, abrirModal, confirmar } from './components.js';
import {
  TIPO_CONTA, TIPO_CARTAO, listAccounts, saveAccount, removeAccount,
  validateAccount, suggestMatchers, novaConta, novoCartao, isAdicional,
} from '../domain/accounts.js';
import {
  TIPOS_FORMA, listFormas, saveForma, removeForma, validatePaymentMethod, novaForma,
} from '../domain/payment-methods.js';
import {
  listCategorias, saveCategoria, removeCategoria, validateCategoria, novaCategoria,
} from '../domain/categories.js';
import { listTransactions } from '../domain/transactions.js';
import { exportarBackup, importarBackup } from '../importers/backup-xlsx.js';

// Conteúdo de cadastros.js: só a montagem da aba.
export async function renderCadastros() {
  const painel = document.getElementById('tabCadastros');
  painel.innerHTML = '';
  painel.append(
    await secaoContas(renderCadastros),
    await secaoFormas(renderCadastros),
    await secaoCategorias(renderCadastros),
    secaoBackup(renderCadastros)
  );
}

// Conteúdo de cadastros-comuns.js.
export function secao(titulo, filhos) {
  return el('section', { class: 'cadastro-secao' }, [el('h2', { text: titulo }), ...filhos]);
}

export function campo(rotulo, controle) {
  return el('label', { class: 'campo' }, [el('span', { text: rotulo }), controle]);
}

export function mostrarErros(erros) {
  toast(erros.join(' '), 'erro');
}

// --- Contas e cartões ---

export async function secaoContas(aoMudar) {
  const todas = await listAccounts();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((a) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'item-nome', text: rotuloConta(a) }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarConta(a, todas) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirConta(a) }),
    ]))
  );
  if (!todas.length) lista.appendChild(el('p', { class: 'vazio', text: 'Nenhuma conta ou cartão cadastrado ainda.' }));

  return secao('Contas e cartões', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Conta corrente', onclick: () => editarConta(novaConta({ nome: '' }), todas) }),
      el('button', { class: 'btn', text: '+ Cartão', onclick: () => editarConta(novoCartao({ nome: '', final: '' }), todas) }),
    ]),
  ]);
}

function rotuloConta(a) {
  if (a.tipo === TIPO_CONTA) return `${a.nome} — ag. ${a.agencia} c/c ${a.numero}`;
  const marca = isAdicional(a) ? ' (adicional)' : '';
  return `${a.nome} — ${String(a.bandeira || '').toUpperCase()} final ${a.final}${marca}`;
}

async function editarConta(acc, todas) {
  const ehCartao = acc.tipo === TIPO_CARTAO;
  const campos = {};
  const campo = (nome, rotulo, valor, tipo) => {
    const input = el('input', { type: tipo || 'text', value: valor == null ? '' : valor, id: 'f_' + nome });
    campos[nome] = input;
    return el('label', { class: 'campo' }, [el('span', { text: rotulo }), input]);
  };

  const cartoesTitulares = todas.filter((a) => a.tipo === TIPO_CARTAO && !isAdicional(a) && a.id !== acc.id);
  const contas = todas.filter((a) => a.tipo === TIPO_CONTA);

  const seletor = (nome, rotulo, opcoes, selecionado) => {
    const sel = el('select', { id: 'f_' + nome }, [
      el('option', { value: '', text: '— nenhum —' }),
      ...opcoes.map((o) => el('option', { value: o.id, text: o.nome, ...(o.id === selecionado ? { selected: 'selected' } : {}) })),
    ]);
    campos[nome] = sel;
    return el('label', { class: 'campo' }, [el('span', { text: rotulo }), sel]);
  };

  const corpo = el('div', { class: 'form' }, [
    campo('nome', 'Nome', acc.nome),
    campo('instituicao', 'Instituição', acc.instituicao),
    ...(ehCartao
      ? [
          campo('bandeira', 'Bandeira', acc.bandeira),
          campo('final', 'Final (4 dígitos)', acc.final),
          campo('diaVencimento', 'Dia de vencimento', acc.diaVencimento, 'number'),
          seletor('cartaoPaiId', 'É adicional do cartão', cartoesTitulares, acc.cartaoPaiId),
          seletor('contaPagadoraId', 'Conta que paga a fatura', contas, acc.contaPagadoraId),
        ]
      : [campo('agencia', 'Agência', acc.agencia), campo('numero', 'Número da conta', acc.numero)]),
  ]);

  const escolha = await abrirModal({
    titulo: acc.nome ? 'Editar' : 'Novo cadastro',
    corpo,
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizado = { ...acc };
  for (const [nome, input] of Object.entries(campos)) {
    const v = input.value.trim();
    atualizado[nome] = nome === 'diaVencimento' ? (v ? Number(v) : undefined) : v || undefined;
  }
  if (ehCartao && !atualizado.matchers?.length) atualizado.matchers = suggestMatchers(atualizado);

  const erros = validateAccount(atualizado, todas);
  if (erros.length) return mostrarErros(erros);

  await saveAccount(atualizado);
  toast('Cadastro salvo.', 'ok');
  await renderCadastros();
}

async function excluirConta(acc) {
  const transacoes = await listTransactions();
  const emUso = transacoes.filter((t) => t.contaId === acc.id).length;
  if (emUso) {
    return toast(`Não dá para excluir: ${emUso} lançamento(s) usam este cadastro. Desative-o em vez de excluir.`, 'erro');
  }
  if (!(await confirmar(`Excluir "${acc.nome}"? Isso não pode ser desfeito.`))) return;
  try {
    await removeAccount(acc.id);
    toast('Excluído.', 'ok');
    await renderCadastros();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// --- Formas de pagamento ---

export async function secaoFormas(aoMudar) {
  const todas = await listFormas();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((p) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'chip-cor', style: `background:${p.cor}` }),
      el('span', { class: 'item-nome', text: `${p.nome} (${p.tipo})${p.ativo === false ? ' — desativada' : ''}` }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarForma(p, todas) }),
      el('button', { class: 'btn btn-mini', text: p.ativo === false ? 'Ativar' : 'Desativar', onclick: () => alternarForma(p) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirForma(p) }),
    ]))
  );
  return secao('Formas de pagamento', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Forma de pagamento', onclick: () => editarForma(novaForma({ nome: '', tipo: 'outro' }, todas), todas) }),
    ]),
  ]);
}

async function editarForma(pm, todas) {
  const inputNome = el('input', { type: 'text', value: pm.nome });
  const selTipo = el('select', {}, TIPOS_FORMA.map((t) =>
    el('option', { value: t, text: t, ...(t === pm.tipo ? { selected: 'selected' } : {}) })
  ));
  const inputPadroes = el('input', { type: 'text', value: (pm.padroesExtrato || []).join(', ') });

  const corpo = el('div', { class: 'form' }, [
    el('label', { class: 'campo' }, [el('span', { text: 'Nome' }), inputNome]),
    el('label', { class: 'campo' }, [el('span', { text: 'Tipo (define o comportamento)' }), selTipo]),
    el('label', { class: 'campo' }, [
      el('span', { text: 'Prefixos no extrato (separados por vírgula)' }), inputPadroes,
    ]),
  ]);

  const escolha = await abrirModal({
    titulo: pm.nome ? 'Editar forma' : 'Nova forma de pagamento',
    corpo,
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizado = novaForma({ ...pm, nome: inputNome.value.trim(), tipo: selTipo.value }, todas);
  atualizado.id = pm.id;
  atualizado.ordem = pm.ordem;
  atualizado.padroesExtrato = inputPadroes.value.split(',').map((s) => s.trim()).filter(Boolean);

  const erros = validatePaymentMethod(atualizado, todas);
  if (erros.length) return mostrarErros(erros);

  await saveForma(atualizado);
  toast('Forma de pagamento salva.', 'ok');
  await renderCadastros();
}

async function alternarForma(pm) {
  await saveForma({ ...pm, ativo: pm.ativo === false });
  await renderCadastros();
}

async function excluirForma(pm) {
  if (!(await confirmar(`Excluir a forma "${pm.nome}"?`))) return;
  try {
    await removeForma(pm.id, await listTransactions());
    toast('Excluída.', 'ok');
    await renderCadastros();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// --- Categorias ---

export async function secaoCategorias(aoMudar) {
  const todas = await listCategorias();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((c) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'chip-cor', style: `background:${c.cor}` }),
      el('span', { class: 'item-nome', text: c.nome }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarCategoria(c, todas) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirCategoria(c) }),
    ]))
  );
  return secao('Categorias', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Categoria', onclick: () => editarCategoria(novaCategoria('', null, todas), todas) }),
    ]),
  ]);
}

async function editarCategoria(cat, todas) {
  const inputNome = el('input', { type: 'text', value: cat.nome });
  const inputCor = el('input', { type: 'color', value: cat.cor });
  const escolha = await abrirModal({
    titulo: cat.nome ? 'Editar categoria' : 'Nova categoria',
    corpo: el('div', { class: 'form' }, [
      el('label', { class: 'campo' }, [el('span', { text: 'Nome' }), inputNome]),
      el('label', { class: 'campo' }, [el('span', { text: 'Cor' }), inputCor]),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizada = { ...cat, nome: inputNome.value.trim(), cor: inputCor.value };
  const erros = validateCategoria(atualizada, todas);
  if (erros.length) return mostrarErros(erros);

  await saveCategoria(atualizada);
  toast('Categoria salva.', 'ok');
  await renderCadastros();
}

async function excluirCategoria(cat) {
  const transacoes = await listTransactions();
  const emUso = transacoes.filter((t) => t.categoria === cat.id).length;
  if (emUso) return toast(`${emUso} lançamento(s) usam esta categoria. Reclassifique-os antes de excluir.`, 'erro');
  if (!(await confirmar(`Excluir a categoria "${cat.nome}"?`))) return;
  try {
    await removeCategoria(cat.id);
    toast('Excluída.', 'ok');
    await renderCadastros();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// --- Backup ---

export function secaoBackup(aoMudar) {
  const inputArquivo = el('input', { type: 'file', accept: '.xlsx', class: 'oculto' });
  inputArquivo.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try {
      // Backup do formato anterior é todo de cartão de crédito e não diz de
      // qual: sem escolher um cartão, os lançamentos entrariam sem conta.
      const cartoes = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO);
      const cartaoTitularId = await escolherCartaoParaImportacao(cartoes);
      if (cartaoTitularId === false) return;

      const { contagens, avisos } = await importarBackup(await arquivo.arrayBuffer(), {
        cartaoTitularId, formaCreditoId: 'pm_credito',
      });
      const total = Object.values(contagens).reduce((a, b) => a + b, 0);
      toast(`${total} registro(s) restaurados.`, 'ok');
      if (avisos.length) await abrirModal({ titulo: 'Atenção', corpo: avisos.join('\n\n') });
      await renderCadastros();
    } catch (e) {
      toast('Não consegui ler esse backup: ' + e.message, 'erro');
    }
    ev.target.value = '';
  });

  return secao('Backup', [
    el('p', { class: 'ajuda', text: 'O backup contém todos os seus dados, inclusive faturas e extratos importados.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', text: 'Importar backup', onclick: () => inputArquivo.click() }),
    ]),
    inputArquivo,
  ]);
}

/**
 * Devolve o id do cartão a associar, `null` se não há cartão cadastrado (caso
 * de um backup do formato novo, que já traz o cartão dentro), ou `false` se o
 * usuário cancelou.
 */
async function escolherCartaoParaImportacao(cartoes) {
  if (!cartoes.length) return null;
  if (cartoes.length === 1) return cartoes[0].id;
  const sel = el('select', {}, cartoes.map((c) => el('option', { value: c.id, text: c.nome })));
  const escolha = await abrirModal({
    titulo: 'Backup do app anterior',
    corpo: el('div', { class: 'form' }, [
      el('p', { text: 'Se este for um backup do app anterior, os lançamentos são todos de cartão de crédito. A qual cartão associá-los?' }),
      el('label', { class: 'campo' }, [el('span', { text: 'Cartão' }), sel]),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'ok', rotulo: 'Importar' }],
  });
  return escolha === 'ok' ? sel.value : false;
}

async function baixarBackup() {
  const blob = await exportarBackup();
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `backup-livro-de-gastos-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup gerado.', 'ok');
}
```

- [ ] **Step 2: Ligar a tela em `src/app.js`**

```js
import { renderCadastros } from './ui/cadastros.js';

const RENDERIZADORES = {
  Cadastros: renderCadastros,
};
```

- [ ] **Step 3: Verificar no navegador**

Com `python -m http.server 8000` rodando, abra a aba Cadastros e confirme:
1. As formas de pagamento e categorias do seed aparecem listadas.
2. Cadastrar uma conta corrente e um cartão titular funciona; o campo de final rejeita menos de 4 dígitos com mensagem.
3. Cadastrar um cartão marcando "É adicional do cartão" com o titular criado funciona, e o rótulo mostra "(adicional)".
4. Tentar excluir a categoria "A Classificar" mostra a mensagem de bloqueio.
5. Exportar backup baixa o `.xlsx`; reimportá-lo não duplica nada.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Adiciona aba Cadastros com contas, cartoes, formas e categorias

A camada de UI so coleta formulario, chama validate* de domain e mostra os
erros devolvidos: nenhuma regra e reimplementada aqui. Exclusao de cadastro em
uso e bloqueada com a contagem de lancamentos afetados, e a saida oferecida e
desativar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `ui/lancamentos.js` — a tela de uso diário

**Files:**
- Create: `src/ui/lancamentos.js`
- Modify: `styles.css` (`.filtros`, `.lista-lancamentos`, `.selo-auto`)

**Interfaces:**
- Consumes: `domain/transactions.js`, `domain/categories.js`, `domain/payment-methods.js`, `domain/accounts.js`, `core/money.js`, `core/dates.js`, `ui/components.js`
- Produces: `renderLancamentos() -> Promise<void>`

- [ ] **Step 1: Implementar `src/ui/lancamentos.js`**

Pontos que o código precisa respeitar:

- A forma de pagamento é obrigatória e vem pré-selecionada com a última usada, lida de `meta.ultimaFormaUsada`. Digitar um gasto é a ação mais repetida do app; um campo a mais para preencher toda vez é atrito real.
- Escolher a forma preenche a conta automaticamente por `contaPadraoId`, mas o usuário pode trocar.
- O lançamento classificado pela máquina exibe o selo `auto`; **editar a categoria remove o selo**, porque a escolha do usuário deixa de ser palpite da máquina.
- A data é digitada em `DD/MM/AAAA` e convertida por `parseDateBR` antes de qualquer coisa. Nada de data formatada entra no domínio.

```js
import { el, toast, confirmar } from './components.js';
import {
  listTransactions, saveTransaction, removeTransaction,
  novaTransaction, validateTransaction, filterTransactions, sumDespesas, NATUREZAS,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts } from '../domain/accounts.js';
import { fmtBRL, parseMoneyBR } from '../core/money.js';
import { formatDateBR, parseDateBR, todayISO, monthKey } from '../core/dates.js';
import * as storage from '../core/storage.js';

let filtros = { mes: monthKey(todayISO()) };
let editandoId = null;

export async function renderLancamentos() {
  const painel = document.getElementById('tabLancamentos');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };
  const visiveis = filterTransactions(transacoes, filtros)
    .sort((a, b) => (a.data < b.data ? 1 : -1));

  painel.innerHTML = '';
  painel.append(
    await formulario(ctx, transacoes),
    barraFiltros(ctx),
    el('div', { class: 'total-periodo', text: `Total de gastos no período: ${fmtBRL(sumDespesas(visiveis))}` }),
    listagem(visiveis, ctx)
  );
}

async function formulario(ctx, transacoes) {
  const emEdicao = editandoId ? transacoes.find((t) => t.id === editandoId) : null;
  const ultimaForma = await storage.getMeta('ultimaFormaUsada', null);

  const inpData = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'DD/MM/AAAA', value: formatDateBR(emEdicao ? emEdicao.data : todayISO()) });
  const inpDescricao = el('input', { type: 'text', placeholder: 'Descrição', value: emEdicao ? emEdicao.descricao : '' });
  const inpValor = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: emEdicao ? String(emEdicao.valor).replace('.', ',') : '' });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(emEdicao && emEdicao.categoria === c.id ? { selected: 'selected' } : {}) })
  ));

  const formasAtivas = ctx.formas.filter((f) => f.ativo !== false);
  const formaSelecionada = emEdicao ? emEdicao.formaPagamentoId : ultimaForma;
  const selForma = el('select', {}, formasAtivas.map((f) =>
    el('option', { value: f.id, text: f.nome, ...(f.id === formaSelecionada ? { selected: 'selected' } : {}) })
  ));

  const selConta = el('select', {}, [
    el('option', { value: '', text: '— sem conta —' }),
    ...ctx.contas.map((a) => el('option', { value: a.id, text: a.nome, ...(emEdicao && emEdicao.contaId === a.id ? { selected: 'selected' } : {}) })),
  ]);

  // Escolher a forma preenche a conta pelo padrão dela, sem travar a escolha.
  selForma.addEventListener('change', () => {
    const forma = formasAtivas.find((f) => f.id === selForma.value);
    if (forma && forma.contaPadraoId) selConta.value = forma.contaPadraoId;
  });

  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: rotuloNatureza(n), ...(emEdicao && emEdicao.natureza === n ? { selected: 'selected' } : {}) })
  ));

  const salvar = async () => {
    const data = parseDateBR(inpData.value);
    const valor = parseMoneyBR(inpValor.value);
    const base = {
      data,
      descricao: inpDescricao.value.trim(),
      valor: valor === null ? 0 : Math.abs(valor),
      categoria: selCategoria.value,
      formaPagamentoId: selForma.value,
      contaId: selConta.value || undefined,
      natureza: selNatureza.value,
    };
    const registro = emEdicao ? { ...emEdicao, ...base } : novaTransaction(base);

    // Se o usuário mexeu na categoria, a escolha deixa de ser palpite da máquina.
    if (emEdicao && emEdicao.categoria !== base.categoria) {
      delete registro.classificadoAutomaticamente;
      delete registro.regraId;
    }

    const erros = validateTransaction(registro);
    if (erros.length) return toast(erros.join(' '), 'erro');

    await saveTransaction(registro);
    await storage.setMeta('ultimaFormaUsada', registro.formaPagamentoId);
    editandoId = null;
    toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
    await renderLancamentos();
  };

  return el('form', { class: 'form-lancamento', onsubmit: (ev) => { ev.preventDefault(); salvar(); } }, [
    el('div', { class: 'linha-form' }, [campo('Data', inpData), campo('Valor', inpValor)]),
    campo('Descrição', inpDescricao),
    el('div', { class: 'linha-form' }, [campo('Categoria', selCategoria), campo('Forma de pagamento', selForma)]),
    el('div', { class: 'linha-form' }, [campo('Conta / cartão', selConta), campo('Natureza', selNatureza)]),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn btn-primario', type: 'submit', text: emEdicao ? 'Salvar alterações' : 'Lançar' }),
      emEdicao ? el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: async () => { editandoId = null; await renderLancamentos(); } }) : null,
    ]),
  ]);
}

function campo(rotulo, controle) {
  return el('label', { class: 'campo' }, [el('span', { text: rotulo }), controle]);
}

function rotuloNatureza(n) {
  return {
    despesa: 'Gasto',
    receita: 'Recebimento (não conta como gasto)',
    transferencia: 'Transferência entre contas próprias',
    pagamento_fatura: 'Pagamento de fatura',
  }[n];
}

function barraFiltros(ctx) {
  const inpMes = el('input', { type: 'month', value: filtros.mes || '' });
  inpMes.addEventListener('change', async () => { filtros.mes = inpMes.value || undefined; await renderLancamentos(); });

  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas' }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: f.nome })),
  ]);
  selForma.addEventListener('change', async () => {
    filtros.formas = selForma.value ? [selForma.value] : [];
    await renderLancamentos();
  });

  const chkAuto = el('input', { type: 'checkbox' });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await renderLancamentos(); });

  return el('div', { class: 'filtros' }, [
    campo('Mês', inpMes),
    campo('Forma', selForma),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}

function listagem(visiveis, ctx) {
  if (!visiveis.length) return el('p', { class: 'vazio', text: 'Nenhum lançamento neste filtro.' });
  const nome = (lista, id) => (lista.find((x) => x.id === id) || {}).nome || '—';

  return el('div', { class: 'lista-lancamentos' }, visiveis.map((t) =>
    el('div', { class: `item-lancamento ${t.natureza !== 'despesa' ? 'nao-gasto' : ''}` }, [
      el('div', { class: 'lanc-principal' }, [
        el('span', { class: 'lanc-descricao', text: t.descricao }),
        t.classificadoAutomaticamente ? el('span', { class: 'selo-auto', title: 'Categoria aplicada automaticamente', text: 'auto' }) : null,
      ]),
      el('div', { class: 'lanc-meta', text: `${formatDateBR(t.data)} · ${nome(ctx.categorias, t.categoria)} · ${nome(ctx.formas, t.formaPagamentoId)}` }),
      el('div', { class: 'lanc-valor', text: fmtBRL(t.valor) }),
      el('div', { class: 'acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluir(t) }),
      ]),
    ])
  ));
}

async function excluir(t) {
  if (!(await confirmar(`Excluir "${t.descricao}"?`))) return;
  await removeTransaction(t.id);
  toast('Lançamento excluído.', 'ok');
  await renderLancamentos();
}
```

- [ ] **Step 2: Ligar a tela em `src/app.js`**

Acrescente ao que já existe (não substitua a linha de Cadastros):

```js
import { renderLancamentos } from './ui/lancamentos.js';

const RENDERIZADORES = {
  Lancamentos: renderLancamentos,
  Cadastros: renderCadastros,
};
```

- [ ] **Step 3: Verificar no navegador**

1. Lançar um gasto com Pix; conferir que aparece na lista e entra no total do período.
2. Lançar um recebimento (natureza "Recebimento"); conferir que aparece na lista mas **não** muda o total de gastos.
3. Recarregar a página e lançar de novo: a forma de pagamento vem pré-selecionada com a última usada.
4. Editar um lançamento e conferir que os valores voltam corretos ao formulário.
5. Filtrar por mês e por forma; conferir que o total acompanha o filtro.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Adiciona aba Lancamentos com forma de pagamento e natureza

A forma vem pre-selecionada com a ultima usada porque lancar um gasto e a acao
mais repetida do app, e um campo a mais para preencher toda vez e atrito real.
Editar a categoria de um lancamento classificado automaticamente remove o selo
auto: a escolha do usuario deixa de ser palpite da maquina.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: `ui/onboarding.js` — primeira execução e migração

> **ESCOPO REDUZIDO em 2026-07-31 por decisão direta do usuário:** a migração de lançamentos e faturas via leitura ao vivo do IndexedDB do app anterior (`importers/legacy-idb.js` e a seção 5.7 do spec) foi removida do escopo da Fase 1. O usuário optou por não trazer esse histórico; backup/restore do app novo (Task 10) e a importação de backup `.xlsx` v1 do app anterior (via `migrateV1ToV2`, que `importers/backup-xlsx.js` continua usando) cobrem a necessidade real. Ver ledger da Task 14 para o histórico completo da decisão e da correção.

Onde o usuário cadastra suas contas (que não podem estar no código, por o repositório ser público). Leia a seção 5.7 do spec para o contexto histórico da migração — a leitura ao vivo do app anterior que ela descreve não foi implementada.

**Files:**
- Create: `src/ui/onboarding.js`
- Modify: `src/ui/cadastros.js` (botão "Migrar dados do app anterior" na seção Backup)

**Interfaces:**
- Consumes: `importers/legacy-idb.js`, `domain/accounts.js`, `ui/components.js`, `core/storage.js`
- Produces: `talvezOferecerOnboarding() -> Promise<void>`, `migrarDoAppAnterior() -> Promise<void>`

- [ ] **Step 1: Implementar `src/ui/onboarding.js`**

```js
// Primeira execução: cadastro inicial e migração do app anterior.
//
// Os dados de conta do usuário não podem vir no código porque o repositório é
// público — por isso este assistente existe em vez de um seed.

import { el, toast, abrirModal } from './components.js';
import { legacyDatabaseExists, importLegacyInto } from '../importers/legacy-idb.js';
import { listAccounts, saveAccount, novaConta, novoCartao, validateAccount } from '../domain/accounts.js';
import { irParaAba } from './tabs.js';
import * as storage from '../core/storage.js';

export async function talvezOferecerOnboarding() {
  if (await storage.getMeta('onboardingConcluido', false)) return;
  const contas = await listAccounts();
  if (contas.length) {
    await storage.setMeta('onboardingConcluido', true);
    return;
  }

  const temLegado = await legacyDatabaseExists();
  const escolha = await abrirModal({
    titulo: 'Bem-vindo ao Livro de Gastos',
    corpo: el('div', {}, [
      el('p', { text: 'Para começar, cadastre a conta e o cartão que você usa. Seus dados ficam só neste aparelho.' }),
      temLegado
        ? el('p', { text: 'Encontrei os dados do app de cartão de crédito neste navegador. Posso trazer tudo para cá — lançamentos, categorias e faturas importadas — sem alterar o app antigo.' })
        : el('p', { class: 'ajuda', text: 'Se você usava o app anterior em outro aparelho, exporte um backup lá e importe em Cadastros.' }),
    ]),
    acoes: [
      { id: 'depois', rotulo: 'Depois' },
      ...(temLegado ? [{ id: 'migrar', rotulo: 'Trazer dados do app anterior' }] : []),
      { id: 'cadastrar', rotulo: 'Cadastrar agora', classe: 'btn-primario' },
    ],
  });

  if (escolha === 'migrar') return migrarDoAppAnterior();
  if (escolha === 'cadastrar') return assistenteCadastro();
}

async function assistenteCadastro() {
  const inpBanco = el('input', { type: 'text', placeholder: 'Ex.: Banco X' });
  const inpAgencia = el('input', { type: 'text', placeholder: '0000' });
  const inpNumero = el('input', { type: 'text', placeholder: '00000-0' });
  const inpCartaoNome = el('input', { type: 'text', placeholder: 'Ex.: Cartão principal' });
  const inpBandeira = el('input', { type: 'text', placeholder: 'visa / master' });
  const inpFinal = el('input', { type: 'text', inputmode: 'numeric', placeholder: '0000' });
  // Como o próprio usuário aparece nomeado no extrato dele quando transfere
  // entre contas próprias, e a grafia varia conforme o banco emissor. A Fase 2
  // usa isto para classificar essas linhas como transferência, e não gasto.
  const inpApelidos = el('input', { type: 'text', placeholder: 'Ex.: JOAO DA SILVA, JOAO SILVA' });

  const linha = (rotulo, controle) => el('label', { class: 'campo' }, [el('span', { text: rotulo }), controle]);

  const escolha = await abrirModal({
    titulo: 'Sua conta e seu cartão',
    corpo: el('div', { class: 'form' }, [
      el('h3', { text: 'Conta corrente' }),
      linha('Banco', inpBanco), linha('Agência', inpAgencia), linha('Número', inpNumero),
      el('h3', { text: 'Cartão de crédito' }),
      linha('Nome', inpCartaoNome), linha('Bandeira', inpBandeira), linha('Final (4 dígitos)', inpFinal),
      el('h3', { text: 'Seu nome no extrato' }),
      linha('Como você aparece (separe variações por vírgula)', inpApelidos),
      el('p', { class: 'ajuda', text: 'Quando você transfere dinheiro entre contas suas, seu nome aparece no extrato. Isso serve para o app não contar essas transferências como gasto.' }),
      el('p', { class: 'ajuda', text: 'Você pode cadastrar mais contas, cartões e adicionais depois, na aba Cadastros.' }),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Depois' }, { id: 'salvar', rotulo: 'Salvar', classe: 'btn-primario' }],
  });
  if (escolha !== 'salvar') return;

  const conta = novaConta({
    nome: `${inpBanco.value.trim()} — conta corrente`,
    instituicao: inpBanco.value.trim(),
    agencia: inpAgencia.value.trim(),
    numero: inpNumero.value.trim(),
  });
  const cartao = novoCartao({
    nome: inpCartaoNome.value.trim(),
    instituicao: inpBanco.value.trim(),
    bandeira: inpBandeira.value.trim().toLowerCase(),
    final: inpFinal.value.trim(),
    contaPagadoraId: conta.id,
  });

  const erros = [...validateAccount(conta, []), ...validateAccount(cartao, [conta])];
  if (erros.length) {
    toast(erros.join(' '), 'erro');
    return assistenteCadastro();
  }

  await saveAccount(conta);
  await saveAccount(cartao);
  await storage.setMeta(
    'apelidosTitular',
    inpApelidos.value.split(',').map((s) => s.trim()).filter(Boolean)
  );
  await storage.setMeta('onboardingConcluido', true);
  toast('Cadastro criado. Bom uso!', 'ok');
  irParaAba('Cadastros');
}

export async function migrarDoAppAnterior() {
  const contas = await listAccounts();
  const cartoes = contas.filter((a) => a.tipo === 'cartao');
  if (!cartoes.length) {
    await abrirModal({
      titulo: 'Cadastre o cartão primeiro',
      corpo: 'Os lançamentos do app anterior são todos de cartão de crédito, então preciso saber a qual cartão associá-los. Cadastre o cartão na aba Cadastros e volte aqui.',
    });
    return assistenteCadastro();
  }

  const selCartao = el('select', {}, cartoes.map((c) => el('option', { value: c.id, text: c.nome })));
  const escolha = await abrirModal({
    titulo: 'Trazer dados do app anterior',
    corpo: el('div', { class: 'form' }, [
      el('p', { text: 'Todos os lançamentos, categorias e faturas do app anterior serão copiados. O app antigo não é alterado e continua funcionando.' }),
      el('label', { class: 'campo' }, [el('span', { text: 'Associar os lançamentos a qual cartão?' }), selCartao]),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'migrar', rotulo: 'Trazer dados', classe: 'btn-primario' }],
  });
  if (escolha !== 'migrar') return;

  try {
    const { transactions, statements, avisos } = await importLegacyInto({
      cartaoTitularId: selCartao.value,
      formaCreditoId: 'pm_credito',
    });
    await storage.setMeta('onboardingConcluido', true);
    await abrirModal({
      titulo: 'Pronto',
      corpo: el('div', {}, [
        el('p', { text: `${transactions.length} lançamento(s) e ${statements.length} fatura(s) foram trazidos.` }),
        ...avisos.map((a) => el('p', { class: 'ajuda', text: a })),
      ]),
    });
    irParaAba('Lancamentos');
  } catch (e) {
    toast('Não consegui ler os dados do app anterior: ' + e.message, 'erro');
  }
}
```

- [ ] **Step 2: Ligar o assistente em `src/app.js` e o botão em Cadastros**

Em `src/app.js`, dentro de `boot()`, logo após `await renderizar('Lancamentos')`:

```js
import { talvezOferecerOnboarding } from './ui/onboarding.js';
// ...
await talvezOferecerOnboarding();
```

Em `src/ui/cadastros-backup.js`, importe `migrarDoAppAnterior` e acrescente ao bloco de ações:

```js
el('button', { class: 'btn', text: 'Migrar dados do app anterior', onclick: migrarDoAppAnterior }),
```

- [ ] **Step 3: Verificar o caminho de migração com dados de verdade**

Este é o passo mais importante da fase: é o momento em que os dados reais do usuário atravessam.

1. Sirva o app em `http://localhost:8000` e, **na mesma origem**, sirva também o app anterior (copie-o para uma subpasta temporária fora do repositório, ou use o app publicado). Abra o app anterior primeiro para que o banco `livro-de-gastos` exista nessa origem.
2. Abra o app novo, cadastre um cartão e acione "Migrar dados do app anterior".
3. Confirme: a contagem de lançamentos bate com a do app anterior; as faturas vieram; os lançamentos de parcela mantêm o número da parcela.
4. **Confirme que o app anterior continua funcionando** — abra-o de novo e verifique que os dados dele estão intactos. A migração lê, nunca escreve.
5. Rode a migração uma segunda vez e confirme que nada duplicou.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Adiciona assistente de primeira execucao e migracao do app anterior

Os dados de conta do usuario nao podem vir em seed porque o repositorio e
publico, entao o cadastro inicial e um assistente. A migracao le o banco do
app anterior na mesma origem, sem escrever nele: o app antigo segue intacto e
utilizavel como retaguarda.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: PWA e publicação

> **AJUSTADO em 2026-07-31, decorrente da redução de escopo da Task 14:** `src/importers/legacy-idb.js` foi apagado e não deve constar do `PRECACHE` do service worker. As verificações do Step 5 que dependiam da migração ao vivo do app anterior foram substituídas por verificações do que existe de fato hoje.
>
> **Também ajustado o momento da publicação:** esta task ainda está sendo executada na branch `fase-1-fundacao`, e a revisão final da branch inteira (que ainda não rodou) pode gerar correções. Publicar no GitHub Pages e instalar no celular é uma ação pouco reversível e visível para fora do processo de revisão — o Step 4 original (`git push origin main` + ativar Pages) fica adiado para depois da revisão final e do merge via `finishing-a-development-branch`, não dentro desta task. Esta task entrega e verifica a infraestrutura da PWA na própria branch; a publicação de fato é o último passo do fechamento da fase.

**Files:**
- Create: `sw.js`, `manifest.webmanifest`
- Modify: `src/version.js`, `README.md`

**Interfaces:**
- Consumes: `src/version.js` (`APP_VERSION`)
- Produces: app publicado em `https://renewsolutionsbr.github.io/Financas/`

- [ ] **Step 1: Criar `manifest.webmanifest`**

```json
{
  "name": "Livro de Gastos",
  "short_name": "Gastos",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "background_color": "#f4efe4",
  "theme_color": "#f4efe4",
  "lang": "pt-BR",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Criar `sw.js` importando a versão de um lugar só**

O app anterior exigia lembrar de subir `CACHE_VERSION` à mão a cada publicação — esquecer significava aparelhos servindo arquivos velhos indefinidamente. Aqui existe **um** lugar para alterar.

```js
// Service worker. A versão vem de src/version.js: há um único lugar para
// alterar a cada publicação, e esquecer de subir a versão deixava aparelhos
// servindo arquivos antigos do cache indefinidamente.
import { APP_VERSION } from './src/version.js';

const CACHE = `livro-de-gastos-${APP_VERSION}`;

const PRECACHE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/version.js',
  './src/core/storage.js', './src/core/db-schema.js', './src/core/money.js',
  './src/core/dates.js', './src/core/text.js', './src/core/ids.js',
  './src/domain/categories.js', './src/domain/accounts.js',
  './src/domain/payment-methods.js', './src/domain/transactions.js',
  './src/importers/backup-xlsx.js',
  './src/ui/components.js', './src/ui/tabs.js', './src/ui/cadastros.js',
  './src/ui/cadastros-contas.js', './src/ui/cadastros-formas.js',
  './src/ui/cadastros-categorias.js', './src/ui/cadastros-backup.js',
  './src/ui/cadastros-comuns.js',
  './src/ui/lancamentos.js', './src/ui/onboarding.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copia));
        return resp;
      })
      .catch(() => caches.match(ev.request).then((r) => r || caches.match('./index.html')))
  );
});

self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting();
});
```

Registre-o como módulo, já que ele usa `import`. Em `src/app.js`, ajuste:

```js
navigator.serviceWorker.register('sw.js', { type: 'module' });
```

- [ ] **Step 3: Rodar a suíte inteira antes de publicar**

Run: `node tools/run-tests.mjs`
Expected: PASS, sem nenhuma falha.

Abra `http://localhost:8000/tools/tests.html`.
Expected: todos verdes, incluindo os de navegador.

- [ ] **Step 4: Verificar a PWA localmente, na própria branch**

Sem publicar ainda (isso fica para depois da revisão final da branch inteira — ver nota no topo desta task). Usando o servidor estático local (a mesma origem já usada nos testes de navegador desta fase):

1. Abra o app pela raiz do servidor local, confirme no DevTools → Application → Service Workers que `sw.js` registrou e instalou, e que `caches` tem uma entrada `livro-de-gastos-<versão>` com o `PRECACHE` inteiro.
2. Simule offline (DevTools → Network → Offline) e recarregue: o app deve abrir normalmente, servido do cache.
3. Suba `APP_VERSION` em `src/version.js`, recarregue, e confirme que o cache antigo é removido (`activate` limpando as chaves que não batem com `CACHE`) e o novo é instalado.
4. Confirme que nada em `PRECACHE` aponta para um arquivo que não existe mais no repositório (checagem direta contra a lista de arquivos de `src/`, depois da Task 14 ter removido `importers/legacy-idb.js`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona PWA com service worker de versao unica

A versao do cache vem de src/version.js em vez de uma constante duplicada no
sw.js: esquecer de subi-la deixava aparelhos servindo arquivos antigos
indefinidamente, que era o risco registrado no app anterior.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**A publicação de fato (merge para `main`, ativar GitHub Pages, instalar no celular, verificar offline no aparelho real) acontece depois da revisão final de toda a branch, como parte do fechamento da fase — não dentro desta task.**

---

## Verificação de fim de fase

Antes de declarar a Fase 1 concluída, confirme cada item com evidência, não por impressão:

- [ ] `node tools/run-tests.mjs` termina com código 0 e nenhuma falha
- [ ] `tools/tests.html` mostra todos os testes verdes, inclusive os de IndexedDB
- [ ] O app anterior continua íntegro (nenhum código no repositório abre `livro-de-gastos` para escrita — Task 14 removeu a leitura ao vivo por decisão do usuário)
- [ ] Um ciclo exportar backup → importar backup devolve o mesmo conjunto de dados (Task 10)
- [ ] Um backup `.xlsx` no formato v1 do app anterior importa corretamente pelo caminho de `backup-xlsx.js`/`migrateV1ToV2` (única porta de dado histórico que resta)
- [ ] `git status --porcelain` não lista nenhum `.pdf`, `.xls`, `.xlsx` ou `.csv` fora do ignore
- [ ] Nenhum número de conta, agência, final de cartão real ou nome de pessoa aparece em `git grep` no repositório
- [ ] A PWA instala e abre offline no celular do usuário
- [ ] O usuário conseguiu lançar um gasto real pelo aparelho dele

Só então escreva o plano da Fase 2.
