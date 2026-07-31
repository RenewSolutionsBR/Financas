// Só a parte pura da tela de Lançamentos entra aqui: renderLancamentos() e o
// formulário tocam o DOM direto (document.getElementById, addEventListener),
// então não podem ser exercitados num teste que roda em Node. As funções
// testadas aqui — opcoesAtivas, interpretarValor, classeDoItem,
// formaFiltroAtual, somenteAutoFiltroAtual — são lógica pura extraída de
// dentro das funções que tocam DOM exatamente para isso: cada uma delas foi
// achado real de revisão (barra de filtros presa ligada, regra de ouro
// copiada pela metade, valor ilegível virando 0) que a suíte original não
// alcançava.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  opcoesAtivas, interpretarValor, classeDoItem, formaFiltroAtual, somenteAutoFiltroAtual,
} from '../src/ui/lancamentos.js';

function itemAtivo(id) { return { id, nome: 'Item ' + id, ativo: true }; }
function itemInativo(id) { return { id, nome: 'Item ' + id, ativo: false }; }

function t(over) {
  return {
    id: 'x', data: '2026-06-10', descricao: 'Compra', valor: 10, categoria: 'casa',
    natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_cc', ...over,
  };
}

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

  it('nao reintroduz um item inativo sem id so porque idAtual tambem e undefined', () => {
    // undefined === undefined seria verdadeiro numa comparacao ingenua: um
    // cadastro corrompido sem id (ex.: vindo de uma restauracao de backup
    // antiga) nao pode voltar a aparecer so porque nenhum id esta em edicao.
    const lista = [itemAtivo('a'), { id: undefined, nome: 'Sem id', ativo: false }];
    assertDeepEqual(opcoesAtivas(lista, undefined).map((x) => x.id), ['a']);
    assertDeepEqual(opcoesAtivas(lista, null).map((x) => x.id), ['a']);
  });
});

describe('lancamentos: interpretarValor (campo Valor do formulário)', () => {
  it('campo vazio vira 0 sem erro — a guarda de "maior que zero" do domínio cuida do resto', () => {
    assertDeepEqual(interpretarValor(''), { valor: 0, erro: null });
    assertDeepEqual(interpretarValor('   '), { valor: 0, erro: null });
    assertDeepEqual(interpretarValor(undefined), { valor: 0, erro: null });
  });

  it('valor no formato BR é lido e sempre devolvido positivo', () => {
    assertDeepEqual(interpretarValor('12,30'), { valor: 12.3, erro: null });
    assertDeepEqual(interpretarValor('-12,30'), { valor: 12.3, erro: null });
  });

  it('valor com ponto decimal ambíguo gera erro próprio, não vira 0 silenciosamente', () => {
    // "12.30" é o erro de digitação mais comum (hábito de teclado numérico) e
    // parseMoneyBR recusa de propósito, porque poderia significar 1230.
    const r = interpretarValor('12.30');
    assertEqual(r.valor, 0);
    assert(r.erro !== null, 'deveria ter gerado uma mensagem de erro');
    assert(/[Vv]alor inválido/.test(r.erro), r.erro);
  });

  it('texto sem nenhum número gera o mesmo erro de formato', () => {
    const r = interpretarValor('abc');
    assert(r.erro !== null);
  });
});

describe('lancamentos: classeDoItem (marcação visual de não-gasto)', () => {
  it('despesa real não recebe a marca nao-gasto', () => {
    assertEqual(classeDoItem(t()), 'item-lancamento');
  });

  it('receita, transferência e pagamento de fatura recebem a marca', () => {
    assertEqual(classeDoItem(t({ natureza: 'receita' })), 'item-lancamento nao-gasto');
    assertEqual(classeDoItem(t({ natureza: 'transferencia' })), 'item-lancamento nao-gasto');
    assertEqual(classeDoItem(t({ natureza: 'pagamento_fatura' })), 'item-lancamento nao-gasto');
  });

  it('despesa PREVISTA também recebe a marca, mesmo com natureza despesa', () => {
    // Este é o caso que uma checagem só em `natureza` perde: contaComoGasto
    // exige despesa E não prevista.
    assertEqual(classeDoItem(t({ previsto: true })), 'item-lancamento nao-gasto');
  });
});

describe('lancamentos: estado da barra de filtros', () => {
  it('formaFiltroAtual devolve vazio quando não há filtro de forma', () => {
    assertEqual(formaFiltroAtual({}), '');
    assertEqual(formaFiltroAtual({ formas: [] }), '');
    assertEqual(formaFiltroAtual(undefined), '');
  });

  it('formaFiltroAtual devolve a forma filtrada', () => {
    assertEqual(formaFiltroAtual({ formas: ['pm_pix'] }), 'pm_pix');
  });

  it('somenteAutoFiltroAtual reflete true e false, não só a ausência da chave', () => {
    assertEqual(somenteAutoFiltroAtual({}), false);
    assertEqual(somenteAutoFiltroAtual({ somenteAuto: true }), true);
    assertEqual(somenteAutoFiltroAtual({ somenteAuto: false }), false);
    assertEqual(somenteAutoFiltroAtual(undefined), false);
  });
});
