// Helper de teste (não é código do app): cria e derruba, no navegador de
// testes, um banco IndexedDB com o mesmo nome do app anterior
// (livro-de-gastos) para exercitar o caminho "há dados para migrar" sem
// depender da origem real do GitHub Pages, onde o banco de verdade mora.
//
// Só é importado por *.browser.test.js. Nenhum dado real do usuário aparece
// aqui nem em quem usa este módulo.

import { LEGACY_DB_NAME } from '../../src/core/db-schema.js';

const STORES_LEGADO = ['expenses', 'categories', 'faturas', 'meta'];

function abrirComVersao(nome, versao, aoAtualizar) {
  return new Promise((resolve, reject) => {
    const req = versao === undefined ? indexedDB.open(nome) : indexedDB.open(nome, versao);
    if (aoAtualizar) req.onupgradeneeded = () => aoAtualizar(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('bloqueado por outra aba'));
  });
}

export async function derrubarBancoLegadoFalso() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort: outra conexao aberta não deve travar o teste
  });
}

/**
 * Cria (substituindo qualquer banco anterior com o mesmo nome) um banco
 * `livro-de-gastos` fictício, com chaves fora de linha (autoIncrement) —
 * a migração só olha para os campos do próprio registro (id, descricao...),
 * nunca para a chave do object store, então o teste não precisa adivinhar o
 * keyPath real do app anterior.
 */
export async function criarBancoLegadoFalso(dados) {
  await derrubarBancoLegadoFalso();
  const db = await abrirComVersao(LEGACY_DB_NAME, 1, (d) => {
    for (const nome of STORES_LEGADO) d.createObjectStore(nome, { autoIncrement: true });
  });
  try {
    for (const nome of STORES_LEGADO) {
      const tx = db.transaction(nome, 'readwrite');
      const s = tx.objectStore(nome);
      for (const item of dados[nome] || []) s.add(item);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  } finally {
    db.close();
  }
}

/** Lê todos os stores do banco falso, sem passar por versão (igual ao app). */
export async function lerBancoLegadoFalso() {
  const db = await abrirComVersao(LEGACY_DB_NAME, undefined, undefined);
  try {
    const resultado = {};
    for (const nome of STORES_LEGADO) {
      resultado[nome] = await new Promise((resolve, reject) => {
        const req = db.transaction(nome, 'readonly').objectStore(nome).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return resultado;
  } finally {
    db.close();
  }
}
