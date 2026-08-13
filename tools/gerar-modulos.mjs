// Gera src/core/modulos.js a partir do que existe em src/. Não é parte do
// app: rode à mão (`node tools/gerar-modulos.mjs`) depois de criar ou
// remover qualquer módulo, para que o import map (index.html) e o precache
// do service worker (sw.js) continuem cobrindo a árvore inteira.
//
// Existe porque a lista do precache era mantida à mão e tinha silenciosamente
// ficado com 29 dos 50 módulos — um arquivo esquecido lá só se manifestava
// como falha offline, sem nenhum erro visível.

import { readdirSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dirSrc = join(raiz, 'src');

function listarJs(dir) {
  const achados = [];
  for (const nome of readdirSync(dir).sort()) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) achados.push(...listarJs(caminho));
    else if (nome.endsWith('.js')) achados.push(caminho);
  }
  return achados;
}

const modulos = listarJs(dirSrc)
  .map((c) => './' + relative(raiz, c).split('\\').join('/'))
  .sort();

const conteudo = `// GERADO POR tools/gerar-modulos.mjs — não edite à mão.
// Rode \`node tools/gerar-modulos.mjs\` depois de criar ou remover um módulo.
//
// Lista de TODOS os módulos ES do app. Fonte única para dois consumidores
// que antes mantinham listas próprias e saíram de sincronia:
//
// 1. index.html — monta o import map que põe \`?v=APP_VERSION\` na URL de
//    cada módulo. Sem isso o navegador serve código velho do cache HTTP por
//    até 10 minutos depois de uma publicação (o GitHub Pages manda
//    \`Cache-Control: max-age=600\`, medido em 2026-08-13), mostrando a
//    versão nova no rodapé enquanto roda a lógica antiga.
// 2. sw.js — precache do service worker (uso offline).
export const MODULOS = [
${modulos.map((m) => `  '${m}',`).join('\n')}
];
`;

const destino = join(dirSrc, 'core', 'modulos.js');
const anterior = (() => { try { return readFileSync(destino, 'utf8'); } catch { return null; } })();
writeFileSync(destino, conteudo);
console.log(`${modulos.length} módulo(s) listados em src/core/modulos.js${anterior === conteudo ? ' (sem mudança)' : ''}`);
