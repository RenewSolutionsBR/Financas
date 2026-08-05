// Navegação por mês (setas ‹ › ) e barra de filtros (forma, conta,
// natureza, só-automático) da aba Lançamentos. Extraído de lancamentos.js
// para manter os dois arquivos abaixo de ~250 linhas — layout portado do
// app anterior (Pessoal/07 Financeiro/Cartão de Credito/gastos-app),
// adaptado para os filtros multi-conta/forma/natureza que o app anterior
// não tinha.

import { el } from './components.js';
import { campo, rotuloComStatus } from './cadastros-comuns.js';
import { NATUREZAS } from '../domain/transactions.js';

export function viewDateParaMes(viewDate) {
  return viewDate.getFullYear() + '-' + String(viewDate.getMonth() + 1).padStart(2, '0');
}

export function mesParaViewDate(mesYYYYMM) {
  const [ano, mes] = mesYYYYMM.split('-').map(Number);
  return new Date(ano, mes - 1, 1);
}

export function nomeMesAno(viewDate) {
  const bruto = viewDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return bruto.charAt(0).toUpperCase() + bruto.slice(1);
}

export function formaFiltroAtual(filtros) {
  return ((filtros || {}).formas || [])[0] || '';
}

export function contaFiltroAtual(filtros) {
  return ((filtros || {}).contas || [])[0] || '';
}

export function naturezaFiltroAtual(filtros) {
  return ((filtros || {}).naturezas || [])[0] || '';
}

export function somenteAutoFiltroAtual(filtros) {
  return !!(filtros || {}).somenteAuto;
}

function rotuloNatureza(n) {
  return {
    despesa: 'Gasto',
    receita: 'Recebimento (não conta como gasto)',
    transferencia: 'Transferência entre contas próprias',
    pagamento_fatura: 'Pagamento de fatura',
  }[n];
}

// `aoMudar(novoViewDate)` é chamado com o mês já ajustado — quem chama
// (lancamentos.js) decide como recalcular filtros e re-renderizar.
export function montarNavegacaoMes(viewDate, aoMudar) {
  const mudarMes = (delta) => {
    const novo = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    aoMudar(novo);
  };
  return el('div', { class: 'nav-mes' }, [
    el('button', { class: 'btn btn-mini', type: 'button', text: '‹', 'aria-label': 'Mês anterior', onclick: () => mudarMes(-1) }),
    el('span', { class: 'nav-mes-label', text: nomeMesAno(viewDate) }),
    el('button', { class: 'btn btn-mini', type: 'button', text: '›', 'aria-label': 'Próximo mês', onclick: () => mudarMes(1) }),
  ]);
}

// `ctx` = { formas, contas }. `aoMudar()` é chamado sem argumento — os
// listeners já escreveram direto em `filtros` (mesmo padrão do
// lancamentos.js original) antes de chamar.
export function montarBarraFiltros(ctx, filtros, aoMudar) {
  // A barra de filtro mostra formas/contas/naturezas mesmo desativadas: o
  // usuário pode querer olhar o histórico de algo que já não usa.
  const formaAtual = formaFiltroAtual(filtros);
  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(formaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', async () => { filtros.formas = selForma.value ? [selForma.value] : []; await aoMudar(); });

  const contaAtual = contaFiltroAtual(filtros);
  const selConta = el('select', {}, [
    el('option', { value: '', text: 'Todas as contas/cartões', ...(contaAtual === '' ? { selected: 'selected' } : {}) }),
    ...ctx.contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === contaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selConta.addEventListener('change', async () => { filtros.contas = selConta.value ? [selConta.value] : []; await aoMudar(); });

  const naturezaAtual = naturezaFiltroAtual(filtros);
  const selNatureza = el('select', {}, [
    el('option', { value: '', text: 'Todas', ...(naturezaAtual === '' ? { selected: 'selected' } : {}) }),
    ...NATUREZAS.map((n) => el('option', { value: n, text: rotuloNatureza(n), ...(n === naturezaAtual ? { selected: 'selected' } : {}) })),
  ]);
  selNatureza.addEventListener('change', async () => { filtros.naturezas = selNatureza.value ? [selNatureza.value] : []; await aoMudar(); });

  const chkAuto = el('input', { type: 'checkbox', ...(somenteAutoFiltroAtual(filtros) ? { checked: 'checked' } : {}) });
  chkAuto.addEventListener('change', async () => { filtros.somenteAuto = chkAuto.checked; await aoMudar(); });

  return el('div', { class: 'filtros' }, [
    campo('Forma', selForma),
    campo('Conta/cartão', selConta),
    campo('Natureza', selNatureza),
    el('label', { class: 'campo-inline' }, [chkAuto, el('span', { text: 'Só classificados automaticamente' })]),
  ]);
}
