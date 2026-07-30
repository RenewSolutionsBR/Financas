// Formatação e leitura de valores monetários no padrão brasileiro.
// Não conhece IndexedDB nem DOM: roda igual no navegador e no Node.

export function round2(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return NaN;
  if (num === 0) return 0;
  const escalado = num * 100;
  // Duas correções, cada uma para um erro real:
  // 1. A margem de EPSILON relativo compensa o resíduo binário que faz
  //    1.005 * 100 valer 100.49999999999999 e arredondar para baixo.
  // 2. O sinal sai da conta e volta no fim porque Math.round(-100.5) devolve
  //    -100 em JavaScript, enquanto Math.round(100.5) devolve 101 — sem isso,
  //    um lançamento e o seu estorno diferem em um centavo.
  const corrigido = Math.abs(escalado) * (1 + Number.EPSILON);
  return Math.sign(escalado) * Math.round(corrigido) / 100;
}

export function fmtBRL(n) {
  const num = Number(n) || 0;
  return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoneyBR(str) {
  if (str === null || str === undefined) return null;
  const limpo = String(str).replace(/R\$/gi, '').trim();
  if (!limpo) return null;
  // Formato BR estrito: ponto só como separador de milhar, e portanto sempre
  // seguido de exatamente três dígitos; vírgula como separador decimal.
  // A rigidez é proposital. A versão tolerante lia "12.30" como 1230 — erro de
  // cem vezes, sem nenhum aviso. Um valor que o app não entende com certeza
  // precisa parar na frente do usuário, não entrar calado num total.
  if (!/^-?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(limpo)) return null;
  return round2(parseFloat(limpo.replace(/\./g, '').replace(',', '.')));
}
