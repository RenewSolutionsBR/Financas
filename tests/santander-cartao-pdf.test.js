import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseFaturaTexto, resolveDate, extrairPeriodoCompras, vencimentoFromText } from '../src/importers/santander-cartao-pdf.js';
import { LINHAS_FATURA_SINTETICA } from './fixtures/fatura-texto-sintetica.js';

const VENCIMENTO = new Date(2026, 4, 1); // 01/05/2026

describe('santander-cartao-pdf: resolveDate', () => {
  it('resolve DD/MM pro ano do vencimento quando a data cai antes (com folga de 5 dias)', () => {
    const d = resolveDate(28, 4, VENCIMENTO);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 3); // abril
  });

  it('resolve pro ano ANTERIOR quando a data (compra parcelada antiga) fica bem depois do vencimento na leitura ingenua', () => {
    // Compra de dezembro, fatura de maio do ano seguinte: sem retroceder o
    // ano, "12/25" cairia DEPOIS do vencimento de maio/2026.
    const d = resolveDate(15, 12, VENCIMENTO);
    assertEqual(d.getFullYear(), 2025);
  });

  it('testa ate 3 anos pra tras antes de desistir e usar o ano do vencimento', () => {
    const d = resolveDate(1, 1, new Date(2020, 0, 10));
    assert(d.getFullYear() <= 2020);
  });
});

describe('santander-cartao-pdf: parseFaturaTexto — nucleo (secoes, checksum, parcela)', () => {
  it('separa parcelamento, despesa avulsa e pagamento/credito nas tres secoes', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const porSecao = (s) => rows.filter((r) => r.secao === s);
    assertEqual(porSecao('despesas').length, 3, '1 parcelamento + 2 despesas avulsas, todas secao despesas');
    assertEqual(porSecao('pagamentos_creditos').length, 1);
  });

  it('linha de "Pagamento e Demais Creditos" NAO e descartada — vem no resultado (diferente do app anterior)', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const pagamento = rows.find((r) => r.secao === 'pagamentos_creditos');
    assert(pagamento, 'a linha de pagamento de fatura precisa estar em rows, nao ser pulada');
    assertEqual(pagamento.sinal, 'credito');
    assertEqual(pagamento.valor, 890);
  });

  it('despesa avulsa vem com sinal debito', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const despesa = rows.find((r) => r.descricao.includes('SUPERMERCADO'));
    assertEqual(despesa.sinal, 'debito');
    assertEqual(despesa.valor, 320.5);
  });

  it('extrai parcela_atual/parcela_total da coluna NN/NN', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const parcelado = rows.find((r) => r.descricao.includes('MOVEIS'));
    assertEqual(parcelado.parcela_atual, 2);
    assertEqual(parcelado.parcela_total, 6);
  });

  it('despesa avulsa (sem coluna de parcela) tem parcela_atual/parcela_total null', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const despesa = rows.find((r) => r.descricao.includes('FARMACIA'));
    assertEqual(despesa.parcela_atual, null);
    assertEqual(despesa.parcela_total, null);
  });

  it('checksum bate quando a soma de cada secao fecha com o VALOR TOTAL impresso', () => {
    const { checksum } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
  });

  it('checksum acusa quando a soma NAO bate', () => {
    const linhasQuebradas = LINHAS_FATURA_SINTETICA.map((l) =>
      l === '22/04 22/04 SUPERMERCADO EXEMPLO 320,50' ? '22/04 22/04 SUPERMERCADO EXEMPLO 999,99' : l
    );
    const { checksum, avisos } = parseFaturaTexto(linhasQuebradas, 'fatura-teste.pdf', VENCIMENTO);
    assert(!checksum.ok);
    assert(avisos.some((a) => /não bate/i.test(a)));
  });

  it('descricaoCanonica vem calculada em toda linha, com escopo fatura', () => {
    const { rows } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assert(rows.every((r) => typeof r.descricaoCanonica === 'string' && r.descricaoCanonica.length > 0));
  });

  it('id de cada linha e determinístico: reparsear o MESMO texto gera os MESMOS ids', () => {
    const r1 = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    const r2 = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    assertDeepEqual(r1.rows.map((r) => r.id), r2.rows.map((r) => r.id));
  });

  it('duas linhas de mesma data/valor/descricao (raro, mas possivel) geram ids DIFERENTES pelo ordinal', () => {
    const linhas = [
      ...LINHAS_FATURA_SINTETICA.slice(0, 5),
      '22/04 22/04 FARMACIA EXEMPLO 45,00',
      '22/04 22/04 FARMACIA EXEMPLO 45,00',
      'VALOR TOTAL 90,00',
      'Resumo da Fatura',
    ];
    const { rows } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    const ids = rows.filter((r) => r.descricao.includes('FARMACIA')).map((r) => r.id);
    assertEqual(ids.length, 2);
    assert(ids[0] !== ids[1], 'sem o ordinal no hash, as duas linhas identicas colidiriam no mesmo id e uma sumiria na conciliacao');
  });
});

// Fixture sintetica com DOIS plasticos (titular sem '@', adicional com '@'),
// no formato medido contra as faturas reais (Step 6): cada cartao tem seu
// proprio cabecalho "NOME - BBBB XXXX XXXX FFFF" (adicional prefixado por
// '@ '), cada um com sua propria secao "Despesas". Dados 100% ficticios.
const LINHAS_TITULAR_ADICIONAL = [
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 1111',
  'Despesas',
  '05/04 05/04 LOJA DO TITULAR EXEMPLO 100,00',
  'VALOR TOTAL 100,00',
  '@ ADICIONAL EXEMPLO - 1234 XXXX XXXX 2222',
  'Despesas',
  '06/04 06/04 LOJA DO ADICIONAL EXEMPLO 50,00',
  'VALOR TOTAL 50,00',
  'Resumo da Fatura',
];

describe('santander-cartao-pdf: plastico (titular/adicional)', () => {
  it('cartao sem @ na frente do nome vem marcado como titular', () => {
    const { rows } = parseFaturaTexto(LINHAS_TITULAR_ADICIONAL, 'fatura-teste.pdf', VENCIMENTO);
    const doTitular = rows.find((r) => r.descricao.includes('DO TITULAR'));
    assertEqual(doTitular.plastico, 'titular');
    assertEqual(doTitular.cartaoFinal, '1111');
  });

  it('cartao com @ na frente do nome vem marcado como adicional', () => {
    const { rows } = parseFaturaTexto(LINHAS_TITULAR_ADICIONAL, 'fatura-teste.pdf', VENCIMENTO);
    const doAdicional = rows.find((r) => r.descricao.includes('DO ADICIONAL'));
    assertEqual(doAdicional.plastico, 'adicional');
    assertEqual(doAdicional.cartaoFinal, '2222');
  });

  it('checksum fecha por cartao mesmo com dois plasticos na mesma fatura', () => {
    const { checksum } = parseFaturaTexto(LINHAS_TITULAR_ADICIONAL, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
  });
});

// Fixture sintetica reproduzindo a divergencia medida contra as faturas reais
// (Step 6): a secao "Pagamento e Demais Creditos" tem 1 lancamento e a
// fatura NAO imprime "VALOR TOTAL" pra ela — a secao "Despesas" comeca
// direto em seguida. Sem o reset de sectionSum na transicao de secao, a
// soma do pagamento vazava pra dentro da soma de Despesas e o checksum
// acusava um erro que nao existia.
const LINHAS_SECAO_SEM_TOTAL = [
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 3333',
  'Pagamento e Demais Créditos',
  '10/04 10/04 DEB AUTOM DE FATURA EM C/ 200,00',
  'Despesas',
  '12/04 12/04 LOJA EXEMPLO SEM TOTAL 30,00',
  'VALOR TOTAL 30,00',
  'Resumo da Fatura',
];

describe('santander-cartao-pdf: secao sem "VALOR TOTAL" proprio nao contamina a secao seguinte', () => {
  it('checksum fecha considerando so a secao que TEM total impresso (Despesas), ignorando o pagamento sem total', () => {
    const { checksum, rows } = parseFaturaTexto(LINHAS_SECAO_SEM_TOTAL, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
    assertEqual(checksum.sections.length, 1, 'so a secao Despesas teve "VALOR TOTAL" impresso pra virar entrada de checksum');
    const pagamento = rows.find((r) => r.secao === 'pagamentos_creditos');
    assert(pagamento, 'a linha de pagamento continua aparecendo em rows, mesmo sem "VALOR TOTAL" pra validar a secao dela');
  });
});

describe('santander-cartao-pdf: extrairPeriodoCompras', () => {
  it('escolhe a faixa cujo FIM bate com a dataCorte, entre quatro faixas', () => {
    const linhas = [
      'Período das compras',
      '26/02/26 a 25/03/26  26/03/26 a 25/04/26  26/04/26 a 25/05/26  26/05/26 a 24/06/26',
    ];
    const resultado = extrairPeriodoCompras(linhas, '2026-05-25');
    assertDeepEqual(resultado, { inicio: '2026-04-26', fim: '2026-05-25' });
  });

  it('nenhuma faixa batendo com o corte devolve null, sem lancar', () => {
    const linhas = ['26/02/26 a 25/03/26'];
    assertEqual(extrairPeriodoCompras(linhas, '2026-12-31'), null);
  });

  it('sem dataCorte conhecida, devolve null direto (nao ha o que comparar)', () => {
    assertEqual(extrairPeriodoCompras(['26/02/26 a 25/03/26'], null), null);
  });
});

describe('santander-cartao-pdf: vencimentoFromText', () => {
  it('acha a data de vencimento pelo rotulo "Vencimento" em linha propria, olhando as 2 linhas seguintes', () => {
    const linhas = ['Fatura', 'Vencimento', 'irrelevante', '25/06/2026', 'resto'];
    const d = vencimentoFromText(linhas);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 5); // junho
    assertEqual(d.getDate(), 25);
  });

  it('acha tambem quando "Vencimento" e a data estao na MESMA linha', () => {
    const d = vencimentoFromText(['Vencimento: 25/06/2026']);
    assertEqual(d.getDate(), 25);
  });

  it('sem nenhum rotulo de vencimento reconhecivel, devolve null', () => {
    assertEqual(vencimentoFromText(['nada aqui']), null);
  });
});
