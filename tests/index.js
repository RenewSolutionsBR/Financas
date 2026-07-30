// Lista central de módulos de teste. Os dois runners importam daqui, porque
// nem o navegador nem o Node conseguem descobrir arquivos por glob sem build.
export const TEST_MODULES = [
  './harness.test.js',
  './money.test.js',
  './dates.test.js',
  './text.test.js',
  './ids.test.js',
];
