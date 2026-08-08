// Testes de categories.js que dependem de IndexedDB de verdade: saveCategoria
// agora grava também no log de auditoria (storage.put em 'auditLog'), então só
// roda no navegador (tools/tests.html). O runner do Node pula este arquivo.

import { describe, it, assert, assertEqual } from './harness.js';
import { saveCategoria, removeCategoria } from '../src/domain/categories.js';
import { secaoCategorias } from '../src/ui/cadastros-categorias.js';
import * as storage from '../src/core/storage.js';

describe('categories: log de auditoria', () => {
  it('saveCategoria registra evento de auditoria cadastro_atualizado', async () => {
    const { listarEventos, TIPOS_EVENTO } = await import('../src/domain/audit-log.js');
    const antes = (await listarEventos()).length;
    await saveCategoria({ id: 'cat_teste_audit', nome: 'Teste Audit', cor: '#8a6d3b' });
    const eventos = await listarEventos();
    assertEqual(eventos.length, antes + 1);
    assertEqual(eventos[0].tipo, TIPOS_EVENTO.CADASTRO_ATUALIZADO);
    await storage.remove('categories', 'cat_teste_audit');
  });
});

// secaoCategorias (src/ui/cadastros-categorias.js) so poe o atributo `title`
// no nome da categoria quando `descricao` nao esta vazia — logica de DOM que
// nao roda em Node puro, por isso mora aqui (nao em categories.test.js).
describe('categories: tooltip de descricao no item da lista (DOM real)', () => {
  it('categoria COM descricao ganha atributo title; categoria SEM descricao nao ganha', async () => {
    const COM_DESC_ID = 'cat_teste_tooltip_com';
    const SEM_DESC_ID = 'cat_teste_tooltip_sem';
    await saveCategoria({ id: COM_DESC_ID, nome: 'Teste Tooltip Com', cor: '#8a6d3b', descricao: 'Categoria de teste' });
    await saveCategoria({ id: SEM_DESC_ID, nome: 'Teste Tooltip Sem', cor: '#31708f' });
    try {
      const secao = await secaoCategorias(async () => {});
      const nomes = [...secao.querySelectorAll('.item-nome')];
      const itemCom = nomes.find((n) => n.textContent === 'Teste Tooltip Com');
      const itemSem = nomes.find((n) => n.textContent === 'Teste Tooltip Sem');
      assert(itemCom, 'item da categoria com descricao nao encontrado na lista');
      assert(itemSem, 'item da categoria sem descricao nao encontrado na lista');
      assertEqual(itemCom.getAttribute('title'), 'Categoria de teste', 'categoria com descricao precisa expor o title');
      assert(!itemSem.hasAttribute('title'), 'categoria sem descricao nao deveria ganhar atributo title');
    } finally {
      await removeCategoria(COM_DESC_ID, []);
      await removeCategoria(SEM_DESC_ID, []);
    }
  });
});
