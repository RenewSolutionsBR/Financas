// Adaptador genérico: colunas mapeadas manualmente pelo usuário na tela de
// Conciliação (Task 12), não adivinhadas. Serve para qualquer banco sem
// adaptador dedicado. `detectar` pontua sempre baixo — nunca deve vencer um
// adaptador que reconheça o formato de verdade.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { stableHash } from '../core/ids.js';

function dataParaISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(txt || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseLinhasGenerico(linhas, mapeamento, contaId, arquivo) {
  const avisos = [];
  const rows = [];
  const dados = mapeamento.temCabecalho ? (linhas || []).slice(1) : (linhas || []);
  let ordinal = 0;

  for (const l of dados) {
    const dataISO = dataParaISO(l[mapeamento.colData]);
    const descricao = String(l[mapeamento.colDescricao] || '').trim();
    const valorBruto = parseMoneyBR(String(l[mapeamento.colValor] || '').trim());
    if (!dataISO || !descricao || valorBruto === null) {
      avisos.push(`Linha ignorada por dado ilegível: ${JSON.stringify(l)}`);
      continue;
    }
    const documento = mapeamento.colDocumento != null ? String(l[mapeamento.colDocumento] || '').trim() || null : null;
    const valor = Math.abs(valorBruto);
    const sinal = valorBruto < 0 ? 'debito' : 'credito';
    rows.push({
      id: stableHash([contaId, dataISO, valor, descricao, documento, ordinal++]),
      data: dataISO, valor, sinal, descricao,
      descricaoCanonica: canonicalizar(descricao, mapeamento.escopo),
      documento, tipoDetectado: null, saldo: null, contaId, raw: l.join ? l.join(' | ') : String(l),
      parcela_atual: null, parcela_total: null, cartaoFinal: null, secao: null, valorUSD: null,
    });
  }

  return { rows, avisos, checksum: { ok: true, sections: [], nota: 'Formato genérico não tem total impresso para validar automaticamente.' } };
}

function detectar() {
  return 0.05; // rede de segurança: nunca vence um adaptador que reconhece o formato de verdade
}

async function lerMatriz(arrayBuffer, nomeArquivo) {
  const isCsv = /\.csv$/i.test(nomeArquivo || '');
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(arrayBuffer), { type: 'string' })
    : XLSX.read(arrayBuffer, { type: 'array' });
  const primeiraAba = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: false, defval: '' });
}

async function parse(arrayBuffer, opcoes) {
  const matriz = await lerMatriz(arrayBuffer, opcoes.arquivo);
  const { rows, avisos, checksum } = parseLinhasGenerico(matriz, opcoes.mapeamento, opcoes.contaId, opcoes.arquivo);
  return {
    statement: { tipo: opcoes.mapeamento.escopo, contaId: opcoes.contaId, adaptador: 'generic-table', arquivo: opcoes.arquivo, importadoEm: Date.now(), rows },
    rows, avisos, checksum,
  };
}

register({ id: 'generic-table', label: 'Planilha genérica (mapeamento manual)', aceita: ['.csv', '.xls', '.xlsx'], detectar, parse });
