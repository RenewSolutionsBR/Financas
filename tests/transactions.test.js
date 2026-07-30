import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  NATUREZAS, contaComoGasto, validateTransaction, sumDespesas,
  filterTransactions, totaisPorForma, novaTransaction,
} from '../src/domain/transactions.js';

function t(over) {
  return {
    id: 'x', data: '2026-06-10', descricao: 'Compra', valor: 10, categoria: 'casa',
    natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_cc', ...over,
  };
}

describe('transactions: o que conta como gasto', () => {
  it('despesa real conta', () => {
    assert(contaComoGasto(t()));
  });

  // Estes três são a razão de existir o campo natureza: o extrato traz todos e
  // somá-los dobraria o gasto ou inventaria gasto que não houve.
  it('receita, transferência e pagamento de fatura não contam', () => {
    assert(!contaComoGasto(t({ natureza: 'receita' })));
    assert(!contaComoGasto(t({ natureza: 'transferencia' })));
    assert(!contaComoGasto(t({ natureza: 'pagamento_fatura' })));
  });

  it('previsão não conta, mesmo sendo despesa', () => {
    assert(!contaComoGasto(t({ previsto: true })));
  });

  it('soma apenas o que conta como gasto', () => {
    const lista = [
      t({ id: 'a', valor: 100 }),
      t({ id: 'b', valor: 50, natureza: 'receita' }),
      t({ id: 'c', valor: 30, natureza: 'pagamento_fatura' }),
      t({ id: 'd', valor: 20, previsto: true }),
      t({ id: 'e', valor: 5.5 }),
    ];
    assertEqual(sumDespesas(lista), 105.5);
  });

  it('soma de lista vazia é zero', () => {
    assertEqual(sumDespesas([]), 0);
  });
});

describe('transactions: validação', () => {
  it('aceita lançamento completo', () => {
    assertEqual(validateTransaction(t()).length, 0);
  });

  it('exige descrição, data ISO válida e categoria', () => {
    assert(validateTransaction(t({ descricao: '' })).length > 0);
    assert(validateTransaction(t({ data: '10/06/2026' })).length > 0);
    assert(validateTransaction(t({ categoria: '' })).length > 0);
  });

  it('exige forma de pagamento', () => {
    assert(validateTransaction(t({ formaPagamentoId: null })).length > 0);
  });

  it('rejeita natureza desconhecida', () => {
    assert(validateTransaction(t({ natureza: 'inventada' })).length > 0);
  });

  it('rejeita valor zero ou negativo: o sentido vem da natureza', () => {
    assert(validateTransaction(t({ valor: 0 })).length > 0);
    assert(validateTransaction(t({ valor: -10 })).length > 0);
  });
});

describe('transactions: filtros', () => {
  const lista = [
    t({ id: 'a', data: '2026-05-10', formaPagamentoId: 'pm_pix', contaId: 'acc_1', categoria: 'casa' }),
    t({ id: 'b', data: '2026-06-10', formaPagamentoId: 'pm_credito', contaId: 'acc_2', categoria: 'lazer' }),
    t({ id: 'c', data: '2026-06-20', formaPagamentoId: 'pm_pix', contaId: 'acc_2', categoria: 'casa', classificadoAutomaticamente: true }),
  ];

  it('sem filtro devolve tudo', () => {
    assertEqual(filterTransactions(lista, {}).length, 3);
  });

  it('filtra por mês', () => {
    assertDeepEqual(filterTransactions(lista, { mes: '2026-06' }).map((x) => x.id), ['b', 'c']);
  });

  it('filtra por ano', () => {
    assertEqual(filterTransactions(lista, { ano: '2026' }).length, 3);
    assertEqual(filterTransactions(lista, { ano: '2025' }).length, 0);
  });

  it('filtra por várias formas de pagamento ao mesmo tempo', () => {
    assertDeepEqual(filterTransactions(lista, { formas: ['pm_pix'] }).map((x) => x.id), ['a', 'c']);
    assertEqual(filterTransactions(lista, { formas: ['pm_pix', 'pm_credito'] }).length, 3);
  });

  it('filtra por conta e por categoria', () => {
    assertEqual(filterTransactions(lista, { contas: ['acc_2'] }).length, 2);
    assertDeepEqual(filterTransactions(lista, { categorias: ['lazer'] }).map((x) => x.id), ['b']);
  });

  it('filtra os classificados automaticamente, para revisão', () => {
    assertDeepEqual(filterTransactions(lista, { somenteAuto: true }).map((x) => x.id), ['c']);
  });

  it('combina filtros com E lógico', () => {
    assertDeepEqual(filterTransactions(lista, { mes: '2026-06', formas: ['pm_pix'] }).map((x) => x.id), ['c']);
  });

  it('filtro vazio de lista não elimina nada', () => {
    assertEqual(filterTransactions(lista, { formas: [] }).length, 3);
  });
});

describe('transactions: totais por forma', () => {
  it('agrupa só o que conta como gasto', () => {
    const lista = [
      t({ id: 'a', valor: 100, formaPagamentoId: 'pm_pix' }),
      t({ id: 'b', valor: 40, formaPagamentoId: 'pm_pix' }),
      t({ id: 'c', valor: 70, formaPagamentoId: 'pm_credito' }),
      t({ id: 'd', valor: 999, formaPagamentoId: 'pm_pix', natureza: 'receita' }),
    ];
    const totais = totaisPorForma(lista);
    assertEqual(totais.get('pm_pix'), 140);
    assertEqual(totais.get('pm_credito'), 70);
  });
});

describe('transactions: construtor', () => {
  it('novaTransaction assume despesa e gera id com prefixo', () => {
    const nova = novaTransaction({ descricao: 'X', valor: 5, data: '2026-06-01', categoria: 'casa', formaPagamentoId: 'pm_pix' });
    assertEqual(nova.natureza, 'despesa');
    assertEqual(nova.origem, 'manual');
    assert(nova.id.startsWith('tx_'));
  });

  it('novaTransaction guarda o valor sempre positivo', () => {
    assertEqual(novaTransaction({ valor: -30 }).valor, 30);
  });
});
