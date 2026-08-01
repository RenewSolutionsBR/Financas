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

// Pura, sem DOM: um item inativo some da lista, a não ser que seja `idAtual` —
// o valor já gravado no registro em edição. `idAtual` só conta quando não é
// null/undefined: sem essa guarda, dois itens sem `id` (ex.: cadastro
// corrompido vindo de uma restauração de backup antiga) se igualariam por
// `undefined === undefined` e um inativo sem id voltaria a aparecer mesmo
// fora de edição.
//
// Compartilhada entre todos os seletores que oferecem conta/forma como
// opção (Lançamentos e os seletores de Cadastros que referenciam outro
// cadastro, como "conta que paga a fatura" e "conta padrão da forma"): um
// cadastro desativado não pode aparecer sem marca — ou pior, nem aparecer —
// só porque foi filtrado num lugar e não no outro.
export function opcoesAtivas(lista, idAtual) {
  return (lista || []).filter((item) => item.ativo !== false || (idAtual != null && item.id === idAtual));
}

export function rotuloComStatus(item) {
  return item.ativo === false ? `${item.nome} — desativada` : item.nome;
}
