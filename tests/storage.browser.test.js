// Testes de storage.js que dependem de IndexedDB de verdade: só rodam no
// navegador (tools/tests.html). O runner do Node pula este arquivo.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import * as storage from '../src/core/storage.js';

describe('storage', () => {
  it('grava e lê um registro', async () => {
    await storage.put('categories', { id: 'teste_1', nome: 'Teste', cor: '#000' });
    const lido = await storage.get('categories', 'teste_1');
    assertEqual(lido.nome, 'Teste');
    await storage.remove('categories', 'teste_1');
    assertEqual(await storage.get('categories', 'teste_1'), undefined);
  });

  it('putMany grava em lote', async () => {
    await storage.putMany('categories', [
      { id: 'teste_a', nome: 'A', cor: '#111' },
      { id: 'teste_b', nome: 'B', cor: '#222' },
    ]);
    const todas = await storage.getAll('categories');
    assert(todas.some((c) => c.id === 'teste_a'));
    assert(todas.some((c) => c.id === 'teste_b'));
    await storage.remove('categories', 'teste_a');
    await storage.remove('categories', 'teste_b');
  });

  it('putMany ignora lista vazia, nula ou ausente sem quebrar', async () => {
    // O guard existe pelos dois ultimos casos: sem ele, .map lanca TypeError.
    await storage.putMany('categories', []);
    await storage.putMany('categories', null);
    await storage.putMany('categories', undefined);
  });

  it('busca por índice', async () => {
    await storage.put('transactions', {
      id: 'teste_t1', data: '2026-06-10', descricao: 'x', valor: 1,
      categoria: 'casa', natureza: 'despesa', contaId: 'acc_x',
    });
    const achados = await storage.getByIndex('transactions', 'by_contaId', 'acc_x');
    assertEqual(achados.length, 1);
    assertEqual(achados[0].id, 'teste_t1');
    await storage.remove('transactions', 'teste_t1');
  });

  it('meta guarda pares chave/valor', async () => {
    assertEqual(await storage.getMeta('inexistente', 'padrao'), 'padrao');
    await storage.setMeta('teste_meta', 42);
    assertEqual(await storage.getMeta('teste_meta'), 42);
    await storage.remove('meta', 'teste_meta');
  });
});

describe('storage: resetTransacoes', () => {
  it('apaga transactions e statements, preserva cadastros (categories)', async () => {
    await storage.put('transactions', { id: 'teste_rt1', data: '2026-06-10', descricao: 'x', valor: 1, categoria: 'casa', natureza: 'despesa' });
    await storage.put('statements', { id: 'teste_rt_st1', tipo: 'fatura', contaId: 'acc_x' });
    await storage.put('categories', { id: 'teste_rt_cat1', nome: 'Categoria Teste', cor: '#000' });

    await storage.resetTransacoes();

    assertDeepEqual(await storage.getAll('transactions'), []);
    assertDeepEqual(await storage.getAll('statements'), []);
    const categoriaPreservada = await storage.get('categories', 'teste_rt_cat1');
    assertEqual(categoriaPreservada.nome, 'Categoria Teste');

    await storage.remove('categories', 'teste_rt_cat1');
  });
});

// IDBObjectStore.put() lança SINCRONAMENTE (não via request.onerror) quando o
// valor não tem uma chave válida para o keyPath do store — put({}) num store
// com keyPath 'id' é o caso mais comum. Isso importa porque uma sabotagem
// (ou um bug futuro) que enfileire o put() e só aborte a transação no
// caminho assíncrono deixaria os itens ANTERIORES ao ruim gravados mesmo
// com a chamada tendo lançado — "ou tudo entra, ou nada entra" vira mentira
// bem no caminho de erro mais comum, não no raro (quota, etc.).
describe('storage: atomicidade de putMany/putManyAcrossStores', () => {
  it('putMany nao grava nada se um item lancar sincronamente (sem chave valida para o keyPath)', async () => {
    // try/finally em volta da limpeza: se a asserção falhar (é exatamente o
    // que a sabotagem faz de propósito), o registro do item BOM ainda assim
    // precisa ser removido — senão ele fica na origem real e faz a PRÓXIMA
    // execução deste teste falhar por um motivo totalmente diferente (o id
    // já existir de antes), mascarando o resultado real da sabotagem.
    try {
      let erro = null;
      try {
        await storage.putMany('categories', [
          { id: 'teste_atomico_1', nome: 'Boa', cor: '#111' },
          { nome: 'Sem id' }, // sem 'id': keyPath do store 'categories' é 'id'
        ]);
      } catch (e) {
        erro = e;
      }
      assert(erro !== null, 'deveria ter lançado');
      assertEqual(
        await storage.get('categories', 'teste_atomico_1'), undefined,
        'o item ANTES do item ruim na lista não pode ter sido gravado'
      );
    } finally {
      await storage.remove('categories', 'teste_atomico_1');
    }
  });

  it('putManyAcrossStores nao grava em NENHUM store se um item de outro store lancar sincronamente', async () => {
    try {
      const categoriasAntes = (await storage.getAll('categories')).length;
      let erro = null;
      try {
        await storage.putManyAcrossStores({
          categories: [{ id: 'teste_atomico_2', nome: 'Boa', cor: '#222' }],
          transactions: [{ data: '2026-06-10', valor: 1 }], // sem 'id': keyPath de 'transactions' é 'id'
        });
      } catch (e) {
        erro = e;
      }
      assert(erro !== null, 'deveria ter lançado');
      const categoriasDepois = (await storage.getAll('categories')).length;
      assertEqual(
        categoriasDepois, categoriasAntes,
        'a categoria de um store SEM problema nao pode ter sido gravada por causa de erro em outro store da mesma transação'
      );
    } finally {
      await storage.remove('categories', 'teste_atomico_2');
    }
  });
});
