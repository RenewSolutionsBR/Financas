import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import {
  NATUREZAS, SEM_FORMA, contaComoGasto, validateTransaction, sumDespesas,
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

  it('soma apenas o que conta como gasto, sem residuo de ponto flutuante', () => {
    const lista = [
      t({ id: 'a', valor: 0.1 }),
      t({ id: 'b', valor: 0.29 }),
      t({ id: 'c', valor: 23.45 }),
      t({ id: 'd', valor: 7781.06 }),
      t({ id: 'e', valor: 50, natureza: 'receita' }),
      t({ id: 'f', valor: 30, natureza: 'pagamento_fatura' }),
      t({ id: 'g', valor: 20, natureza: 'transferencia' }),
      t({ id: 'h', valor: 99, previsto: true }),
    ];
    // Sem round2 a soma nativa daria 7804.900000000001.
    assertEqual(sumDespesas(lista), 7804.9);
  });

  it('cem centavos somam exatamente um real', () => {
    // Sem round2 isto daria 1.0000000000000007.
    const centavos = Array.from({ length: 100 }, (_, i) => t({ id: 'c' + i, valor: 0.01 }));
    assertEqual(sumDespesas(centavos), 1);
  });

  it('um valor ilegivel nao contamina o total', () => {
    const lista = [t({ id: 'a', valor: 10 }), t({ id: 'b', valor: 'abc' }), t({ id: 'c', valor: 5 })];
    // Perder um registro é ruim; zerar o mês inteiro em silêncio é pior.
    assertEqual(sumDespesas(lista), 15);
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

  it('nao lanca excecao para entrada invalida', () => {
    assert(validateTransaction(null).length > 0);
    assert(validateTransaction(undefined).length > 0);
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

  it('filtra por natureza', () => {
    const listaNaturezas = [t({ id: 'a' }), t({ id: 'b', natureza: 'receita' }), t({ id: 'c', natureza: 'transferencia' })];
    assertDeepEqual(filterTransactions(listaNaturezas, { naturezas: ['receita', 'transferencia'] }).map((x) => x.id), ['b', 'c']);
  });

  it('somenteGastos exclui receita, transferencia, pagamento de fatura e previsto', () => {
    const listaGastos = [
      t({ id: 'a' }),
      t({ id: 'b', natureza: 'receita' }),
      t({ id: 'c', natureza: 'pagamento_fatura' }),
      t({ id: 'd', previsto: true }),
    ];
    assertDeepEqual(filterTransactions(listaGastos, { somenteGastos: true }).map((x) => x.id), ['a']);
  });
});

describe('transactions: totais por forma', () => {
  it('agrupa só o que conta como gasto', () => {
    const lista = [
      t({ id: 'a', valor: 100.1, formaPagamentoId: 'pm_pix' }),
      t({ id: 'b', valor: 40.2, formaPagamentoId: 'pm_pix' }),
      t({ id: 'c', valor: 70.35, formaPagamentoId: 'pm_credito' }),
      t({ id: 'd', valor: 999, formaPagamentoId: 'pm_pix', natureza: 'receita' }),
    ];
    const totais = totaisPorForma(lista);
    assertEqual(totais.get('pm_pix'), 140.3);
    assertEqual(totais.get('pm_credito'), 70.35);
  });

  it('agrupa lancamento sem forma sob uma chave nomeada', () => {
    const mapa = totaisPorForma([t({ id: 'a', valor: 10, formaPagamentoId: undefined })]);
    assertEqual(mapa.get(SEM_FORMA), 10);
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
