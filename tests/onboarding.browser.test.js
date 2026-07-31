// Testes de ui/onboarding.js dirigindo o modal real (abrirModal usa o DOM):
// só rodam no navegador (tools/tests.html). tools/tests.html não tem
// #modalRaiz/#toastRaiz por padrão (só index.html tem) — este arquivo os
// monta, do mesmo jeito que lancamentos.browser.test.js monta #tabLancamentos.
//
// Por decisão do usuário (2026-07-31), o assistente não migra mais dados do
// app anterior via leitura do IndexedDB dele — só cadastra conta e cartão.
// Os describes que exercitavam esse fluxo (migrarDoAppAnterior, banco legado
// falso) foram removidos junto com src/importers/legacy-idb.js e
// tests/fixtures/fake-legacy-db.js.

import { describe, it, assertEqual } from './harness.js';
import { talvezOferecerOnboarding } from '../src/ui/onboarding.js';
import { TIPO_CONTA, TIPO_CARTAO, listAccounts, saveAccount, removeAccount } from '../src/domain/accounts.js';
import * as storage from '../src/core/storage.js';

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

async function esperarBotaoModal(rotulo, tentativas = 150) {
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

async function esperarInputModal(seletor, tentativas = 150) {
  for (let i = 0; i < tentativas; i++) {
    const alvo = document.querySelector('#modalRaiz ' + seletor);
    if (alvo) return alvo;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`input "${seletor}" nao apareceu no modal a tempo`);
}

async function esperarToast(padrao, tentativas = 150) {
  for (let i = 0; i < tentativas; i++) {
    const achado = [...document.querySelectorAll('#toastRaiz .toast')].find((n) => padrao.test(n.textContent));
    if (achado) return achado;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`nenhum toast casando com ${padrao} apareceu a tempo`);
}

// Preenche o formulário de "Sua conta e seu cartão" do assistente. Os
// seletores usam o placeholder porque é o único atributo estável dos inputs
// (eles não têm id/name — ver onboarding.js).
async function preencherAssistenteCadastro({ banco, agencia, numero, cartaoNome, bandeira, final }) {
  (await esperarInputModal('input[placeholder="Ex.: Banco X"]')).value = banco;
  (await esperarInputModal('input[placeholder="0000"]:not([inputmode])')).value = agencia;
  (await esperarInputModal('input[placeholder="00000-0"]')).value = numero;
  (await esperarInputModal('input[placeholder="Ex.: Cartão principal"]')).value = cartaoNome;
  (await esperarInputModal('input[placeholder="visa / master"]')).value = bandeira;
  (await esperarInputModal('input[placeholder="0000"][inputmode="numeric"]')).value = final;
}

async function removerContaSeExistir(id) {
  const contas = await listAccounts();
  if (contas.some((a) => a.id === id)) await removeAccount(id, []);
}

// Localiza pelo NOME, não por um id capturado durante o teste: se o teste
// morrer antes de chegar na linha que capturava o id, o cleanup por id vira
// um `if (cartaoId)` que nunca entra, e o cartão de teste + a conta pagadora
// ficam para trás na origem real.
async function removerContaECartaoPorNome(nomeCartao) {
  const contas = await listAccounts();
  const cartao = contas.find((a) => a.tipo === TIPO_CARTAO && a.nome === nomeCartao);
  if (!cartao) return;
  await removeAccount(cartao.id, []);
  if (cartao.contaPagadoraId) await removerContaSeExistir(cartao.contaPagadoraId);
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

// Um erro de validação reconstruía os sete inputs do zero, apagando tudo o
// que o usuário tinha digitado.
describe('onboarding: assistenteCadastro preserva o formulario apos erro de validacao', () => {
  it('final de cartao invalido nao apaga os campos ja preenchidos, e corrigir só o final basta para salvar', async () => {
    montarRaizes();
    await storage.remove('meta', 'onboardingConcluido');
    try {
      const corrida = talvezOferecerOnboarding();
      await clicarBotaoModal('Cadastrar agora');

      await preencherAssistenteCadastro({
        banco: 'Banco Preserva Teste', agencia: '9999', numero: '8888-8',
        cartaoNome: 'Cartao Preserva Teste', bandeira: 'visa', final: '12', // invalido: só 2 dígitos
      });
      await clicarBotaoModal('Salvar');
      await esperarToast(/final do cartão/i);

      // O mesmo modal continua aberto (não fechou por causa do erro) — os
      // valores dos OUTROS campos precisam ter sobrevivido à repintura.
      assertEqual((await esperarInputModal('input[placeholder="Ex.: Banco X"]')).value, 'Banco Preserva Teste');
      assertEqual((await esperarInputModal('input[placeholder="0000"]:not([inputmode])')).value, '9999');
      assertEqual((await esperarInputModal('input[placeholder="00000-0"]')).value, '8888-8');
      assertEqual((await esperarInputModal('input[placeholder="Ex.: Cartão principal"]')).value, 'Cartao Preserva Teste');
      assertEqual((await esperarInputModal('input[placeholder="visa / master"]')).value, 'visa');

      // Corrige só o final (o único campo inválido) e salva de novo.
      (await esperarInputModal('input[placeholder="0000"][inputmode="numeric"]')).value = '1234';
      await clicarBotaoModal('Salvar');
      await corrida;

      const cartoes = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO && a.nome === 'Cartao Preserva Teste');
      assertEqual(cartoes.length, 1, 'o cadastro deveria ter sido salvo depois da correção');
      assertEqual(cartoes[0].final, '1234');
    } finally {
      await removerContaECartaoPorNome('Cartao Preserva Teste');
      await storage.remove('meta', 'onboardingConcluido');
      await storage.remove('meta', 'apelidosTitular');
    }
  });
});
