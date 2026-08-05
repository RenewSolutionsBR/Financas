// Adaptador de fatura Santander (Visa e Mastercard). A extração de texto do
// PDF (extractLines) usa pdf.js e só roda no navegador; o parsing em si
// (parseFaturaTexto) é PURO — recebe linhas de texto já prontas — e é o que
// os testes exercitam, sem nunca abrir um PDF de verdade no Node. Os
// helpers de data/vencimento/período moram em santander-cartao-pdf-datas.js
// (arquivo irmão, mesmo teto de ~250 linhas dos Global Constraints).

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { stableHash } from '../core/ids.js';
import { extractLines } from './santander-cartao-pdf-extrair.js';
import {
  resolveDate, toISO, toISOExportado, extractCutoffDateDeLinhas, extrairPeriodoCompras, vencimentoFromText,
} from './santander-cartao-pdf-datas.js';

export { resolveDate, toISOExportado, extractCutoffDateDeLinhas, extrairPeriodoCompras, vencimentoFromText };

function moneyToNumber(str) {
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
}
const MONEY_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

// Cabeçalho de plástico: "[@]NOME - BBBB XXXX XXXX FFFF". Medido contra as
// 3 faturas reais (Step 6): as duas formas aparecem de fato, uma por cartão
// — titular sem "@", adicional com "@ " na frente. Grupo 1 = presença do
// '@' (adicional); grupo 2 = final do cartão (os 4 dígitos em claro).
const CARD_HEADER_RE = /^(@)?[^-]*-\s*\d{4}\s*XXXX\s*XXXX\s*(\d{4})\s*$/;
const ROW_RE = /^(?:\S+\s+)?(\d{2})\/(\d{2})\s+(.+)$/;
const PARCELA_TAG_RE = /(\d{2})\/(\d{2})\s*$/;

// Soma só o impresso das seções de DÉBITO (despesas/parcelamento) — a seção
// "Pagamento e Demais Créditos" (secaoTipo: 'pagamentos_creditos') é dinheiro
// SAINDO da dívida, não compõe o total da fatura. Seções sem "VALOR TOTAL"
// impresso (expected: null, achado da medição — ver parseFaturaTexto) também
// ficam de fora: não dá pra somar um total que a fatura não informou.
export function totalImpressoDeSections(sections) {
  const soma = (sections || [])
    .filter((s) => s.secaoTipo === 'despesas' && s.expected != null)
    .reduce((acc, s) => acc + s.expected, 0);
  return Math.round(soma * 100) / 100;
}

// Núcleo do parsing: state machine por linha, idêntica em espírito à do app
// anterior (mode: null|'credito'|'parcelamento'|'despesa'), com UMA mudança
// deliberada — linhas do modo 'credito' (seção "Pagamento e Demais
// Créditos") não são mais descartadas, viram linha normalizada com
// secao:'pagamentos_creditos' e sinal:'credito' (spec 6.4/7.1c: a
// atribuição de natureza real acontece em reconcile-card.js, não aqui).
// Agrupa 'parcelamento' e 'despesa' num único grupo ('despesa-like'), já
// que a fatura Santander pode imprimir um "VALOR TOTAL" combinado pros dois
// — ver comentário na leitura dos rótulos de seção, dentro do loop.
function grupoAtual(mode) {
  if (mode === 'credito') return 'credito';
  if (mode === 'despesa' || mode === 'parcelamento') return 'despesa-like';
  return null;
}

export function parseFaturaTexto(linhas, arquivo, vencimentoDate) {
  const avisos = [];
  const rows = [];
  const sections = [];
  let mode = null;
  let inDetalhamento = false;
  let cardEnding = null;
  let plastico = null;
  let sectionSum = 0;
  let sectionCount = 0;
  let lastDate = null;
  let ordinal = 0;

  // Fecha a seção corrente ao ver "VALOR TOTAL": vira entrada AVALIADA em
  // sections[] (expected/ok preenchidos de verdade).
  const flushSection = (expected) => {
    const secaoTipo = mode === 'credito' ? 'pagamentos_creditos' : 'despesas';
    const ok = Math.abs(sectionSum - expected) < 0.02;
    sections.push({ cardEnding, secaoTipo, expected, computed: Math.round(sectionSum * 100) / 100, ok, nLinhas: sectionCount });
    if (!ok) avisos.push(`Cartão final ${cardEnding}: soma calculada (R$ ${sectionSum.toFixed(2)}) não bate com o "VALOR TOTAL" da fatura (R$ ${expected.toFixed(2)}).`);
    sectionSum = 0;
    sectionCount = 0;
  };

  // Fecha a seção corrente ao mudar de cartão/seção SEM ter visto "VALOR
  // TOTAL" antes — medido contra faturas reais (Step 6): a seção "Pagamento
  // e Demais Créditos" às vezes tem só 1 lançamento e a fatura NÃO imprime
  // "VALOR TOTAL" pra ela, o bloco seguinte ("Despesas") começa direto. Sem
  // resetar sectionSum aqui, essa soma vazava pra dentro da seção seguinte e
  // o flush dela comparava soma de DUAS seções contra o total de UMA só,
  // acusando erro que não existe. A seção sem total vira entrada NÃO
  // AVALIADA em sections[] (expected/ok: null — nem sucesso nem falha), e só
  // gera aviso quando tem mais de 1 lançamento: o caso de 1 lançamento sem
  // total é o observado nas 3 faturas reais, e não é um erro de parsing.
  const abandonarSecaoAtual = () => {
    if (sectionCount === 0) return;
    const secaoTipo = mode === 'credito' ? 'pagamentos_creditos' : 'despesas';
    sections.push({ cardEnding, secaoTipo, expected: null, computed: Math.round(sectionSum * 100) / 100, ok: null, nLinhas: sectionCount });
    if (sectionCount > 1) {
      avisos.push(`Cartão final ${cardEnding}: seção ${secaoTipo} com ${sectionCount} lançamentos não tem "VALOR TOTAL" impresso na fatura — não foi possível validar essa parte automaticamente.`);
    }
    sectionSum = 0;
    sectionCount = 0;
  };

  for (const rawLine of linhas || []) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/Detalhamento da Fatura/i.test(line)) { inDetalhamento = true; continue; }
    if (!inDetalhamento) continue;
    if (/^Resumo da Fatura/i.test(line)) break;

    const cardMatch = CARD_HEADER_RE.exec(line);
    if (cardMatch) {
      abandonarSecaoAtual();
      cardEnding = cardMatch[2];
      plastico = cardMatch[1] ? 'adicional' : 'titular';
      mode = null;
      continue;
    }

    // Rótulos de seção só disparam abandonarSecaoAtual() quando o GRUPO
    // muda de verdade (credito <-> despesa-like). Medido contra fatura Visa
    // real: 'Parcelamentos' e 'Despesas' do mesmo cartão às vezes
    // compartilham UM "VALOR TOTAL" combinado no final — flush a cada rótulo
    // descartava a soma do Parcelamentos como "sem total impresso" e o
    // checksum comparava só Despesas contra o total dos dois, sempre
    // acusando soma calculada menor que a impressa. Além disso, quando um
    // cartão tem 'Despesas' cruzando quebra de página, a palavra 'Despesas'
    // reaparece como cabeçalho de continuação — tratar isso como nova seção
    // partia uma listagem contínua em duas. Solução: só reseta ao trocar de
    // GRUPO (credito vs. despesa-like = despesa ou parcelamento); dentro do
    // mesmo grupo (parcelamento<->despesa, ou repetição do mesmo rótulo) só
    // atualiza `mode` e continua acumulando em sectionSum/sectionCount.
    if (/^Pagamento e Demais/i.test(line)) {
      if (grupoAtual(mode) !== 'credito') abandonarSecaoAtual();
      mode = 'credito';
      continue;
    }
    if (/^Parcelamentos\s*$/i.test(line)) {
      if (grupoAtual(mode) !== 'despesa-like') abandonarSecaoAtual();
      mode = 'parcelamento';
      continue;
    }
    if (/^Despesas\s*$/i.test(line)) {
      if (grupoAtual(mode) !== 'despesa-like') abandonarSecaoAtual();
      mode = 'despesa';
      continue;
    }
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
      sectionCount++;
      rows.push(montarLinha({
        secao: mode === 'credito' ? 'pagamentos_creditos' : 'despesas',
        sinal: mode === 'credito' ? 'credito' : 'debito',
        tipo: mode === 'parcelamento' ? 'parcelamento' : 'compra',
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
    sectionCount++;
    rows.push(montarLinha({
      secao, sinal: mode === 'credito' ? 'credito' : 'debito',
      tipo: mode === 'parcelamento' ? 'parcelamento' : 'compra',
      data: toISO(dataResolvida), descricao, valor: Math.abs(valor), valorUSD,
      parcela_atual: parcelaAtual, parcela_total: parcelaTotal, cardEnding, plastico,
    }, arquivo, vencimentoDate, ordinal++));
  }
  abandonarSecaoAtual(); // seção final, se a fatura terminou sem "VALOR TOTAL" pra ela

  const secoesAvaliadas = sections.filter((s) => s.ok !== null);
  const checksum = { ok: secoesAvaliadas.length > 0 && secoesAvaliadas.every((s) => s.ok), sections };
  if (secoesAvaliadas.length === 0) avisos.push('Não encontrei nenhuma seção "VALOR TOTAL" pra conferir — não foi possível validar esta fatura automaticamente.');

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
      totalImpresso: totalImpressoDeSections(checksum.sections),
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
