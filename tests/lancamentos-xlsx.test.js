import { describe, it, assert, assertEqual } from './harness.js';
import { parseLancamentosPlanilha, parseNatureza } from '../src/importers/lancamentos-xlsx.js';
import { COLUNAS_LANCAMENTOS } from '../src/importers/modelos-planilha.js';
import { CATEGORIA_A_CLASSIFICAR } from '../src/domain/categories.js';

// Cadastros reais o suficiente para o parse resolver nome -> id.
const categorias = [
  { id: 'cat_alim', nome: 'Alimentação' },
  { id: CATEGORIA_A_CLASSIFICAR, nome: 'A Classificar' },
];
const formas = [
  { id: 'pm_dinheiro', nome: 'Dinheiro', tipo: 'dinheiro' },
  { id: 'pm_credito', nome: 'Cartão de Crédito', tipo: 'credito', contaPadraoId: 'acc_visa' },
];
const contas = [{ id: 'acc_visa', nome: 'Visa', tipo: 'cartao' }];

const ctx = { categorias, formas, contas };
const cabecalho = COLUNAS_LANCAMENTOS;

describe('lancamentos-xlsx: parseNatureza', () => {
  it('aceita o rotulo curto do modelo de planilha', () => {
    assertEqual(parseNatureza('Gasto'), 'despesa');
    assertEqual(parseNatureza('Receita'), 'receita');
    assertEqual(parseNatureza('Transferência'), 'transferencia');
    assertEqual(parseNatureza('Pagamento de fatura'), 'pagamento_fatura');
  });

  it('aceita o valor interno e o rotulo longo que o app mostra nos seletores', () => {
    // Quem copia da tela do app nao deve ser punido por isso.
    assertEqual(parseNatureza('despesa'), 'despesa');
    assertEqual(parseNatureza('Recebimento (não conta como gasto)'), 'receita');
    assertEqual(parseNatureza('Transferência entre contas próprias'), 'transferencia');
  });

  it('coluna vazia vira despesa (o caso esmagadoramente mais comum)', () => {
    assertEqual(parseNatureza(''), 'despesa');
    assertEqual(parseNatureza(null), 'despesa');
  });

  it('texto desconhecido devolve null, para a linha ser pulada com aviso', () => {
    assertEqual(parseNatureza('qualquer coisa'), null);
  });
});

describe('lancamentos-xlsx: parseLancamentosPlanilha', () => {
  it('converte uma linha valida em transacao pronta para gravar', () => {
    const matriz = [cabecalho, ['05/07/2026', 'Almoço', '35,00', 'Alimentação', 'Dinheiro', 'Gasto']];
    const { transacoes, avisos, erros } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(erros.length, 0);
    assertEqual(avisos.length, 0);
    assertEqual(transacoes.length, 1);
    const t = transacoes[0];
    assertEqual(t.data, '2026-07-05');
    assertEqual(t.descricao, 'Almoço');
    assertEqual(t.valor, 35);
    assertEqual(t.categoria, 'cat_alim');
    assertEqual(t.formaPagamentoId, 'pm_dinheiro');
    assertEqual(t.natureza, 'despesa');
    assert(t.importadoDePlanilha === true, 'marca a procedencia do lote');
  });

  it('casa categoria/forma ignorando acento e caixa', () => {
    // "Alimentacao" sem cedilha/til na planilha tem que achar "Alimentação".
    const matriz = [cabecalho, ['05/07/2026', 'X', '10,00', 'alimentacao', 'DINHEIRO', 'Gasto']];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(transacoes[0].categoria, 'cat_alim');
    assertEqual(transacoes[0].formaPagamentoId, 'pm_dinheiro');
  });

  it('herda a conta padrao da forma — sem contaId, gasto de cartao nunca concilia', () => {
    const matriz = [cabecalho, ['05/07/2026', 'Compra', '99,00', 'Alimentação', 'Cartão de Crédito', 'Gasto']];
    const { transacoes } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes[0].contaId, 'acc_visa');
  });

  it('categoria em branco cai em "A Classificar" em vez de recusar a linha', () => {
    const matriz = [cabecalho, ['05/07/2026', 'Sem categoria', '10,00', '', 'Dinheiro', 'Gasto']];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(avisos.length, 0);
    assertEqual(transacoes[0].categoria, CATEGORIA_A_CLASSIFICAR);
  });

  it('categoria/forma NAO cadastrada pula a linha com aviso, sem criar cadastro novo', () => {
    // Criar cadastro a partir de texto solto encheria o app de duplicatas
    // quase-iguais sem o usuario perceber.
    const matriz = [
      cabecalho,
      ['05/07/2026', 'A', '10,00', 'Categoria Inexistente', 'Dinheiro', 'Gasto'],
      ['06/07/2026', 'B', '10,00', 'Alimentação', 'Forma Inexistente', 'Gasto'],
    ];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes.length, 0);
    assertEqual(avisos.length, 2);
    assert(avisos[0].includes('não está cadastrada'), avisos[0]);
  });

  it('uma linha ruim nao derruba as boas', () => {
    const matriz = [
      cabecalho,
      ['data-ruim', 'A', '10,00', 'Alimentação', 'Dinheiro', 'Gasto'],
      ['06/07/2026', 'B', '20,00', 'Alimentação', 'Dinheiro', 'Gasto'],
    ];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes.length, 1);
    assertEqual(transacoes[0].descricao, 'B');
    assertEqual(avisos.length, 1);
    assert(avisos[0].includes('Linha 2'), 'o aviso cita a linha como o usuario ve no Excel');
  });

  it('linha totalmente vazia e ignorada em silencio (nao vira aviso)', () => {
    const matriz = [cabecalho, ['', '', '', '', '', ''], ['06/07/2026', 'B', '20,00', 'Alimentação', 'Dinheiro', 'Gasto']];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes.length, 1);
    assertEqual(avisos.length, 0);
  });

  it('valor sempre positivo: o sentido vem da natureza, nao do sinal', () => {
    const matriz = [cabecalho, ['05/07/2026', 'Estorno', '-50,00', 'Alimentação', 'Dinheiro', 'Receita']];
    const { transacoes } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes[0].valor, 50);
    assertEqual(transacoes[0].natureza, 'receita');
  });

  it('cabecalho fora do modelo vira ERRO (nao aviso) e nao importa nada', () => {
    // Colunas trocadas seriam lidas "com sucesso" e gravariam descricao no
    // lugar do valor — falhar cedo e melhor que importar lixo.
    const matriz = [['Descrição', 'Data', 'Valor'], ['A', '05/07/2026', '10,00']];
    const { transacoes, erros } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes.length, 0);
    assertEqual(erros.length, 1);
    assert(erros[0].includes('modelo'), erros[0]);
  });
});
