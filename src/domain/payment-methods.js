// Formas de pagamento. O `tipo` carrega comportamento (com o que concilia, se
// gera fatura); o `nome` é só rótulo e o usuário pode renomear à vontade.

import { uid } from '../core/ids.js';
import { normalizeDescricao } from '../core/text.js';
import * as storage from '../core/storage.js';
import { registrarEvento, TIPOS_EVENTO } from './audit-log.js';

export const TIPOS_FORMA = ['credito', 'debito', 'pix', 'dinheiro', 'boleto', 'transferencia', 'outro'];

const CONCILIA_POR_TIPO = {
  credito: 'fatura',
  debito: 'extrato',
  pix: 'extrato',
  boleto: 'extrato',
  transferencia: 'extrato',
  dinheiro: 'nenhum',
  outro: 'nenhum',
};

// Tipo desconhecido cai em 'nenhum', não em 'extrato': um typo no tipo não pode
// fazer a forma entrar calada na conciliação de extrato como se fosse válida.
export function conciliaComDoTipo(tipo) {
  return CONCILIA_POR_TIPO[tipo] || 'nenhum';
}

// Prefixos observados no extrato real, usados para inferir a forma de pagamento
// de uma linha importada. Sem número de conta nem nome de pessoa: são rótulos
// do próprio banco.
export const DEFAULT_PAYMENT_METHODS = [
  { id: 'pm_credito', nome: 'Cartão de Crédito', tipo: 'credito', ordem: 1, cor: '#31708f',
    // Prefixos mais específicos que o 'DEBITO AUT.' genérico do débito: sem
    // eles, o pagamento da fatura do cartão era classificado como cartão de
    // débito, que é justamente o que a regra do prefixo mais longo existe para
    // evitar. São as duas grafias observadas no extrato real.
    padroesExtrato: ['DEBITO AUT. FATURA', 'DEBITO AUT. FAT.CARTAO', 'PAGAMENTO FATURA CARTAO'] },
  { id: 'pm_debito', nome: 'Cartão de Débito', tipo: 'debito', ordem: 2, cor: '#3c763d', padroesExtrato: ['COMPRA CARTAO DEBITO', 'DEBITO AUT.'] },
  { id: 'pm_pix', nome: 'Pix', tipo: 'pix', ordem: 3, cor: '#00695c', padroesExtrato: ['PIX ENVIADO', 'PIX RECEBIDO'] },
  { id: 'pm_dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', ordem: 4, cor: '#827717', padroesExtrato: [] },
  { id: 'pm_boleto', nome: 'Boleto', tipo: 'boleto', ordem: 5, cor: '#bf6516', padroesExtrato: ['PAGAMENTO DE BOLETO'] },
  { id: 'pm_transferencia', nome: 'Transferência (TED/DOC)', tipo: 'transferencia', ordem: 6, cor: '#6f5499', padroesExtrato: ['TED RECEBIDA', 'TED ENVIADA', 'DOC'] },
  { id: 'pm_outro', nome: 'Outro', tipo: 'outro', ordem: 7, cor: '#455a64', padroesExtrato: [] },
].map((p) => ({ ...p, conciliaCom: conciliaComDoTipo(p.tipo), ativo: true }));

export function validatePaymentMethod(pm, todas) {
  if (!pm || typeof pm !== 'object') return ['Forma de pagamento inválida.'];
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
    // Forma desativada não classifica nada: o usuário a tirou de circulação, e
    // ela continuar capturando linhas novas do extrato contraria isso.
    if (forma.ativo === false) continue;
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
  await storage.put('paymentMethods', pm);
  await registrarEvento(TIPOS_EVENTO.CADASTRO_ATUALIZADO, 'Cadastro de forma de pagamento atualizado');
}

export async function removeForma(id, transactions) {
  // Sem `transactions` (undefined), (transactions || []) virava lista vazia
  // e a guarda de "em uso" abaixo nunca disparava — exclusao em silencio.
  // Exige o array explicitamente: quem chama precisa passar [] de proposito,
  // nunca deixar o parametro ausente silenciar a guarda.
  if (!Array.isArray(transactions)) {
    throw new Error('removeForma precisa da lista de lançamentos (passe [] se não houver nenhum) para checar se a forma está em uso.');
  }
  const emUso = transactions.filter((t) => t.formaPagamentoId === id).length;
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
