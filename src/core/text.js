// Normalização de texto. Deliberadamente conservadora: normalizeDescricao é a
// base de computeParcelaKey (Fase 2), e a identidade das parcelas já gravadas
// depende dela não mudar. Remoção de acento e limpeza agressiva pertencem à
// canonicalização de classificação, que é outra função, em outro módulo.

export function normalizeDescricao(s) {
  return String(s === null || s === undefined ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
