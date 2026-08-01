// Testes de lancamentos.js que só podem ser provados com DOM e IndexedDB de
// verdade: o bug da barra de filtros presa ligada só aparece depois do ciclo
// completo change -> renderLancamentos() -> DOM reconstruído de novo, e o bug
// de reentrância no submit só aparece com o timing real de dois disparos de
// evento antes do primeiro `await saveTransaction` resolver. Um teste sobre
// funções puras não alcança nenhum dos dois — por isso moram aqui, não em
// lancamentos.test.js.

import { describe, it, assertEqual, assert } from './harness.js';
import { renderLancamentos, resetLancamentos } from '../src/ui/lancamentos.js';
import { listTransactions, saveTransaction, removeTransaction } from '../src/domain/transactions.js';
import { TIPO_CONTA, TIPO_CARTAO, saveAccount } from '../src/domain/accounts.js';
import { saveForma } from '../src/domain/payment-methods.js';
import * as storage from '../src/core/storage.js';

function montarPainel() {
  // renderLancamentos() precisa de #tabLancamentos para montar a tela e de
  // #toastRaiz porque toast() (chamada por salvar()) grava nele direto — sem
  // isso, toast() lança "Cannot read properties of null" e o salvamento
  // acaba silenciosamente antes de reconstruir a tela, mesmo com o registro
  // já gravado. tools/tests.html não tem nenhum dos dois: só existem em
  // index.html.
  let painel = document.getElementById('tabLancamentos');
  if (!painel) {
    painel = document.createElement('section');
    painel.id = 'tabLancamentos';
    document.body.appendChild(painel);
  }
  if (!document.getElementById('toastRaiz')) {
    const raiz = document.createElement('div');
    raiz.id = 'toastRaiz';
    document.body.appendChild(raiz);
  }
  return painel;
}

function esperar() {
  // renderLancamentos() encadeia quatro leituras reais de IndexedDB
  // (Promise.all de listTransactions/listCategorias/listFormas/listAccounts)
  // antes de reescrever o DOM — um setTimeout(0) não garante esperar tudo
  // isso, só um tick de macrotask.
  return new Promise((r) => setTimeout(r, 50));
}

async function comLancamentosDeTeste(fn) {
  const t1 = {
    id: 'lt_teste_1', data: '2026-07-10', descricao: 'Pix teste filtro', valor: 10,
    categoria: 'outros', natureza: 'despesa', formaPagamentoId: 'pm_pix',
  };
  const t2 = {
    id: 'lt_teste_2', data: '2026-07-11', descricao: 'Debito auto teste filtro', valor: 20,
    categoria: 'outros', natureza: 'despesa', formaPagamentoId: 'pm_debito', classificadoAutomaticamente: true,
  };
  await saveTransaction(t1);
  await saveTransaction(t2);
  try {
    await fn();
  } finally {
    await removeTransaction('lt_teste_1');
    await removeTransaction('lt_teste_2');
  }
}

// Deixa a tela num estado conhecido: mês = julho/2026 (mês dos dados de
// teste), forma e "só automático" desligados — independente do que uma
// suíte anterior tenha deixado ligado.
async function estadoConhecido() {
  montarPainel();
  resetLancamentos();
  await renderLancamentos();
  const inpMes = document.querySelector('.filtros input[type="month"]');
  inpMes.value = '2026-07';
  inpMes.dispatchEvent(new Event('change'));
  await esperar();
}

describe('lancamentos (DOM real): barra de filtros reflete o estado depois do re-render', () => {
  it('checkbox "só classificados automaticamente" liga E desliga, e o total acompanha', async () => {
    await comLancamentosDeTeste(async () => {
      await estadoConhecido();
      const chk = () => document.querySelector('.filtros input[type="checkbox"]');
      const total = () => document.querySelector('.total-periodo').textContent;

      assertEqual(total(), 'Total de gastos no período: R$ 30,00');
      assertEqual(chk().checked, false);

      chk().click();
      await esperar();
      assertEqual(chk().checked, true, 'o checkbox precisa continuar marcado depois do re-render que o próprio clique disparou');
      assertEqual(total(), 'Total de gastos no período: R$ 20,00');

      chk().click();
      await esperar();
      assertEqual(chk().checked, false, 'um segundo clique precisa DESLIGAR o filtro, não ficar preso ligado');
      assertEqual(total(), 'Total de gastos no período: R$ 30,00');
    });
  });

  it('filtro de forma liga E desliga pelo próprio select', async () => {
    await comLancamentosDeTeste(async () => {
      await estadoConhecido();
      const selForma = () => document.querySelectorAll('.filtros select')[0];
      const total = () => document.querySelector('.total-periodo').textContent;

      assertEqual(selForma().value, '');
      assertEqual(total(), 'Total de gastos no período: R$ 30,00');

      selForma().value = 'pm_pix';
      selForma().dispatchEvent(new Event('change'));
      await esperar();
      assertEqual(selForma().value, 'pm_pix', 'o select precisa continuar em Pix depois do re-render que o próprio change disparou');
      assertEqual(total(), 'Total de gastos no período: R$ 10,00');

      selForma().value = '';
      selForma().dispatchEvent(new Event('change'));
      await esperar();
      assertEqual(selForma().value, '', 'voltar para "Todas as formas" precisa aparecer selecionado, não ficar preso em Pix');
      assertEqual(total(), 'Total de gastos no período: R$ 30,00');
    });
  });
});

// Reproduz o furo achado na revisão final: contaPadraoId era consumido só
// pelo evento `change` do seletor de forma, então a forma pré-selecionada
// automaticamente (por ultimaFormaUsada, o caso comum de uso diário) nunca
// disparava o preenchimento — só valia se o usuário trocasse a forma à mão.
describe('lancamentos (DOM real): conta padrão da forma pré-selecionada (contaPadraoId)', () => {
  const CONTA_ID = 'acc_teste_conta_padrao';
  const FORMA_ID = 'pm_teste_conta_padrao';

  async function comFormaEContaDeTeste(fn) {
    const ultimaFormaOriginal = await storage.getMeta('ultimaFormaUsada', null);
    await saveAccount({ id: CONTA_ID, tipo: TIPO_CONTA, nome: 'Conta teste padrão', ativo: true, agencia: '1', numero: '2' });
    await saveForma({
      id: FORMA_ID, nome: 'Forma teste padrão', tipo: 'outro', ativo: true,
      padroesExtrato: [], ordem: 999, conciliaCom: 'nenhum', contaPadraoId: CONTA_ID,
    });
    await storage.setMeta('ultimaFormaUsada', FORMA_ID);
    try {
      await fn();
    } finally {
      await storage.setMeta('ultimaFormaUsada', ultimaFormaOriginal);
      await storage.remove('paymentMethods', FORMA_ID);
      await storage.remove('accounts', CONTA_ID);
    }
  }

  it('preenche a conta no RENDER INICIAL, sem precisar de change manual no seletor de forma', async () => {
    await comFormaEContaDeTeste(async () => {
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selForma = selects[1];
      const selConta = selects[2];
      assertEqual(selForma.value, FORMA_ID, 'a forma de teste precisa vir pré-selecionada (ultimaFormaUsada)');
      assertEqual(selConta.value, CONTA_ID, 'a conta padrão da forma precisa vir preenchida sem nenhum evento change');
    });
  });

  it('conta padrão desativada continua selecionada e marcada, em vez de deixar o select em branco', async () => {
    await comFormaEContaDeTeste(async () => {
      await storage.put('accounts', { id: CONTA_ID, tipo: TIPO_CONTA, nome: 'Conta teste padrão', ativo: false, agencia: '1', numero: '2' });
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selConta = selects[2];
      assertEqual(selConta.value, CONTA_ID, 'a conta desativada ainda precisa ser a selecionada, nao cair para "sem conta"');
      const opcaoSelecionada = [...selConta.options].find((o) => o.value === CONTA_ID);
      assert(opcaoSelecionada.textContent.includes('desativada'), `esperava marca de desativada, achei "${opcaoSelecionada.textContent}"`);
    });
  });
});

// Reproduz o furo do Critico 1 da revisao: sem ultimaFormaUsada valida, o
// <select> de forma cai sozinho (comportamento padrao do navegador) na
// PRIMEIRA option da lista - e o filtro de tipo de conta precisa refletir
// essa forma EXIBIDA, nao so uma pre-selecao genuina que nao existe neste
// caso. Sem a correcao, o campo de conta oferecia so conta corrente mesmo
// com "Cartao de Credito" visivelmente marcado no formulario.
describe('lancamentos (DOM real): filtro de conta reflete a forma que o select REALMENTE exibe (Critico 1)', () => {
  const FORMA_ID = 'pm_teste_fallback_credito';
  const CARTAO_ID = 'acc_teste_fallback_cartao';
  const CONTA_ID = 'acc_teste_fallback_conta';

  async function comFallbackParaCredito(fn) {
    const ultimaFormaOriginal = await storage.getMeta('ultimaFormaUsada', null);
    // ordem bem negativa: garante que esta forma vem ANTES de qualquer forma
    // real do seed (ordem 1..7) ou criada pelo usuario, entao ela e sempre a
    // primeira option da lista, independente do que mais exista no banco.
    await saveForma({
      id: FORMA_ID, nome: 'Forma teste fallback credito', tipo: 'credito', ativo: true,
      padroesExtrato: [], ordem: -999, conciliaCom: 'fatura',
    });
    await saveAccount({ id: CARTAO_ID, tipo: TIPO_CARTAO, nome: 'Cartao teste fallback', ativo: true, final: '1234' });
    await saveAccount({ id: CONTA_ID, tipo: TIPO_CONTA, nome: 'Conta teste fallback', ativo: true, agencia: '1', numero: '2' });
    // Aponta para uma forma que nao existe: a pre-selecao genuina falha, e o
    // <select> precisa cair na primeira option sozinho (fallback do navegador).
    await storage.setMeta('ultimaFormaUsada', 'forma_que_nao_existe_mais');
    try {
      await fn();
    } finally {
      await storage.setMeta('ultimaFormaUsada', ultimaFormaOriginal);
      await storage.remove('paymentMethods', FORMA_ID);
      await storage.remove('accounts', CARTAO_ID);
      await storage.remove('accounts', CONTA_ID);
    }
  }

  it('sem pre-selecao valida, o select cai na primeira forma (credito) e o campo de conta oferece so cartao', async () => {
    await comFallbackParaCredito(async () => {
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selForma = selects[1];
      const selConta = selects[2];
      assertEqual(selForma.value, FORMA_ID, 'a forma de ordem mais baixa precisa aparecer selecionada por padrao do navegador');
      const valores = [...selConta.options].map((o) => o.value);
      assert(valores.includes(CARTAO_ID), `esperava o cartao entre as opcoes, achei ${JSON.stringify(valores)}`);
      assert(!valores.includes(CONTA_ID), `a conta corrente NAO deveria aparecer com credito selecionado, achei ${JSON.stringify(valores)}`);
    });
  });
});

// Reproduz o Critico 2 (mensagem de erro) e o Importante 3 (regressao do
// preenchimento automatico) da revisao: a conta padrao so pode vir de uma
// forma cujo TIPO bate com o da conta, e so deve ser sobrescrita ao trocar de
// forma quando o usuario NAO escolheu a conta manualmente.
describe('lancamentos (DOM real): troca de forma no formulario (change do seletor)', () => {
  const FORMA_A_ID = 'pm_teste_troca_a';
  const FORMA_B_ID = 'pm_teste_troca_b';
  const FORMA_CREDITO_ID = 'pm_teste_troca_credito';
  const CONTA_A_ID = 'acc_teste_troca_a';
  const CONTA_B_ID = 'acc_teste_troca_b';
  const CONTA_MANUAL_ID = 'acc_teste_troca_manual';
  const CARTAO_ID = 'acc_teste_troca_cartao';

  async function comFormasDeTeste(fn) {
    await saveAccount({ id: CONTA_A_ID, tipo: TIPO_CONTA, nome: 'Conta teste A', ativo: true, agencia: '1', numero: '1' });
    await saveAccount({ id: CONTA_B_ID, tipo: TIPO_CONTA, nome: 'Conta teste B', ativo: true, agencia: '1', numero: '2' });
    await saveAccount({ id: CONTA_MANUAL_ID, tipo: TIPO_CONTA, nome: 'Conta teste manual', ativo: true, agencia: '1', numero: '3' });
    await saveAccount({ id: CARTAO_ID, tipo: TIPO_CARTAO, nome: 'Cartao teste troca', ativo: true, final: '9999' });
    await saveForma({ id: FORMA_A_ID, nome: 'Forma teste A', tipo: 'outro', ativo: true, padroesExtrato: [], ordem: 900, conciliaCom: 'nenhum', contaPadraoId: CONTA_A_ID });
    await saveForma({ id: FORMA_B_ID, nome: 'Forma teste B', tipo: 'outro', ativo: true, padroesExtrato: [], ordem: 901, conciliaCom: 'nenhum', contaPadraoId: CONTA_B_ID });
    // contaPadraoId de tipo ERRADO (conta corrente numa forma de credito): o
    // editor hoje so oferece conta corrente como padrao pra qualquer forma,
    // entao este estado e alcancavel pela UI normal, nao so por teste.
    await saveForma({ id: FORMA_CREDITO_ID, nome: 'Forma teste credito', tipo: 'credito', ativo: true, padroesExtrato: [], ordem: 902, conciliaCom: 'fatura', contaPadraoId: CONTA_A_ID });
    try {
      await fn();
    } finally {
      await storage.remove('paymentMethods', FORMA_A_ID);
      await storage.remove('paymentMethods', FORMA_B_ID);
      await storage.remove('paymentMethods', FORMA_CREDITO_ID);
      await storage.remove('accounts', CONTA_A_ID);
      await storage.remove('accounts', CONTA_B_ID);
      await storage.remove('accounts', CONTA_MANUAL_ID);
      await storage.remove('accounts', CARTAO_ID);
    }
  }

  it('trocar entre formas com contas padrao DIFERENTES aplica o padrao de cada uma (nao trava na anterior)', async () => {
    await comFormasDeTeste(async () => {
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selForma = selects[1];
      const selConta = selects[2];

      selForma.value = FORMA_A_ID;
      selForma.dispatchEvent(new Event('change'));
      assertEqual(selConta.value, CONTA_A_ID, 'forma A precisa preencher a conta padrao dela');

      // Troca para B SEM tocar em selConta: se a conta de A "vazasse" para B
      // (bug do Importante 3), selConta continuaria em CONTA_A_ID aqui,
      // porque CONTA_A_ID tambem e do tipo certo pra forma B (as duas sao
      // conta corrente) - o teste so pega o vazamento porque os padroes sao
      // DIFERENTES entre as duas formas.
      selForma.value = FORMA_B_ID;
      selForma.dispatchEvent(new Event('change'));
      assertEqual(selConta.value, CONTA_B_ID, 'forma B precisa aplicar o PROPRIO padrao, nao manter o da forma anterior');
    });
  });

  it('conta escolhida manualmente sobrevive a troca de forma; auto-preenchida NAO sobrevive', async () => {
    await comFormasDeTeste(async () => {
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selForma = selects[1];
      const selConta = selects[2];

      selForma.value = FORMA_A_ID;
      selForma.dispatchEvent(new Event('change'));
      assertEqual(selConta.value, CONTA_A_ID);

      // Usuario troca a conta A MAO (evento change real no proprio select).
      selConta.value = CONTA_MANUAL_ID;
      selConta.dispatchEvent(new Event('change'));

      selForma.value = FORMA_B_ID;
      selForma.dispatchEvent(new Event('change'));
      assertEqual(selConta.value, CONTA_MANUAL_ID, 'a escolha manual do usuario precisa sobreviver a troca de forma');
    });
  });

  it('contaPadraoId de tipo errado (conta corrente numa forma de credito) nunca preenche nem aparece', async () => {
    await comFormasDeTeste(async () => {
      montarPainel();
      resetLancamentos();
      await renderLancamentos();
      const selects = document.querySelectorAll('.form-lancamento select');
      const selForma = selects[1];
      const selConta = selects[2];

      selForma.value = FORMA_CREDITO_ID;
      selForma.dispatchEvent(new Event('change'));
      assertEqual(selConta.value, '', 'contaPadraoId de tipo errado nao pode preencher o campo — deve ficar "sem conta"');
      const valores = [...selConta.options].map((o) => o.value);
      assert(!valores.includes(CONTA_A_ID), `a conta corrente do padrao errado nao deveria nem aparecer nas opcoes, achei ${JSON.stringify(valores)}`);
      assert(valores.includes(CARTAO_ID), `o cartao precisa estar entre as opcoes, achei ${JSON.stringify(valores)}`);
    });
  });
});

describe('lancamentos (DOM real): guarda de reentrância do submit', () => {
  it('dois disparos de submit antes do primeiro salvar resolver gravam só um lançamento', async () => {
    montarPainel();
    resetLancamentos();
    await renderLancamentos();

    const form = document.querySelector('.form-lancamento');
    const inputs = form.querySelectorAll('input');
    inputs[0].value = '10/07/2026'; // data
    inputs[1].value = '7,77'; // valor
    inputs[2].value = 'Duplo disparo teste'; // descricao

    // Dois disparos síncronos, sem nenhum await entre eles: reproduz dois
    // cliques rápidos no botão antes do primeiro `await saveTransaction`
    // resolver. O listener chama salvar() sem aguardá-la (fire-and-forget),
    // então a segunda chamada roda antes de a primeira sequer ter tido chance
    // de gravar.
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    // Duas voltas de microtask/macrotask não bastam sempre; espera um pouco
    // mais para o salvamento (e o re-render subsequente) terminarem de vez.
    await new Promise((r) => setTimeout(r, 50));

    // try/finally: se a asserção falhar (é exatamente o que a sabotagem de
    // verificação faz de propósito), o(s) registro(s) duplicado(s) ainda
    // assim precisam ser removidos — senão uma falha aqui deixa lixo no
    // IndexedDB que contamina outras execuções da suíte depois.
    const todos = await listTransactions();
    const achados = todos.filter((t) => t.descricao === 'Duplo disparo teste');
    try {
      assertEqual(achados.length, 1, `esperava 1 lançamento gravado, achei ${achados.length}`);
    } finally {
      for (const t of achados) await removeTransaction(t.id);
    }
  });
});
