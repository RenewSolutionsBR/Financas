// Aba Lançamentos: a tela de uso diário, onde cada gasto é digitado. A regra
// de ouro do sistema (o que conta como gasto) mora em domain/transactions.js;
// esta tela só coleta o formulário e delega validação e persistência ao
// domínio.
//
// Conta e forma de pagamento desativadas somem do seletor do formulário,
// exceto quando são o valor já gravado no lançamento em edição: um lançamento
// antigo que aponta para uma conta já desativada precisa continuar mostrando
// essa conta e permitir salvar sem forçar o usuário a trocar por outra só
// para poder editar a descrição.

import { el, toast, confirmar } from './components.js';
import {
  listTransactions, saveTransaction, removeTransaction,
  novaTransaction, validateTransaction, filterTransactions, sumDespesas, NATUREZAS,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts } from '../domain/accounts.js';
import { fmtBRL, parseMoneyBR } from '../core/money.js';
import { formatDateBR, parseDateBR, todayISO, monthKey } from '../core/dates.js';
import * as storage from '../core/storage.js';

let filtros = { mes: monthKey(todayISO()) };
let editandoId = null;

// Pura, sem DOM: um item inativo some da lista, a não ser que seja `idAtual` —
// o valor já gravado no registro em edição. Sem a exceção, editar um
// lançamento antigo trocaria a conta ou a forma dele por "sem conta"/nenhuma
// seleção assim que o cadastro fosse desativado, o que o usuário não pediu.
export function opcoesAtivas(lista, idAtual) {
  return (lista || []).filter((item) => item.ativo !== false || item.id === idAtual);
}

function rotuloComStatus(item) {
  return item.ativo === false ? `${item.nome} — desativada` : item.nome;
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

  const contaAtualId = emEdicao ? emEdicao.contaId : null;
  const contasOpcoes = opcoesAtivas(ctx.contas, contaAtualId);
  const selConta = el('select', {}, [
    el('option', { value: '', text: '— sem conta —' }),
    ...contasOpcoes.map((a) => el('option', { value: a.id, text: rotuloComStatus(a), ...(emEdicao && emEdicao.contaId === a.id ? { selected: 'selected' } : {}) })),
  ]);

  // Escolher a forma preenche a conta automaticamente pelo padrão dela, sem
  // travar a escolha: o usuário ainda pode trocar depois.
  selForma.addEventListener('change', () => {
    const forma = ctx.formas.find((f) => f.id === selForma.value);
    if (forma && forma.contaPadraoId) selConta.value = forma.contaPadraoId;
  });

  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: rotuloNatureza(n), ...(emEdicao && emEdicao.natureza === n ? { selected: 'selected' } : {}) })
  ));

  const salvar = async () => {
    const data = parseDateBR(inpData.value);
    const valor = parseMoneyBR(inpValor.value);
    const base = {
      data,
      descricao: inpDescricao.value.trim(),
      valor: valor === null ? 0 : Math.abs(valor),
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
    if (erros.length) return toast(erros.join(' '), 'erro');

    await saveTransaction(registro);
    await storage.setMeta('ultimaFormaUsada', registro.formaPagamentoId);
    editandoId = null;
    toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
    await renderLancamentos();
  };

  return el('form', { class: 'form-lancamento', onsubmit: (ev) => { ev.preventDefault(); salvar(); } }, [
    el('div', { class: 'linha-form' }, [campo('Data', inpData), campo('Valor', inpValor)]),
    campo('Descrição', inpDescricao),
    el('div', { class: 'linha-form' }, [campo('Categoria', selCategoria), campo('Forma de pagamento', selForma)]),
    el('div', { class: 'linha-form' }, [campo('Conta / cartão', selConta), campo('Natureza', selNatureza)]),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn btn-primario', type: 'submit', text: emEdicao ? 'Salvar alterações' : 'Lançar' }),
      emEdicao ? el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: async () => { editandoId = null; await renderLancamentos(); } }) : null,
    ]),
  ]);
}

function campo(rotulo, controle) {
  return el('label', { class: 'campo' }, [el('span', { text: rotulo }), controle]);
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
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas' }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f) })),
  ]);
  selForma.addEventListener('change', async () => {
    filtros.formas = selForma.value ? [selForma.value] : [];
    await renderLancamentos();
  });

  const chkAuto = el('input', { type: 'checkbox' });
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
    el('div', { class: `item-lancamento ${t.natureza !== 'despesa' ? 'nao-gasto' : ''}` }, [
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
