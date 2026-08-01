// Aba Lançamentos: a tela de uso diário, onde cada gasto é digitado. A regra
// de ouro do sistema (o que conta como gasto) mora em domain/transactions.js;
// esta tela só coleta o formulário e delega validação e persistência ao
// domínio — inclusive a marcação visual do que não é gasto, que usa
// contaComoGasto() em vez de reimplementar a metade da regra.
//
// Conta e forma de pagamento desativadas somem do seletor do formulário,
// exceto quando são o valor já gravado no lançamento em edição: um lançamento
// antigo que aponta para uma conta já desativada precisa continuar mostrando
// essa conta e permitir salvar sem forçar o usuário a trocar por outra só
// para poder editar a descrição.

import { el, toast, confirmar } from './components.js';
import { campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import {
  listTransactions, saveTransaction, removeTransaction,
  novaTransaction, validateTransaction, filterTransactions, sumDespesas, contaComoGasto, NATUREZAS,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts } from '../domain/accounts.js';
import { fmtBRL, parseMoneyBR } from '../core/money.js';
import { formatDateBR, parseDateBR, todayISO, monthKey } from '../core/dates.js';
import * as storage from '../core/storage.js';

let filtros = { mes: monthKey(todayISO()) };
let editandoId = null;

// Chamado pelo roteador (app.js) ao entrar na aba vindo de outro lugar —
// nunca pelo re-render interno da própria tela, que precisa preservar o
// filtro e a edição em curso. Sem isso, editar um lançamento, ir para
// Cadastros e voltar deixava o formulário armado para sobrescrever um
// lançamento antigo, e o filtro de mês/forma anterior continuava aplicado
// sem nenhum indício.
export function resetLancamentos() {
  editandoId = null;
  filtros = { mes: monthKey(todayISO()) };
}

// opcoesAtivas e rotuloComStatus moraram aqui e foram extraídas para
// cadastros-comuns.js: os seletores de Cadastros que referenciam outro
// cadastro (ex.: "conta que paga a fatura", "conta padrão da forma")
// precisam da mesma regra — um cadastro desativado sem marca, ou pior,
// escondido, era exatamente o furo que a revisão final pegou.

// Pura: decide o que o campo Valor significa antes de qualquer gravação.
// parseMoneyBR devolve null tanto para "vazio" quanto para "não entendi o
// formato" (ex.: "12.30", ponto decimal ambíguo) — aqui os dois casos são
// distinguidos, porque o segundo merece dizer ao usuário que o formato é
// inválido, em vez de colapsar para 0 e deixar a guarda genérica do domínio
// ("valor precisa ser maior que zero") reclamar de um valor que na
// verdade nunca chegou a existir.
export function interpretarValor(textoDigitado) {
  const texto = String(textoDigitado || '').trim();
  if (!texto) return { valor: 0, erro: null };
  const valor = parseMoneyBR(texto);
  if (valor === null) {
    return { valor: 0, erro: 'Valor inválido. Use vírgula para os centavos, como 12,30 (sem ponto).' };
  }
  return { valor: Math.abs(valor), erro: null };
}

// Pura: a marcação visual de "não é gasto" tem que ser a MESMA regra que
// decide o total (contaComoGasto, usada por sumDespesas) — nunca uma cópia
// parcial dela. Uma despesa prevista (previsto: true) não conta como gasto,
// igual a receita/transferência/pagamento de fatura, e por isso também
// precisa da marca; checar só `natureza !== 'despesa'` deixava passar
// batido uma despesa prevista, que aparecia lado a lado com gasto real sem
// nenhuma pista de que não somava no total.
export function classeDoItem(t) {
  return `item-lancamento${contaComoGasto(t) ? '' : ' nao-gasto'}`;
}

// Puras: derivam o que a barra de filtros deve mostrar a partir de `filtros`,
// para o controle nunca divergir do estado que ele supostamente representa.
// A barra inteira é reconstruída a cada renderLancamentos() (mesmo padrão de
// `inpMes`, que já lia `filtros.mes` no value); sem espelhar esses dois
// também, marcar/desmarcar "só automático" ou trocar a forma no filtro
// parecia não ter efeito nenhum no controle, mesmo afetando o total de
// verdade — um total que mente sobre o que está filtrando.
export function formaFiltroAtual(filtros) {
  return ((filtros || {}).formas || [])[0] || '';
}

export function somenteAutoFiltroAtual(filtros) {
  return !!(filtros || {}).somenteAuto;
}

export async function renderLancamentos() {
  const painel = document.getElementById('tabLancamentos');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };
  const visiveis = filterTransactions(transacoes, filtros)
    .sort((a, b) => (a.data < b.data ? 1 : -1));

  painel.innerHTML = '';
  painel.append(
    await formulario(ctx, transacoes),
    barraFiltros(ctx),
    el('div', { class: 'total-periodo', text: `Total de gastos no período: ${fmtBRL(sumDespesas(visiveis))}` }),
    listagem(visiveis, ctx)
  );
}

async function formulario(ctx, transacoes) {
  const emEdicao = editandoId ? transacoes.find((t) => t.id === editandoId) : null;
  const ultimaForma = await storage.getMeta('ultimaFormaUsada', null);

  const inpData = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'DD/MM/AAAA', value: formatDateBR(emEdicao ? emEdicao.data : todayISO()) });
  const inpDescricao = el('input', { type: 'text', placeholder: 'Descrição', value: emEdicao ? emEdicao.descricao : '' });
  const inpValor = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: emEdicao ? String(emEdicao.valor).replace('.', ',') : '' });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(emEdicao && emEdicao.categoria === c.id ? { selected: 'selected' } : {}) })
  ));

  // A exceção de "continuar selecionável" só vale para o valor do registro em
  // edição — nunca para `ultimaFormaUsada`: se a última forma usada foi
  // desativada nesse meio-tempo, ela não deve aparecer pré-selecionada num
  // lançamento novo, só continuar visível em quem já apontava para ela.
  const formaAtualId = emEdicao ? emEdicao.formaPagamentoId : null;
  const formasOpcoes = opcoesAtivas(ctx.formas, formaAtualId);
  const formaSelecionada = emEdicao ? emEdicao.formaPagamentoId : ultimaForma;
  const selForma = el('select', {}, formasOpcoes.map((f) =>
    el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaSelecionada ? { selected: 'selected' } : {}) })
  ));

  // Conta padrão da forma já pré-selecionada (ultimaFormaUsada, num novo
  // lançamento): precisa ser calculada aqui, não só reagir ao `change` do
  // seletor de forma — senão o preenchimento automático só valia se o
  // usuário trocasse a forma à mão, e nunca no caso comum (forma já vem
  // certa, usuário só confere e lança). Só considera a forma que REALMENTE
  // vai aparecer selecionada no <select> (presente em formasOpcoes) — uma
  // `ultimaFormaUsada` desativada não fica selecionada (comentário acima), e
  // não pode emprestar sua conta padrão para uma seleção que não é a dela.
  const formaPreSelecionada = !emEdicao && formasOpcoes.some((f) => f.id === formaSelecionada)
    ? ctx.formas.find((f) => f.id === formaSelecionada)
    : null;
  const contaPadraoInicial = formaPreSelecionada ? formaPreSelecionada.contaPadraoId : null;

  // A conta padrão de uma forma pode estar desativada sem que ninguém tenha
  // desativado a forma junto — opcoesAtivas precisa contar essa conta como
  // "idAtual" também, senão ela fica de fora das opções e o preenchimento
  // automático abaixo não encontra option nenhuma para selecionar, deixando
  // o select em branco.
  const contaAtualId = emEdicao ? emEdicao.contaId : contaPadraoInicial;
  const contasOpcoes = opcoesAtivas(ctx.contas, contaAtualId);
  const selConta = el('select', {}, [
    el('option', { value: '', text: '— sem conta —' }),
    ...contasOpcoes.map((a) => el('option', {
      value: a.id,
      text: rotuloComStatus(a),
      ...((emEdicao ? emEdicao.contaId === a.id : a.id === contaPadraoInicial) ? { selected: 'selected' } : {}),
    })),
  ]);

  // Escolher a forma preenche a conta automaticamente pelo padrão dela, sem
  // travar a escolha: o usuário ainda pode trocar depois. O mesmo
  // preenchimento no render inicial já está coberto acima (contaPadraoInicial
  // marca a option "selected" direto), este listener só cobre a troca manual.
  selForma.addEventListener('change', () => {
    const forma = ctx.formas.find((f) => f.id === selForma.value);
    if (forma && forma.contaPadraoId) selConta.value = forma.contaPadraoId;
  });

  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: rotuloNatureza(n), ...(emEdicao && emEdicao.natureza === n ? { selected: 'selected' } : {}) })
  ));

  const botaoSalvar = el('button', { class: 'btn btn-primario', type: 'submit', text: emEdicao ? 'Salvar alterações' : 'Lançar' });

  // Guarda de reentrância: sem ela, dois disparos de submit antes do primeiro
  // `await saveTransaction` resolver criam dois registros distintos
  // (novaTransaction gera um id novo a cada chamada). A checagem em si é
  // síncrona e roda antes de qualquer await, então bloqueia mesmo um segundo
  // disparo que chega no mesmo tick do primeiro.
  let salvando = false;
  const salvar = async () => {
    if (salvando) return;
    salvando = true;
    botaoSalvar.disabled = true;
    try {
      const { valor, erro: erroValor } = interpretarValor(inpValor.value);
      if (erroValor) return toast(erroValor, 'erro');

      const data = parseDateBR(inpData.value);
      const base = {
        data,
        descricao: inpDescricao.value.trim(),
        valor,
        categoria: selCategoria.value,
        formaPagamentoId: selForma.value,
        contaId: selConta.value || undefined,
        natureza: selNatureza.value,
      };
      const registro = emEdicao ? { ...emEdicao, ...base } : novaTransaction(base);

      // Se o usuário mexeu na categoria, a escolha deixa de ser palpite da máquina.
      if (emEdicao && emEdicao.categoria !== base.categoria) {
        delete registro.classificadoAutomaticamente;
        delete registro.regraId;
      }

      const erros = validateTransaction(registro);
      if (erros.length) return mostrarErros(erros);

      await saveTransaction(registro);
      await storage.setMeta('ultimaFormaUsada', registro.formaPagamentoId);
      editandoId = null;
      toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
      await renderLancamentos();
    } finally {
      salvando = false;
      botaoSalvar.disabled = false;
    }
  };

  return el('form', { class: 'form-lancamento', onsubmit: (ev) => { ev.preventDefault(); salvar(); } }, [
    el('div', { class: 'linha-form' }, [campo('Data', inpData), campo('Valor', inpValor)]),
    campo('Descrição', inpDescricao),
    el('div', { class: 'linha-form' }, [campo('Categoria', selCategoria), campo('Forma de pagamento', selForma)]),
    el('div', { class: 'linha-form' }, [campo('Conta / cartão', selConta), campo('Natureza', selNatureza)]),
    el('div', { class: 'acoes' }, [
      botaoSalvar,
      emEdicao ? el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: async () => { editandoId = null; await renderLancamentos(); } }) : null,
    ]),
  ]);
}

function rotuloNatureza(n) {
  return {
    despesa: 'Gasto',
    receita: 'Recebimento (não conta como gasto)',
    transferencia: 'Transferência entre contas próprias',
    pagamento_fatura: 'Pagamento de fatura',
  }[n];
}

function barraFiltros(ctx) {
  const inpMes = el('input', { type: 'month', value: filtros.mes || '' });
  inpMes.addEventListener('change', async () => { filtros.mes = inpMes.value || undefined; await renderLancamentos(); });

  // A barra de filtro mostra todas as formas, inclusive desativadas: o usuário
  // pode querer olhar o histórico de uma forma que não usa mais.
  const formaAtual = formaFiltroAtual(filtros);
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => {
    filtros.formas = selForma.value ? [selForma.value] : [];
    await renderLancamentos();
  });

  const chkAuto = el('input', { type: 'checkbox', ...(somenteAutoFiltroAtual(filtros) ? { checked: 'checked' } : {}) });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await renderLancamentos(); });

  return el('div', { class: 'filtros' }, [
    campo('Mês', inpMes),
    campo('Forma', selForma),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}

function listagem(visiveis, ctx) {
  if (!visiveis.length) return el('p', { class: 'vazio', text: 'Nenhum lançamento neste filtro.' });
  const nome = (lista, id) => (lista.find((x) => x.id === id) || {}).nome || '—';

  return el('div', { class: 'lista-lancamentos' }, visiveis.map((t) =>
    el('div', { class: classeDoItem(t) }, [
      el('div', { class: 'lanc-principal' }, [
        el('span', { class: 'lanc-descricao', text: t.descricao }),
        t.classificadoAutomaticamente ? el('span', { class: 'selo-auto', title: 'Categoria aplicada automaticamente', text: 'auto' }) : null,
      ]),
      el('div', { class: 'lanc-meta', text: `${formatDateBR(t.data)} · ${nome(ctx.categorias, t.categoria)} · ${nome(ctx.formas, t.formaPagamentoId)}` }),
      el('div', { class: 'lanc-valor', text: fmtBRL(t.valor) }),
      el('div', { class: 'acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluir(t) }),
      ]),
    ])
  ));
}

async function excluir(t) {
  if (!(await confirmar(`Excluir "${t.descricao}"?`))) return;
  await removeTransaction(t.id);
  toast('Lançamento excluído.', 'ok');
  await renderLancamentos();
}
