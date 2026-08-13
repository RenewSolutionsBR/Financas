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
import { COLUNAS_LANCAMENTOS } from './modelos-planilha.js';

function dataParaISO(txt) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(txt || ''));
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
  const linhas = temCabecalho ? (matriz || []).slice(1) : (matriz || []);

  // Cabeçalho conferido antes de tudo: uma planilha com as colunas noutra
  // ordem seria lida inteira "com sucesso" e gravaria descrição no lugar do
  // valor. Falhar cedo e dizer o que se esperava é melhor que importar lixo.
  if (temCabecalho && (matriz || []).length) {
    const cabecalho = (matriz[0] || []).map((c) => chaveDeNome(c));
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
    const numeroLinha = i + (temCabecalho ? 2 : 1); // linha como o usuário vê no Excel
    const bruta = (l || []).map((c) => String(c == null ? '' : c).trim());
    if (bruta.every((c) => !c)) return; // linha totalmente vazia: ignorada em silêncio

    const [colData, colDescricao, colValor, colCategoria, colForma, colNatureza] = bruta;
    const dataISO = dataParaISO(colData);
    const descricao = colDescricao;
    const valor = parseMoneyBR(colValor);

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

// Lê o arquivo (.xlsx/.xls/.csv) e devolve a matriz da PRIMEIRA aba — a aba
// "Instruções" do modelo é ignorada por vir depois.
export function matrizDoArquivo(arrayBuffer, nomeArquivo) {
  const isCsv = /\.csv$/i.test(nomeArquivo || '');
  const wb = isCsv
    ? XLSX.read(new TextDecoder('utf-8').decode(arrayBuffer), { type: 'string' })
    : XLSX.read(arrayBuffer, { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
}
