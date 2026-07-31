// Só a parte pura da tela de Lançamentos entra aqui: renderLancamentos() e o
// formulário tocam o DOM direto (document.getElementById, addEventListener),
// então não podem ser exercitados num teste que roda em Node. opcoesAtivas()
// é lógica pura — não sabe o que é conta nem forma, só filtra uma lista por
// `ativo` preservando uma exceção por id — e por isso é testável aqui.

import { describe, it, assert, assertDeepEqual } from './harness.js';
import { opcoesAtivas } from '../src/ui/lancamentos.js';

function itemAtivo(id) { return { id, nome: 'Item ' + id, ativo: true }; }
function itemInativo(id) { return { id, nome: 'Item ' + id, ativo: false }; }

describe('lancamentos: opcoesAtivas (seletor de conta/forma do formulário)', () => {
  it('mantém apenas os itens ativos quando nada está em edição', () => {
    const lista = [itemAtivo('a'), itemInativo('b'), itemAtivo('c')];
    assertDeepEqual(opcoesAtivas(lista, null).map((x) => x.id), ['a', 'c']);
  });

  it('reintroduz o item inativo que é o valor atual do registro em edição', () => {
    const lista = [itemAtivo('a'), itemInativo('b'), itemAtivo('c')];
    assertDeepEqual(opcoesAtivas(lista, 'b').map((x) => x.id), ['a', 'b', 'c']);
  });

  it('não reintroduz um item inativo diferente do id atual', () => {
    // Dois inativos: só o que bate com idAtual pode voltar. Sem essa
    // distinção por id, um filtro "algum inativo pode passar" deixaria
    // vazar cadastros desativados que não têm nada a ver com o lançamento
    // em edição.
    const lista = [itemAtivo('a'), itemInativo('b'), itemInativo('c')];
    assertDeepEqual(opcoesAtivas(lista, 'b').map((x) => x.id), ['a', 'b']);
  });

  it('um item ativo nunca é afetado por idAtual apontar para outro id', () => {
    const lista = [itemAtivo('a')];
    assertDeepEqual(opcoesAtivas(lista, 'outro-id').map((x) => x.id), ['a']);
  });

  it('lista vazia ou ausente não quebra', () => {
    assert(opcoesAtivas([], 'a').length === 0);
    assert(opcoesAtivas(undefined, 'a').length === 0);
  });

  it('idAtual ausente (novo lançamento) nunca reintroduz um inativo', () => {
    const lista = [itemAtivo('a'), itemInativo('b')];
    assertDeepEqual(opcoesAtivas(lista, undefined).map((x) => x.id), ['a']);
  });
});
