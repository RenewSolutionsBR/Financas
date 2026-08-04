// Adaptador de extrato de conta corrente Santander (.xls, BIFF8). A leitura
// da planilha em si (parse, que chama XLSX.read) é browser-only; o parsing
// da matriz de células já lida (parseLinhasExtrato) é PURO e testável em Node.

import { register } from './registry.js';
import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { stableHash } from '../core/ids.js';

function celula(linha, i) { return String((linha && linha[i]) || '').trim(); }

// Texto de todas as células não-vazias da linha, concatenado — o cabeçalho
// do extrato real do Santander espalha "Conta:" e "Extrato de X a Y" em
// colunas que variam (observado na coluna 4, não na 0 como a princípio se
// supunha), então essas duas informações são buscadas na linha inteira, não
// numa coluna fixa. Os regexes que as leem não são ancorados no início, então
// não importa em qual célula da linha o texto realmente cai.
function textoLinha(linha) {
  return (linha || []).map((c) => String(c || '').trim()).filter(Boolean).join(' ');
}

function dataBRparaISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function parseLinhasExtrato(linhas, contaId, arquivo) {
  const avisos = [];
  let agencia = null, numero = null, periodoInicio = null, periodoFim = null;
  let headerIdx = -1;

  for (let i = 0; i < linhas.length; i++) {
    const linhaTexto = textoLinha(linhas[i]);
    // Formato observado: "NNNN-NN.NNNNNN.N" (agência-conta com pontos), além
    // do "NNNN-NNNNNN-N" da fixture original — por isso o segmento depois do
    // hífen aceita dígito, ponto E hífen, não só dígito e hífen.
    const contaMatch = /Conta:\s*(\d+)-([\d.-]+)/.exec(linhaTexto);
    if (contaMatch) { agencia = contaMatch[1]; numero = contaMatch[2]; }
    const periodoMatch = /Extrato de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/.exec(linhaTexto);
    if (periodoMatch) { periodoInicio = dataBRparaISO(periodoMatch[1]); periodoFim = dataBRparaISO(periodoMatch[2]); }
    if (/^Data$/i.test(celula(linhas[i], 0)) && /Descri/i.test(celula(linhas[i], 1)) && /Saldo/i.test(celula(linhas[i], 6))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    // Mesmo shape do retorno de sucesso (statement com agencia/numero,
    // checksum sempre presente) — um chamador que leia resultado.checksum.ok
    // não pode quebrar com "undefined.ok" só porque o arquivo veio fora do
    // formato esperado.
    return {
      statement: { agencia: null, numero: null, periodoInicio, periodoFim, saldoInicial: null, saldoFinal: null },
      rows: [],
      avisos: ['Não encontrei o cabeçalho de tabela do extrato — arquivo fora do formato esperado.'],
      checksum: { ok: false, saldoInicial: null, saldoFinal: null, somaCreditos: 0, somaDebitos: 0 },
    };
  }

  let saldoInicial = null;
  let saldoFinal = null;
  let somaCreditos = 0;
  let somaDebitos = 0;
  const rows = [];
  let ordinal = 0;

  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    const descricaoCol = celula(l, 1);
    const rotuloCol0 = celula(l, 0);
    const dataISO = dataBRparaISO(rotuloCol0);
    const saldoCol = parseMoneyBR(celula(l, 6));

    // "SALDO ANTERIOR" e "TOTAL" apareceram na coluna Descrição na fixture
    // original, mas no extrato real "TOTAL" veio na coluna Data — por isso as
    // duas colunas são checadas para os dois rótulos.
    if (/^SALDO ANTERIOR$/i.test(descricaoCol) || /^SALDO ANTERIOR$/i.test(rotuloCol0)) { saldoInicial = saldoCol; continue; }
    if (/^TOTAL$/i.test(descricaoCol) || /^TOTAL$/i.test(rotuloCol0)) {
      // No extrato real a linha TOTAL não repete o saldo corrente na coluna
      // Saldo (fica vazia) — só traz o crédito e o débito somados do
      // período. Quando isso acontece, o saldo final é derivado do saldo
      // inicial mais esses dois totais (débito já vem negativo, igual às
      // linhas de lançamento), em vez de ficar sem valor.
      if (saldoCol !== null) {
        saldoFinal = saldoCol;
      } else if (saldoInicial !== null) {
        const totalCredito = parseMoneyBR(celula(l, 4));
        const totalDebito = parseMoneyBR(celula(l, 5));
        if (totalCredito !== null || totalDebito !== null) {
          saldoFinal = saldoInicial + (totalCredito || 0) + (totalDebito || 0);
        }
      }
      break;
    }
    if (!dataISO) continue; // linha de rodapé/consolidado, sem data — ignorada

    const creditoTxt = celula(l, 4);
    const debitoTxt = celula(l, 5);
    const credito = creditoTxt ? parseMoneyBR(creditoTxt) : null;
    const debito = debitoTxt ? parseMoneyBR(debitoTxt) : null;
    if (credito === null && debito === null) continue;

    const sinal = credito !== null ? 'credito' : 'debito';
    const valor = Math.abs(credito !== null ? credito : debito);
    if (sinal === 'credito') somaCreditos += valor; else somaDebitos += valor;

    const partes = descricaoCol.split(/\s{2,}/).filter(Boolean);
    const tipoDetectado = partes.length > 1 ? partes[0] : descricaoCol;
    const descricaoCanonica = canonicalizar(descricaoCol, 'extrato');
    const documento = celula(l, 2) || null;

    rows.push({
      id: stableHash([contaId, dataISO, valor, descricaoCol, documento, ordinal++]),
      data: dataISO, valor, sinal, descricao: descricaoCol, descricaoCanonica,
      documento, tipoDetectado, saldo: saldoCol, contaId, raw: l.join(' | '),
      parcela_atual: null, parcela_total: null, cartaoFinal: null, secao: null, valorUSD: null,
    });
  }

  const checksum = { ok: false, saldoInicial, saldoFinal, somaCreditos, somaDebitos };
  if (saldoInicial !== null && saldoFinal !== null) {
    const esperado = saldoInicial + somaCreditos - somaDebitos;
    checksum.ok = Math.abs(esperado - saldoFinal) < 0.02;
    if (!checksum.ok) avisos.push(`Saldo calculado (R$ ${esperado.toFixed(2)}) não bate com o saldo final do extrato (R$ ${saldoFinal.toFixed(2)}).`);
  } else {
    avisos.push('Não encontrei "SALDO ANTERIOR" e/ou "TOTAL" — não foi possível validar o extrato automaticamente.');
  }

  return {
    statement: { agencia, numero, periodoInicio, periodoFim, saldoInicial, saldoFinal },
    rows, avisos, checksum,
  };
}

function detectar(matriz) {
  let pontuacao = 0;
  const primeirasLinhas = (matriz || []).slice(0, 10);
  if (primeirasLinhas.some((l) => /^EXTRATO DE CONTA CORRENTE$/i.test(celula(l, 0)))) pontuacao += 0.4;
  // "Conta:" pode cair em qualquer coluna da linha (observado na coluna 4 no
  // extrato real, não na 0 como a fixture original sugeria).
  if (primeirasLinhas.some((l) => /Conta:/i.test(textoLinha(l)))) pontuacao += 0.3;
  if ((matriz || []).slice(0, 15).some((l) => /^Data$/i.test(celula(l, 0)) && /Descri/i.test(celula(l, 1)))) pontuacao += 0.3;
  return pontuacao;
}

async function lerMatriz(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', codepage: 1252 });
  const primeiraAba = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[primeiraAba], { header: 1, raw: false, defval: '' });
}

async function parse(arrayBuffer, opcoes) {
  const matriz = await lerMatriz(arrayBuffer);
  const { statement, rows, avisos, checksum } = parseLinhasExtrato(matriz, opcoes.contaId, opcoes.arquivo);
  return {
    statement: { ...statement, tipo: 'extrato', contaId: opcoes.contaId, adaptador: 'santander-extrato-xls', arquivo: opcoes.arquivo, importadoEm: Date.now(), rows },
    rows, avisos, checksum,
  };
}

register({
  id: 'santander-extrato-xls', label: 'Extrato Santander (.xls)', aceita: ['.xls', '.xlsx'],
  detectar: async (buffer) => detectar(await lerMatriz(buffer)),
  parse,
});
