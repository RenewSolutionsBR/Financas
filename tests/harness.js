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
