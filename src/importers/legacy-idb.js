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
      // vazio para trás — e só rejeitamos a promessa quando a transação de
      // versionchange já terminou de abortar (evento `abort`, não a simples
      // chamada de `abort()`), para que quem espera esta promessa possa
      // contar que o banco fantasma já não existe mais, sem precisar de
      // nenhuma espera arbitrária depois.
      req.transaction.onabort = () => {
        reject(new Error('O banco do app anterior não existe nesta origem.'));
      };
      req.transaction.abort();
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
  // Fase de leitura e fase de escrita relatam erros com mensagens distintas:
  // um erro no meio da leitura não tem nada gravado ainda, e um erro na
  // escrita, com a gravação atômica abaixo, também não — mas o usuário
  // precisa saber QUAL das duas falhou para não confundir "o app anterior
  // sumiu" com "não coube no aparelho".
  let legado;
  try {
    legado = await readLegacyDatabase();
  } catch (e) {
    throw new Error('Não consegui ler os dados do app anterior: ' + e.message);
  }

  const { transactions, categories, statements, meta, avisos } = migrateV1ToV2(legado, opcoes);
  try {
    // Uma única transação cobrindo os quatro stores: ou tudo entra, ou nada
    // entra. Antes disto, um erro na 3ª de quatro gravações separadas
    // deixava as duas primeiras já persistidas e o app avisava "não
    // consegui ler" sobre uma migração que na verdade tinha gravado metade.
    await storage.putManyAcrossStores({ categories, transactions, statements, meta });
  } catch (e) {
    throw new Error('Não consegui salvar os dados migrados neste aparelho: ' + e.message);
  }
  return { transactions, statements, avisos };
}
