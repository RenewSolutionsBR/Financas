// Importa lançamentos JÁ PRONTOS de uma planilha, direto para a aba
// Lançamentos — sem passar pelos baldes de conciliação. Serve para trazer
// gastos digitados fora do app (planilha antiga, outro app, anotação de
// viagem) sem redigitar um a um.
//
// Diferente de fatura/extrato, aqui não existe documento a conciliar: as
// linhas viram transações diretamente. Por isso este adaptador NÃO se
// registra no registry.js (que serve à tela de Conciliação) — ele é chamado
// pelo menu Ferramentas.
//
// A função de parse é PURA (recebe as listas de categorias/formas, devolve
// transações e avisos, não toca storage), para ser testável em Node.

import { canonicalizar } from '../domain/classification.js';
import { parseMoneyBR } from '../core/money.js';
import { novaTransaction, NATUREZAS } from '../domain/transactions.js';
import { CATEGORIA_A_CLASSIFICAR } from '../domain/categories.js';
import { COLUNAS_LANCAMENTOS, tipoDoMarcador } from './modelos-planilha.js';

// Aceita as duas formas que uma célula de data chega de uma planilha real:
//
// 1. Texto "dd/mm/aaaa" — quando o usuário digita a data como TEXTO.
// 2. Objeto Date — quando a célula é uma data DE VERDADE no Excel.
//
// O caso (2) foi um bug real (medido 2026-08-13 com a planilha do usuário):
// a leitura usava `raw: false`, que converte a data para a string de
// EXIBIÇÃO do arquivo — no caso, "7/5/26", sem zero à esquerda e com ano de
// 2 dígitos. O regex exigia dd/mm/aaaa e rejeitava a linha, então preencher
// a data corretamente no Excel fazia a linha ser PULADA, enquanto digitar
// como texto funcionava. Pior: "7/5/26" é ambíguo (5 de julho ou 7 de
// maio?) e depende do locale de quem salvou o arquivo — por isso a leitura
// passou a usar `cellDates: true`, que entrega um Date já resolvido pelo
// número de série da planilha, sem passar por texto nenhum.
function dataParaISO(valor) {
  if (valor instanceof Date && !isNaN(valor)) {
    // Componentes LOCAIS (não toISOString, que converte para UTC e pode
    // recuar um dia dependendo do fuso do aparelho).
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
  }
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Comparação de nomes digitados à mão contra cadastros do app: sem acento,
// sem caixa, sem espaço duplicado. NÃO reusa normalizeDescricao de
// core/text.js de propósito — aquela função é a base de computeParcelaKey e
// preserva acentos (a identidade das parcelas já gravadas depende dela não
// mudar). Aqui o objetivo é o oposto: "Alimentação" digitado na planilha
// precisa casar com "Alimentacao" cadastrado no app.
function chaveDeNome(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase().replace(/\s+/g, ' ');
}

// Aceita tanto o rótulo curto do modelo de planilha ("Gasto", "Receita")
// quanto o valor interno ("despesa") e o rótulo longo que o app mostra nos
// seletores ("Recebimento (não conta como gasto)") — quem copia da tela do
// app não deve ser punido por isso. Comparação sem acento/caixa
// (chaveDeNome) para "transferencia" casar com "Transferência".
const APELIDOS_NATUREZA = {
  GASTO: 'despesa', DESPESA: 'despesa', SAIDA: 'despesa',
  RECEITA: 'receita', RECEBIMENTO: 'receita', ENTRADA: 'receita',
  TRANSFERENCIA: 'transferencia',
  'PAGAMENTO DE FATURA': 'pagamento_fatura', PAGAMENTO_FATURA: 'pagamento_fatura',
};

export function parseNatureza(txt) {
  const limpo = chaveDeNome(txt);
  if (!limpo) return 'despesa'; // coluna vazia = gasto, o caso esmagadoramente mais comum
  if (NATUREZAS.includes(limpo.toLowerCase())) return limpo.toLowerCase();
  // Rótulo longo do app: casa pelo começo ("RECEBIMENTO (NAO CONTA...)").
  const chave = Object.keys(APELIDOS_NATUREZA).find((k) => limpo === k || limpo.startsWith(k));
  return chave ? APELIDOS_NATUREZA[chave] : null;
}

// Casa o nome escrito na planilha com um cadastro do app, ignorando
// acento/caixa/espaço extra. Devolve o objeto cadastrado ou null.
function acharPorNome(lista, texto) {
  const alvo = chaveDeNome(texto);
  if (!alvo) return null;
  return (lista || []).find((x) => chaveDeNome(x.nome) === alvo) || null;
}

/**
 * Converte a matriz da planilha em transações prontas para gravar.
 *
 * Categoria e forma de pagamento são resolvidas por NOME contra o que já
 * está cadastrado — nunca criadas na hora. Criar cadastro a partir de um
 * texto solto de planilha encheria o app de categorias quase-duplicadas
 * ("Alimentacao", "alimentação", "Alimentaçao") sem o usuário perceber; é
 * melhor recusar a linha e dizer o que falta cadastrar.
 *
 * Devolve `{ transacoes, avisos, erros }`. `erros` é o que impede a
 * importação inteira (planilha no formato errado); `avisos` são linhas
 * puladas individualmente, com a importação seguindo nas demais.
 */
export function parseLancamentosPlanilha(matriz, { categorias, formas, contas, temCabecalho = true } = {}) {
  const avisos = [];
  const erros = [];
  // O modelo tem uma linha de MARCADOR acima do cabeçalho (ver
  // modelos-planilha.js): ela existe para o arquivo se identificar em vez de
  // ser adivinhado pelo formato. Quando está presente, os títulos são a
  // linha 2 e os dados começam na 3. Arquivo montado à mão (sem marcador)
  // segue com títulos na linha 1.
  const temMarcador = !!tipoDoMarcador(matriz);
  const linhaDoCabecalho = temMarcador ? 1 : 0;
  const linhas = temCabecalho ? (matriz || []).slice(linhaDoCabecalho + 1) : (matriz || []);

  // Cabeçalho conferido antes de tudo: uma planilha com as colunas noutra
  // ordem seria lida inteira "com sucesso" e gravaria descrição no lugar do
  // valor. Falhar cedo e dizer o que se esperava é melhor que importar lixo.
  if (temCabecalho && (matriz || []).length) {
    const cabecalho = ((matriz || [])[linhaDoCabecalho] || []).map((c) => chaveDeNome(c));
    const esperado = COLUNAS_LANCAMENTOS.map((c) => chaveDeNome(c));
    const confere = esperado.every((col, i) => cabecalho[i] === col);
    if (!confere) {
      erros.push(
        `A primeira linha da planilha não tem as colunas do modelo. Esperado: ${COLUNAS_LANCAMENTOS.join(' | ')}. ` +
        'Baixe o modelo em Ferramentas → Modelos de planilha.'
      );
      return { transacoes: [], avisos, erros };
    }
  }

  const transacoes = [];
  linhas.forEach((l, i) => {
    // Linha como o usuário vê no Excel: soma as linhas puladas (marcador
    // e/ou cabeçalho) mais o índice 1-based.
    const numeroLinha = i + (temCabecalho ? linhaDoCabecalho + 2 : 1);
    // Célula de data e de valor ficam CRUAS (Date/number) — só o texto é
    // aparado. Converter tudo para string aqui destruía o Date antes de
    // dataParaISO poder lê-lo, que era exatamente o bug de "data preenchida
    // certo no Excel faz a linha ser pulada".
    const celula = (v) => (v instanceof Date || typeof v === 'number' ? v : String(v == null ? '' : v).trim());
    const bruta = (l || []).map(celula);
    if (bruta.every((c) => c === '' || c === null || c === undefined)) return; // linha vazia: ignorada em silêncio

    const [colData, colDescricao, colValor, colCategoria, colForma, colNatureza] = bruta;
    const dataISO = dataParaISO(colData);
    const descricao = String(colDescricao == null ? '' : colDescricao).trim();
    // Número puro (célula formatada como moeda/número no Excel) já é o valor
    // final; só texto passa por parseMoneyBR, que interpreta vírgula decimal.
    const valor = typeof colValor === 'number' ? colValor : parseMoneyBR(colValor);

    if (!dataISO) return avisos.push(`Linha ${numeroLinha} pulada: data "${colData}" inválida (use dd/mm/aaaa).`);
    if (!descricao) return avisos.push(`Linha ${numeroLinha} pulada: descrição vazia.`);
    if (valor === null || !Number.isFinite(valor) || valor === 0) {
      return avisos.push(`Linha ${numeroLinha} pulada: valor "${colValor}" inválido.`);
    }

    const natureza = parseNatureza(colNatureza);
    if (!natureza) {
      return avisos.push(`Linha ${numeroLinha} pulada: natureza "${colNatureza}" desconhecida (use Gasto, Receita, Transferência ou Pagamento de fatura).`);
    }

    const categoria = acharPorNome(categorias, colCategoria);
    if (colCategoria && !categoria) {
      return avisos.push(`Linha ${numeroLinha} pulada: categoria "${colCategoria}" não está cadastrada.`);
    }
    const forma = acharPorNome(formas, colForma);
    if (colForma && !forma) {
      return avisos.push(`Linha ${numeroLinha} pulada: forma de pagamento "${colForma}" não está cadastrada.`);
    }
    if (!forma) return avisos.push(`Linha ${numeroLinha} pulada: forma de pagamento não informada.`);

    // Conta padrão da forma, quando houver — mesma regra do formulário de
    // Lançamentos. Sem contaId, um gasto de cartão nunca aparece na
    // conciliação de fatura (plasticosDoTitular filtra por conta).
    const contaPadrao = forma.contaPadraoId
      ? (contas || []).find((c) => c.id === forma.contaPadraoId)
      : null;

    transacoes.push(novaTransaction({
      data: dataISO,
      descricao,
      valor: Math.abs(valor),
      categoria: categoria ? categoria.id : CATEGORIA_A_CLASSIFICAR,
      formaPagamentoId: forma.id,
      contaId: contaPadrao ? contaPadrao.id : undefined,
      natureza,
      origem: 'manual',
      // Marca a procedência para o usuário poder distinguir depois o que
      // veio de planilha do que ele digitou — e para uma futura correção em
      // massa conseguir achar exatamente este lote.
      importadoDePlanilha: true,
      descricaoCanonica: canonicalizar(descricao, 'extrato'),
    }));
  });

  return { transacoes, avisos, erros };
}

/**
 * Marca quais das transações a importar já parecem existir no app.
 *
 * Existe porque esta importação NÃO passa pela conciliação (que tem os
 * baldes para revisar o casamento linha a linha) e grava direto: reimportar
 * o mesmo arquivo, ou dois arquivos com meses sobrepostos, criava cópias
 * silenciosas sem nada na tela avisando.
 *
 * O critério é MESMA DATA + MESMO VALOR, deliberadamente sem exigir
 * descrição igual: quem monta a planilha à mão raramente escreve a
 * descrição do mesmo jeito duas vezes ("Almoço" vs "Almoco restaurante"),
 * e o objetivo aqui é AVISAR, não bloquear. Em compensação, descrição
 * parecida vira um sinal a mais (`descricaoIgual`) para a tela separar o
 * que é quase certamente duplicata do que pode ser coincidência legítima
 * — dois cafés de R$ 5,00 no mesmo dia são gastos diferentes de verdade.
 *
 * Compara contra TODAS as transações do app (não só as importadas de
 * planilha): um gasto digitado à mão e depois trazido numa planilha é
 * duplicata do mesmo jeito.
 *
 * Não decide nada sozinha — quem chama mostra o aviso e o usuário escolhe.
 */
export function marcarPossiveisDuplicatas(transacoes, existentes) {
  const porChave = new Map();
  for (const t of existentes || []) {
    // Previsões de parcela não são gasto lançado: casar contra elas
    // acusaria duplicata de algo que ainda nem aconteceu.
    if (t.previsto) continue;
    const chave = `${t.data}|${Math.abs(Number(t.valor)).toFixed(2)}`;
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(t);
  }

  return (transacoes || []).map((nova) => {
    const iguais = porChave.get(`${nova.data}|${Math.abs(Number(nova.valor)).toFixed(2)}`) || [];
    if (!iguais.length) return { ...nova, possivelDuplicata: null };
    const alvo = chaveDeNome(nova.descricao);
    const comDescricaoIgual = iguais.find((t) => chaveDeNome(t.descricao) === alvo);
    return {
      ...nova,
      possivelDuplicata: {
        descricaoIgual: !!comDescricaoIgual,
        existente: comDescricaoIgual || iguais[0],
        quantas: iguais.length,
      },
    };
  });
}

// Lê o arquivo (.xlsx/.xls/.csv) e devolve a matriz da PRIMEIRA aba — a aba
// "Instruções" do modelo é ignorada por vir depois.
export function matrizDoArquivo(arrayBuffer, nomeArquivo) {
  const isCsv = /\.csv$/i.test(nomeArquivo || '');
  // `cellDates: true` + `raw: true`: uma célula de data de verdade chega
  // como Date (resolvido pelo número de série da planilha), nunca como a
  // string de exibição do arquivo — que vem no locale de quem salvou
  // ("7/5/26") e é ambígua entre dia e mês. Ver dataParaISO acima.
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(arrayBuffer), { type: 'string', cellDates: true })
    : XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}
