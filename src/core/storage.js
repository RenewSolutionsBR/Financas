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
  // Uma abertura que falhou nao pode ficar cacheada: sem isso, toda chamada
  // seguinte rejeitava com o mesmo erro ate a pagina ser recarregada, e fechar
  // a aba que bloqueava - que e o que a propria mensagem manda fazer - nao
  // adiantava nada. Com o reset, a proxima chamada tenta abrir de novo.
  dbPromise.catch(() => { dbPromise = null; });
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

/**
 * Grava em vários stores dentro de uma única transação — ou tudo entra, ou
 * nada entra. Existe para operações como a migração do app anterior, que
 * gravam em quatro stores (categories/transactions/statements/meta): sem
 * isto, um erro na 3ª gravação deixava as duas primeiras já persistidas,
 * e o usuário via uma migração "parcial" sem nenhum aviso disso.
 *
 * @param {Record<string, any[]>} entradasPorStore
 */
export async function putManyAcrossStores(entradasPorStore) {
  const nomes = Object.keys(entradasPorStore || {}).filter(
    (nome) => (entradasPorStore[nome] || []).length
  );
  if (!nomes.length) return;
  const db = await openDB();
  let tx;
  try {
    tx = db.transaction(nomes, 'readwrite', { durability: 'strict' });
  } catch (e) {
    // Motores antigos rejeitam a assinatura de 3 argumentos, ou a lista de
    // stores com mais de um nome — mesma guarda de store() acima.
    tx = db.transaction(nomes, 'readwrite');
  }
  for (const nome of nomes) {
    const s = tx.objectStore(nome);
    for (const v of entradasPorStore[nome]) s.put(v);
  }
  // Espera o COMMIT da transação, não só as respostas individuais de put():
  // uma requisição que falha aborta a transação inteira por padrão (nós não
  // chamamos preventDefault no erro dela), e só o evento da transação diz se
  // o conjunto todo realmente foi para o disco.
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('A gravação foi cancelada.'));
  });
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
