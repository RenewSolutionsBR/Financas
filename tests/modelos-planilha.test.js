import { describe, it, assert, assertEqual } from './harness.js';
import {
  matrizDoModelo, ajudaDoModelo, tiposDeModelo,
  COLUNAS_FATURA, COLUNAS_EXTRATO, COLUNAS_LANCAMENTOS, MAPEAMENTO_MODELO,
} from '../src/importers/modelos-planilha.js';
import { parseLinhasGenerico } from '../src/importers/generic-table.js';

describe('modelos-planilha: estrutura dos modelos', () => {
  it('os tres modelos pedidos existem', () => {
    const tipos = tiposDeModelo();
    ['fatura', 'extrato', 'lancamentos'].forEach((t) => assert(tipos.includes(t), `falta o modelo ${t}`));
  });

  it('a primeira linha de cada modelo e o cabecalho, seguida de exemplos', () => {
    ['fatura', 'extrato', 'lancamentos'].forEach((tipo) => {
      const m = matrizDoModelo(tipo);
      assert(m.length > 1, `modelo ${tipo} precisa de pelo menos uma linha de exemplo`);
      assert(Array.isArray(m[0]), 'cabecalho e um array de titulos');
    });
  });

  it('todas as linhas de exemplo tem o mesmo numero de colunas do cabecalho', () => {
    ['fatura', 'extrato', 'lancamentos'].forEach((tipo) => {
      const [cabecalho, ...exemplos] = matrizDoModelo(tipo);
      exemplos.forEach((linha, i) => {
        assertEqual(linha.length, cabecalho.length, `${tipo}: exemplo ${i} tem numero de colunas diferente do cabecalho`);
      });
    });
  });

  it('cada modelo tem instrucoes de preenchimento', () => {
    ['fatura', 'extrato', 'lancamentos'].forEach((tipo) => {
      assert(ajudaDoModelo(tipo).length > 3, `modelo ${tipo} sem instrucoes suficientes`);
    });
  });

  it('modelo desconhecido falha alto, nao devolve planilha vazia', () => {
    let erro = null;
    try { matrizDoModelo('inexistente'); } catch (e) { erro = e; }
    assert(erro !== null, 'deveria lancar');
  });
});

// O ponto critico deste arquivo: MAPEAMENTO_MODELO diz em qual indice esta
// cada coluna, e COLUNAS_* define a ordem real do arquivo gerado. Se as duas
// constantes sairem de sincronia, a planilha e lida com as colunas TROCADAS
// e sem erro nenhum — descricao viraria valor, e o import gravaria lixo.
describe('modelos-planilha: mapeamento bate com a ordem real das colunas', () => {
  it('fatura: cada indice do mapeamento aponta para a coluna certa', () => {
    const m = MAPEAMENTO_MODELO.fatura;
    assertEqual(COLUNAS_FATURA[m.colData], 'Data');
    assertEqual(COLUNAS_FATURA[m.colDescricao], 'Descrição');
    assertEqual(COLUNAS_FATURA[m.colValor], 'Valor');
    assertEqual(COLUNAS_FATURA[m.colParcela], 'Parcela');
  });

  it('extrato: cada indice do mapeamento aponta para a coluna certa', () => {
    const m = MAPEAMENTO_MODELO.extrato;
    assertEqual(COLUNAS_EXTRATO[m.colData], 'Data');
    assertEqual(COLUNAS_EXTRATO[m.colDescricao], 'Descrição');
    assertEqual(COLUNAS_EXTRATO[m.colValor], 'Valor');
    assertEqual(COLUNAS_EXTRATO[m.colDocumento], 'Documento');
  });

  it('lancamentos: a ordem das colunas e a que o parser assume', () => {
    // parseLancamentosPlanilha desestrutura a linha nesta ordem exata.
    assertEqual(COLUNAS_LANCAMENTOS[0], 'Data');
    assertEqual(COLUNAS_LANCAMENTOS[1], 'Descrição');
    assertEqual(COLUNAS_LANCAMENTOS[2], 'Valor');
    assertEqual(COLUNAS_LANCAMENTOS[3], 'Categoria');
    assertEqual(COLUNAS_LANCAMENTOS[4], 'Forma de pagamento');
    assertEqual(COLUNAS_LANCAMENTOS[5], 'Natureza');
  });
});

// Teste de ida e volta: o modelo GERADO, lido de volta pelo adaptador que vai
// le-lo de verdade na importacao. Pega qualquer divergencia entre o que o app
// escreve e o que ele espera ler, sem depender de arquivo fixture externo.
describe('modelos-planilha: ida e volta (gera o modelo, le com o adaptador real)', () => {
  it('modelo de fatura preenchido e lido com as colunas certas, inclusive a parcela', () => {
    const matriz = matrizDoModelo('fatura');
    const { rows, avisos } = parseLinhasGenerico(matriz, MAPEAMENTO_MODELO.fatura, 'acc_visa', 'modelo-fatura.xlsx');
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(rows.length, 2, 'as duas linhas de exemplo do modelo');
    assertEqual(rows[0].descricao, 'SUPERMERCADO EXEMPLO');
    assertEqual(rows[0].valor, 150);
    assertEqual(rows[0].tipo, null, 'primeira linha e compra a vista');
    assertEqual(rows[1].parcela_atual, 3, 'a coluna Parcela do modelo e lida');
    assertEqual(rows[1].parcela_total, 10);
    assertEqual(rows[1].tipo, 'parcelamento');
  });

  it('modelo de extrato preserva o sinal (saida negativa, entrada positiva)', () => {
    const matriz = matrizDoModelo('extrato');
    const { rows, avisos } = parseLinhasGenerico(matriz, MAPEAMENTO_MODELO.extrato, 'acc_cc', 'modelo-extrato.xlsx');
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(rows[0].sinal, 'debito', 'PIX ENVIADO -80,00 e saida');
    assertEqual(rows[0].valor, 80, 'valor gravado sempre positivo');
    assertEqual(rows[1].sinal, 'credito', 'SALARIO 5000,00 e entrada');
  });
});
