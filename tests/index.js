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
  './lancamentos-filtros.test.js',
  './cadastros-comuns.test.js',
  './origem-teste.test.js',
  './cache-policy.test.js',
  './registry.test.js',
  './classification.test.js',
  './parcelas.test.js',
  './lancamentos-parcelado.test.js',
  './reconcile-card.test.js',
  './reconcile-bank.test.js',
  './pagamento-fatura.test.js',
  './santander-cartao-pdf.test.js',
  './santander-cartao-pdf-extrair.test.js',
  './santander-extrato-xls.test.js',
  './generic-table.test.js',
  './conciliacao-import.test.js',
];

// Testes que dependem de IndexedDB ou DOM: só no navegador.
export const BROWSER_ONLY_MODULES = [
  './storage.browser.test.js',
  './backup.browser.test.js',
  './accounts.browser.test.js',
  './lancamentos.browser.test.js',
  './onboarding.browser.test.js',
];
