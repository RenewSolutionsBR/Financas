// Formas de pagamento. O `tipo` carrega comportamento (com o que concilia, se
// gera fatura); o `nome` é só rótulo e o usuário pode renomear à vontade.

import { uid } from '../core/ids.js';
import { normalizeDescricao } from '../core/text.js';
import * as storage from '../core/storage.js';

export const TIPOS_FORMA = ['credito', 'debito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'outro'];

export function conciliaComDoTipo(tipo) {
  if (tipo === 'credito') return 'fatura';
  if (tipo === 'dinheiro' || tipo === 'outro') return 'nenhum';
  return 'extrato';
}

// Prefixos observados no extrato real, usados para inferir a forma de pagamento
// de uma linha importada. Sem número de conta nem nome de pessoa: são rótulos
// do próprio banco.
export const DEFAULT_PAYMENT_METHODS = [
  { id: 'pm_credito', nome: 'Cartão de Crédito', tipo: 'credito', ordem: 1, cor: '#31708f', padroesExtrato: [] },
  { id: 'pm_debito', nome: 'Cartão de Débito', tipo: 'debito', ordem: 2, cor: '#3c763d', padroesExtrato: ['COMPRA CARTAO DEBITO', 'DEBITO AUT.'] },
  { id: 'pm_pix', nome: 'Pix', tipo: 'pix', ordem: 3, cor: '#00695c', padroesExtrato: ['PIX ENVIADO', 'PIX RECEBIDO'] },
  { id: 'pm_dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', ordem: 4, cor: '#827717', padroesExtrato: [] },
  { id: 'pm_boleto', nome: 'Boleto', tipo: 'boleto', ordem: 5, cor: '#bf6516', padroesExtrato: ['PAGAMENTO DE BOLETO'] },
  { id: 'pm_transferencia', nome: 'Transferência (TED/DOC)', tipo: 'transferencia', ordem: 6, cor: '#6f5499', padroesExtrato: ['TED RECEBIDA', 'TED ENVIADA', 'DOC'] },
  { id: 'pm_outro', nome: 'Outro', tipo: 'outro', ordem: 7, cor: '#455a64', padroesExtrato: [] },
].map((p) => ({ ...p, conciliaCom: conciliaComDoTipo(p.tipo), ativo: true }));

export function validatePaymentMethod(pm, todas) {
  const erros = [];
  const nome = String(pm.nome || '').trim();
  if (!nome) erros.push('O nome da forma de pagamento não pode ficar em branco.');
  if (!TIPOS_FORMA.includes(pm.tipo)) erros.push(`Tipo inválido. Use um destes: ${TIPOS_FORMA.join(', ')}.`);
  const repetida = (todas || []).some(
    (p) => p.id !== pm.id && String(p.nome || '').trim().toLowerCase() === nome.toLowerCase()
  );
  if (repetida) erros.push(`Já existe uma forma de pagamento chamada "${nome}".`);
  return erros;
}

export function formaPorPrefixoExtrato(descricao, todas) {
  const alvo = normalizeDescricao(descricao);
  let melhor = null;
  let maiorPadrao = 0;
  for (const forma of todas || []) {
    for (const padrao of forma.padroesExtrato || []) {
      const p = normalizeDescricao(padrao);
      // Prefixo mais longo vence: o banco usa rótulos que são prefixo uns dos
      // outros, e o mais específico é o que descreve a operação de verdade.
      if (p && alvo.startsWith(p) && p.length > maiorPadrao) {
        melhor = forma;
        maiorPadrao = p.length;
      }
    }
  }
  return melhor;
}

export function novaForma(dados, todas) {
  const ordens = (todas || []).map((p) => p.ordem || 0);
  return {
    id: uid('pm'),
    ativo: true,
    padroesExtrato: [],
    ordem: (ordens.length ? Math.max(...ordens) : 0) + 1,
    ...dados,
    conciliaCom: conciliaComDoTipo(dados.tipo),
  };
}

// --- Persistência ---

export async function listFormas() {
  const todas = await storage.getAll('paymentMethods');
  return todas.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

export async function saveForma(pm) {
  return storage.put('paymentMethods', pm);
}

export async function removeForma(id, transactions) {
  const emUso = (transactions || []).filter((t) => t.formaPagamentoId === id).length;
  if (emUso) {
    throw new Error(`Esta forma de pagamento está em uso por ${emUso} lançamento(s). Desative-a em vez de excluir, para não perder o histórico.`);
  }
  return storage.remove('paymentMethods', id);
}

export async function seedFormasIfEmpty() {
  const existentes = await storage.getAll('paymentMethods');
  if (existentes.length) return false;
  await storage.putMany('paymentMethods', DEFAULT_PAYMENT_METHODS);
  return true;
}
