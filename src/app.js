// Boot e roteamento. Nenhuma regra de negócio e nenhuma manipulação de dados
// mora aqui: este arquivo só decide o que renderizar.

import { initTabs } from './ui/tabs.js';
import { toast } from './ui/components.js';
import { seedCategoriasIfEmpty } from './domain/categories.js';
import { seedFormasIfEmpty } from './domain/payment-methods.js';
import { renderCadastros } from './ui/cadastros.js';
import { renderLancamentos, resetLancamentos } from './ui/lancamentos.js';
import { talvezOferecerOnboarding } from './ui/onboarding.js';

const RENDERIZADORES = {
  Lancamentos: renderLancamentos,
  Cadastros: renderCadastros,
};

async function renderizar(aba) {
  // Lancamentos guarda estado entre renders de propósito (filtro aplicado,
  // edição em curso) porque o re-render interno da própria tela reusa esse
  // estado — é assim que trocar o filtro de mês continua filtrado. Mas entrar
  // na aba vindo de outro lugar (clique na barra de abas) precisa começar
  // limpo: sem isso, editar um lançamento, ir para Cadastros e voltar reabria
  // o formulário armado para sobrescrever o lançamento antigo.
  if (aba === 'Lancamentos') resetLancamentos();
  const fn = RENDERIZADORES[aba];
  if (fn) await fn();
}

async function boot() {
  try {
    await seedCategoriasIfEmpty();
    await seedFormasIfEmpty();
    initTabs(renderizar);
    await renderizar('Lancamentos');
    await talvezOferecerOnboarding();
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
