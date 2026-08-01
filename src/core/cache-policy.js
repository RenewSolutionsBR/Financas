// Regra pura sobre o que o service worker pode gravar no cache offline.
// Extraída para ser testável em Node: um 503 transitório, um 404 de deploy
// ou uma página de captive portal gravados por cima do precache bom
// envenenariam o cache permanentemente (só se cura se o usuário estiver
// online exatamente quando aquela URL for pedida de novo, já que o nome do
// cache só muda com APP_VERSION).
export function respostaCacheavel(resp) {
  if (!resp) return false;
  // type === 'basic': resposta da mesma origem. Respostas opacas (type
  // 'opaque', típicas de requests cross-origin no-cors) não expõem status
  // real e não devem ser guardadas como se fossem um recurso do próprio app.
  return resp.ok === true && resp.type === 'basic';
}

// Regra pura sobre quais caches o `activate` do service worker pode apagar.
// `caches.keys()` é por ORIGEM, não por escopo de service worker — no GitHub
// Pages, este app e o app anterior (de cartão de crédito) vivem na mesma
// origem, em caminhos diferentes. Um `activate` que apaga "tudo que não é o
// cache atual" apaga também o cache offline do app anterior, que o usuário
// ainda usa. O prefixo restringe a limpeza aos caches deste app.
export function cachesParaApagar(chaves, cacheAtual, prefixo) {
  return (chaves || []).filter((k) => k.startsWith(prefixo) && k !== cacheAtual);
}
