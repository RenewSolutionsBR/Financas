// Única porta de entrada do IndexedDB. Nenhum módulo de core/ ou domain/
// (fora este arquivo) importa indexedDB diretamente, e mesmo aqui o objeto
// global só é tocado dentro de funções, nunca no corpo do módulo.

import { DB_NAME, DB_VERSION, STORES } from './db-schema.js';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      for (const def of STORES) {
        const store = db.objectStoreNames.contains(def.nome)
          ? tx.objectStore(def.nome)
          : db.createObjectStore(def.nome, { keyPath: def.keyPath });
        for (const idx of def.indices) {
          if (!store.indexNames.contains(idx.nome)) {
            store.createIndex(idx.nome, idx.keyPath, { unique: idx.unique });
          }
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Se outra aba subir o schema, fechamos esta conexão em vez de travar o
      // upgrade indefinidamente — problema clássico de IndexedDB multi-aba.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(
      'Abertura do banco bloqueada por outra aba deste app. Feche as outras abas e recarregue.'
    ));
  });
  return dbPromise;
}

function store(db, nome, modo) {
  let tx;
  try {
    tx = modo === 'readwrite'
      ? db.transaction(nome, modo, { durability: 'strict' })
      : db.transaction(nome, modo);
  } catch (e) {
    // Motores antigos rejeitam a assinatura de 3 argumentos.
    tx = db.transaction(nome, modo);
  }
  return tx.objectStore(nome);
}

function promessa(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(nome) {
  return promessa(store(await openDB(), nome, 'readonly').getAll());
}

export async function get(nome, key) {
  return promessa(store(await openDB(), nome, 'readonly').get(key));
}

export async function put(nome, valor) {
  return promessa(store(await openDB(), nome, 'readwrite').put(valor));
}

export async function putMany(nome, valores) {
  if (!valores || !valores.length) return;
  const s = store(await openDB(), nome, 'readwrite');
  await Promise.all(valores.map((v) => promessa(s.put(v))));
}

export async function remove(nome, key) {
  return promessa(store(await openDB(), nome, 'readwrite').delete(key));
}

export async function clearStore(nome) {
  return promessa(store(await openDB(), nome, 'readwrite').clear());
}

export async function resetAllData() {
  for (const def of STORES) await clearStore(def.nome);
}

export async function getByIndex(nome, indice, valor) {
  const s = store(await openDB(), nome, 'readonly');
  return promessa(s.index(indice).getAll(valor));
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}
