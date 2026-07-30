// Contas correntes e cartões. Um cartão adicional aponta para o titular por
// cartaoPaiId: a fatura e o débito em conta pertencem ao titular, mas cada
// gasto guarda de qual plástico saiu (ver spec 5.1.1).

import { uid } from '../core/ids.js';
import { normalizeDescricao } from '../core/text.js';
import * as storage from '../core/storage.js';

export const TIPO_CONTA = 'conta';
export const TIPO_CARTAO = 'cartao';

export function isAdicional(acc) {
  return acc.tipo === TIPO_CARTAO && !!acc.cartaoPaiId;
}

export function validateAccount(acc, todas) {
  const erros = [];
  const outras = (todas || []).filter((a) => a.id !== acc.id);

  if (!String(acc.nome || '').trim()) erros.push('O nome não pode ficar em branco.');
  if (acc.tipo !== TIPO_CONTA && acc.tipo !== TIPO_CARTAO) erros.push('Tipo inválido.');

  if (acc.tipo === TIPO_CONTA) {
    if (!String(acc.agencia || '').trim()) erros.push('Informe a agência.');
    if (!String(acc.numero || '').trim()) erros.push('Informe o número da conta.');
  }

  if (acc.tipo === TIPO_CARTAO) {
    if (!/^\d{4}$/.test(String(acc.final || ''))) {
      erros.push('O final do cartão deve ter exatamente 4 dígitos.');
    }
    if (acc.cartaoPaiId) {
      if (acc.cartaoPaiId === acc.id) {
        erros.push('Um cartão não pode ser adicional de si mesmo.');
      } else {
        const pai = outras.find((a) => a.id === acc.cartaoPaiId);
        if (!pai) erros.push('O cartão titular informado não existe.');
        else if (pai.tipo !== TIPO_CARTAO) erros.push('O titular de um adicional precisa ser um cartão.');
        else if (isAdicional(pai)) erros.push('Um cartão adicional não pode ser titular de outro adicional.');
      }
    }
    if (acc.cartaoPaiId && acc.contaPagadoraId) {
      erros.push('Um cartão adicional não tem conta pagadora própria: quem paga é a conta do cartão titular.');
    }
    if (acc.contaPagadoraId) {
      const conta = outras.find((a) => a.id === acc.contaPagadoraId);
      if (!conta) erros.push('A conta pagadora informada não existe.');
      else if (conta.tipo !== TIPO_CONTA) erros.push('A conta pagadora precisa ser uma conta corrente.');
    }
  }

  return erros;
}

export function suggestMatchers(acc) {
  if (acc.tipo !== TIPO_CARTAO || !acc.final) return [];
  const bandeira = String(acc.bandeira || '').toUpperCase();
  const sugestoes = [`FINAL ${acc.final}`];
  if (bandeira) sugestoes.push(`${bandeira} FINAL ${acc.final}`);
  return sugestoes;
}

export function plasticosDoTitular(titularId, todas) {
  const lista = todas || [];
  // Se vier o id de um adicional, resolve para o titular antes: devolver so o
  // proprio adicional seria um resultado incompleto com cara de valido, e os
  // gastos dos irmaos ficariam de fora da conciliacao sem ninguem notar.
  const alvo = lista.find((a) => a.id === titularId);
  const raizId = alvo && alvo.cartaoPaiId ? alvo.cartaoPaiId : titularId;
  const ids = [raizId];
  for (const a of lista) if (a.cartaoPaiId === raizId) ids.push(a.id);
  return ids;
}

export function contaPagadoraEfetiva(acc, todas) {
  if (!acc || acc.tipo !== TIPO_CARTAO) return null;
  // O pai vem primeiro de proposito: um adicional nao tem conta pagadora
  // propria, e um cadastro malformado com os dois campos preenchidos nao pode
  // fazer a conciliacao confrontar o debito contra a conta errada.
  if (acc.cartaoPaiId) {
    const pai = (todas || []).find((a) => a.id === acc.cartaoPaiId);
    return pai ? pai.contaPagadoraId || null : null;
  }
  return acc.contaPagadoraId || null;
}

export function contaQueCasaDescricao(descricao, todas) {
  const alvo = normalizeDescricao(descricao);
  for (const a of todas || []) {
    for (const m of a.matchers || []) {
      if (m && casaMatcher(alvo, normalizeDescricao(m))) return a;
    }
  }
  return null;
}

// Casamento por substring, mas sem deixar um matcher terminado em digito casar
// dentro de um numero maior: sem a ancora, o matcher "FINAL 151" casava com a
// descricao de um cartao final 1511, e o pagamento iria para o cartao errado.
function casaMatcher(alvo, matcher) {
  if (!matcher) return false;
  const escapado = matcher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9])${escapado}(?![0-9])`).test(alvo);
}

export function novaConta(dados) {
  return { id: uid('acc'), tipo: TIPO_CONTA, ativo: true, ...dados };
}

export function novoCartao(dados) {
  const base = { id: uid('acc'), tipo: TIPO_CARTAO, ativo: true, ...dados };
  return { ...base, matchers: dados.matchers || suggestMatchers(base) };
}

// --- Persistência ---

export async function listAccounts() {
  return storage.getAll('accounts');
}

export async function saveAccount(a) {
  return storage.put('accounts', a);
}

export async function removeAccount(id) {
  const todas = await listAccounts();
  const filhos = todas.filter((a) => a.cartaoPaiId === id);
  if (filhos.length) {
    throw new Error(`Não dá para excluir: existem ${filhos.length} cartão(ões) adicional(is) ligados a este. Exclua-os primeiro ou desative este cartão.`);
  }
  return storage.remove('accounts', id);
}
