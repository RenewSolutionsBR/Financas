import { describe, it, assert, assertEqual } from './harness.js';
import {
  viewDateParaMes, mesParaViewDate, nomeMesAno,
  formaFiltroAtual, contaFiltroAtual, naturezaFiltroAtual, somenteAutoFiltroAtual,
} from '../src/ui/lancamentos-filtros.js';

describe('lancamentos-filtros: conversão viewDate <-> mês', () => {
  it('viewDateParaMes formata YYYY-MM com zero à esquerda', () => {
    assertEqual(viewDateParaMes(new Date(2026, 0, 1)), '2026-01');
    assertEqual(viewDateParaMes(new Date(2026, 10, 1)), '2026-11');
  });

  it('mesParaViewDate lê YYYY-MM e sempre cai no dia 1', () => {
    const d = mesParaViewDate('2026-08');
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 7);
    assertEqual(d.getDate(), 1);
  });

  it('ida e volta preserva o mês', () => {
    assertEqual(viewDateParaMes(mesParaViewDate('2026-03')), '2026-03');
  });
});

describe('lancamentos-filtros: nomeMesAno', () => {
  it('formata mês por extenso com ano, capitalizado', () => {
    const nome = nomeMesAno(new Date(2026, 7, 1));
    assert(nome.toLowerCase().includes('agosto'), nome);
    assert(nome.includes('2026'), nome);
    assertEqual(nome[0], nome[0].toUpperCase());
  });
});

describe('lancamentos-filtros: leitura pura dos filtros', () => {
  it('formaFiltroAtual lê o primeiro item de filtros.formas', () => {
    assertEqual(formaFiltroAtual({ formas: ['pm_pix'] }), 'pm_pix');
    assertEqual(formaFiltroAtual({}), '');
  });

  it('contaFiltroAtual lê o primeiro item de filtros.contas', () => {
    assertEqual(contaFiltroAtual({ contas: ['acc_1'] }), 'acc_1');
    assertEqual(contaFiltroAtual({}), '');
  });

  it('naturezaFiltroAtual lê o primeiro item de filtros.naturezas', () => {
    assertEqual(naturezaFiltroAtual({ naturezas: ['receita'] }), 'receita');
    assertEqual(naturezaFiltroAtual({}), '');
    assertEqual(naturezaFiltroAtual({ naturezas: [] }), '');
  });

  it('somenteAutoFiltroAtual devolve booleano', () => {
    assertEqual(somenteAutoFiltroAtual({ somenteAuto: true }), true);
    assertEqual(somenteAutoFiltroAtual({}), false);
  });
});
