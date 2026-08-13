// Service worker. A versão vem de src/version.js: há um único lugar para
// alterar a cada publicação, e esquecer de subir a versão deixava aparelhos
// servindo arquivos antigos do cache indefinidamente.
import { APP_VERSION } from './src/version.js';
import { respostaCacheavel, cachesParaApagar } from './src/core/cache-policy.js';
import { MODULOS } from './src/core/modulos.js';

// Mesmo namespace do banco deste app (db-schema.js: DB_NAME = 'financas'),
// nunca o nome do app anterior ('livro-de-gastos'): caches.keys() é por
// ORIGEM, e este app e o app de cartão de crédito que já está em produção
// vivem na mesma origem no GitHub Pages, em caminhos diferentes. Um cache
// chamado "livro-de-gastos-*" correria o risco de colidir com (ou ser
// apagado/sobrescrito por engano por) o cache do app anterior.
const PREFIXO_CACHE = 'financas-';
const CACHE = `${PREFIXO_CACHE}${APP_VERSION}`;

// A lista de modulos vem de src/core/modulos.js (gerada por
// tools/gerar-modulos.mjs), nao mais escrita a mao aqui: a versao manual
// tinha silenciosamente ficado com 29 dos 50 modulos do app, e um arquivo
// esquecido so se manifestava como falha offline, sem erro visivel.
//
// Cada modulo e precacheado COM a query `?v=APP_VERSION`, porque e essa a
// URL que o import map do index.html manda o navegador buscar — precachear
// a URL sem query encheria o cache de entradas que nunca seriam usadas.
const PRECACHE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  ...MODULOS.map((m) => `${m}?v=${APP_VERSION}`),
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-512-maskable.png', './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(cachesParaApagar(chaves, CACHE, PREFIXO_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Arquivos que DECIDEM qual versao do app roda e que, por isso, nunca podem
// vir do cache HTTP do navegador:
//
// - o HTML (entrypoint, carrega o import map com a versao)
// - version.js (a propria versao)
// - modulos.js (a lista que o import map percorre)
//
// Os tres sao buscados antes de o import map existir, entao a query
// `?v=APP_VERSION` nao os protege. E o GitHub Pages manda
// `Cache-Control: max-age=600` (medido 2026-08-13): por 10 minutos o
// navegador serviria a copia velha SEM perguntar ao servidor, e o app
// ficaria rodando codigo antigo mesmo depois de uma publicacao — foi
// exatamente o que aconteceu em v20, v22 e v23.
//
// `cache: 'reload'` obriga a ida ao servidor para esses tres (o resto da
// arvore ja esta protegido pela query de versao). Se a rede falhar, o
// `.catch` abaixo continua servindo o cache — offline segue funcionando.
function ignoraCacheHTTP(request) {
  if (request.mode === 'navigate') return true;
  const caminho = new URL(request.url).pathname;
  return /\/(index\.html)?$/.test(caminho) ||
    caminho.endsWith('/src/version.js') ||
    caminho.endsWith('/src/core/modulos.js');
}

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  const requisicao = ignoraCacheHTTP(ev.request)
    ? new Request(ev.request, { cache: 'reload' })
    : ev.request;
  ev.respondWith(
    fetch(requisicao)
      .then((resp) => {
        // Só grava no cache resposta de sucesso da própria origem. Gravar um
        // 503/404 transitório por cima do precache bom envenenaria o cache
        // até a próxima troca de APP_VERSION — é o requisito "abre offline"
        // quebrado bem na hora que mais importa.
        if (respostaCacheavel(resp)) {
          const copia = resp.clone();
          ev.waitUntil(
            caches.open(CACHE).then((c) => c.put(ev.request, copia)).catch(() => {})
          );
        }
        return resp;
      })
      .catch(() => caches.match(ev.request).then((r) => r || caches.match('./index.html')))
  );
});

self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting();
});
