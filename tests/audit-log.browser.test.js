import { describe, it, assert, assertEqual } from './harness.js';
import { registrarEvento, listarEventos, TIPOS_EVENTO } from '../src/domain/audit-log.js';
import * as storage from '../src/core/storage.js';

describe('audit-log: registrarEvento + listarEventos', () => {
  it('grava um evento com id, timestamp, tipo e resumo', async () => {
    await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, 'Lançamento criado');
    const eventos = await listarEventos();
    const encontrado = eventos.find((e) => e.resumo === 'Lançamento criado');
    assert(encontrado, 'o evento precisa aparecer em listarEventos');
    assert(encontrado.id, 'precisa ter id');
    assert(typeof encontrado.timestamp === 'number', 'timestamp precisa ser number (Date.now())');
    assertEqual(encontrado.tipo, TIPOS_EVENTO.LANCAMENTO_CRIADO);
    await storage.remove('auditLog', encontrado.id);
  });

  it('listarEventos devolve mais recente PRIMEIRO', async () => {
    const e1 = { id: 'audit_teste_1', timestamp: 1000, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: 'Antigo' };
    const e2 = { id: 'audit_teste_2', timestamp: 2000, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: 'Recente' };
    await storage.put('auditLog', e1);
    await storage.put('auditLog', e2);
    const eventos = await listarEventos();
    const idxAntigo = eventos.findIndex((e) => e.id === 'audit_teste_1');
    const idxRecente = eventos.findIndex((e) => e.id === 'audit_teste_2');
    assert(idxRecente < idxAntigo, 'evento mais recente (timestamp maior) precisa vir ANTES do mais antigo na lista');
    await storage.remove('auditLog', 'audit_teste_1');
    await storage.remove('auditLog', 'audit_teste_2');
  });
});

describe('audit-log: limite de 500 eventos', () => {
  it('ao ultrapassar 500, remove os MAIS ANTIGOS primeiro (mantem os mais recentes)', async () => {
    // Popula 502 eventos com timestamps crescentes e ids previsiveis, pra
    // poder limpar so os que este teste criou no final.
    const ids = [];
    for (let i = 0; i < 502; i++) {
      const id = `audit_limite_teste_${i}`;
      ids.push(id);
      await storage.put('auditLog', { id, timestamp: i, tipo: TIPOS_EVENTO.LANCAMENTO_CRIADO, resumo: `Evento ${i}` });
    }
    // registrarEvento aplica o limite como efeito colateral da proxima gravacao.
    await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, 'Gatilho do limite');
    const eventos = await listarEventos();
    assert(eventos.length <= 500, `esperava no maximo 500 eventos, achei ${eventos.length}`);
    const aindaExisteOMaisAntigo = eventos.some((e) => e.id === 'audit_limite_teste_0');
    assert(!aindaExisteOMaisAntigo, 'o evento MAIS ANTIGO (timestamp 0) precisa ter sido removido pelo limite');

    // Limpeza: remove tudo que sobrou deste teste.
    const restantes = await listarEventos();
    for (const e of restantes) {
      if (e.id.startsWith('audit_limite_teste_') || e.resumo === 'Gatilho do limite') {
        await storage.remove('auditLog', e.id);
      }
    }
  });
});
