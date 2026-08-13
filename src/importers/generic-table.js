// Adaptador genérico: colunas mapeadas manualmente pelo usuário na tela de
// Conciliação (Task 12), não adivinhadas. Serve para qualquer banco sem
// adaptador dedicado. `detectar` pontua sempre baixo — nunca deve vencer um
// adaptador que reconheça o formato de verdade.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { stableHash } from '../core/ids.js';
import { tipoDoMarcador, MAPEAMENTO_MODELO } from './modelos-planilha.js';

// Aceita texto "dd/mm/aaaa" E célula de data DE VERDADE do Excel (Date).
// Mesmo bug corrigido em lancamentos-xlsx.js (medido 2026-08-13): com
// `raw: false`, a célula chegava como a string de EXIBIÇÃO do arquivo
// ("7/5/26" — sem zero à esquerda, ano de 2 dígitos, ambígua entre dia e
// mês conforme o locale de quem salvou), o regex rejeitava, e a linha era
// pulada. Preencher a data corretamente no Excel não pode ser o caminho que
// falha. Componentes LOCAIS (não toISOString, que converte para UTC e pode
// recuar um dia em fuso negativo).
function dataParaISO(valor) {
  if (valor instanceof Date && !isNaN(valor)) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
  }
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor || ''));
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
  // "3/10" digitado numa célula de formato Geral vira DATA no Excel (3 de
  // outubro) — a célula chega como Date e o texto original se perdeu. Não dá
  // para adivinhar a parcela a partir disso sem arriscar inventar um
  // parcelamento errado, então é tratado como célula inválida: gera aviso e
  // a linha entra como compra à vista. As instruções do modelo pedem para
  // formatar a coluna Parcela como Texto justamente por isso.
  if (txt instanceof Date) return { atual: null, total: null, invalido: true };
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
  // `linhasDeCabecalho` (2 nos modelos: marcador + títulos) vence
  // `temCabecalho` (booleano do mapeamento manual, que só sabe pular 1).
  const pular = mapeamento.linhasDeCabecalho != null
    ? mapeamento.linhasDeCabecalho
    : (mapeamento.temCabecalho ? 1 : 0);
  const dados = (linhas || []).slice(pular);
  let ordinal = 0;

  for (const l of dados) {
    const dataISO = dataParaISO(l[mapeamento.colData]);
    const descricao = String(l[mapeamento.colDescricao] || '').trim();
    // Célula numérica (formatada como número/moeda no Excel) já é o valor
    // final — só texto passa por parseMoneyBR, que interpreta vírgula
    // decimal. Com `raw: true` na leitura, converter para string primeiro
    // faria "30.3" cair no parser de vírgula e virar nulo.
    const celulaValor = l[mapeamento.colValor];
    const valorBruto = typeof celulaValor === 'number'
      ? celulaValor
      : parseMoneyBR(String(celulaValor || '').trim());
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

// Uma planilha gerada por "Modelos de planilha" (Ferramentas) se identifica
// na primeira célula, e aí este adaptador é o dono do arquivo com certeza:
// pontuação máxima. Sem isso os três modelos perdiam para o adaptador de
// extrato Santander, que dá 0.3 para qualquer planilha com "Data" na coluna
// 0 e "Descri..." na coluna 1 — exatamente o cabeçalho dos modelos — e a
// importação morria em "não encontrei o cabeçalho de tabela do extrato"
// (bug real relatado 2026-08-13).
//
// Fora esse caso, segue valendo 0.05: rede de segurança que nunca deve
// vencer um adaptador que reconhece o formato de verdade.
async function detectar(arrayBuffer) {
  try {
    // Sem nome de arquivo aqui (o registry só passa o buffer): lerMatriz cai
    // no ramo de planilha binária, que é o dos modelos gerados pelo app. Um
    // .csv de modelo não é detectado por marcador, mas o app nunca gera .csv
    // — os modelos saem sempre em .xlsx.
    const matriz = await lerMatriz(arrayBuffer, '');
    if (tipoDoMarcador(matriz)) return 1;
  } catch {
    // Arquivo ilegível como planilha (ex.: um PDF com extensão trocada):
    // não é modelo, e a pontuação baixa deixa outro adaptador tentar.
  }
  return 0.05;
}

async function lerMatriz(arrayBuffer, nomeArquivo) {
  const isCsv = /\.csv$/i.test(nomeArquivo || '');
  // `cellDates: true` + `raw: true`: data de verdade chega como Date (ver
  // dataParaISO acima) e número como number, em vez da string de exibição
  // no locale de quem salvou o arquivo.
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(arrayBuffer), { type: 'string', cellDates: true })
    : XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const primeiraAba = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: true, defval: '' });
}

// Mapeamento a usar: o do modelo (quando o arquivo se identifica pelo
// marcador) ou o que o usuário preencheu à mão. O `vencimento` digitado na
// tela é preservado nos dois casos — ele nunca vem da planilha.
export function mapeamentoEfetivo(matriz, mapeamentoDaTela) {
  const tipo = tipoDoMarcador(matriz);
  if (!tipo || !MAPEAMENTO_MODELO[tipo]) return mapeamentoDaTela;
  return { ...MAPEAMENTO_MODELO[tipo], vencimento: (mapeamentoDaTela || {}).vencimento || null };
}

async function parse(arrayBuffer, opcoes) {
  const matriz = await lerMatriz(arrayBuffer, opcoes.arquivo);
  // Modelo baixado do app traz o próprio mapeamento: o usuário não precisa
  // (nem deveria) contar colunas para importar um arquivo que o app gerou.
  const mapeamento = mapeamentoEfetivo(matriz, opcoes.mapeamento);
  const { rows, avisos, checksum } = parseLinhasGenerico(matriz, mapeamento, opcoes.contaId, opcoes.arquivo);
  return {
    statement: {
      tipo: mapeamento.escopo, contaId: opcoes.contaId, adaptador: 'generic-table',
      arquivo: opcoes.arquivo, importadoEm: Date.now(), rows,
      ...periodoDoStatement(mapeamento, rows),
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
