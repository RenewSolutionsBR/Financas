// Modelos (templates) de planilha para importar fatura, extrato e
// lançamentos sem depender de um adaptador dedicado ao banco.
//
// Por que existem: o adaptador genérico (generic-table.js) sempre aceitou
// .csv/.xls/.xlsx, mas exigia que o usuário informasse À MÃO o número da
// coluna de cada dado ("coluna 0 = Data, coluna 1 = Descrição..."). Quem
// monta a planilha do zero não tem por que adivinhar essa ordem. Baixando um
// modelo já no formato certo, o mapeamento fica implícito e o import vira
// só escolher o arquivo.
//
// A ORDEM DAS COLUNAS AQUI É CONTRATO: `MAPEAMENTO_MODELO` abaixo é o que a
// tela de importação usa quando o usuário diz que a planilha veio de um
// modelo. Mudar a ordem de uma constante sem mudar a outra quebra a leitura
// silenciosamente (as colunas passam a ser lidas trocadas, sem erro nenhum),
// por isso as duas moram lado a lado neste arquivo.

// Cabeçalhos por tipo de modelo. A primeira linha do arquivo é sempre
// cabeçalho (temCabecalho: true no mapeamento correspondente).
export const COLUNAS_FATURA = ['Data', 'Descrição', 'Valor', 'Parcela'];
export const COLUNAS_EXTRATO = ['Data', 'Descrição', 'Valor', 'Documento'];
export const COLUNAS_LANCAMENTOS = ['Data', 'Descrição', 'Valor', 'Categoria', 'Forma de pagamento', 'Natureza'];

// Índice de cada coluna nos modelos acima — o "mapeamento" que o usuário
// teria de preencher à mão se a planilha não viesse de um modelo.
export const MAPEAMENTO_MODELO = {
  fatura: { colData: 0, colDescricao: 1, colValor: 2, colParcela: 3, colDocumento: null, temCabecalho: true, escopo: 'fatura' },
  extrato: { colData: 0, colDescricao: 1, colValor: 2, colDocumento: 3, colParcela: null, temCabecalho: true, escopo: 'extrato' },
};

// Linhas de exemplo: mostram o FORMATO esperado de cada célula (data
// dd/mm/aaaa, valor com vírgula decimal, parcela "3/10") sem o usuário
// precisar ler documentação. São dados obviamente fictícios de propósito —
// alguém que esqueça de apagá-los percebe na hora da conferência, e nenhum
// deles se parece com um lançamento real.
const EXEMPLOS_FATURA = [
  ['01/07/2026', 'SUPERMERCADO EXEMPLO', '150,00', ''],
  ['02/07/2026', 'LOJA EXEMPLO PARCELADO', '200,00', '3/10'],
];
const EXEMPLOS_EXTRATO = [
  ['01/07/2026', 'PIX ENVIADO FULANO', '-80,00', '111222'],
  ['05/07/2026', 'SALARIO', '5000,00', ''],
];
const EXEMPLOS_LANCAMENTOS = [
  ['01/07/2026', 'Almoço', '35,00', 'Alimentação', 'Dinheiro', 'Gasto'],
  ['02/07/2026', 'Reembolso', '120,00', 'Outros', 'Pix', 'Receita'],
];

// Instruções curtas dentro da própria planilha, numa segunda aba: o arquivo
// viaja sozinho (o usuário preenche fora do app, talvez noutro aparelho),
// então a explicação precisa viajar junto — um texto só na tela do app não
// estaria presente na hora de preencher.
const AJUDA_COMUM = [
  ['Como preencher'],
  [''],
  ['1. Não mude a ordem nem o nome das colunas da primeira aba.'],
  ['2. Apague as linhas de exemplo antes de importar.'],
  ['3. Data no formato dd/mm/aaaa (ex.: 05/07/2026).'],
  ['4. Valor com vírgula nos centavos (ex.: 1.234,56). Não use "R$".'],
];

const AJUDA_POR_TIPO = {
  fatura: [
    ...AJUDA_COMUM,
    ['5. Valor: use número positivo para compras. Crédito/estorno com sinal negativo.'],
    ['6. Parcela: só para compra parcelada, no formato 3/10 (parcela 3 de 10).'],
    ['   Compra à vista: deixe a célula vazia.'],
    ['   IMPORTANTE: formate a coluna Parcela como TEXTO antes de digitar.'],
    ['   Sem isso o Excel entende "3/10" como a data 3 de outubro.'],
    [''],
    ['A data de vencimento da fatura é informada no app, na hora de importar.'],
  ],
  extrato: [
    ...AJUDA_COMUM,
    ['5. Valor: negativo para saídas (débitos), positivo para entradas (créditos).'],
    ['6. Documento é opcional — pode deixar em branco.'],
  ],
  lancamentos: [
    ...AJUDA_COMUM,
    ['5. Valor: sempre positivo. Quem define entrada/saída é a coluna Natureza.'],
    ['6. Categoria e Forma de pagamento: escreva exatamente como estão'],
    ['   cadastradas no app (Cadastros). Se não existir, o app avisa e não importa.'],
    ['7. Natureza: Gasto, Receita, Transferência ou Pagamento de fatura.'],
    [''],
    ['Estes lançamentos entram direto na aba Lançamentos, sem conciliação.'],
  ],
};

const MODELOS = {
  fatura: { colunas: COLUNAS_FATURA, exemplos: EXEMPLOS_FATURA, aba: 'Fatura', arquivo: 'modelo-fatura' },
  extrato: { colunas: COLUNAS_EXTRATO, exemplos: EXEMPLOS_EXTRATO, aba: 'Extrato', arquivo: 'modelo-extrato' },
  lancamentos: { colunas: COLUNAS_LANCAMENTOS, exemplos: EXEMPLOS_LANCAMENTOS, aba: 'Lancamentos', arquivo: 'modelo-lancamentos' },
};

export function tiposDeModelo() {
  return Object.keys(MODELOS);
}

// Pura: devolve a matriz (array de arrays) da aba principal do modelo —
// cabeçalho + exemplos. Testável sem XLSX nem DOM.
export function matrizDoModelo(tipo) {
  const modelo = MODELOS[tipo];
  if (!modelo) throw new Error(`Modelo desconhecido: ${tipo}`);
  return [modelo.colunas, ...modelo.exemplos];
}

export function ajudaDoModelo(tipo) {
  const ajuda = AJUDA_POR_TIPO[tipo];
  if (!ajuda) throw new Error(`Modelo desconhecido: ${tipo}`);
  return ajuda;
}

// Gera o .xlsx e dispara o download. Depende de XLSX (global, vendorizado) e
// do DOM, por isso fica fora das funções puras acima.
export function baixarModelo(tipo) {
  const modelo = MODELOS[tipo];
  if (!modelo) throw new Error(`Modelo desconhecido: ${tipo}`);

  const wb = XLSX.utils.book_new();
  const aba = XLSX.utils.aoa_to_sheet(matrizDoModelo(tipo));
  // Larguras generosas na coluna de descrição: sem isso o Excel abre tudo
  // com ~8 caracteres e o usuário vê "SUPERMERCA###" no exemplo.
  aba['!cols'] = modelo.colunas.map((c) => ({ wch: c === 'Descrição' ? 34 : 18 }));
  XLSX.utils.book_append_sheet(wb, aba, modelo.aba);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ajudaDoModelo(tipo)), 'Instruções');
  XLSX.writeFile(wb, `${modelo.arquivo}.xlsx`);
}
