// Geração de identificadores. stableHash precisa ser determinístico entre
// sessões e aparelhos, então não pode usar aleatoriedade nem a hora atual.

export function uid(prefixo) {
  const tempo = Date.now().toString(36);
  const acaso = Math.random().toString(36).slice(2, 8);
  return `${prefixo}_${tempo}${acaso}`;
}

export function slugId(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[^a-zA-Z0-9]/g, '_');
}

export function stableHash(partes) {
  // O separador espaço impede que ['ab','c'] e ['a','bc'] colidam.
  const texto = partes.map((p) => String(p)).join(' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
