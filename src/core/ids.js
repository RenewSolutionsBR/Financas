// Geração de identificadores. stableHash precisa ser determinístico entre
// sessões e aparelhos, então não pode usar aleatoriedade nem a hora atual.

// O separador precisa ser um caractere que nunca aparece dentro de uma
// descricao de extrato. Fica definido por String.fromCharCode(0) em vez de
// literal na string: o caractere NUL e invisivel no editor e ja foi trocado
// por espaco por engano mais de uma vez.
const SEPARADOR_PARTES = String.fromCharCode(0);

export function uid(prefixo) {
  const tempo = Date.now().toString(36);
  const acaso = Math.random().toString(36).slice(2, 8);
  return `${prefixo}_${tempo}${acaso}`;
}

export function slugId(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[^a-zA-Z0-9]/g, '_');
}

export function stableHash(partes) {
  // Com espaco como separador, ['a b','c'] e ['a','b c'] geravam o mesmo
  // hash, e uma linha de extrato seria descartada como duplicata de outra.
  const texto = partes.map((p) => String(p)).join(SEPARADOR_PARTES);
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
