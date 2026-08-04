// Helpers de data e dos blocos "informativos" da fatura (vencimento, data de
// corte, período de compras) — extraídos de santander-cartao-pdf.js pra
// manter os dois arquivos abaixo do teto de ~250 linhas dos Global
// Constraints. Puros, sem dependência de pdf.js nem DOM: testáveis em Node.

// Resolve o ano de uma data DD/MM dada como referência o vencimento: escolhe
// o ano mais recente que não fique DEPOIS do vencimento (+5 dias de folga).
// `ROW_RE` (em santander-cartao-pdf.js) sempre captura a SEGUNDA data de
// cada linha de lançamento — a data do lançamento na fatura em si, nunca uma
// eventual data de compra original — mas essa segunda data pode ser de até
// ~3 anos atrás em parcelamentos antigos que ainda aparecem na fatura atual,
// e é por isso que a folga de retrocesso de ano vai até 3 anos, não só 1.
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

export function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function toISOExportado(d) {
  return toISO(d);
}

const CUTOFF_RE = /realizados?\D*?at[éeè]\s+(\d{2})\/(\d{2})|^at[éeè]\s+(\d{2})\/(\d{2})/i;

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

const FAIXA_PERIODO_RE = /(\d{2})\/(\d{2})\/(\d{2})\s*a\s*(\d{2})\/(\d{2})\/(\d{2})/g;

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

// O app anterior extraía o vencimento preferencialmente do NOME do arquivo
// ("Visa-DD-MM-AAAA.pdf"), convenção pessoal de um usuário só com um cartão.
// O app novo é multi-cartão e não pode depender de arquivo renomeado — só o
// texto do PDF (rótulo "Vencimento" impresso), que já funcionava como
// fallback no app anterior. Medido contra as 3 faturas reais (Step 6): o
// rótulo aparece na página 1 (capa), no formato "Vencimento: DD/MM/AAAA" —
// por isso `extractLines` expõe a página 1 sem gate de seção.
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
