// Leitura do banco do app anterior (livro-de-gastos). Os dois apps ficam sob a
// mesma origem no GitHub Pages, e IndexedDB é isolado por origem e não por
// caminho — então este banco é visível aqui.
//
// Esta leitura NUNCA escreve no banco antigo: o app anterior segue íntegro e
// utilizável como retaguarda durante a transição.

import { LEGACY_DB_NAME, migrateV1ToV2 } from '../core/db-schema.js';
import * as storage from '../core/storage.js';

const STORES_LEGADO = ['expenses', 'categories', 'faturas', 'meta'];

export async function legacyDatabaseExists() {
  if (!indexedDB.databases) return false; // Firefox antigo: trate como ausente.
  try {
    const bancos = await indexedDB.databases();
    return bancos.some((b) => b.name === LEGACY_DB_NAME);
  } catch (e) {
    return false;
  }
}

function abrirSomenteLeitura() {
  return new Promise((resolve, reject) => {
    // Sem número de versão: conecta na versão atual sem disparar upgrade.
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      // Só acontece se o banco não existia. Abortamos para não deixar um banco
      // vazio para trás.
      req.transaction.abort();
      reject(new Error('O banco do app anterior não existe nesta origem.'));
    };
  });
}

export async function readLegacyDatabase() {
  const db = await abrirSomenteLeitura();
  try {
    const faltando = STORES_LEGADO.filter((n) => !db.objectStoreNames.contains(n));
    if (faltando.length === STORES_LEGADO.length) {
      throw new Error('O banco encontrado não tem o formato do app anterior.');
    }
    const resultado = {};
    for (const nome of STORES_LEGADO) {
      resultado[nome] = db.objectStoreNames.contains(nome)
        ? await new Promise((resolve, reject) => {
            const req = db.transaction(nome, 'readonly').objectStore(nome).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          })
        : [];
    }
    return resultado;
  } finally {
    db.close();
  }
}

export async function importLegacyInto(opcoes) {
  const legado = await readLegacyDatabase();
  const { transactions, categories, statements, meta, avisos } = migrateV1ToV2(legado, opcoes);
  // Ordem deliberada: categorias antes de transactions, para que nenhum
  // lançamento fique apontando para uma categoria que ainda não existe se a
  // gravação for interrompida no meio.
  await storage.putMany('categories', categories);
  await storage.putMany('transactions', transactions);
  await storage.putMany('statements', statements);
  await storage.putMany('meta', meta);
  return { transactions, statements, avisos };
}
