// Helper de teste PURO (não é código do app): decide se a origem atual é
// seguro para operações DESTRUTIVAS de teste (apagar/recriar bancos
// IndexedDB, incluindo o banco `livro-de-gastos` do app anterior).
//
// Extraído para um módulo à parte, em vez de embutido como uma expressão
// solta em fake-legacy-db.js e tools/tests.html, para que a decisão em si
// seja testável no Node: `location` é unforgeable num navegador de verdade
// (não dá pra sobrescrever `location.hostname` num teste para simular a
// origem de produção), então sem esta extração a única forma de conferir a
// guarda seria ler o código à mão.
export function origemSeguraParaTestesDestrutivos(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
