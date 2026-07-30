// Service worker placeholder: só existe para que o registro em app.js não
// falhe com 404. A estratégia de cache offline é infraestrutura de uma
// tarefa futura; este arquivo ainda não intercepta nenhuma requisição.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));
