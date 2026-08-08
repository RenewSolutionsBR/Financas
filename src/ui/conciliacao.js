// Aba Conciliacao: escolha de conta/cartao e documento, delega para os
// outros tres modulos (import/fatura/extrato). Nenhuma regra de negocio
// mora aqui.

import { el, toast } from './components.js';
import { listAccounts, TIPO_CARTAO, TIPO_CONTA } from '../domain/accounts.js';
import { listTransactions } from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listRegras } from '../domain/classification.js';
import { buildFullReconciliationRows } from '../domain/reconcile-card.js';
import * as storage from '../core/storage.js';
import { renderImportacao } from './conciliacao-import.js';
import { renderBaldesFatura } from './conciliacao-fatura.js';
import { renderBaldesExtrato, limparFiltrosExtrato } from './conciliacao-extrato.js';

let contaSelecionadaId = null;
let documentoSelecionadoId = null;

async function exportarConciliacaoCompleta(faturasList, extratosList, transactions, accounts, apelidosTitular, categorias) {
  try {
    const rows = buildFullReconciliationRows(faturasList, extratosList, transactions, accounts, apelidosTitular, categorias);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conciliacao');
    XLSX.writeFile(wb, `conciliacao-completa-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    toast('Não consegui exportar a conciliação: ' + e.message, 'erro');
  }
}

export async function renderConciliacao() {
  const painel = document.getElementById('tabConciliacao');
  const contas = await listAccounts();
  const documentos = contaSelecionadaId ? await storage.getByIndex('statements', 'by_contaId', contaSelecionadaId) : [];

  painel.innerHTML = '';
  const painelAcoes = contas.length
    ? el('div', { class: 'acoes' }, [
        el('button', {
          class: 'btn', text: 'Exportar conciliação completa',
          onclick: async () => {
            const [transactions, todasFaturas, todosExtratos, apelidosTitular, categorias] = await Promise.all([
              listTransactions(),
              storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'fatura')),
              storage.getAll('statements').then((lista) => lista.filter((s) => s.tipo === 'extrato')),
              storage.getMeta('apelidosTitular', []),
              listCategorias(),
            ]);
            await exportarConciliacaoCompleta(todasFaturas, todosExtratos, transactions, contas, apelidosTitular, categorias);
          },
        }),
      ])
    : null;
  painel.append(
    montarSeletorContaCartao(contas),
    montarSeletorDocumento(documentos),
    ...(painelAcoes ? [painelAcoes] : []),
    el('div', { id: 'painelImportacao' }),
    el('div', { id: 'painelBaldes' })
  );
  const escopoSugerido = contaAtualEhCartao(contas) ? 'fatura' : 'extrato';
  await renderImportacao(document.getElementById('painelImportacao'), contaSelecionadaId, escopoSugerido, renderConciliacao);

  const doc = documentos.find((d) => d.id === documentoSelecionadoId);
  const painelBaldes = document.getElementById('painelBaldes');
  try {
    if (doc && doc.tipo === 'fatura') {
      const [transactions, faturasDoCartao] = await Promise.all([
        listTransactions(),
        storage.getByIndex('statements', 'by_contaId', doc.contaId).then((lista) => lista.filter((s) => s.tipo === 'fatura')),
      ]);
      await renderBaldesFatura(painelBaldes, doc, faturasDoCartao, transactions, contas);
    } else if (doc && doc.tipo === 'extrato') {
      const [transactions, categorias, formas, regras] = await Promise.all([
        listTransactions(), listCategorias(), listFormas(), listRegras(),
      ]);
      const apelidosTitular = await storage.getMeta('apelidosTitular', []);
      await renderBaldesExtrato(painelBaldes, doc, transactions, contas, apelidosTitular, categorias, formas, regras, renderConciliacao);
    } else {
      painelBaldes.innerHTML = '';
    }
  } catch (e) {
    // Sem isso, um erro aqui deixava o painel em branco (nem os baldes vazios
    // apareciam) sem NENHUMA pista pro usuario — visto em producao com um
    // extrato real, onde a mesma logica funcionava perfeitamente quando
    // chamada manualmente, mas a tela ficava muda. Mostrar o erro na propria
    // tela (nao so um toast, que pode passar despercebido) e o unico jeito
    // de diagnosticar um erro que so acontece no aparelho do usuario.
    painelBaldes.innerHTML = '';
    painelBaldes.append(el('p', { class: 'aviso-erro', text: `Não consegui carregar esta conciliação: ${e.message}` }));
    toast('Não consegui carregar esta conciliação: ' + e.message, 'erro');
  }
}

function contaAtualEhCartao(contas) {
  const conta = contas.find((c) => c.id === contaSelecionadaId);
  return conta ? conta.tipo === TIPO_CARTAO : true;
}

// Cartoes primeiro (rotulados "Fatura"), contas depois ("Extrato") — spec 9.
function montarSeletorContaCartao(contas) {
  const cartoes = contas.filter((c) => c.tipo === TIPO_CARTAO);
  const contasCorrentes = contas.filter((c) => c.tipo === TIPO_CONTA);
  const sel = el('select', {}, [
    el('option', { value: '', text: '— escolha —', ...(contaSelecionadaId ? {} : { selected: 'selected' }) }),
    cartoes.length ? el('optgroup', { label: 'Fatura (cartão)' }, cartoes.map((c) =>
      el('option', { value: c.id, text: c.nome, ...(c.id === contaSelecionadaId ? { selected: 'selected' } : {}) })
    )) : null,
    contasCorrentes.length ? el('optgroup', { label: 'Extrato (conta)' }, contasCorrentes.map((c) =>
      el('option', { value: c.id, text: c.nome, ...(c.id === contaSelecionadaId ? { selected: 'selected' } : {}) })
    )) : null,
  ]);
  sel.addEventListener('change', async () => {
    contaSelecionadaId = sel.value || null;
    documentoSelecionadoId = null;
    limparFiltrosExtrato();
    await renderConciliacao();
  });
  return el('label', { class: 'campo' }, [el('span', { text: 'Conta / cartão' }), sel]);
}

function montarSeletorDocumento(documentos) {
  const ordenados = [...documentos].sort((a, b) => (a.vencimento < b.vencimento ? 1 : -1));
  const sel = el('select', {}, [
    el('option', { value: '', text: documentos.length ? '— escolha um documento —' : '— nenhum documento importado —' }),
    ...ordenados.map((d) => el('option', {
      value: d.id,
      text: `${d.tipo === 'fatura' ? 'Fatura' : 'Extrato'} — ${d.vencimento || d.arquivo}`,
      ...(d.id === documentoSelecionadoId ? { selected: 'selected' } : {}),
    })),
  ]);
  sel.addEventListener('change', async () => {
    documentoSelecionadoId = sel.value || null;
    limparFiltrosExtrato();
    await renderConciliacao();
  });
  return el('label', { class: 'campo' }, [el('span', { text: 'Documento' }), sel]);
}
