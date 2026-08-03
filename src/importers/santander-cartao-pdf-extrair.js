// Extração de texto de PDF via pdf.js — browser-only, sem equivalente
// testável em Node. A lógica de parsing de linha (que é testável) mora em
// santander-cartao-pdf.js; este arquivo só produz as linhas de texto que
// aquele consome.

function clusterRowsFromItems(items, yTol = 2.2) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  let cur = [];
  let curY = null;
  for (const it of sorted) {
    if (curY === null || Math.abs(it.y - curY) <= yTol) {
      cur.push(it);
      curY = curY === null ? it.y : curY;
    } else {
      rows.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim());
}

const COMPLETE_ROW_RE = /^(?:\S+\s+)?\d{2}\/\d{2}\s+.+\d,\d{2}\s*$/;
// Reconhece linha de cabeçalho de cartão pela FORMA estrutural (mesmo padrão
// do CARD_HEADER_RE em santander-cartao-pdf.js), não por nome de pessoa —
// o app anterior tinha o nome real do usuário hardcoded aqui, o que não
// pode se repetir num repositório público nem generaliza para outro titular.
const LABEL_LINE_RE = /^(Parcelamentos|Despesas|Pagamento e Demais|VALOR TOTAL|Compra\s+Data|Detalhamento da Fatura|Resumo da Fatura|IOF DESPESA|@?[^-]+-\s*\d{4}\s*XXXX\s*XXXX\s*\d{4})/i;

function scoreCompleteness(lines) {
  return lines.reduce((n, l) => n + ((COMPLETE_ROW_RE.test(l) || LABEL_LINE_RE.test(l)) ? 1 : 0), 0);
}

function reconstructSegment(items, depth = 0) {
  if (!items.length || depth > 4) return clusterRowsFromItems(items);
  const xs = [...new Set(items.map((it) => Math.round(it.x)))].sort((a, b) => a - b);
  const noSplitLines = clusterRowsFromItems(items);
  if (xs.length < 2) return noSplitLines;

  let bestLines = noSplitLines;
  let bestScore = scoreCompleteness(noSplitLines);

  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap < 35) continue;
    const mid = (xs[i] + xs[i + 1]) / 2;
    const left = items.filter((it) => it.x < mid);
    const right = items.filter((it) => it.x >= mid);
    if (left.length < 5 || right.length < 5) continue;
    const combined = [...reconstructSegment(left, depth + 1), ...reconstructSegment(right, depth + 1)];
    const combinedScore = scoreCompleteness(combined);
    if (combinedScore > bestScore) { bestLines = combined; bestScore = combinedScore; }
  }
  return bestLines;
}

function clusterRowsWithY(items, yTol = 2.2) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows = [];
  let cur = [];
  let curY = null;
  for (const it of sorted) {
    if (curY === null || Math.abs(it.y - curY) <= yTol) {
      cur.push(it);
      curY = curY === null ? it.y : curY;
    } else {
      rows.push({ y: curY, items: cur });
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) rows.push({ y: curY, items: cur });
  return rows.map(({ y, items: r }) => ({ y, text: r.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim() }));
}

function reconstructPageLines(items, alreadyInDetail) {
  if (!items.length) return { lines: [], stillInDetail: alreadyInDetail };

  const rough = clusterRowsWithY(items);
  let yTop = null;
  let yFooter = null;
  for (const { y, text } of rough) {
    if (/Detalhamento da Fatura/i.test(text)) yTop = yTop === null ? y : Math.max(yTop, y);
    if (/Juros e Custo Efetivo Total/i.test(text)) yFooter = yFooter === null ? y : Math.max(yFooter, y);
  }

  const inDetailAtStart = alreadyInDetail || yTop !== null;
  if (!inDetailAtStart) return { lines: [], stillInDetail: false };

  const hi = yTop !== null ? yTop + 3 : Math.max(...items.map((it) => it.y)) + 1;
  const lo = yFooter !== null ? yFooter + 3 : Math.min(...items.map((it) => it.y)) - 1;
  const bandItems = items.filter((it) => it.y >= lo && it.y <= hi);

  let lines = reconstructSegment(bandItems);
  if (yTop !== null) lines = ['Detalhamento da Fatura', ...lines];
  return { lines, stillInDetail: true };
}

async function getPageItems(page) {
  const content = await page.getTextContent();
  return content.items
    .filter((it) => it.str && it.str.trim().length > 0)
    .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
}

export async function extractLines(doc) {
  const allLines = [];

  // Medido contra 3 faturas Mastercard reais (Step 6 da task): a página 1 é
  // a capa/resumo e NÃO contém "Detalhamento da Fatura" — é só a partir da
  // página 2 que esse marcador aparece. Mas é justamente na página 1 que
  // moram o rótulo "Vencimento", a frase "...até DD/MM." (data de corte) e o
  // bloco "Período das compras" (4 faixas). Como o laço abaixo só emite
  // linha quando `inDetail` já é true, essas três informações NUNCA
  // apareceriam no array se a página 1 fosse processada só pelo caminho
  // gateado — por isso a reconstrução crua da página 1 entra à parte, antes
  // do laço principal, sem o gate: `vencimentoFromText`, `extractCutoffDateDeLinhas`
  // e `extrairPeriodoCompras` (que procuram nas primeiras linhas do array)
  // dependem de achar essas 3 informações logo no início.
  const page1 = await doc.getPage(1);
  const page1Items = await getPageItems(page1);
  allLines.push(...reconstructSegment(page1Items));

  let inDetail = false;
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const items = await getPageItems(page);
    const { lines, stillInDetail } = reconstructPageLines(items, inDetail);
    inDetail = stillInDetail;
    allLines.push(...lines);
    if (lines.some((l) => /^Resumo da Fatura/i.test(l.trim()))) break;
  }
  return allLines;
}
