// Só a parte pura da tela de Lançamentos entra aqui: renderLancamentos() e o
// formulário tocam o DOM direto (document.getElementById, addEventListener),
// então não podem ser exercitados num teste que roda em Node. As funções
// testadas aqui — interpretarValor, classeDoItem, formaFiltroAtual,
// somenteAutoFiltroAtual — são lógica pura extraída de dentro das funções
// que tocam DOM exatamente para isso: cada uma delas foi achado real de
// revisão (barra de filtros presa ligada, regra de ouro copiada pela
// metade, valor ilegível virando 0) que a suíte original não alcançava.
//
// opcoesAtivas e rotuloComStatus, que moravam aqui, foram extraídas para
// ui/cadastros-comuns.js (revisão final da fase) e são testadas em
// tests/cadastros-comuns.test.js.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  interpretarValor, classeDoItem, formaFiltroAtual, somenteAutoFiltroAtual,
  tipoContaParaForma, contasParaForma,
} from '../src/ui/lancamentos.js';
import { TIPO_CONTA, TIPO_CARTAO } from '../src/domain/accounts.js';

function t(over) {
  return {
    id: 'x', data: '2026-06-10', descricao: 'Compra', valor: 10, categoria: 'casa',
    natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_cc', ...over,
  };
}

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

describe('lancamentos: tipoContaParaForma (que cadastro o campo Conta/cartão oferece)', () => {
  it('credito exige cartao', () => {
    assertEqual(tipoContaParaForma('credito'), TIPO_CARTAO);
  });

  it('dinheiro nao usa conta nenhuma', () => {
    assertEqual(tipoContaParaForma('dinheiro'), null);
  });

  it('as demais formas (e ausencia de forma) caem em conta corrente', () => {
    for (const tipo of ['debito', 'pix', 'boleto', 'transferencia', 'outro', undefined, null]) {
      assertEqual(tipoContaParaForma(tipo), TIPO_CONTA, `tipo=${tipo}`);
    }
  });
});

describe('lancamentos: contasParaForma (filtra o seletor Conta/cartão pelo tipo da forma)', () => {
  const contaCorrente = { id: 'acc_cc', tipo: TIPO_CONTA, nome: 'Conta corrente' };
  const cartao = { id: 'acc_cartao', tipo: TIPO_CARTAO, nome: 'Cartao' };
  const contas = [contaCorrente, cartao];

  it('credito so oferece cartao, mesmo havendo conta corrente cadastrada', () => {
    // Prova que nao e so "devolve tudo": uma implementacao ingenua que
    // ignorasse o tipo devolveria as duas.
    assertDeepEqual(contasParaForma(contas, 'credito', null), [cartao]);
  });

  it('pix so oferece conta corrente, nao o cartao', () => {
    assertDeepEqual(contasParaForma(contas, 'pix', null), [contaCorrente]);
  });

  it('dinheiro nao oferece nenhuma conta, quando nao ha idAtual', () => {
    assertDeepEqual(contasParaForma(contas, 'dinheiro', null), []);
  });

  it('dinheiro com conta ja gravada (dado legado) preserva essa conta na lista', () => {
    // Sem esta excecao, abrir para edicao um lancamento antigo com essa
    // combinacao apagaria o campo sozinho, so por ter carregado a tela.
    assertDeepEqual(contasParaForma(contas, 'dinheiro', 'acc_cc'), [contaCorrente]);
  });

  it('pix com cartao ja gravado (idAtual de tipo errado) preserva o cartao junto com as contas corrente', () => {
    assertDeepEqual(contasParaForma(contas, 'pix', 'acc_cartao'), [contaCorrente, cartao]);
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
