// Descrição do schema e conversão de dados. Módulo PURO: não abre banco, não
// toca em IndexedDB. É o que permite testar a migração inteira fora do
// navegador — e a migração é onde um erro custa os dados reais do usuário.

import { isValidISO } from './dates.js';

export const DB_NAME = 'financas';
export const DB_VERSION = 2;

// Banco do app anterior, lido apenas para migrar. Mesma origem no GitHub Pages.
export const LEGACY_DB_NAME = 'livro-de-gastos';

export const STORES = [
  {
    nome: 'transactions',
    keyPath: 'id',
    indices: [
      { nome: 'by_data', keyPath: 'data', unique: false },
      { nome: 'by_parcelaKey', keyPath: 'parcelaKey', unique: false },
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
    ],
  },
  { nome: 'accounts', keyPath: 'id', indices: [] },
  { nome: 'paymentMethods', keyPath: 'id', indices: [] },
  { nome: 'categories', keyPath: 'id', indices: [] },
  {
    nome: 'statements',
    keyPath: 'id',
    indices: [
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
      { nome: 'by_tipo', keyPath: 'tipo', unique: false },
    ],
  },
  {
    nome: 'classificationRules',
    keyPath: 'id',
    indices: [{ nome: 'by_padrao', keyPath: 'padrao', unique: false }],
  },
  { nome: 'meta', keyPath: 'key', indices: [] },
];

/**
 * Converte o conteúdo do banco do app anterior no schema v2.
 *
 * Não altera a entrada e não conhece persistência: recebe arrays, devolve
 * arrays. Rodar duas vezes com a mesma entrada produz o mesmo resultado, e
 * como os ids são preservados, uma segunda gravação sobrescreve em vez de
 * duplicar.
 */
export function migrateV1ToV2(legado, opcoes) {
  const { cartaoTitularId, formaCreditoId } = opcoes;
  const expenses = (legado && legado.expenses) || [];
  const faturas = (legado && legado.faturas) || [];
  const avisos = [];

  const transactions = [];
  for (const e of expenses) {
    if (!isValidISO(e.data)) {
      avisos.push(`Lançamento "${e.id}" foi descartado por não ter data válida.`);
      continue;
    }
    const t = {
      id: e.id,
      data: e.data,
      descricao: e.descricao || '',
      valor: Math.abs(Number(e.valor) || 0),
      categoria: e.categoria || 'a_classificar',
      natureza: 'despesa',
      formaPagamentoId: formaCreditoId,
      contaId: cartaoTitularId,
      origem: 'manual',
      previsto: e.previsto === true,
    };
    // Campos opcionais só entram quando existiam, para não poluir o registro
    // com um monte de undefined e para o teste de idempotência ser exato.
    if (e.parcelaKey) t.parcelaKey = e.parcelaKey;
    if (e.parcela_atual != null) t.parcela_atual = e.parcela_atual;
    if (e.parcela_total != null) t.parcela_total = e.parcela_total;
    if (e.conciliadoAutomaticamente) t.conciliadoAutomaticamente = true;
    if (e.origemManual) t.origemManual = true;
    if (e.grupo_parcela) t.grupo_parcela = e.grupo_parcela;
    transactions.push(t);
  }

  const statements = faturas.map((f) => ({
    id: `${cartaoTitularId}|fatura|${f.vencimento}`,
    tipo: 'fatura',
    contaId: cartaoTitularId,
    adaptador: 'santander-cartao-pdf',
    arquivo: f.arquivo || '',
    importadoEm: f.importedAt || null,
    vencimento: f.vencimento,
    dataCorte: f.dataCorte || null,
    rows: f.rows || [],
  }));

  if (expenses.length > 0 && faturas.length === 0) {
    avisos.push(
      'Nenhuma fatura veio na origem dos dados. Se você migrou por arquivo de backup, ' +
      'as faturas importadas não estão nele: reimporte os PDFs de fatura depois.'
    );
  }

  return {
    transactions,
    categories: ((legado && legado.categories) || []).map((c) => ({ ...c })),
    statements,
    meta: ((legado && legado.meta) || []).map((m) => ({ ...m })),
    avisos,
  };
}
