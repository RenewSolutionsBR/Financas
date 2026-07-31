// Testes de ui/onboarding.js dirigindo o modal real (abrirModal usa o DOM):
// só rodam no navegador (tools/tests.html). tools/tests.html não tem
// #modalRaiz/#toastRaiz por padrão (só index.html tem) — este arquivo os
// monta, do mesmo jeito que lancamentos.browser.test.js monta #tabLancamentos.
//
// O banco antigo real só existe na origem do GitHub Pages; aqui usamos o
// mesmo banco "livro-de-gastos" falso de legacy-idb.browser.test.js
// (fixtures/fake-legacy-db.js) para exercitar migrarDoAppAnterior() de ponta
// a ponta, inclusive clicando duas vezes para confirmar que a UI não duplica.

import { describe, it, assert, assertEqual } from './harness.js';
import { talvezOferecerOnboarding, migrarDoAppAnterior } from '../src/ui/onboarding.js';
import { TIPO_CONTA, TIPO_CARTAO, saveAccount, removeAccount } from '../src/domain/accounts.js';
import * as storage from '../src/core/storage.js';
import { criarBancoLegadoFalso, derrubarBancoLegadoFalso } from './fixtures/fake-legacy-db.js';

function montarRaizes() {
  if (!document.getElementById('modalRaiz')) {
    document.body.appendChild(Object.assign(document.createElement('div'), { id: 'modalRaiz' }));
  }
  if (!document.getElementById('toastRaiz')) {
    document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toastRaiz' }));
  }
  document.getElementById('modalRaiz').innerHTML = '';
  document.getElementById('toastRaiz').innerHTML = '';
}

async function esperarBotaoModal(rotulo, tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    const botoes = [...document.querySelectorAll('#modalRaiz button')];
    const alvo = botoes.find((b) => b.textContent === rotulo);
    if (alvo) return alvo;
    await new Promise((r) => setTimeout(r, 20));
  }
  const presentes = [...document.querySelectorAll('#modalRaiz button')].map((b) => b.textContent);
  throw new Error(`botao "${rotulo}" nao apareceu no modal a tempo (presentes: ${presentes.join(', ') || 'nenhum'})`);
}

async function clicarBotaoModal(rotulo) {
  (await esperarBotaoModal(rotulo)).click();
}

async function esperarSelectModal(tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    const sel = document.querySelector('#modalRaiz select');
    if (sel) return sel;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('select nao apareceu no modal a tempo');
}

const DADOS_LEGADO_ONBOARDING = {
  expenses: [
    { id: 'onb_e1', descricao: 'Mercado teste', valor: 50, data: '2026-05-01', categoria: 'a_classificar' },
    { id: 'onb_e2', descricao: 'Posto teste', valor: 80, data: '2026-05-02', categoria: 'a_classificar' },
  ],
  categories: [],
  faturas: [{ vencimento: '2026-05-10', dataCorte: '2026-05-03', arquivo: 'fatura-onb.pdf', importedAt: 1, rows: [{ valor: 50 }, { valor: 80 }] }],
  meta: [],
};

async function limparDadosDaMigracao(cartaoId) {
  const trans = await storage.getAll('transactions');
  for (const t of trans.filter((t) => t.contaId === cartaoId)) await storage.remove('transactions', t.id);
  const stmts = await storage.getAll('statements');
  for (const s of stmts.filter((s) => s.contaId === cartaoId)) await storage.remove('statements', s.id);
}

describe('onboarding: guardas de talvezOferecerOnboarding', () => {
  it('nao abre modal quando onboardingConcluido ja esta true, mesmo sem conta cadastrada', async () => {
    montarRaizes();
    await storage.setMeta('onboardingConcluido', true);
    try {
      await talvezOferecerOnboarding();
      assertEqual(document.getElementById('modalRaiz').innerHTML, '', 'nao deveria ter aberto modal nenhum');
    } finally {
      await storage.remove('meta', 'onboardingConcluido');
    }
  });

  it('nao abre modal e marca onboardingConcluido quando ja existe conta cadastrada', async () => {
    montarRaizes();
    await storage.remove('meta', 'onboardingConcluido');
    const conta = { id: 'acc_teste_onboarding_guarda', tipo: TIPO_CONTA, nome: 'Teste', agencia: '1', numero: '2' };
    await saveAccount(conta);
    try {
      await talvezOferecerOnboarding();
      assertEqual(document.getElementById('modalRaiz').innerHTML, '', 'nao deveria ter aberto modal com conta ja cadastrada');
      assertEqual(await storage.getMeta('onboardingConcluido', false), true, 'devia marcar onboarding como concluido');
    } finally {
      await removeAccount(conta.id, []);
      await storage.remove('meta', 'onboardingConcluido');
    }
  });
});

describe('onboarding: migrarDoAppAnterior pela UI real', () => {
  it('traz os dados pelo modal e, clicando duas vezes, nao duplica', async () => {
    montarRaizes();
    const cartao = { id: 'acc_teste_cartao_onboarding', tipo: TIPO_CARTAO, nome: 'Cartao Teste', final: '1234', bandeira: 'visa', ativo: true };
    await saveAccount(cartao);
    await criarBancoLegadoFalso(DADOS_LEGADO_ONBOARDING);
    try {
      // Primeira rodada: abre o modal de escolha do cartao, fixa a selecao no
      // cartao deste teste (o ambiente pode ter outros cartoes cadastrados, e
      // o <select> nao pode depender de qual opcao caiu primeiro por acaso),
      // clica em migrar, depois fecha o modal de confirmacao "Pronto".
      let corrida = migrarDoAppAnterior();
      (await esperarSelectModal()).value = cartao.id;
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK');
      await corrida;

      let transacoes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(transacoes.length, 2, 'esperava os dois lancamentos do banco legado falso');

      // Segunda rodada pela mesma UI: nao pode duplicar.
      corrida = migrarDoAppAnterior();
      (await esperarSelectModal()).value = cartao.id;
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK');
      await corrida;

      transacoes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(transacoes.length, 2, 'rodar a migracao duas vezes pela UI nao pode duplicar lancamentos');

      const faturas = (await storage.getAll('statements')).filter((s) => s.contaId === cartao.id);
      assertEqual(faturas.length, 1, 'rodar a migracao duas vezes pela UI nao pode duplicar faturas');
    } finally {
      await derrubarBancoLegadoFalso();
      await limparDadosDaMigracao(cartao.id);
      await removeAccount(cartao.id, []);
      await storage.remove('meta', 'onboardingConcluido');
    }
  });

  it('sem cartao cadastrado, pede para cadastrar em vez de tentar migrar', async () => {
    montarRaizes();
    // Garante que nao ha nenhum cartao no banco: conta corrente sem cartao.
    const conta = { id: 'acc_teste_sem_cartao', tipo: TIPO_CONTA, nome: 'Conta sem cartao', agencia: '1', numero: '2' };
    await saveAccount(conta);
    try {
      const corrida = migrarDoAppAnterior();
      const titulo = await (async () => {
        for (let i = 0; i < 100; i++) {
          const h2 = document.querySelector('#modalRaiz h2');
          if (h2) return h2.textContent;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error('modal nao apareceu a tempo');
      })();
      assertEqual(titulo, 'Cadastre o cartão primeiro');
      await clicarBotaoModal('OK');
      // migrarDoAppAnterior() encadeia em assistenteCadastro(); fecha com "Depois".
      await clicarBotaoModal('Depois');
      await corrida;
    } finally {
      await removeAccount(conta.id, []);
      await storage.remove('meta', 'onboardingConcluido');
    }
  });
});
