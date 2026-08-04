import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseLinhasExtrato } from '../src/importers/santander-extrato-xls.js';

// Matriz sintética no formato de linhas/células que sheet_to_json({header:1})
// produziria — estrutura da spec 6.3, dados 100% fictícios.
function planilhaSintetica(over) {
  const base = [
    ['EXTRATO DE CONTA CORRENTE'],
    ['Conta: 0001-123456-7'],
    ['Extrato de 01/05/2026 a 31/05/2026'],
    [],
    ['Data', 'Descrição', 'Docto', 'Situação', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
    ['01/05/2026', 'SALDO ANTERIOR', '', '', '', '', '1.000,00'],
    ['03/05/2026', 'PIX RECEBIDO   Fulano de Tal', '000123', 'Efetivada', '250,00', '', '1.250,00'],
    ['05/05/2026', 'PIX ENVIADO   Beltrano da Silva', '000124', 'Efetivada', '', '-100,00', '1.150,00'],
    ['10/05/2026', 'TARIFA MANUTENCAO CONTA', '000125', 'Efetivada', '', '-30,00', '1.120,00'],
    ['31/05/2026', 'TOTAL', '', '', '250,00', '-130,00', '1.120,00'],
  ];
  return over ? over(base) : base;
}

describe('santander-extrato-xls: parseLinhasExtrato', () => {
  it('extrai contaId, periodo e saldo inicial/final do cabecalho e rodape', () => {
    const { statement } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(statement.periodoInicio, '2026-05-01');
    assertEqual(statement.periodoFim, '2026-05-31');
    assertEqual(statement.saldoInicial, 1000);
    assertEqual(statement.saldoFinal, 1120);
  });

  it('gera uma linha normalizada por lancamento, pulando SALDO ANTERIOR e TOTAL', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.length, 3);
  });

  it('credito e debito viram sinal e valor SEMPRE positivo', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const pix = rows.find((r) => r.descricao.includes('Fulano'));
    assertEqual(pix.sinal, 'credito');
    assertEqual(pix.valor, 250);
    const enviado = rows.find((r) => r.descricao.includes('Beltrano'));
    assertEqual(enviado.sinal, 'debito');
    assertEqual(enviado.valor, 100, 'valor sempre positivo, mesmo a celula de debito vindo negativa');
  });

  it('documento vem da coluna Docto', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).documento, '000123');
  });

  it('saldo da linha vem da coluna Saldo (R$)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).saldo, 1250);
  });

  it('descricaoCanonica calculada com escopo extrato (separa tipo/contraparte)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).descricaoCanonica, 'FULANO DE TAL');
  });

  it('tipoDetectado e a parte ANTES do espaco duplo, para casar padroesExtrato depois', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertEqual(rows.find((r) => r.descricao.includes('Fulano')).tipoDetectado, 'PIX RECEBIDO');
  });

  it('linha sem contraparte (sem espaco duplo): tipoDetectado e descricaoCanonica sao o texto inteiro', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const tarifa = rows.find((r) => r.descricao.includes('TARIFA'));
    assertEqual(tarifa.tipoDetectado, 'TARIFA MANUTENCAO CONTA');
    assertEqual(tarifa.descricaoCanonica, 'TARIFA MANUTENCAO CONTA');
  });

  it('checksum fecha quando saldoInicial + creditos - debitos = saldoFinal', () => {
    const { checksum } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assert(checksum.ok, JSON.stringify(checksum));
  });

  it('checksum acusa divergencia', () => {
    const quebrada = planilhaSintetica((linhas) => {
      const copia = linhas.map((l) => [...l]);
      copia[5][6] = '999,00'; // mexe no saldo anterior, sem tocar nos lancamentos
      return copia;
    });
    const { checksum, avisos } = parseLinhasExtrato(quebrada, 'acc_1', 'extrato.xls');
    assert(!checksum.ok);
    assert(avisos.some((a) => /não bate/i.test(a)));
  });

  it('id de cada linha e deterministico entre duas chamadas iguais', () => {
    const r1 = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    const r2 = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });

  it('contaId se propaga pra cada linha (necessario pro casamento por conta na conciliacao)', () => {
    const { rows } = parseLinhasExtrato(planilhaSintetica(), 'acc_1', 'extrato.xls');
    assert(rows.every((r) => r.contaId === 'acc_1'));
  });
});

// Casos abaixo cobrem divergências encontradas ao validar contra um extrato
// real do Santander (dados 100% fictícios aqui): "Conta:"/"Extrato de X a Y"
// vieram numa coluna diferente da 0, o número de conta tinha pontos além de
// hífen, e a linha TOTAL trazia o rótulo na coluna Data (não Descrição) e
// não repetia o saldo corrente na coluna Saldo.
describe('santander-extrato-xls: parseLinhasExtrato — variações observadas no arquivo real', () => {
  it('Conta: e Extrato de X a Y numa coluna diferente da 0 ainda sao lidos (linha inteira e varrida)', () => {
    const linhas = [
      ['EXTRATO DE CONTA CORRENTE'],
      ['', '', '', '', 'Conta: 0001-12.345678.9'],
      ['', '', '', '', 'Extrato de 01/05/2026 a 31/05/2026'],
      [],
      ['Data', 'Descrição', 'Docto', 'Situação', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
      ['01/05/2026', 'SALDO ANTERIOR', '', '', '', '', '1.000,00'],
      ['03/05/2026', 'PIX RECEBIDO   Ciclano de Souza', '000123', 'Efetivada', '250,00', '', '1.250,00'],
      ['31/05/2026', 'TOTAL', '', '', '250,00', '', '1.250,00'],
    ];
    const { statement } = parseLinhasExtrato(linhas, 'acc_1', 'extrato.xls');
    assertEqual(statement.periodoInicio, '2026-05-01');
    assertEqual(statement.periodoFim, '2026-05-31');
    assertEqual(statement.agencia, '0001');
    assertEqual(statement.numero, '12.345678.9');
  });

  it('linha TOTAL com rotulo na coluna Data (em vez de Descricao) ainda encerra a leitura', () => {
    const linhas = [
      ['EXTRATO DE CONTA CORRENTE'],
      ['Conta: 0001-123456-7'],
      ['Extrato de 01/05/2026 a 31/05/2026'],
      [],
      ['Data', 'Descrição', 'Docto', 'Situação', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
      ['01/05/2026', 'SALDO ANTERIOR', '', '', '', '', '1.000,00'],
      ['03/05/2026', 'PIX RECEBIDO   Ciclano de Souza', '000123', 'Efetivada', '250,00', '', '1.250,00'],
      ['TOTAL', '', '', '', '250,00', '', '1.250,00'],
    ];
    const { rows, statement } = parseLinhasExtrato(linhas, 'acc_1', 'extrato.xls');
    assertEqual(rows.length, 1);
    assertEqual(statement.saldoFinal, 1250);
  });

  it('linha TOTAL sem saldo na coluna Saldo: saldo final vem de saldoInicial + credito total + debito total da propria linha TOTAL', () => {
    const linhas = [
      ['EXTRATO DE CONTA CORRENTE'],
      ['Conta: 0001-123456-7'],
      ['Extrato de 01/05/2026 a 31/05/2026'],
      [],
      ['Data', 'Descrição', 'Docto', 'Situação', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
      ['01/05/2026', 'SALDO ANTERIOR', '', '', '', '', '1.000,00'],
      ['03/05/2026', 'PIX RECEBIDO   Ciclano de Souza', '000123', 'Efetivada', '250,00', '', '1.250,00'],
      ['05/05/2026', 'PIX ENVIADO   Beltrano da Silva', '000124', 'Efetivada', '', '-100,00', '1.150,00'],
      ['TOTAL', '', '', '', '250,00', '-100,00', ''],
    ];
    const { statement, checksum } = parseLinhasExtrato(linhas, 'acc_1', 'extrato.xls');
    assertEqual(statement.saldoFinal, 1150);
    assert(checksum.ok, JSON.stringify(checksum));
  });
});
