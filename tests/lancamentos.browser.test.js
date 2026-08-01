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
import { TIPO_CONTA, saveAccount } from '../src/domain/accounts.js';
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
