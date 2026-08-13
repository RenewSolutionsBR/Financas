// Service worker. A versão vem de src/version.js: há um único lugar para
// alterar a cada publicação, e esquecer de subir a versão deixava aparelhos
// servindo arquivos antigos do cache indefinidamente.
import { APP_VERSION } from './src/version.js';
import { respostaCacheavel, cachesParaApagar } from './src/core/cache-policy.js';

// Mesmo namespace do banco deste app (db-schema.js: DB_NAME = 'financas'),
// nunca o nome do app anterior ('livro-de-gastos'): caches.keys() é por
// ORIGEM, e este app e o app de cartão de crédito que já está em produção
// vivem na mesma origem no GitHub Pages, em caminhos diferentes. Um cache
// chamado "livro-de-gastos-*" correria o risco de colidir com (ou ser
// apagado/sobrescrito por engano por) o cache do app anterior.
const PREFIXO_CACHE = 'financas-';
const CACHE = `${PREFIXO_CACHE}${APP_VERSION}`;

const PRECACHE = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/version.js',
  './src/core/storage.js', './src/core/db-schema.js', './src/core/money.js',
  './src/core/dates.js', './src/core/text.js', './src/core/ids.js',
  './src/core/cache-policy.js',
  './src/domain/categories.js', './src/domain/accounts.js',
  './src/domain/payment-methods.js', './src/domain/transactions.js',
  './src/importers/backup-xlsx.js',
  './src/ui/components.js', './src/ui/tabs.js', './src/ui/cadastros.js',
  './src/ui/cadastros-contas.js', './src/ui/cadastros-formas.js',
  './src/ui/cadastros-categorias.js',
  './src/ui/cadastros-comuns.js',
  './src/ui/lancamentos.js', './src/ui/onboarding.js',
  './src/ui/ferramentas.js', './src/ui/backup-comum.js',
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

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    fetch(ev.request)
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
