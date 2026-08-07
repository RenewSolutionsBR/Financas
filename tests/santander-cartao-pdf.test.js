import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { parseFaturaTexto, resolveDate, extrairPeriodoCompras, vencimentoFromText, totalImpressoDeSections } from '../src/importers/santander-cartao-pdf.js';
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
    assertEqual(checksum.sections.length, 2, 'as DUAS secoes aparecem em sections[] agora: a com total (avaliada) e a sem total (nao avaliada, ok:null)');
    assertEqual(checksum.sections.filter((s) => s.ok !== null).length, 1, 'so a secao Despesas foi de fato AVALIADA (ok true/false) — a de pagamento fica com ok:null');
    const semTotal = checksum.sections.find((s) => s.secaoTipo === 'pagamentos_creditos');
    assert(semTotal, 'a secao de pagamento sem "VALOR TOTAL" precisa aparecer em sections[], nao sumir silenciosamente');
    assertEqual(semTotal.ok, null);
    assertEqual(semTotal.expected, null);
    assertEqual(semTotal.nLinhas, 1);
    const pagamento = rows.find((r) => r.secao === 'pagamentos_creditos');
    assert(pagamento, 'a linha de pagamento continua aparecendo em rows, mesmo sem "VALOR TOTAL" pra validar a secao dela');
  });

  it('secao sem total com MAIS DE 1 lancamento gera aviso nao-bloqueante (nLinhas > 1)', () => {
    const linhas = [
      'Detalhamento da Fatura',
      'TITULAR EXEMPLO - 1234 XXXX XXXX 4444',
      'Pagamento e Demais Créditos',
      '10/04 10/04 DEB AUTOM DE FATURA EM C/ 200,00',
      '11/04 11/04 ESTORNO DE COMPRA EXEMPLO 50,00',
      'Despesas',
      '12/04 12/04 LOJA EXEMPLO SEM TOTAL 30,00',
      'VALOR TOTAL 30,00',
      'Resumo da Fatura',
    ];
    const { checksum, avisos } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    const semTotal = checksum.sections.find((s) => s.secaoTipo === 'pagamentos_creditos');
    assertEqual(semTotal.nLinhas, 2);
    assertEqual(semTotal.ok, null);
    assert(avisos.some((a) => /não tem "VALOR TOTAL" impresso/i.test(a)), 'com 2+ lancamentos sem total, precisa avisar (nao e mais o caso benigno de 1 lancamento so)');
  });

  it('secao sem total com 1 lancamento SO (caso observado nas 3 faturas reais) NAO gera aviso', () => {
    const { avisos } = parseFaturaTexto(LINHAS_SECAO_SEM_TOTAL, 'fatura-teste.pdf', VENCIMENTO);
    assert(!avisos.some((a) => /não tem "VALOR TOTAL" impresso/i.test(a)), '1 lancamento sem total e o caso benigno — nao deveria gerar ruido de aviso');
  });
});

// Fixtures sintéticas reproduzindo a divergência medida contra fatura Visa
// real: 'abandonarSecaoAtual()' disparando em toda transição de rótulo de
// seção é agressivo demais quando dois blocos TIPADOS (Parcelamentos e
// Despesas) do mesmo cartão compartilham um único "VALOR TOTAL" impresso no
// fim — ou quando o rótulo 'Despesas' se repete como cabeçalho de
// continuação de página. Dados 100% fictícios.
const LINHAS_PARCELAMENTO_DESPESA_TOTAL_UNICO = [
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 6666',
  'Parcelamentos',
  '20/04 20/04 LOJA MOVEIS EXEMPLO 02/06 150,00',
  'Despesas',
  '22/04 22/04 SUPERMERCADO EXEMPLO 320,50',
  '23/04 23/04 FARMACIA EXEMPLO 45,00',
  'VALOR TOTAL 515,50',
  'Resumo da Fatura',
];

const LINHAS_DESPESAS_ROTULO_REPETIDO = [
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 7777',
  'Despesas',
  '01/04 01/04 LOJA PAGINA UM EXEMPLO 100,00',
  'Despesas',
  '02/04 02/04 LOJA PAGINA DOIS EXEMPLO 200,00',
  'VALOR TOTAL 300,00',
  'Resumo da Fatura',
];

// Ordem inversa do primeiro caso (Despesas antes de Parcelamentos) — prova
// que o guard por GRUPO não depende de qual dos dois rótulos vem primeiro.
const LINHAS_DESPESA_PARCELAMENTO_TOTAL_UNICO = [
  'Detalhamento da Fatura',
  'TITULAR EXEMPLO - 1234 XXXX XXXX 9999',
  'Despesas',
  '22/04 22/04 SUPERMERCADO EXEMPLO 320,50',
  'Parcelamentos',
  '20/04 20/04 LOJA MOVEIS EXEMPLO 02/06 150,00',
  'VALOR TOTAL 470,50',
  'Resumo da Fatura',
];

describe('santander-cartao-pdf: blocos tipados compartilhando um "VALOR TOTAL" combinado (medido contra fatura Visa real)', () => {
  it('Parcelamentos seguido de Despesas, com UM só "VALOR TOTAL" pros dois: checksum bate e a soma combina os dois blocos', () => {
    const { checksum, rows } = parseFaturaTexto(LINHAS_PARCELAMENTO_DESPESA_TOTAL_UNICO, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
    assertEqual(checksum.sections.length, 1, 'os dois blocos (Parcelamentos + Despesas) viram UMA seção avaliada, nao duas — compartilham o total impresso');
    const secao = checksum.sections[0];
    assertEqual(secao.expected, 515.5);
    assertEqual(secao.computed, 515.5, 'soma tem que incluir o lancamento do bloco Parcelamentos (150) + os dois de Despesas (320,50 + 45,00)');
    assertEqual(secao.nLinhas, 3);
    assertEqual(rows.filter((r) => r.secao === 'despesas').length, 3);
    assertEqual(rows.filter((r) => r.tipo === 'parcelamento').length, 1, 'a linha do bloco Parcelamentos tem que sair marcada tipo:"parcelamento" — e o campo que domain/parcelas.js usa pra gerar previsoes futuras');
    assertEqual(rows.filter((r) => r.tipo === 'compra').length, 2, 'as linhas do bloco Despesas saem marcadas tipo:"compra"');
  });

  it('rótulo "Despesas" repetido (simulando cabeçalho de continuação de página): checksum bate e a soma combina os dois lados', () => {
    const { checksum, rows } = parseFaturaTexto(LINHAS_DESPESAS_ROTULO_REPETIDO, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
    assertEqual(checksum.sections.length, 1, 'a repeticao do rotulo Despesas nao pode criar uma segunda secao — e o mesmo bloco continuando');
    const secao = checksum.sections[0];
    assertEqual(secao.expected, 300);
    assertEqual(secao.computed, 300, 'soma tem que incluir o lancamento ANTES e DEPOIS do rotulo repetido');
    assertEqual(secao.nLinhas, 2);
    assertEqual(rows.filter((r) => r.secao === 'despesas').length, 2);
  });

  it('ordem invertida (Despesas antes de Parcelamentos), mesmo total combinado: guard por grupo nao depende de qual rotulo vem primeiro', () => {
    const { checksum, rows } = parseFaturaTexto(LINHAS_DESPESA_PARCELAMENTO_TOTAL_UNICO, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
    assertEqual(checksum.sections.length, 1);
    const secao = checksum.sections[0];
    assertEqual(secao.expected, 470.5);
    assertEqual(secao.computed, 470.5, 'soma tem que incluir Despesas (320,50) + Parcelamentos (150,00), nessa ordem');
    assertEqual(secao.nLinhas, 2);
    assertEqual(rows.filter((r) => r.secao === 'despesas').length, 2);
  });
});

// Guarda extra de regressao pro caso ORIGINAL medido em Mastercard
// (LINHAS_SECAO_SEM_TOTAL acima já cobre isso, mas este teste isola
// especificamente o risco de vazamento credito -> despesa-like através da
// mudanca de GRUPO, que é o mecanismo que a mudanca acima preservou).
describe('santander-cartao-pdf: guarda de regressao — credito nao vaza pra despesa-like na troca de GRUPO', () => {
  it('Pagamento e Demais Creditos (sem total) seguido de Parcelamentos (com total proprio): soma do credito nao contamina o parcelamento', () => {
    const linhas = [
      'Detalhamento da Fatura',
      'TITULAR EXEMPLO - 1234 XXXX XXXX 8888',
      'Pagamento e Demais Créditos',
      '10/04 10/04 DEB AUTOM DE FATURA EM C/ 700,00',
      'Parcelamentos',
      '15/04 15/04 LOJA MOVEIS EXEMPLO 01/03 90,00',
      'VALOR TOTAL 90,00',
      'Resumo da Fatura',
    ];
    const { checksum } = parseFaturaTexto(linhas, 'fatura-teste.pdf', VENCIMENTO);
    assert(checksum.ok, JSON.stringify(checksum.sections));
    const avaliada = checksum.sections.find((s) => s.ok !== null);
    assertEqual(avaliada.computed, 90, 'os 700 do credito nao podem vazar pra dentro da soma do parcelamento');
    assertEqual(avaliada.secaoTipo, 'despesas');
  });
});

describe('santander-cartao-pdf: totalImpressoDeSections', () => {
  it('soma so despesas/parcelamento, excluindo a secao de credito', () => {
    const { checksum } = parseFaturaTexto(LINHAS_FATURA_SINTETICA, 'fatura-teste.pdf', VENCIMENTO);
    // fixture sintetica: 150 (parcelamento) + 365,50 (despesas) = 515,50, SEM os 890 de pagamento
    assertEqual(totalImpressoDeSections(checksum.sections), 515.5);
  });

  it('secao sem "VALOR TOTAL" (expected:null) nao entra na soma', () => {
    const { checksum } = parseFaturaTexto(LINHAS_SECAO_SEM_TOTAL, 'fatura-teste.pdf', VENCIMENTO);
    // so a secao Despesas (30) foi avaliada; a de pagamento (sem total) fica de fora por nao ter expected
    assertEqual(totalImpressoDeSections(checksum.sections), 30);
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

  // Bug real de producao: fatura Visa importada com vencimento 30/01/2026
  // salvou 24/02/2026 (a data de "Melhor dia para compras", nao o
  // vencimento). Linhas reproduzidas a partir do texto REAL extraido dessa
  // fatura pelo extractLines (pdf.js) — layout "3 caixas lado a lado" (Total
  // a Pagar / Vencimento / Seu limite e), com a data no MEIO da linha de
  // dados, 2 linhas abaixo do cabecalho.
  it('layout Visa: cabecalho "Total a Pagar Vencimento Seu limte e" com a data no MEIO da linha de dados, 2 linhas abaixo', () => {
    const linhas = [
      'Olá, Rene! Esta é a fatura do seu cartão SANTANDER',
      'UNIQUE VISA contendo compras e pagamentos realizados',
      'Total a Pagar Vencimento Seu limte é',
      'até 23/01.',
      'R$ 11.680,38 30/01/2026 R$49.270,00',
      'Opções de Pagamento até a Data de Vencimento',
      '1 Pagamento Total R$11.680,38 Melhor dia para',
      'Limite utilizado Limite Disponível:',
      'compras',
      'Sempre a sua MELHOR opção!',
      'R$24.266,21 R$25.003,79',
      'No caso de pagamentos após a data de vencimento você tem alguns custos 24/02/2026',
      'adicionais por conta do atraso: Juros: 15,19% a.m. + Juros por atraso: 1,00% a.m.',
    ];
    const d = vencimentoFromText(linhas);
    assertEqual(d.getFullYear(), 2026);
    assertEqual(d.getMonth(), 0, 'janeiro (0-indexado) — o vencimento real e 30/01, nunca 24/02 (Melhor dia para compras)');
    assertEqual(d.getDate(), 30);
  });

  it('nunca casa "vencimento" solto no meio de uma frase distante de aviso — regex antigo pegava a data errada logo depois dela', () => {
    const linhas = [
      'No caso de pagamentos após a data de vencimento você tem alguns custos 24/02/2026',
      'adicionais por conta do atraso.',
    ];
    assertEqual(vencimentoFromText(linhas), null, 'sem cabecalho reconhecivel antes, nenhuma data deve ser extraida daqui');
  });
});
