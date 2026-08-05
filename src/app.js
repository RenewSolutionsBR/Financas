// Boot e roteamento. Nenhuma regra de negócio e nenhuma manipulação de dados
// mora aqui: este arquivo só decide o que renderizar.

import { initTabs } from './ui/tabs.js';
import { toast } from './ui/components.js';
import { seedCategoriasIfEmpty } from './domain/categories.js';
import { seedFormasIfEmpty } from './domain/payment-methods.js';
import { renderCadastros } from './ui/cadastros.js';
import { renderLancamentos, resetLancamentos } from './ui/lancamentos.js';
import { renderParcelas } from './ui/parcelas.js';
import { renderConciliacao } from './ui/conciliacao.js';
import { renderDashboard } from './ui/dashboard.js';
import { talvezOferecerOnboarding } from './ui/onboarding.js';

const RENDERIZADORES = {
  Lancamentos: renderLancamentos,
  Cadastros: renderCadastros,
  Parcelas: renderParcelas,
  Conciliacao: renderConciliacao,
  Dashboard: renderDashboard,
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
    // Dispara antes do onboarding de propósito: talvezOferecerOnboarding()
    // pode ficar minutos esperando o usuário preencher conta e cartão no
    // modal de boas-vindas, e as duas chamadas abaixo são fire-and-forget
    // (não são aguardadas, e o registro do SW já engole falha). Se ficassem
    // depois do onboarding, o cache offline e a persistência de storage só
    // existiriam depois que o usuário terminasse de interagir com o modal —
    // exatamente na primeira visita, que é quando mais importa ter cache.
    registrarServiceWorker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await talvezOferecerOnboarding();
  } catch (e) {
    toast('Erro ao iniciar o app: ' + e.message, 'erro');
    throw e;
  }
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // sw.js usa import para ler a versão de src/version.js, por isso precisa
  // ser registrado como módulo. updateViaCache: 'none' evita que o HTTP
  // cache do navegador segure uma cópia velha do import de src/version.js
  // entre publicações (o servidor local manda no-store, mas GitHub Pages
  // não necessariamente). Falha de registro não pode virar erro de console
  // nem travar o boot: o app funciona sem service worker, só perde o cache
  // offline.
  navigator.serviceWorker
    .register('sw.js', { type: 'module', updateViaCache: 'none' })
    .catch(() => {});
}

boot();
