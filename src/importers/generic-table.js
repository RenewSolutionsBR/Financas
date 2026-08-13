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

// "3/10", "3 de 10", "03/10" -> { atual: 3, total: 10 }. Devolve nulos quando
// a célula está vazia ou não é parcelamento — uma compra à vista tem a coluna
// em branco, que NÃO é erro e não gera aviso.
//
// A coluna de parcela existe no modelo de planilha desde v21. Antes disso o
// adaptador genérico cravava parcela_atual/parcela_total em null, e uma
// compra parcelada importada de planilha nunca gerava as previsões dos meses
// seguintes (syncPredictions depende desses dois campos) — o dado ia embora
// em silêncio, sem nem um aviso na tela.
export function parseParcela(txt) {
  const limpo = String(txt == null ? '' : txt).trim();
  if (!limpo) return { atual: null, total: null };
  const m = /^(\d{1,2})\s*(?:\/|\s+de\s+)\s*(\d{1,2})$/i.exec(limpo);
  if (!m) return { atual: null, total: null, invalido: true };
  const atual = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  // "0/5" ou "7/5" não descrevem parcelamento nenhum: tratados como célula
  // inválida (com aviso), não como parcelamento silenciosamente torto.
  if (!atual || !total || atual > total) return { atual: null, total: null, invalido: true };
  return { atual, total };
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

    const parcela = mapeamento.colParcela != null
      ? parseParcela(l[mapeamento.colParcela])
      : { atual: null, total: null };
    if (parcela.invalido) {
      avisos.push(`Parcela ilegível em "${descricao}" (${String(l[mapeamento.colParcela]).trim()}) — lançada como compra à vista. Use o formato 3/10.`);
    }

    rows.push({
      id: stableHash([contaId, dataISO, valor, descricao, documento, ordinal++]),
      data: dataISO, valor, sinal, descricao,
      descricaoCanonica: canonicalizar(descricao, mapeamento.escopo),
      documento, tipoDetectado: null, saldo: null, contaId, raw: l.join ? l.join(' | ') : String(l),
      parcela_atual: parcela.atual, parcela_total: parcela.total,
      // commitImportacao só roda autoConfirmParcelas/syncPredictions nas
      // linhas com tipo === 'parcelamento' — sem este campo, a coluna de
      // parcela seria lida e ainda assim ignorada no commit.
      tipo: parcela.total ? 'parcelamento' : null,
      cartaoFinal: null, secao: null, valorUSD: null,
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
    statement: {
      tipo: opcoes.mapeamento.escopo, contaId: opcoes.contaId, adaptador: 'generic-table',
      arquivo: opcoes.arquivo, importadoEm: Date.now(), rows,
      ...periodoDoStatement(opcoes.mapeamento, rows),
    },
    rows, avisos, checksum,
  };
}

// O id de um documento importado é `contaId|tipo|vencimento||periodoFim`
// (idDeterministicoDoDocumento, em ui/conciliacao-import.js). O adaptador
// genérico não preenchia NENHUM dos dois, então toda planilha da mesma conta
// gerava o id `contaId|fatura|undefined`: importar a fatura de junho
// SUBSTITUÍA a de maio em silêncio, sem nem o aviso de "já importado" (que
// compara justamente por esse id). Medido em 2026-08-13, antes do fix.
//
// Fatura: o vencimento vem de um campo da tela de importação — a planilha só
// traz os lançamentos, e uma fatura pode conter compras de vários meses, o
// que torna qualquer dedução a partir das datas das linhas um chute.
// Extrato: não tem vencimento, então o período é o intervalo real coberto
// pelas linhas, que é o que distingue um extrato de outro.
export function periodoDoStatement(mapeamento, rows) {
  if (mapeamento.escopo === 'fatura') {
    return mapeamento.vencimento ? { vencimento: mapeamento.vencimento } : {};
  }
  const datas = (rows || []).map((r) => r.data).filter(Boolean).sort();
  if (!datas.length) return {};
  return { periodoInicio: datas[0], periodoFim: datas[datas.length - 1] };
}

register({ id: 'generic-table', label: 'Planilha genérica (mapeamento manual)', aceita: ['.csv', '.xls', '.xlsx'], detectar, parse });
