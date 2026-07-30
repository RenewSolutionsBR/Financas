// Formatação e leitura de valores monetários no padrão brasileiro.
// Não conhece IndexedDB nem DOM: roda igual no navegador e no Node.

export function round2(n) {
  // O deslocamento por notação exponencial evita o erro clássico de
  // Math.round(1.005 * 100) devolver 100 em vez de 101.
  return Number(Math.round(Number(n + 'e2')) + 'e-2');
}

export function fmtBRL(n) {
  const num = Number(n) || 0;
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoneyBR(str) {
  if (str === null || str === undefined) return null;
  const limpo = String(str).replace(/R\$/gi, '').trim();
  if (!limpo) return null;
  // Formato BR: ponto separa milhar, vírgula separa decimal.
  const normalizado = limpo.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  return round2(parseFloat(normalizado));
}
