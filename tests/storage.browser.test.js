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

  it('putMany com lista vazia não falha', async () => {
    await storage.putMany('categories', []);
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
