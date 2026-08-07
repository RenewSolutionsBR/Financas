// Testes de accounts.js que dependem de IndexedDB de verdade: removeAccount
// chama listAccounts() antes de checar a guarda de em-uso, então só roda no
// navegador (tools/tests.html). O runner do Node pula este arquivo.

import { describe, it, assert, assertEqual } from './harness.js';
import { TIPO_CONTA, saveAccount, removeAccount } from '../src/domain/accounts.js';
import * as storage from '../src/core/storage.js';

describe('accounts: log de auditoria', () => {
  it('saveAccount registra evento de auditoria cadastro_atualizado', async () => {
    const { listarEventos, TIPOS_EVENTO } = await import('../src/domain/audit-log.js');
    const antes = (await listarEventos()).length;
    await saveAccount({ id: 'acc_teste_audit', tipo: TIPO_CONTA, nome: 'Teste Audit', ativo: true, agencia: '1', numero: '2' });
    const eventos = await listarEventos();
    assertEqual(eventos.length, antes + 1);
    assertEqual(eventos[0].tipo, TIPOS_EVENTO.CADASTRO_ATUALIZADO);
    await storage.remove('accounts', 'acc_teste_audit');
  });
});

describe('accounts: exclusão (guarda de integridade no domínio)', () => {
  it('recusa excluir conta em uso, dizendo quantos lancamentos usam', async () => {
    const conta = { id: 'acc_teste_uso', tipo: TIPO_CONTA, nome: 'Teste', agencia: '1', numero: '2' };
    await saveAccount(conta);
    const transacoes = [{ id: 't1', contaId: conta.id }, { id: 't2', contaId: conta.id }];
    let erro = null;
    try {
      await removeAccount(conta.id, transacoes);
    } catch (e) {
      erro = e;
    }
    assert(erro !== null, 'deveria ter recusado a exclusao');
    assert(erro.message.includes('2'), erro.message);
    await storage.remove('accounts', conta.id);
  });

  it('exclui normalmente quando nao ha lancamento nem cartao adicional usando a conta', async () => {
    const conta = { id: 'acc_teste_livre', tipo: TIPO_CONTA, nome: 'Teste', agencia: '1', numero: '2' };
    await saveAccount(conta);
    await removeAccount(conta.id, []);
    const lida = await storage.get('accounts', conta.id);
    assert(lida === undefined, 'deveria ter excluido');
  });
});
