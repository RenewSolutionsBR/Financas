// Boot e roteamento. Nenhuma regra de negócio e nenhuma manipulação de dados
// mora aqui: este arquivo só decide o que renderizar.

import { initTabs } from './ui/tabs.js';
import { toast } from './ui/components.js';
import { seedCategoriasIfEmpty } from './domain/categories.js';
import { seedFormasIfEmpty } from './domain/payment-methods.js';
import { renderCadastros } from './ui/cadastros.js';

// As telas restantes entram nas tarefas 13 e 14. Cada uma acrescenta o
// próprio import e a própria linha em RENDERIZADORES ao ser criada — nada de
// import comentado esperando por um arquivo que ainda não existe.
const RENDERIZADORES = {
  Cadastros: renderCadastros,
};

async function renderizar(aba) {
  const fn = RENDERIZADORES[aba];
  if (fn) await fn();
}

async function boot() {
  try {
    await seedCategoriasIfEmpty();
    await seedFormasIfEmpty();
    initTabs(renderizar);
    await renderizar('Lancamentos');
    registrarServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    toast('Erro ao iniciar o app: ' + e.message, 'erro');
    throw e;
  }
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // sw.js chega numa tarefa de infraestrutura futura. Falha de registro (por
  // exemplo o arquivo ainda não existir) não pode virar erro de console nem
  // travar o boot: o app funciona sem service worker, só perde o cache offline.
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
