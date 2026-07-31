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
import { TIPO_CONTA, TIPO_CARTAO, listAccounts, saveAccount, removeAccount } from '../src/domain/accounts.js';
import { listFormas, saveForma } from '../src/domain/payment-methods.js';
import { legacyDatabaseExists, importLegacyInto } from '../src/importers/legacy-idb.js';
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

async function esperarSelectModal(tentativas = 150) {
  for (let i = 0; i < tentativas; i++) {
    const sel = document.querySelector('#modalRaiz select');
    if (sel) return sel;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('select nao apareceu no modal a tempo');
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

// migrarDoAppAnterior() agora resolve a forma de crédito dinamicamente (via
// listFormas()) em vez de cravar 'pm_credito' — então os testes precisam
// garantir que existe uma forma tipo:'credito' na origem, sem presumir que
// DEFAULT_PAYMENT_METHODS já foi semeado. Só remove no cleanup a forma que
// ELA MESMA criou, para não apagar uma forma real da origem semeada.
async function garantirFormaCredito() {
  const formas = await listFormas();
  const existente = formas.find((f) => f.tipo === 'credito' && f.ativo !== false);
  if (existente) return { id: existente.id, criada: false };
  const nova = {
    id: 'pm_teste_credito_onboarding', nome: 'Crédito (teste onboarding)', tipo: 'credito',
    ativo: true, ordem: 999, padroesExtrato: [], conciliaCom: 'fatura',
  };
  await saveForma(nova);
  return { id: nova.id, criada: true };
}

async function removerFormaSeCriada(formaCredito) {
  if (formaCredito && formaCredito.criada) await storage.remove('paymentMethods', formaCredito.id);
}

async function removerContaSeExistir(id) {
  const contas = await listAccounts();
  if (contas.some((a) => a.id === id)) await removeAccount(id, []);
}

// Localiza pelo NOME, não por um id capturado durante o teste: se o teste
// morrer antes de chegar na linha que capturava o id (ex.: uma asserção
// falhou no meio do fluxo, antes do cartão ter sido usado), o cleanup por id
// vira um `if (cartaoId)` que nunca entra, e o cartão de teste + a conta
// pagadora ficam para trás na origem real — foi exatamente isso que
// aconteceu na primeira tentativa deste teste, contaminando a origem
// semeada com "Cartao Retomada Teste".
async function removerContaECartaoPorNome(nomeCartao) {
  const contas = await listAccounts();
  const cartao = contas.find((a) => a.tipo === TIPO_CARTAO && a.nome === nomeCartao);
  if (!cartao) return;
  await limparDadosDaMigracao(cartao.id);
  await removeAccount(cartao.id, []);
  if (cartao.contaPagadoraId) await removerContaSeExistir(cartao.contaPagadoraId);
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

// Achado Crítico #1 da revisão: o botão "Trazer dados do app anterior" do
// modal de boas-vindas só é alcançável com ZERO contas cadastradas (é a
// única condição em que talvezOferecerOnboarding() abre o modal). Antes da
// correção, migrarDoAppAnterior() sempre caía no ramo "cadastre o cartão
// primeiro" nesse estado, encadeava assistenteCadastro() e NUNCA retomava a
// migração — o usuário achava que tinha pedido a migração e o app ficava
// vazio. Este describe cobre exatamente esse caminho, ponta a ponta.
describe('onboarding: fluxo critico do Achado #1 (legado presente, zero contas)', () => {
  it('clicar "Trazer dados do app anterior" no modal de boas-vindas termina com os lancamentos migrados', async () => {
    montarRaizes();
    await storage.remove('meta', 'onboardingConcluido');
    await derrubarBancoLegadoFalso();
    await criarBancoLegadoFalso(DADOS_LEGADO_ONBOARDING);
    const formaCredito = await garantirFormaCredito();

    const contasAntes = await listAccounts();
    assertEqual(contasAntes.filter((a) => a.tipo === TIPO_CARTAO).length, 0, 'pre-condicao do teste: nenhum cartao deveria existir ainda');
    assertEqual(await legacyDatabaseExists(), true, 'pre-condicao do teste: o banco legado falso precisa existir');

    let cartaoId = null;
    try {
      const corrida = talvezOferecerOnboarding();
      await clicarBotaoModal('Trazer dados do app anterior'); // modal de boas-vindas
      await clicarBotaoModal('OK'); // "Cadastre o cartão primeiro"

      await preencherAssistenteCadastro({
        banco: 'Banco Critico Teste', agencia: '1234', numero: '5678-9',
        cartaoNome: 'Cartao Critico Teste', bandeira: 'visa', final: '1357',
      });
      await clicarBotaoModal('Salvar');

      // A partir daqui, migrarDoAppAnterior() precisa ter se retomado
      // SOZINHA depois do cadastro. Sem a correção do Crítico #1, nenhum
      // destes dois passos aconteceria e o teste estouraria por timeout
      // esperando o select/botão que nunca chegam.
      await esperarSelectModal();
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK'); // fecha o modal "Pronto"
      await corrida;

      const cartoesDepois = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO);
      assertEqual(cartoesDepois.length, 1, 'o assistente deveria ter criado exatamente um cartao');
      cartaoId = cartoesDepois[0].id;

      const transacoes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartaoId);
      assertEqual(transacoes.length, 2, 'os dois lancamentos do banco legado falso precisavam ter sido migrados de verdade');
      assert(transacoes.every((t) => t.formaPagamentoId === formaCredito.id), 'os lancamentos migrados precisam apontar para uma forma de credito que existe');

      const faturas = (await storage.getAll('statements')).filter((s) => s.contaId === cartaoId);
      assertEqual(faturas.length, 1, 'a fatura do banco legado falso precisava ter sido migrada');

      assertEqual(await storage.getMeta('onboardingConcluido', false), true);
    } finally {
      await derrubarBancoLegadoFalso();
      // Por nome, não pelo `cartaoId` capturado no meio do try: se o teste
      // morrer antes daquela linha, o cartão criado pelo assistente ainda
      // precisa ser encontrado e removido.
      await removerContaECartaoPorNome('Cartao Critico Teste');
      await removerFormaSeCriada(formaCredito);
      await storage.remove('meta', 'onboardingConcluido');
      await storage.remove('meta', 'apelidosTitular');
    }
  });

  it('sem cartao e sem legado, cadastra o cartao e RETOMA a tentativa de migracao (que falha com mensagem clara)', async () => {
    // Variante sem banco legado: prova que a retomada acontece mesmo quando
    // o passo seguinte vai falhar - ou seja, prova que a funcao volta a
    // TENTAR migrar, e nao so que ela "teria tentado se desse certo".
    montarRaizes();
    await derrubarBancoLegadoFalso();
    const formaCredito = await garantirFormaCredito();
    const contasAntes = await listAccounts();
    assertEqual(contasAntes.filter((a) => a.tipo === TIPO_CARTAO).length, 0, 'pre-condicao do teste: nenhum cartao deveria existir ainda');

    try {
      const corrida = migrarDoAppAnterior();
      await clicarBotaoModal('OK'); // "Cadastre o cartão primeiro"
      await preencherAssistenteCadastro({
        banco: 'Banco Retomada Teste', agencia: '1111', numero: '2222-2',
        cartaoNome: 'Cartao Retomada Teste', bandeira: 'master', final: '4444',
      });
      await clicarBotaoModal('Salvar');

      // A retomada reabre o modal de escolha de cartão (agora com o cartão
      // recém-criado já disponível) — ainda precisa do clique em "Trazer
      // dados" para de fato tentar ler o banco antigo e falhar.
      await esperarSelectModal();
      await clicarBotaoModal('Trazer dados');
      await esperarToast(/Não consegui ler os dados do app anterior/);
      await corrida;

      const cartoesDepois = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO);
      assertEqual(cartoesDepois.length, 1);
    } finally {
      // Por nome — ver comentário em removerContaECartaoPorNome acima.
      await removerContaECartaoPorNome('Cartao Retomada Teste');
      await removerFormaSeCriada(formaCredito);
      await storage.remove('meta', 'onboardingConcluido');
      await storage.remove('meta', 'apelidosTitular');
    }
  });
});

describe('onboarding: migrarDoAppAnterior pela UI real', () => {
  it('traz os dados pelo modal e, clicando duas vezes seguidas pela UI, nao duplica', async () => {
    montarRaizes();
    const cartao = { id: 'acc_teste_cartao_onboarding', tipo: TIPO_CARTAO, nome: 'Cartao Teste', final: '1234', bandeira: 'visa', ativo: true };
    await saveAccount(cartao);
    const formaCredito = await garantirFormaCredito();
    await criarBancoLegadoFalso(DADOS_LEGADO_ONBOARDING);
    try {
      let corrida = migrarDoAppAnterior();
      (await esperarSelectModal()).value = cartao.id;
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK');
      await corrida;

      let transacoes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(transacoes.length, 2, 'esperava os dois lancamentos do banco legado falso');

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
      await removerFormaSeCriada(formaCredito);
      await storage.remove('meta', 'onboardingConcluido');
    }
  });

  // A revisão apontou que a prova de idempotência anterior só rodava a
  // partir de um banco vazio (o primeiro clique já grava do zero). Este
  // teste popula o banco novo por FORA da UI antes de sequer abrir o modal
  // — simulando exatamente o estado de alguém que já migrou numa sessão
  // anterior — e só então roda a migração uma vez pela UI, confirmando que
  // a contagem não muda.
  it('idempotencia contra um banco que JA TEM os registros (nao a partir do zero)', async () => {
    montarRaizes();
    const cartao = { id: 'acc_teste_cartao_preseed', tipo: TIPO_CARTAO, nome: 'Cartao Preseed Teste', final: '2468', bandeira: 'visa', ativo: true };
    await saveAccount(cartao);
    const formaCredito = await garantirFormaCredito();
    await criarBancoLegadoFalso(DADOS_LEGADO_ONBOARDING);
    try {
      // Popula por fora da UI, chamando a mesma função que o app usaria numa
      // migração anterior — mas sem passar pelo modal.
      await importLegacyInto({ cartaoTitularId: cartao.id, formaCreditoId: formaCredito.id });
      const antes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(antes.length, 2, 'pre-condicao do teste: o banco novo ja precisa ter os dois lancamentos antes de abrir a UI');
      const faturasAntes = (await storage.getAll('statements')).filter((s) => s.contaId === cartao.id);
      assertEqual(faturasAntes.length, 1);

      const corrida = migrarDoAppAnterior();
      (await esperarSelectModal()).value = cartao.id;
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK');
      await corrida;

      const depois = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(depois.length, 2, 'migrar pela UI sobre um banco que ja tinha os registros nao pode duplicar');
      const faturasDepois = (await storage.getAll('statements')).filter((s) => s.contaId === cartao.id);
      assertEqual(faturasDepois.length, 1, 'idem para faturas');
    } finally {
      await derrubarBancoLegadoFalso();
      await limparDadosDaMigracao(cartao.id);
      await removeAccount(cartao.id, []);
      await removerFormaSeCriada(formaCredito);
      await storage.remove('meta', 'onboardingConcluido');
    }
  });

  it('cartao desativado nao aparece como opcao de destino da migracao', async () => {
    montarRaizes();
    const cartaoAtivo = { id: 'acc_teste_cartao_ativo_migracao', tipo: TIPO_CARTAO, nome: 'Cartao Ativo Teste', final: '1111', bandeira: 'visa', ativo: true };
    const cartaoInativo = { id: 'acc_teste_cartao_inativo_migracao', tipo: TIPO_CARTAO, nome: 'Cartao Inativo Teste', final: '2222', bandeira: 'visa', ativo: false };
    await saveAccount(cartaoAtivo);
    await saveAccount(cartaoInativo);
    const formaCredito = await garantirFormaCredito();
    try {
      const corrida = migrarDoAppAnterior();
      const sel = await esperarSelectModal();
      const valores = [...sel.options].map((o) => o.value);
      assert(valores.includes(cartaoAtivo.id), 'o cartao ativo precisa aparecer');
      assert(!valores.includes(cartaoInativo.id), 'o cartao desativado nao pode aparecer como opcao');
      await clicarBotaoModal('Cancelar');
      await corrida;
    } finally {
      await removeAccount(cartaoAtivo.id, []);
      await removeAccount(cartaoInativo.id, []);
      await removerFormaSeCriada(formaCredito);
    }
  });
});

// Achado #6 da revisão: um erro de validação reconstruía os sete inputs do
// zero, apagando tudo o que o usuário tinha digitado. Entra pelo caminho
// "Cadastrar agora" do modal de boas-vindas (não por migrarDoAppAnterior,
// que — corretamente, pelo Crítico #1 — encadearia para uma SEGUNDA rodada
// de migração depois de salvar, o que não é o que este teste quer exercitar).
describe('onboarding: assistenteCadastro preserva o formulario apos erro de validacao', () => {
  it('final de cartao invalido nao apaga os campos ja preenchidos, e corrigir só o final basta para salvar', async () => {
    montarRaizes();
    await storage.remove('meta', 'onboardingConcluido');
    await derrubarBancoLegadoFalso(); // sem legado: o modal de boas-vindas nao oferece "migrar"
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

// Achado #9 da revisão: formaCreditoId era cravado em 'pm_credito'. Como
// 'pm_credito' é também o id do default real, um teste que só checar "achou
// UMA forma de crédito" não distingue busca dinâmica de valor cravado — este
// teste desativa pm_credito e cadastra uma segunda forma de crédito com id
// DIFERENTE, para que só a busca dinâmica (e não o literal) possa acertar.
describe('onboarding: forma de credito resolvida dinamicamente (Achado #9)', () => {
  it('usa a forma de credito ATIVA cadastrada pelo usuario, nao o literal pm_credito', async () => {
    montarRaizes();
    const formasAntes = await listFormas();
    const pmCreditoOriginal = formasAntes.find((f) => f.id === 'pm_credito');
    const formaAlternativa = {
      id: 'pm_teste_credito_alternativo', nome: 'Crédito Alternativo (teste)', tipo: 'credito',
      ativo: true, ordem: 998, padroesExtrato: [], conciliaCom: 'fatura',
    };
    const cartao = { id: 'acc_teste_cartao_forma_dinamica', tipo: TIPO_CARTAO, nome: 'Cartao Forma Dinamica Teste', final: '5566', bandeira: 'visa', ativo: true };

    await saveAccount(cartao);
    await saveForma(formaAlternativa);
    if (pmCreditoOriginal) await saveForma({ ...pmCreditoOriginal, ativo: false });
    await criarBancoLegadoFalso(DADOS_LEGADO_ONBOARDING);
    try {
      const corrida = migrarDoAppAnterior();
      (await esperarSelectModal()).value = cartao.id;
      await clicarBotaoModal('Trazer dados');
      await clicarBotaoModal('OK');
      await corrida;

      const transacoes = (await storage.getAll('transactions')).filter((t) => t.contaId === cartao.id);
      assertEqual(transacoes.length, 2);
      assert(
        transacoes.every((t) => t.formaPagamentoId === formaAlternativa.id),
        `esperava formaPagamentoId="${formaAlternativa.id}", achei ${JSON.stringify(transacoes.map((t) => t.formaPagamentoId))}`
      );
    } finally {
      await derrubarBancoLegadoFalso();
      await limparDadosDaMigracao(cartao.id);
      await removeAccount(cartao.id, []);
      await storage.remove('paymentMethods', formaAlternativa.id);
      if (pmCreditoOriginal) await saveForma(pmCreditoOriginal); // restaura o estado original (ativo: true)
      await storage.remove('meta', 'onboardingConcluido');
    }
  });
});
