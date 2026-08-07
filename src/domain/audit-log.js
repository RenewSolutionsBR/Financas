// Log tecnico de eventos de escrita na base, pra facilitar debug de
// problemas como "por que este lancamento nao aparece na conciliacao" —
// NUNCA guarda descricao, valor especifico, nome de conta/cartao ou
// qualquer dado que identifique uma compra ou pessoa: so contagens e
// tipos, porque o repositorio e publico e este log pode ser exportado e
// compartilhado em debug.

import { uid } from '../core/ids.js';
import * as storage from '../core/storage.js';

export const TIPOS_EVENTO = {
  IMPORTACAO_FATURA: 'importacao_fatura',
  IMPORTACAO_EXTRATO: 'importacao_extrato',
  LANCAMENTO_CRIADO: 'lancamento_criado',
  LANCAMENTO_EDITADO: 'lancamento_editado',
  LANCAMENTO_EXCLUIDO: 'lancamento_excluido',
  LANCAR_DA_CONCILIACAO: 'lancar_da_conciliacao',
  CADASTRO_ATUALIZADO: 'cadastro_atualizado',
  APAGAR_TRANSACOES: 'apagar_transacoes',
  APAGAR_TUDO: 'apagar_tudo',
  BACKUP_IMPORTADO: 'backup_importado',
};

const LIMITE_EVENTOS = 500;

export async function registrarEvento(tipo, resumo) {
  await storage.put('auditLog', { id: uid('audit'), timestamp: Date.now(), tipo, resumo });
  await aplicarLimite();
}

export async function listarEventos() {
  const eventos = await storage.getAll('auditLog');
  return eventos.sort((a, b) => b.timestamp - a.timestamp);
}

// Remove os mais ANTIGOS além do limite — o log e uma ferramenta de debug
// recente, nao um historico completo desde o inicio dos tempos.
async function aplicarLimite() {
  const eventos = await listarEventos();
  if (eventos.length <= LIMITE_EVENTOS) return;
  const excedentes = eventos.slice(LIMITE_EVENTOS);
  for (const e of excedentes) await storage.remove('auditLog', e.id);
}
