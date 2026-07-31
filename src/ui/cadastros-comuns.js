// Blocos compartilhados entre as seções de Cadastros: moldura de seção, campo
// de formulário rotulado e exibição dos erros que vêm do domínio. Nenhuma
// seção conhece as outras — só este arquivo é comum a todas.

import { el, toast } from './components.js';

export function secao(titulo, filhos) {
  return el('section', { class: 'cadastro-secao' }, [el('h2', { text: titulo }), ...filhos]);
}

export function campo(rotulo, controle) {
  return el('label', { class: 'campo' }, [el('span', { text: rotulo }), controle]);
}

// Os erros vêm prontos de validate*() do domínio: esta função só os exibe,
// nunca decide se algo é válido.
export function mostrarErros(erros) {
  toast(erros.join(' '), 'erro');
}
