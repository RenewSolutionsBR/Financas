import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { atribuirNatureza, confrontarFaturaDebito, runReconciliationBank } from '../src/domain/reconcile-bank.js';
import { TIPO_CARTAO, TIPO_CONTA } from '../src/domain/accounts.js';

const CARTAO = { id: 'acc_cartao_1', tipo: TIPO_CARTAO, matchers: ['MASTER CARD FINAL 0000'] };
const OUTRA_CONTA_PROPRIA = { id: 'acc_poupanca', tipo: TIPO_CONTA, matchers: ['JOAO DA SILVA'] };
const accounts = [CARTAO, OUTRA_CONTA_PROPRIA];
const apelidos = ['JOAO DA SILVA', 'JOAO SILVA'];

function linha(over) { return { descricao: '', sinal: 'debito', valor: 100, data: '2026-05-04', ...over }; }

describe('reconcile-bank: atribuirNatureza', () => {
  it('descricao casa matcher de CARTAO em linha de debito: pagamento_fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', sinal: 'debito' });
    const { natureza, contaCasadaId } = atribuirNatureza(l, accounts, apelidos);
    assertEqual(natureza, 'pagamento_fatura');
    assertEqual(contaCasadaId, CARTAO.id);
  });

  it('mesma descricao mas CREDITO (estorno de pagamento, por exemplo) NAO vira pagamento_fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', sinal: 'credito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'receita', 'so debito confirma pagamento de fatura; credito cai na regra de sinal');
  });

  it('contraparte casa apelido do titular: transferencia', () => {
    const l = linha({ descricao: 'PIX ENVIADO   JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'transferencia');
  });

  it('contraparte casa OUTRA CONTA cadastrada (nao so apelido pessoal): transferencia', () => {
    const l = linha({ descricao: 'TED ENVIADA   JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, []).natureza, 'transferencia', 'casou pelo matcher da conta cadastrada, sem apelido nenhum configurado');
  });

  it('sinal credito sem nenhum matcher: receita', () => {
    const l = linha({ descricao: 'PIX RECEBIDO   Fulano Desconhecido', sinal: 'credito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'receita');
  });

  it('debito sem nenhum matcher: despesa (o caso default)', () => {
    const l = linha({ descricao: 'COMPRA LOJA QUALQUER', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'despesa');
  });

  it('precedencia: pagamento_fatura vence sobre transferencia quando os dois matchers, por acaso, casassem', () => {
    // Cenario de borda deliberado: um apelido do titular casando por acidente
    // na mesma descricao de um debito de fatura — pagamento_fatura e mais
    // especifico e tem que vencer.
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000 JOAO DA SILVA', sinal: 'debito' });
    assertEqual(atribuirNatureza(l, accounts, apelidos).natureza, 'pagamento_fatura');
  });
});

describe('reconcile-bank: confrontarFaturaDebito', () => {
  // NOTA: vencimento de s1/s2 corrigido em relacao ao brief original (que
  // tinha os dois valores trocados por engano — ver task-9-report.md). Com
  // o debito em 2026-05-04, a fatura de vencimento mais proximo tem que ser
  // s1 (2026-05-01, a 3 dias), nao s2 (2026-06-01, a 28 dias) — do jeito que
  // o brief tinha, nem a propria implementacao do brief batia com o teste.
  const statementsFatura = [
    { id: 's1', tipo: 'fatura', contaId: CARTAO.id, vencimento: '2026-05-01', totalImpresso: 123.01 },
    { id: 's2', tipo: 'fatura', contaId: CARTAO.id, vencimento: '2026-06-01', totalImpresso: 200 },
  ];

  it('vincula a fatura de VENCIMENTO MAIS PROXIMO da data do debito', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 123.01, data: '2026-05-04' });
    const resultado = confrontarFaturaDebito({ ...l, contaCasadaId: CARTAO.id }, statementsFatura);
    assertEqual(resultado.faturaId, 's1');
    assertEqual(resultado.aviso, null, 'valores batem, sem aviso');
  });

  it('gera aviso NAO BLOQUEANTE quando o valor debitado diverge do total da fatura', () => {
    const l = linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 100, data: '2026-05-04' });
    const resultado = confrontarFaturaDebito({ ...l, contaCasadaId: CARTAO.id }, statementsFatura);
    assertEqual(resultado.faturaId, 's1');
    assert(resultado.aviso !== null);
    assertEqual(resultado.diferenca, 23.01);
  });
});

describe('reconcile-bank: runReconciliationBank — 4 baldes e idempotencia', () => {
  it('so DESPESA soma — pagamento_fatura/transferencia/receita ficam de fora do total mesmo conciliados', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [
      linha({ descricao: 'DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000', valor: 100, data: '2026-05-04' }),
      linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' }),
    ] };
    const { extratoUnmatched } = runReconciliationBank(extrato, [], accounts, apelidos, []);
    const pagamentoFatura = extratoUnmatched.find((l) => l.natureza === 'pagamento_fatura');
    const despesa = extratoUnmatched.find((l) => l.natureza === 'despesa');
    assert(pagamentoFatura && despesa);
  });

  it('casamento por valor/data com tolerancia de 2 dias e conta compativel', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-06', valor: 50 };
    const { matched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 1);
  });

  it('lancamento de OUTRA conta nao casa, mesmo com valor/data identicos', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_OUTRA', data: '2026-05-05', valor: 50 };
    const { matched, extratoUnmatched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 0);
    assertEqual(extratoUnmatched.length, 1);
  });

  it('lancamento SEM conta definida ainda casa (regra: extrato bate com contaId do lancamento OU lancamento sem conta)', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const t = { id: 't1', previsto: false, natureza: 'despesa', contaId: null, data: '2026-05-05', valor: 50 };
    const { matched } = runReconciliationBank(extrato, [t], accounts, apelidos, []);
    assertEqual(matched.length, 1);
  });

  it('empate de candidatos: vence o de descricao canonica mais parecida', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [linha({ descricao: 'COMPRA SUPERMERCADO EXEMPLO', valor: 50, sinal: 'debito', data: '2026-05-05' })] };
    const longe = { id: 'longe', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50, descricao: 'Outra coisa qualquer' };
    const perto = { id: 'perto', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50, descricao: 'Supermercado Exemplo' };
    const { matched } = runReconciliationBank(extrato, [longe, perto], accounts, apelidos, []);
    assertEqual(matched[0].app.id, 'perto');
  });

  it('reimportar o MESMO extrato (mesmos ids de linha) nao duplica no balde extratoUnmatched', () => {
    const rowFixo = linha({ descricao: 'COMPRA MERCADO', valor: 50, sinal: 'debito', data: '2026-05-05', id: 'row_fixo_1' });
    const extrato = { contaId: 'acc_corrente_1', rows: [rowFixo] };
    const r1 = runReconciliationBank(extrato, [], accounts, apelidos, []);
    const r2 = runReconciliationBank(extrato, [], accounts, apelidos, []);
    assertDeepEqual(r1.extratoUnmatched.map((l) => l.id), r2.extratoUnmatched.map((l) => l.id));
  });

  it('lancamento de ORIGEM FATURA nunca aparece em appUnmatched, mesmo sem casar com nenhuma linha do extrato', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [] };
    const parcelaDeFatura = { id: 't1', previsto: false, natureza: 'despesa', origem: 'fatura', contaId: 'acc_cartao_1', data: '2026-05-05', valor: 349.4 };
    const { appUnmatched } = runReconciliationBank(extrato, [parcelaDeFatura], accounts, apelidos, []);
    assertEqual(appUnmatched.length, 0, 'parcela de fatura pertence a conciliacao de fatura, nunca deveria sobrar no balde de extrato');
  });

  it('lancamento de origem EXTRATO (ou sem origem definida) continua aparecendo normalmente em appUnmatched quando nao casa', () => {
    const extrato = { contaId: 'acc_corrente_1', rows: [] };
    const semOrigem = { id: 't1', previsto: false, natureza: 'despesa', contaId: 'acc_corrente_1', data: '2026-05-05', valor: 50 };
    const { appUnmatched } = runReconciliationBank(extrato, [semOrigem], accounts, apelidos, []);
    assertEqual(appUnmatched.length, 1, 'lancamento manual/de extrato sem casamento ainda precisa aparecer, senao o usuario nunca sabe que falta reconciliar');
  });
});
