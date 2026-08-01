// opcoesAtivas e rotuloComStatus moravam em ui/lancamentos.js e foram
// extraídas para cá na revisão final da fase: os seletores de Cadastros que
// referenciam outro cadastro (ex.: "conta que paga a fatura", "conta padrão
// da forma") precisam da MESMA regra que o formulário de Lançamentos já
// usava — um cadastro desativado sem marca, ou pior, escondido do seletor
// sem nenhum indício, era exatamente o furo que a revisão pegou.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { opcoesAtivas, rotuloComStatus } from '../src/ui/cadastros-comuns.js';

function itemAtivo(id) { return { id, nome: 'Item ' + id, ativo: true }; }
function itemInativo(id) { return { id, nome: 'Item ' + id, ativo: false }; }

describe('cadastros-comuns: opcoesAtivas (seletor de conta/forma em qualquer formulário)', () => {
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
    // vazar cadastros desativados que não têm nada a ver com o registro em
    // edição.
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

  it('idAtual ausente (novo registro) nunca reintroduz um inativo', () => {
    const lista = [itemAtivo('a'), itemInativo('b')];
    assertDeepEqual(opcoesAtivas(lista, undefined).map((x) => x.id), ['a']);
  });

  it('nao reintroduz um item inativo sem id so porque idAtual tambem e undefined', () => {
    // undefined === undefined seria verdadeiro numa comparacao ingenua: um
    // cadastro corrompido sem id (ex.: vindo de uma restauracao de backup
    // antiga) nao pode voltar a aparecer so porque nenhum id esta em edicao.
    const lista = [itemAtivo('a'), { id: undefined, nome: 'Sem id', ativo: false }];
    assertDeepEqual(opcoesAtivas(lista, undefined).map((x) => x.id), ['a']);
    assertDeepEqual(opcoesAtivas(lista, null).map((x) => x.id), ['a']);
  });
});

describe('cadastros-comuns: rotuloComStatus (marca visual de cadastro desativado)', () => {
  it('devolve so o nome quando o item esta ativo', () => {
    assertEqual(rotuloComStatus({ nome: 'Conta X', ativo: true }), 'Conta X');
  });

  it('acrescenta a marca quando o item esta desativado', () => {
    assertEqual(rotuloComStatus({ nome: 'Conta X', ativo: false }), 'Conta X — desativada');
  });

  it('trata ativo ausente como ativo (default do domínio)', () => {
    assertEqual(rotuloComStatus({ nome: 'Conta X' }), 'Conta X');
  });
});
