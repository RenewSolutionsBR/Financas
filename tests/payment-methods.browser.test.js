// Testes de payment-methods.js que dependem de IndexedDB de verdade: saveForma
// agora grava também no log de auditoria (storage.put em 'auditLog'), então só
// roda no navegador (tools/tests.html). O runner do Node pula este arquivo.

import { describe, it, assertEqual } from './harness.js';
import { saveForma } from '../src/domain/payment-methods.js';
import * as storage from '../src/core/storage.js';

describe('payment-methods: log de auditoria', () => {
  it('saveForma registra evento de auditoria cadastro_atualizado', async () => {
    const { listarEventos, TIPOS_EVENTO } = await import('../src/domain/audit-log.js');
    const antes = (await listarEventos()).length;
    await saveForma({
      id: 'pm_teste_audit', nome: 'Teste Audit', tipo: 'dinheiro', ativo: true,
      padroesExtrato: [], ordem: 999, conciliaCom: 'nenhum',
    });
    const eventos = await listarEventos();
    assertEqual(eventos.length, antes + 1);
    assertEqual(eventos[0].tipo, TIPOS_EVENTO.CADASTRO_ATUALIZADO);
    await storage.remove('paymentMethods', 'pm_teste_audit');
  });
});
