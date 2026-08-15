// Amostra sintética (dados fictícios) do mesmo FORMATO de um CSV real de
// extrato bancário de um banco sem adaptador dedicado (2026-08-15): cabeçalho
// de conta antes da tabela, separador `;`, datas `dd/mm/aaaa` e valores no
// padrão BR (`.` milhar, `,` decimal). O bug reproduzido era só de FORMATO —
// nenhum dado do arquivo original do usuário está aqui.
export const EXTRATO_CSV_LOCALE_BR = `Extrato Conta Corrente
Conta ;000000000
Período ;01/07/2026 a 31/07/2026
Saldo: ;100,00

Data Lançamento;Descrição;Valor;Saldo
02/07/2026;Pix enviado: "Fulano de Tal";-16.000,00;-15.900,00
06/07/2026;Pagamento efetuado: "Loja Exemplo LTDA";-222,17;-16.122,17
10/07/2026;Resgate: "Aplicacao Exemplo";3.000,00;-13.122,17
`;
