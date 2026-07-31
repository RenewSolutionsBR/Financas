// Helper de teste PURO (não é código do app): decide se a origem atual é
// segura para a suíte de testes de navegador rodar — ela grava/apaga dados
// de verdade no banco `financas` (accounts.browser.test.js,
// onboarding.browser.test.js, storage.browser.test.js, etc.), e tools/
// tests.html é servido pela mesma origem de produção que o usuário usa.
//
// Extraído para um módulo à parte, em vez de embutido como uma expressão
// solta em tools/tests.html, para que a decisão em si seja testável no
// Node: `location` é unforgeable num navegador de verdade (não dá pra
// sobrescrever `location.hostname` num teste para simular a origem de
// produção), então sem esta extração a única forma de conferir a guarda
// seria ler o código à mão.
export function origemSeguraParaTestesDestrutivos(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
