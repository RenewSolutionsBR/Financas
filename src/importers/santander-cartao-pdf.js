// Adaptador de fatura Santander (Visa e Mastercard). A extração de texto do
// PDF (extractLines) usa pdf.js e só roda no navegador; o parsing em si
// (parseFaturaTexto) é PURO — recebe linhas de texto já prontas — e é o que
// os testes exercitam, sem nunca abrir um PDF de verdade no Node.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { stableHash } from '../core/ids.js';
import { extractLines } from './santander-cartao-pdf-extrair.js';

function moneyToNumber(str) {
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
}
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

// Resolve o ano de uma data DD/MM dada como referência o vencimento: escolhe
// o ano mais recente que não fique DEPOIS do vencimento (+5 dias de folga) —
// cobre tanto despesas do ciclo corrente quanto a data de compra original de
// parcelamentos antigos (até ~3 anos atrás).
export function resolveDate(dd, mm, vencimento) {
  const slack = new Date(vencimento);
  slack.setDate(slack.getDate() + 5);
  for (let back = 0; back <= 3; back++) {
    const year = vencimento.getFullYear() - back;
    const candidate = new Date(year, mm - 1, dd);
    if (!isNaN(candidate) && candidate <= slack) return candidate;
  }
  return new Date(vencimento.getFullYear(), mm - 1, dd);
}

function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Cabeçalho de plástico: "[@]NOME - BBBB XXXX XXXX FFFF". Medido contra as
// 3 faturas reais (Step 6): as duas formas aparecem de fato, uma por cartão
// — titular sem "@", adicional com "@ " na frente. Grupo 1 = presença do
// '@' (adicional); grupo 2 = final do cartão (os 4 dígitos em claro).
const CARD_HEADER_RE = /^(@)?[^-]*-\s*\d{4}\s*XXXX\s*XXXX\s*(\d{4})\s*$/;
const ROW_RE = /^(?:\S+\s+)?(\d{2})\/(\d{2})\s+(.+)$/;
const PARCELA_TAG_RE = /(\d{2})\/(\d{2})\s*$/;
const CUTOFF_RE = /realizados?\D*?at[éeè]\s+(\d{2})\/(\d{2})|^at[éeè]\s+(\d{2})\/(\d{2})/i;
const FAIXA_PERIODO_RE = /(\d{2})\/(\d{2})\/(\d{2})\s*a\s*(\d{2})\/(\d{2})\/(\d{2})/g;

export function extractCutoffDateDeLinhas(linhas, vencimentoDate) {
  for (const linha of (linhas || []).slice(0, 20)) {
    const m = CUTOFF_RE.exec(linha.trim());
    if (m) {
      const dd = parseInt(m[1] || m[3], 10);
      const mm = parseInt(m[2] || m[4], 10);
      return resolveDate(dd, mm, vencimentoDate);
    }
  }
  return null;
}

// Varre as primeiras linhas (mesma região onde CUTOFF_RE já procura) por
// faixas "DD/MM/AA a DD/MM/AA" — a fatura sempre lista 4 faixas (medido nas
// 3 reais: exatamente 4 em cada uma) — e escolhe a que TERMINA na dataCorte
// já extraída, que é o ciclo desta fatura especificamente.
export function extrairPeriodoCompras(linhas, dataCorteISO) {
  if (!dataCorteISO) return null;
  const texto = (linhas || []).slice(0, 30).join(' ');
  const faixas = [];
  let m;
  while ((m = FAIXA_PERIODO_RE.exec(texto))) {
    faixas.push({ inicio: `20${m[3]}-${m[2]}-${m[1]}`, fim: `20${m[6]}-${m[5]}-${m[4]}` });
  }
  return faixas.find((f) => f.fim === dataCorteISO) || null;
}

// Núcleo do parsing: state machine por linha, idêntica em espírito à do app
// anterior (mode: null|'credito'|'parcelamento'|'despesa'), com UMA mudança
// deliberada — linhas do modo 'credito' (seção "Pagamento e Demais
// Créditos") não são mais descartadas, viram linha normalizada com
// secao:'pagamentos_creditos' e sinal:'credito' (spec 6.4/7.1c: a
// atribuição de natureza real acontece em reconcile-card.js, não aqui).
export function parseFaturaTexto(linhas, arquivo, vencimentoDate) {
  const avisos = [];
  const rows = [];
  const sections = [];
  let mode = null;
  let inDetalhamento = false;
  let cardEnding = null;
  let plastico = null;
  let sectionSum = 0;
  let lastDate = null;
  let ordinal = 0;

  const flushSection = (expected) => {
    const ok = Math.abs(sectionSum - expected) < 0.02;
    sections.push({ cardEnding, expected, computed: Math.round(sectionSum * 100) / 100, ok });
    if (!ok) avisos.push(`Cartão final ${cardEnding}: soma calculada (R$ ${sectionSum.toFixed(2)}) não bate com o "VALOR TOTAL" da fatura (R$ ${expected.toFixed(2)}).`);
    sectionSum = 0;
  };

  for (const rawLine of linhas || []) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/Detalhamento da Fatura/i.test(line)) { inDetalhamento = true; continue; }
    if (!inDetalhamento) continue;
    if (/^Resumo da Fatura/i.test(line)) break;

    // Reseta sectionSum em TODA transição de cartão/seção, não só em "VALOR
    // TOTAL": medido contra faturas reais (Step 6), a seção "Pagamento e
    // Demais Créditos" às vezes tem só 1 lançamento e a fatura NÃO imprime
    // "VALOR TOTAL" pra ela — o bloco seguinte ("Despesas") começa direto.
    // Sem o reset aqui, a soma da seção sem total impresso vazava pra dentro
    // da soma da seção seguinte, e o flush dessa seguinte comparava soma de
    // DUAS seções contra o total impresso de UMA só, acusando erro que não
    // existe. Seção sem "VALOR TOTAL" próprio simplesmente não entra no
    // checksum (não tem contra o que validar) — as linhas continuam em rows[].
    const cardMatch = CARD_HEADER_RE.exec(line);
    if (cardMatch) {
      cardEnding = cardMatch[2];
      plastico = cardMatch[1] ? 'adicional' : 'titular';
      mode = null; sectionSum = 0; continue;
    }

    if (/^Pagamento e Demais/i.test(line)) { mode = 'credito'; sectionSum = 0; continue; }
    if (/^Parcelamentos\s*$/i.test(line)) { mode = 'parcelamento'; sectionSum = 0; continue; }
    if (/^Despesas\s*$/i.test(line)) { mode = 'despesa'; sectionSum = 0; continue; }
    if (/^Compra\s+Data\s+Descri/i.test(line)) continue;

    const totalMatch = /^VALOR TOTAL\s+(-?[\d.,]+)/i.exec(line);
    if (totalMatch) { flushSection(moneyToNumber(totalMatch[1])); mode = null; continue; }

    if (mode === null) continue;
    if (/^COTA[ÇC][ÃA]O/i.test(line)) continue;

    const iofMatch = /^IOF DESPESA NO EXTERIOR\s+([\d.,]+)/i.exec(line);
    if (iofMatch) {
      if (!lastDate) { avisos.push(`Linha de IOF sem lançamento anterior para herdar a data: "${line}"`); continue; }
      const valor = moneyToNumber(iofMatch[1]);
      sectionSum += valor;
      rows.push(montarLinha({
        secao: mode === 'credito' ? 'pagamentos_creditos' : 'despesas',
        sinal: mode === 'credito' ? 'credito' : 'debito',
        data: toISO(lastDate), descricao: 'IOF DESPESA NO EXTERIOR', valor,
        parcela_atual: null, parcela_total: null, cardEnding, plastico,
      }, arquivo, vencimentoDate, ordinal++));
      continue;
    }

    const rowMatch = ROW_RE.exec(line);
    if (!rowMatch) continue;
    const [, ddStr, mmStr, rest] = rowMatch;
    const dd = parseInt(ddStr, 10);
    const mm = parseInt(mmStr, 10);
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue;

    const moneyTokens = rest.match(MONEY_RE);
    if (!moneyTokens || moneyTokens.length === 0) continue;

    const firstMoneyIdx = rest.indexOf(moneyTokens[0]);
    let descAndMaybeParcela = rest.slice(0, firstMoneyIdx).trim();

    let parcelaAtual = null, parcelaTotal = null;
    const parcelaMatch = PARCELA_TAG_RE.exec(descAndMaybeParcela);
    if (parcelaMatch) {
      parcelaAtual = parseInt(parcelaMatch[1], 10);
      parcelaTotal = parseInt(parcelaMatch[2], 10);
      descAndMaybeParcela = descAndMaybeParcela.slice(0, parcelaMatch.index).trim();
    }
    const descricao = descAndMaybeParcela.replace(/\s+/g, ' ').trim();
    if (!descricao) continue;

    let valor, valorUSD = null;
    if (moneyTokens.length >= 3) { valor = moneyToNumber(moneyTokens[moneyTokens.length - 2]); valorUSD = moneyToNumber(moneyTokens[moneyTokens.length - 1]); }
    else if (moneyTokens.length === 2) { valor = moneyToNumber(moneyTokens[0]); valorUSD = moneyToNumber(moneyTokens[1]); }
    else valor = moneyToNumber(moneyTokens[0]);

    const dataResolvida = resolveDate(dd, mm, vencimentoDate);
    lastDate = dataResolvida;

    const secao = mode === 'credito' ? 'pagamentos_creditos' : 'despesas';
    sectionSum += Math.abs(valor);
    rows.push(montarLinha({
      secao, sinal: mode === 'credito' ? 'credito' : 'debito',
      data: toISO(dataResolvida), descricao, valor: Math.abs(valor), valorUSD,
      parcela_atual: parcelaAtual, parcela_total: parcelaTotal, cardEnding, plastico,
    }, arquivo, vencimentoDate, ordinal++));
  }

  const checksum = { ok: sections.length > 0 && sections.every((s) => s.ok), sections };
  if (sections.length === 0) avisos.push('Não encontrei nenhuma seção "VALOR TOTAL" pra conferir — não foi possível validar esta fatura automaticamente.');

  return { rows, checksum, avisos };
}

// `cardEnding` chega aqui com o nome curto usado internamente pela state
// machine acima; na linha normalizada devolvida pro resto do app usamos o
// nome do contrato documentado em registry.js (`cartaoFinal`).
function montarLinha(campos, arquivo, vencimentoDate, ordinal) {
  const { cardEnding, ...resto } = campos;
  const descricaoCanonica = canonicalizar(campos.descricao, 'fatura');
  const id = stableHash([cardEnding, campos.data, campos.valor, campos.descricao, arquivo, ordinal]);
  return {
    id, documento: null, tipoDetectado: null, saldo: null, raw: campos.descricao,
    ...resto, cartaoFinal: cardEnding, descricaoCanonica,
  };
}

// O app anterior extraía o vencimento preferencialmente do NOME do arquivo
// ("Visa-DD-MM-AAAA.pdf"), convenção pessoal de um usuário só com um cartão.
// O app novo é multi-cartão e não pode depender de arquivo renomeado — só o
// texto do PDF (rótulo "Vencimento" impresso), que já funcionava como
// fallback no app anterior. Medido contra as 3 faturas reais (Step 6): o
// rótulo aparece na página 1 (capa), no formato "Vencimento: DD/MM/AAAA" —
// por isso `extractLines` (Step 8) expõe a página 1 sem gate.
export function vencimentoFromText(linhas) {
  for (let i = 0; i < linhas.length; i++) {
    if (/^Vencimento$/i.test(linhas[i].trim())) {
      for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
        const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(linhas[j]);
        if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
    }
    const inline = /Vencimento\D+(\d{2})\/(\d{2})\/(\d{4})/i.exec(linhas[i]);
    if (inline) return new Date(parseInt(inline[3], 10), parseInt(inline[2], 10) - 1, parseInt(inline[1], 10));
  }
  return null;
}

export function toISOExportado(d) {
  return toISO(d);
}

async function getPdfjs() {
  const lib = await import('../../vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}

async function parse(arrayBuffer, opcoes) {
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const linhas = await extractLines(doc);

  const vencimentoDate = vencimentoFromText(linhas);
  if (!vencimentoDate) {
    throw new Error('Não consegui identificar a data de vencimento desta fatura (procurei o rótulo "Vencimento" no texto do PDF).');
  }
  const vencimentoISO = toISOExportado(vencimentoDate);

  const dataCorteDate = extractCutoffDateDeLinhas(linhas, vencimentoDate);
  const dataCorteISO = dataCorteDate ? toISOExportado(dataCorteDate) : null;
  const periodoCompras = extrairPeriodoCompras(linhas, dataCorteISO);

  const { rows, checksum, avisos } = parseFaturaTexto(linhas, opcoes.arquivo, vencimentoDate);
  if (!dataCorteISO) avisos.push('Não encontrei a data de corte no PDF — a janela de conciliação vai usar uma estimativa.');

  return {
    statement: {
      tipo: 'fatura', contaId: opcoes.contaId, adaptador: 'santander-cartao-pdf',
      arquivo: opcoes.arquivo, importadoEm: Date.now(),
      vencimento: vencimentoISO,
      dataCorte: dataCorteISO,
      periodoCompras,
      totalImpresso: checksum.sections.reduce((soma, s) => soma + s.expected, 0),
      rows,
    },
    rows, avisos, checksum,
  };
}

function detectar() {
  // O registry já filtra por extensão (.pdf); todo arquivo que chega aqui
  // já passou por esse filtro, então pontua 1 sem checagem adicional —
  // não há hoje um segundo adaptador de PDF para desempatar contra.
  return 1;
}

register({ id: 'santander-cartao-pdf', label: 'Fatura Santander (PDF)', aceita: ['.pdf'], detectar, parse });
