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
