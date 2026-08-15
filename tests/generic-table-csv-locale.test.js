// Bug real (2026-08-15): extrato de outro banco (sem adaptador dedicado,
// importado pela planilha genérica) em CSV vinha com valor e data trocados —
// "-16.000,00" virava R$ 16,00 e "02/07/2026" virava outra data. A causa não
// era parseMoneyBR/dataParaISO (que já lidam bem com texto BR): era o
// XLSX.read do CSV tentando ADIVINHAR se cada célula de texto era número ou
// data antes de qualquer parser do app ver o valor, usando convenção
// AMERICANA (ponto decimal) — corrompendo "-16.000,00" para -16 e a data
// dd/mm para um serial errado. Fix em lerMatriz (generic-table.js): CSV passa
// `raw: true` no XLSX.read para preservar o texto original da célula, exatamente
// o formato que parseMoneyBR/dataParaISO já sabem interpretar. Este teste só
// roda no Node (precisa do XLSX real, não dos harness browser-only) e usa uma
// amostra sintética (tests/fixtures/extrato-csv-locale-br.js) — nenhum dado
// do arquivo original do usuário está aqui.
import { describe, it, assertEqual, assert } from './harness.js';
import { EXTRATO_CSV_LOCALE_BR } from './fixtures/extrato-csv-locale-br.js';

// No navegador, XLSX já existe como global (tools/tests.html carrega via
// <script>). Só no Node é preciso o require() do bundle vendorizado — e só
// aqui, dentro do galho que nunca executa no navegador, para não quebrar o
// parse do módulo lá (import 'module' não existe fora do Node).
if (typeof globalThis.XLSX === 'undefined') {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  globalThis.XLSX = require('../vendor/xlsx.full.min.js');
}

const { lerMatriz, parseLinhasGenerico } = await import('../src/importers/generic-table.js');

describe('generic-table: CSV com locale BR (bug real de valor e data trocados)', () => {
  it('lerMatriz preserva texto BR original da célula de valor, sem reinterpretar como numero americano', async () => {
    const buffer = new TextEncoder().encode(EXTRATO_CSV_LOCALE_BR);
    const matriz = await lerMatriz(buffer.buffer, 'extrato.csv');
    const linhaPix = matriz.find((l) => String(l[1] || '').includes('Fulano de Tal'));
    assertEqual(linhaPix[2], '-16.000,00', 'a celula de valor tem que continuar em texto BR, nao virar numero truncado');
    assertEqual(linhaPix[0], '02/07/2026', 'a celula de data tem que continuar em texto dd/mm/aaaa, nao virar serial/outra data');
  });

  it('parseLinhasGenerico interpreta -16.000,00 como dezesseis mil reais, nao dezesseis reais', async () => {
    const buffer = new TextEncoder().encode(EXTRATO_CSV_LOCALE_BR);
    const matriz = await lerMatriz(buffer.buffer, 'extrato.csv');
    const dados = matriz.slice(5); // pula bloco de cabecalho (conta/periodo/saldo) + linha de titulos
    const mapeamento = { colData: 0, colDescricao: 1, colValor: 2, temCabecalho: true, escopo: 'extrato' };
    const { rows, avisos } = parseLinhasGenerico(dados, mapeamento, 'acc_teste', 'extrato.csv');
    assertEqual(avisos.length, 0, avisos.join(' | '));

    const pix = rows.find((r) => r.descricao.includes('Fulano de Tal'));
    assertEqual(pix.valor, 16000, 'R$ 16.000,00, nao R$ 16,00');
    assertEqual(pix.sinal, 'debito');
    assertEqual(pix.data, '2026-07-02', 'dia 2 de julho, dia e mes nao podem inverter');

    const pagamento = rows.find((r) => r.descricao.includes('Loja Exemplo'));
    assertEqual(pagamento.valor, 222.17, 'R$ 222,17, nao R$ 22.217,00');
  });

  it('valor positivo com milhar BR tambem preserva o texto original', async () => {
    const buffer = new TextEncoder().encode(EXTRATO_CSV_LOCALE_BR);
    const matriz = await lerMatriz(buffer.buffer, 'extrato.csv');
    const dados = matriz.slice(5);
    const mapeamento = { colData: 0, colDescricao: 1, colValor: 2, temCabecalho: true, escopo: 'extrato' };
    const { rows } = parseLinhasGenerico(dados, mapeamento, 'acc_teste', 'extrato.csv');
    const resgate = rows.find((r) => r.descricao.includes('Aplicacao Exemplo'));
    assertEqual(resgate.valor, 3000);
    assertEqual(resgate.sinal, 'credito');
  });
});
