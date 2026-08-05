// 4 baldes de uma fatura selecionada (runReconciliation, Task 8), botao
// "+lancar" por item nao lancado no app, e exportacao da conciliacao
// completa (buildFullReconciliationRows) em .xlsx.

import { el } from './components.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR } from '../core/dates.js';
import { runReconciliation } from '../domain/reconcile-card.js';
import { irParaAba } from './tabs.js';

// Estado de modulo lido por ui/lancamentos.js no proximo render, mesmo
// espirito do pendingParcelaKey do app anterior citado no brief: o botao
// "+lancar" preenche este rascunho e troca de aba; lancamentos.js decide
// como usa-lo (fora do escopo desta task).
export let rascunhoLancamento = null;
export function limparRascunhoLancamento() { rascunhoLancamento = null; }

function itemFatura(item) {
  const parcela = item.parcela_atual ? ` (${item.parcela_atual}/${item.parcela_total})` : '';
  return el('div', { class: 'item-balde' }, [
    el('span', { class: 'item-descricao', text: `${item.descricao}${parcela}` }),
    el('span', { class: 'item-meta', text: `${formatDateBR(item.data)} · ${fmtBRL(item.valor)}` }),
    el('button', {
      class: 'btn btn-mini',
      text: '+ lançar',
      onclick: () => {
        rascunhoLancamento = { descricao: item.descricao, data: item.data, valor: item.valor, natureza: 'despesa' };
        irParaAba('Lancamentos');
      },
    }),
  ]);
}

function itemMatched(par) {
  return el('div', { class: 'item-balde item-conciliado' }, [
    el('span', { class: 'item-descricao', text: par.fatura.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(par.fatura.data)} · ${fmtBRL(par.fatura.valor)}` }),
  ]);
}

function itemApp(t) {
  return el('div', { class: 'item-balde' }, [
    el('span', { class: 'item-descricao', text: t.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(t.data)} · ${fmtBRL(t.valor)}` }),
  ]);
}

function balde(titulo, itens, vazio) {
  return el('div', { class: 'balde' }, [
    el('h3', { text: `${titulo} (${itens.length})` }),
    itens.length ? el('div', { class: 'lista-balde' }, itens) : el('p', { class: 'vazio', text: vazio }),
  ]);
}

export async function renderBaldesFatura(painel, fatura, faturasList, transactions, accounts) {
  const { autoMatched, matched, faturaUnmatched, appUnmatched } = runReconciliation(fatura, faturasList, transactions, accounts);

  painel.innerHTML = '';
  painel.append(
    balde('Conciliado automaticamente', autoMatched.map(itemMatched), 'Nenhum item conciliado automaticamente.'),
    balde('Conciliado', matched.map(itemMatched), 'Nenhum item conciliado.'),
    balde('Na fatura, não lançado no app', faturaUnmatched.map(itemFatura), 'Tudo da fatura já está lançado no app.'),
    balde('No app, não na fatura', appUnmatched.map(itemApp), 'Nenhum lançamento do app ficou de fora da fatura.')
  );
}
