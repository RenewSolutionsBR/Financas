// Lista central de módulos de teste. Os dois runners importam daqui, porque
// nem o navegador nem o Node conseguem descobrir arquivos por glob sem build.

// Testes de lógica pura: rodam nos dois alvos.
export const TEST_MODULES = [
  './harness.test.js',
  './money.test.js',
  './dates.test.js',
  './text.test.js',
  './ids.test.js',
  './migration.test.js',
  './categories.test.js',
  './accounts.test.js',
  './payment-methods.test.js',
  './transactions.test.js',
  './backup.test.js',
  './lancamentos.test.js',
];

// Testes que dependem de IndexedDB ou DOM: só no navegador.
export const BROWSER_ONLY_MODULES = [
  './storage.browser.test.js',
  './backup.browser.test.js',
  './accounts.browser.test.js',
  './lancamentos.browser.test.js',
];
