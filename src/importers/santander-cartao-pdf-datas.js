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
// Frase termina em "até" sem a data grudada (ex.: "...realizados até") —
// caso de fatura com cartão adicional, medido 2026-08-13: o layout de 2
// colunas intercala uma linha de OUTRA coluna ("Total a Pagar Vencimento...")
// entre "até" e a data "03/08.", que a extração de texto por posição X/Y
// não consegue evitar. Mesmo padrão de dataDoMeioDeLinhaComTresValores
// abaixo: quando o rótulo não tem a data grudada na mesma linha, ela
// aparece isolada numa das próximas linhas, não necessariamente adjacente.
const CUTOFF_FRAGMENTADO_RE = /realizados?\D*?at[éeè]\s*$/i;
const DATA_ISOLADA_RE = /^(\d{2})\/(\d{2})\.?\s*$/;

export function extractCutoffDateDeLinhas(linhas, vencimentoDate) {
  const todas = (linhas || []).slice(0, 20);
  for (let i = 0; i < todas.length; i++) {
    const linha = todas[i].trim();
    const m = CUTOFF_RE.exec(linha);
    if (m) {
      const dd = parseInt(m[1] || m[3], 10);
      const mm = parseInt(m[2] || m[4], 10);
      return resolveDate(dd, mm, vencimentoDate);
    }
    if (CUTOFF_FRAGMENTADO_RE.test(linha)) {
      for (let j = i + 1; j < Math.min(i + 4, todas.length); j++) {
        const dm = DATA_ISOLADA_RE.exec(todas[j].trim());
        if (dm) return resolveDate(parseInt(dm[1], 10), parseInt(dm[2], 10), vencimentoDate);
      }
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
// fallback no app anterior.
//
// Duas formas medidas contra faturas reais (Mastercard e Visa, ambas
// Santander): a Mastercard imprime "Vencimento: DD/MM/AAAA" isolado numa
// linha só (ou perto). A Visa imprime um cartão de 3 caixas lado a lado —
// "Total a Pagar Vencimento Seu limte é" como CABEÇALHO numa linha, e só
// 1-2 linhas depois vem a linha de dados com os 3 valores nessa MESMA
// ordem ("R$ 11.680,38 30/01/2026 R$49.270,00") — o vencimento é sempre o
// valor do MEIO nessa linha de 3 colunas, nunca o primeiro nem o último.
// Por isso o cabeçalho isolado ("^Vencimento$") não cobre a Visa: o rótulo
// nunca aparece sozinho numa linha.
//
// O antigo regex "solto" (`Vencimento\D+DD/MM/AAAA` em QUALQUER lugar do
// texto, sem exigir adjacência real) foi removido: ele podia casar com uma
// ocorrência de "vencimento" no meio de uma frase de aviso de juros
// distante no texto ("...após a data de vencimento você tem alguns custos
// 24/02/2026"), pegando uma data completamente errada (nesse caso, a do
// bloco "Melhor dia para compras", não o vencimento real) — bug real visto
// em produção com uma fatura Visa.
function dataDoMeioDeLinhaComTresValores(linha) {
  const datas = [...linha.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
  const valores = (linha.match(/R\$\s*[\d.,]+/g) || []).length;
  // Layout de 3 colunas: exatamente 1 data no meio de 2 valores monetários
  // (R$ ... DD/MM/AAAA ... R$ ...) — nunca a primeira nem a última data de
  // uma linha com várias, que poderiam vir de outro contexto.
  if (datas.length !== 1 || valores < 2) return null;
  const [, dd, mm, aaaa] = datas[0];
  return new Date(parseInt(aaaa, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
}

// "Vencimento" e a data no MESMO texto, sem nada entre o rótulo e os dois
// pontos/data (ex.: "Vencimento: 25/06/2026") — âncorado logo depois do
// rótulo (`\s*:?\s*`), nunca `\D+` solto: esse era o regex frouxo que casava
// com "vencimento" no meio de uma frase distante (aviso de juros) e uma
// data completamente sem relação mais adiante no texto.
const INLINE_RE = /^Vencimento\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i;

export function vencimentoFromText(linhas) {
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (/^Vencimento$/i.test(linha)) {
      for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
        const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(linhas[j]);
        if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      }
    }
    const inline = INLINE_RE.exec(linha);
    if (inline) return new Date(parseInt(inline[3], 10), parseInt(inline[2], 10) - 1, parseInt(inline[1], 10));

    // Cabeçalho "Total a Pagar Vencimento Seu limte é" (layout Visa): a
    // data certa é a do MEIO da linha de dados logo abaixo, não a primeira
    // data solta que aparecer no texto adiante.
    if (/vencimento/i.test(linha) && /total a pagar/i.test(linha)) {
      for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
        const dt = dataDoMeioDeLinhaComTresValores(linhas[j]);
        if (dt) return dt;
      }
    }
  }
  return null;
}
