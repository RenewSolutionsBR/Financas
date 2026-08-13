import { describe, it, assert, assertEqual } from './harness.js';
import {
  matrizDoModelo, ajudaDoModelo, tiposDeModelo, tipoDoMarcador,
  COLUNAS_FATURA, COLUNAS_EXTRATO, COLUNAS_LANCAMENTOS, MAPEAMENTO_MODELO,
} from '../src/importers/modelos-planilha.js';
import { parseLinhasGenerico } from '../src/importers/generic-table.js';

describe('modelos-planilha: estrutura dos modelos', () => {
  it('os tres modelos pedidos existem', () => {
    const tipos = tiposDeModelo();
    ['fatura', 'extrato', 'lancamentos'].forEach((t) => assert(tipos.includes(t), `falta o modelo ${t}`));
  });

  it('a primeira linha e o marcador, a segunda o cabecalho, depois os exemplos', () => {
    ['fatura', 'extrato', 'lancamentos'].forEach((tipo) => {
      const m = matrizDoModelo(tipo);
      assert(m.length > 2, `modelo ${tipo} precisa de marcador, cabecalho e ao menos um exemplo`);
      assertEqual(tipoDoMarcador(m), tipo, `${tipo}: marcador precisa identificar o proprio tipo`);
      assert(Array.isArray(m[1]), 'cabecalho e um array de titulos');
    });
  });

  it('todas as linhas de exemplo tem o mesmo numero de colunas do cabecalho', () => {
    ['fatura', 'extrato', 'lancamentos'].forEach((tipo) => {
      const [, cabecalho, ...exemplos] = matrizDoModelo(tipo);
      exemplos.forEach((linha, i) => {
        assertEqual(linha.length, cabecalho.length, `${tipo}: exemplo ${i} tem numero de colunas diferente do cabecalho`);
      });
    });
  });

  // O marcador existe porque, sem ele, os tres modelos eram detectados como
  // "Extrato Santander (.xls)" — aquele detector da 0.3 para qualquer
  // planilha com "Data" na coluna 0 e "Descri..." na coluna 1, exatamente o
  // cabecalho dos modelos, contra 0.05 do adaptador generico. A importacao
  // morria em "nao encontrei o cabecalho de tabela do extrato" (bug real
  // relatado 2026-08-13).
  it('tipoDoMarcador reconhece cada modelo e ignora planilha comum', () => {
    assertEqual(tipoDoMarcador(matrizDoModelo('fatura')), 'fatura');
    assertEqual(tipoDoMarcador(matrizDoModelo('extrato')), 'extrato');
    assertEqual(tipoDoMarcador(matrizDoModelo('lancamentos')), 'lancamentos');
    assertEqual(tipoDoMarcador([['Data', 'Descrição', 'Valor']]), null, 'planilha do banco nao e modelo');
    assertEqual(tipoDoMarcador([]), null);
    assertEqual(tipoDoMarcador(null), null);
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

// Regressao do bug relatado em 2026-08-13: o usuario escolheu
// modelo-fatura.xlsx e a tela veio com "Extrato Santander (.xls)"
// pre-selecionado, falhando com "nao encontrei o cabecalho de tabela do
// extrato". Os dois adaptadores aceitam .xlsx, entao quem decide e a
// pontuacao de `detectar` — e o detector do extrato da 0.3 para qualquer
// planilha com "Data" na coluna 0 e "Descri..." na coluna 1, que era
// exatamente o cabecalho dos modelos, contra 0.05 do generico.
//
// A deteccao real le o arquivo binario (precisa de XLSX, so no navegador);
// aqui testamos a REGRA que decide, contra a matriz — que e onde mora o
// bug: se o marcador nao identificar o modelo, o generico volta a perder.
describe('modelos-planilha: marcador desempata a deteccao de adaptador', () => {
  it('a matriz do modelo e reconhecida, a de um extrato de banco nao', () => {
    // Cabecalho identico ao que o detector do Santander pontua com 0.3.
    const comoExtratoDeBanco = [['Data', 'Descrição', 'Valor', 'Documento'], ['01/07/2026', 'X', '-10,00', '1']];
    assertEqual(tipoDoMarcador(comoExtratoDeBanco), null, 'planilha sem marcador nao pode ser reivindicada');
    assertEqual(tipoDoMarcador(matrizDoModelo('extrato')), 'extrato', 'o modelo do app precisa se identificar');
  });

  it('o marcador sobrevive a maiuscula/minuscula e espaco extra do Excel', () => {
    const [linhaMarcador, ...resto] = matrizDoModelo('fatura');
    const bagunçado = [['  ' + String(linhaMarcador[0]).toLowerCase() + '  '], ...resto];
    assertEqual(tipoDoMarcador(bagunçado), 'fatura');
  });
});
