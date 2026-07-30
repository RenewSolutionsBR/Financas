// Executa a suíte no Node. Não é parte do app: nenhum arquivo de src/ importa daqui.
import { runAll } from '../tests/harness.js';
import { TEST_MODULES, BROWSER_ONLY_MODULES } from '../tests/index.js';

for (const mod of TEST_MODULES) {
  await import(new URL(mod.replace('./', '../tests/'), import.meta.url).href);
}

const { total, passed, failed, results } = await runAll();

for (const r of results) {
  if (!r.ok) console.error(`FALHOU  ${r.suite} > ${r.teste}\n        ${r.erro}`);
}
console.log(`\n${passed}/${total} passaram${failed ? `, ${failed} falharam` : ''}`);
console.log(`${BROWSER_ONLY_MODULES.length} módulo(s) só de navegador não rodaram aqui: abra tools/tests.html`);
process.exit(failed ? 1 : 0);
