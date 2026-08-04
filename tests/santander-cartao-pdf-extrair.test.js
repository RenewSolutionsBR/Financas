// Testes de extractLines com um `doc`/`page` FALSO — extractLines só usa a
// interface minima (numPages, getPage(n).getTextContent()->{items}), entao
// da pra testar em Node sem abrir PDF nenhum e sem pdf.js de verdade. Dados
// 100% sinteticos/ficticios, no mesmo espirito de tests/fixtures/fatura-texto-sintetica.js.
import { describe, it, assert, assertEqual } from './harness.js';
import { extractLines } from '../src/importers/santander-cartao-pdf-extrair.js';
import { parseFaturaTexto } from '../src/importers/santander-cartao-pdf.js';

const VENCIMENTO = new Date(2026, 4, 1);

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}
function fakePage(items) {
  return { getTextContent: async () => ({ items }) };
}
function fakeDoc(paginas) {
  return { numPages: paginas.length, getPage: async (n) => paginas[n - 1] };
}

describe('santander-cartao-pdf-extrair: extractLines — pagina 1 sem "Detalhamento" (caso medido nas 3 faturas reais)', () => {
  it('conteudo cru da pagina 1 (ex: rotulo Vencimento) aparece, e o lancamento da pagina 2 aparece uma unica vez', async () => {
    const pagina1 = fakePage([
      item('Vencimento: 25/06/2026', 10, 100),
    ]);
    const pagina2 = fakePage([
      item('Detalhamento da Fatura', 10, 100),
      item('TITULAR EXEMPLO - 1234 XXXX XXXX 9999', 10, 90),
      item('Despesas', 10, 80),
      item('05/04 05/04 LOJA EXEMPLO UM 10,00', 10, 70),
      item('VALOR TOTAL 10,00', 10, 60),
      item('Resumo da Fatura', 10, 50),
    ]);
    const doc = fakeDoc([pagina1, pagina2]);
    const linhas = await extractLines(doc);
    assert(linhas.some((l) => l.includes('Vencimento: 25/06/2026')), 'conteudo cru da pagina 1 precisa aparecer no array');
    const ocorrencias = linhas.filter((l) => l.includes('LOJA EXEMPLO UM')).length;
    assertEqual(ocorrencias, 1, 'o lancamento da pagina 2 nao pode aparecer mais de uma vez');
  });
});

describe('santander-cartao-pdf-extrair: extractLines — "Detalhamento da Fatura" comecando JA na pagina 1 (nao medido nas 3 Mastercard, mas o adaptador tambem se declara pra Visa)', () => {
  it('pagina 1 processada uma unica vez: lancamento dela nao duplica, mesmo tendo sido reconstruida crua', async () => {
    const pagina1 = fakePage([
      item('Detalhamento da Fatura', 10, 100),
      item('TITULAR EXEMPLO - 1234 XXXX XXXX 9999', 10, 90),
      item('Despesas', 10, 80),
      item('05/04 05/04 LOJA EXEMPLO UM 10,00', 10, 70),
      item('VALOR TOTAL 10,00', 10, 60),
    ]);
    const pagina2 = fakePage([
      item('Despesas', 10, 100),
      item('06/04 06/04 LOJA EXEMPLO DOIS 20,00', 10, 90),
      item('VALOR TOTAL 20,00', 10, 80),
      item('Resumo da Fatura', 10, 70),
    ]);
    const doc = fakeDoc([pagina1, pagina2]);
    const linhas = await extractLines(doc);

    const ocorrenciasUm = linhas.filter((l) => l.includes('LOJA EXEMPLO UM')).length;
    assertEqual(ocorrenciasUm, 1, 'o lancamento da pagina 1 (onde o detalhamento ja comeca) nao pode aparecer 2x');

    const { rows, checksum } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    assertEqual(rows.length, 2, 'exatamente 2 lancamentos (1 por pagina), nao 3 — sem a linha duplicada da pagina 1');
    assert(checksum.ok, JSON.stringify(checksum.sections));
    const totais = checksum.sections.filter((s) => s.ok !== null).map((s) => s.computed).sort((a, b) => a - b);
    assertEqual(totais.length, 2);
    assertEqual(totais[0], 10);
    assertEqual(totais[1], 20);
  });

  it('fatura inteira cabe na pagina 1 ("Resumo da Fatura" ja na pagina 1): nao tenta ler pagina 2', async () => {
    let pagina2Chamada = false;
    const pagina1 = fakePage([
      item('Detalhamento da Fatura', 10, 100),
      item('TITULAR EXEMPLO - 1234 XXXX XXXX 9999', 10, 90),
      item('Despesas', 10, 80),
      item('05/04 05/04 LOJA EXEMPLO UNICA 10,00', 10, 70),
      item('VALOR TOTAL 10,00', 10, 60),
      item('Resumo da Fatura', 10, 50),
    ]);
    const doc = {
      numPages: 2,
      getPage: async (n) => {
        if (n === 2) pagina2Chamada = true;
        return n === 1 ? pagina1 : fakePage([]);
      },
    };
    const linhas = await extractLines(doc);
    assert(!pagina2Chamada, 'com "Resumo da Fatura" ja na pagina 1, nao deveria nem tentar ler a pagina 2');
    const { rows } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    assertEqual(rows.length, 1);
  });
});
