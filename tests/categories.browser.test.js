// Testes de categories.js que dependem de IndexedDB de verdade: saveCategoria
// agora grava também no log de auditoria (storage.put em 'auditLog'), então só
// roda no navegador (tools/tests.html). O runner do Node pula este arquivo.

import { describe, it, assertEqual } from './harness.js';
import { saveCategoria } from '../src/domain/categories.js';
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
