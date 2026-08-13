import { describe, it, assert, assertEqual } from './harness.js';
import { parseLancamentosPlanilha, parseNatureza, marcarPossiveisDuplicatas } from '../src/importers/lancamentos-xlsx.js';
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

  // Bug real (2026-08-13, planilha do usuario): quem preenche a data como
  // DATA DE VERDADE no Excel tinha a linha PULADA, enquanto quem digitava
  // como texto funcionava — o oposto do esperado. A leitura convertia a
  // celula para a string de exibicao do arquivo ("7/5/26": sem zero a
  // esquerda, ano de 2 digitos e ambigua entre dia e mes, dependendo do
  // locale de quem salvou), e o regex exigia dd/mm/aaaa.
  it('aceita celula de data DE VERDADE do Excel (objeto Date), nao so texto', () => {
    const matriz = [cabecalho, [new Date(2026, 6, 5), 'Teste 1', '30,30', 'Alimentação', 'Dinheiro', 'Gasto']];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(transacoes[0].data, '2026-07-05', '5 de julho, nao 7 de maio');
  });

  it('data como Date usa componentes locais — nunca recua um dia por fuso', () => {
    // toISOString() converteria para UTC e, num fuso negativo (Brasil), uma
    // data a meia-noite local viraria o dia anterior.
    const matriz = [cabecalho, [new Date(2026, 0, 1), 'Ano novo', '10,00', 'Alimentação', 'Dinheiro', 'Gasto']];
    const { transacoes } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(transacoes[0].data, '2026-01-01');
  });

  it('aceita valor numerico puro (celula formatada como numero/moeda no Excel)', () => {
    // Com cellDates/raw, uma celula de numero chega como number, nao string:
    // parseMoneyBR receberia 30.3 e nao entenderia o ponto decimal.
    const matriz = [cabecalho, ['05/07/2026', 'Teste', 30.3, 'Alimentação', 'Dinheiro', 'Gasto']];
    const { transacoes, avisos } = parseLancamentosPlanilha(matriz, ctx);
    assertEqual(avisos.length, 0, avisos.join(' | '));
    assertEqual(transacoes[0].valor, 30.3);
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

// Esta importacao grava DIRETO, sem os baldes da conciliacao onde daria pra
// revisar o casamento depois — reimportar o mesmo arquivo (ou dois arquivos
// com meses sobrepostos) criava copias em silencio.
describe('lancamentos-xlsx: marcarPossiveisDuplicatas', () => {
  const existentes = [
    { id: 't1', data: '2026-07-05', valor: 30.3, descricao: 'Teste 1' },
    { id: 't2', data: '2026-07-08', valor: 45.45, descricao: 'Mercado' },
  ];

  it('marca lancamento com mesma data e mesmo valor', () => {
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-05', valor: 30.3, descricao: 'Teste 1' }], existentes);
    assert(r[0].possivelDuplicata !== null, 'deveria marcar');
    assertEqual(r[0].possivelDuplicata.descricaoIgual, true);
    assertEqual(r[0].possivelDuplicata.existente.id, 't1');
  });

  it('nao marca quando a data OU o valor diferem', () => {
    const r = marcarPossiveisDuplicatas([
      { data: '2026-07-06', valor: 30.3, descricao: 'Teste 1' },
      { data: '2026-07-05', valor: 31.0, descricao: 'Teste 1' },
    ], existentes);
    assertEqual(r[0].possivelDuplicata, null, 'data diferente nao e duplicata');
    assertEqual(r[1].possivelDuplicata, null, 'valor diferente nao e duplicata');
  });

  it('marca mesmo com descricao diferente, mas sinaliza que ela NAO bate', () => {
    // Quem monta planilha a mao raramente escreve a descricao igual duas
    // vezes; o objetivo e avisar, nao bloquear — mas a tela precisa poder
    // distinguir "quase certamente duplicata" de "pode ser coincidencia".
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-08', valor: 45.45, descricao: 'Supermercado ABC' }], existentes);
    assert(r[0].possivelDuplicata !== null);
    assertEqual(r[0].possivelDuplicata.descricaoIgual, false);
  });

  it('compara descricao ignorando acento e caixa', () => {
    const r = marcarPossiveisDuplicatas(
      [{ data: '2026-07-01', valor: 10, descricao: 'ALMOCO' }],
      [{ id: 'x', data: '2026-07-01', valor: 10, descricao: 'Almoço' }]
    );
    assertEqual(r[0].possivelDuplicata.descricaoIgual, true);
  });

  it('ignora previsoes de parcela — ainda nao sao gasto lancado', () => {
    const comPrevisao = [{ id: 'p1', data: '2026-07-05', valor: 30.3, descricao: 'Parcela prevista', previsto: true }];
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-05', valor: 30.3, descricao: 'Teste' }], comPrevisao);
    assertEqual(r[0].possivelDuplicata, null);
  });

  it('valor negativo casa com o positivo equivalente (o app grava sempre positivo)', () => {
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-05', valor: 30.3, descricao: 'X' }],
      [{ id: 'n1', data: '2026-07-05', valor: -30.3, descricao: 'X' }]);
    assert(r[0].possivelDuplicata !== null);
  });

  it('lista vazia de existentes nao marca nada e nao quebra', () => {
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-05', valor: 10, descricao: 'X' }], []);
    assertEqual(r[0].possivelDuplicata, null);
    assertEqual(marcarPossiveisDuplicatas([], null).length, 0);
  });

  it('conta quantos existentes casam, para a tela poder avisar', () => {
    const dois = [
      { id: 'a', data: '2026-07-05', valor: 5, descricao: 'Café' },
      { id: 'b', data: '2026-07-05', valor: 5, descricao: 'Café' },
    ];
    const r = marcarPossiveisDuplicatas([{ data: '2026-07-05', valor: 5, descricao: 'Café' }], dois);
    assertEqual(r[0].possivelDuplicata.quantas, 2);
  });
});
