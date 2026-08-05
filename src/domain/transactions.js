// Lançamentos. A regra de ouro do sistema mora aqui: gasto é despesa não
// prevista, e só. Receita, transferência entre contas próprias e pagamento de
// fatura são registrados e exibíveis, mas nunca somam como gasto — é o que
// impede o extrato e a fatura do cartão de contarem o mesmo dinheiro duas vezes.

import { uid } from '../core/ids.js';
import { isValidISO, monthKey } from '../core/dates.js';
import { round2 } from '../core/money.js';
import * as storage from '../core/storage.js';
import { CATEGORIA_A_CLASSIFICAR } from './categories.js';

export const NATUREZAS = ['despesa', 'receita', 'transferencia', 'pagamento_fatura'];

// Chave usada em totaisPorForma para lançamentos sem forma de pagamento
// definida: agrupar sob a string literal "undefined" deixaria a tela sem
// rótulo para mostrar; agrupar sob um nome próprio permite exibir "Sem forma".
export const SEM_FORMA = 'sem_forma';

export function contaComoGasto(t) {
  return t.natureza === 'despesa' && !t.previsto;
}

export function validateTransaction(t) {
  if (!t || typeof t !== 'object') return ['Lançamento inválido.'];
  const erros = [];
  if (!String(t.descricao || '').trim()) erros.push('A descrição não pode ficar em branco.');
  if (!isValidISO(t.data)) erros.push('Informe uma data válida.');
  if (!t.categoria) erros.push('Escolha uma categoria.');
  if (!t.formaPagamentoId) erros.push('Escolha a forma de pagamento.');
  if (!NATUREZAS.includes(t.natureza)) erros.push(`Natureza inválida. Use uma destas: ${NATUREZAS.join(', ')}.`);
  const valor = Number(t.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    erros.push('O valor precisa ser maior que zero. O sentido do lançamento vem da natureza, não do sinal.');
  }
  return erros;
}

export function sumDespesas(transactions) {
  let total = 0;
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    // Um valor ilegível é ignorado em vez de contaminar a soma: sem isso, um
    // único registro corrompido tornava o total NaN, e fmtBRL exibia NaN como
    // "R$ 0,00" — o mês inteiro aparecia zerado sem nenhum sinal de erro.
    if (!Number.isFinite(valor)) continue;
    total += valor;
  }
  return round2(total);
}

export function filterTransactions(transactions, filtros) {
  const f = filtros || {};
  // Uma lista vazia significa "não filtrar por isso", e não "não trazer nada":
  // é o estado inicial de um seletor de múltipla escolha.
  const listaAtiva = (v) => Array.isArray(v) && v.length > 0;
  return (transactions || []).filter((t) => {
    if (f.mes && monthKey(t.data) !== f.mes) return false;
    if (f.ano && String(t.data || '').slice(0, 4) !== String(f.ano)) return false;
    if (listaAtiva(f.formas) && !f.formas.includes(t.formaPagamentoId)) return false;
    if (listaAtiva(f.contas) && !f.contas.includes(t.contaId)) return false;
    if (listaAtiva(f.categorias) && !f.categorias.includes(t.categoria)) return false;
    if (listaAtiva(f.naturezas) && !f.naturezas.includes(t.natureza)) return false;
    if (f.somenteAuto && !t.classificadoAutomaticamente) return false;
    if (f.somenteGastos && !contaComoGasto(t)) return false;
    return true;
  });
}

export function totaisPorForma(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    // Mesma guarda de sumDespesas: um valor ilegível não pode contaminar o
    // total do grupo inteiro.
    if (!Number.isFinite(valor)) continue;
    const chave = t.formaPagamentoId || SEM_FORMA;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

export function totaisPorCategoria(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    // Mesma guarda de sumDespesas/totaisPorForma: um valor ilegível não pode
    // contaminar o total do grupo inteiro.
    if (!Number.isFinite(valor)) continue;
    const chave = t.categoria || CATEGORIA_A_CLASSIFICAR;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

// Soma por mês (YYYY-MM). NÃO aplica filtro de mês — quem chama já filtrou
// por ano/forma/conta antes (filterTransactions), mas nunca por mês: filtrar
// mês aqui colapsaria a série de barras numa barra só.
export function totaisPorMes(transactions) {
  const mapa = new Map();
  for (const t of transactions || []) {
    if (!contaComoGasto(t)) continue;
    const valor = Number(t.valor);
    if (!Number.isFinite(valor)) continue;
    const chave = monthKey(t.data);
    if (!chave) continue;
    mapa.set(chave, round2((mapa.get(chave) || 0) + valor));
  }
  return mapa;
}

export function novaTransaction(dados) {
  return {
    id: uid('tx'),
    natureza: 'despesa',
    origem: 'manual',
    previsto: false,
    ...dados,
    valor: Math.abs(Number((dados && dados.valor) || 0)),
  };
}

// --- Persistência ---

export async function listTransactions() {
  return storage.getAll('transactions');
}

export async function saveTransaction(t) {
  return storage.put('transactions', t);
}

export async function saveTransactions(lista) {
  return storage.putMany('transactions', lista);
}

export async function removeTransaction(id) {
  return storage.remove('transactions', id);
}
