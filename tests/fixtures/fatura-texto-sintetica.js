// Linhas de texto sintéticas no formato que extractLines() produz — não são
// derivadas de nenhuma fatura real. Servem só para exercitar o parser contra
// a estrutura documentada na spec (6.4), com dados 100% fictícios.
export const LINHAS_FATURA_SINTETICA = [
  'até 25/05',
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 5678',
  'Parcelamentos',
  'Compra Data Descrição Parcela R$ US$',
  '20/04 20/04 LOJA MOVEIS EXEMPLO 02/06 150,00',
  'VALOR TOTAL 150,00',
  'Despesas',
  '22/04 22/04 SUPERMERCADO EXEMPLO 320,50',
  '23/04 23/04 FARMACIA EXEMPLO 45,00',
  'VALOR TOTAL 365,50',
  'Pagamento e Demais Créditos',
  '10/04 10/04 DEB AUTOM DE FATURA EM C/ 890,00',
  'VALOR TOTAL 890,00',
  'Resumo da Fatura',
];
