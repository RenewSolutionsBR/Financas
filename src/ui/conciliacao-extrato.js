// 4 baldes de um extrato selecionado (runReconciliationBank, Task 9),
// natureza editavel por linha do balde extratoUnmatched, categoria/forma
// sugeridas, e "+ lancar em lote" (novaTransaction + saveTransactions,
// aprenderRegra quando o usuario corrige a categoria sugerida).

import { el, toast, abrirModal } from './components.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR } from '../core/dates.js';
import { runReconciliationBank } from '../domain/reconcile-bank.js';
import { aplicarRegra, aprenderRegra, candidatosRetroativos } from '../domain/classification.js';
import { formaPorPrefixoExtrato } from '../domain/payment-methods.js';
import { novaTransaction, saveTransactions, NATUREZAS, rotuloNatureza } from '../domain/transactions.js';
import { CATEGORIA_A_CLASSIFICAR } from '../domain/categories.js';
import * as storage from '../core/storage.js';

// Pura: filtra qualquer lista de itens por natureza/forma, dado como
// extrair {natureza, formaPagamentoId} de CADA TIPO de item — os 4 baldes
// de extrato têm formatos de item diferentes (par {extrato,app}, transaction
// crua, linha crua sem forma ainda) e nao dá pra assumir um shape fixo.
// `extrairForma` que devolve sempre null (linha crua) faz o filtro de forma
// nunca excluir nada para esse tipo de item, de proposito.
export function filtrarPorNaturezaEForma(itens, { natureza, formaPagamentoId } = {}, extrair) {
  return (itens || []).filter((item) => {
    const { natureza: n, formaPagamentoId: f } = extrair(item);
    if (natureza && n !== natureza) return false;
    if (formaPagamentoId && f !== null && f !== formaPagamentoId) return false;
    return true;
  });
}

let filtroNatureza = '';
let filtroForma = '';

// Chamado por conciliacao.js sempre que a conta ou o documento selecionado
// muda — sem isso um filtro de natureza/forma escolhido para um extrato
// continua ativo silenciosamente ao trocar para outro extrato, podendo
// esconder linhas pendentes de verdade (ver Finding 1 da revisao final).
export function limparFiltrosExtrato() {
  filtroNatureza = '';
  filtroForma = '';
}

function montarBarraFiltrosExtrato(formas, aoMudar) {
  const selNatureza = el('select', {}, [
    el('option', { value: '', text: 'Todas as naturezas', ...(filtroNatureza === '' ? { selected: 'selected' } : {}) }),
    ...NATUREZAS.map((n) => el('option', { value: n, text: rotuloNatureza(n), ...(n === filtroNatureza ? { selected: 'selected' } : {}) })),
  ]);
  selNatureza.addEventListener('change', () => { filtroNatureza = selNatureza.value; aoMudar(); });

  const selForma = el('select', {}, [
    el('option', { value: '', text: 'Todas as formas', ...(filtroForma === '' ? { selected: 'selected' } : {}) }),
    ...formas.map((f) => el('option', { value: f.id, text: f.nome, ...(f.id === filtroForma ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', () => { filtroForma = selForma.value; aoMudar(); });

  return el('div', { class: 'filtros' }, [
    el('label', { class: 'campo' }, [el('span', { text: 'Natureza' }), selNatureza]),
    el('label', { class: 'campo' }, [el('span', { text: 'Forma' }), selForma]),
  ]);
}

// `categorias` por parâmetro, não capturado do módulo — mesmo padrão do
// restante do arquivo (dados sempre vêm de `ctx`/argumento, nunca de global).
function nomeCategoria(categoriaId, categorias) {
  return (categorias.find((c) => c.id === categoriaId) || {}).nome || 'A Classificar';
}

function itemMatched(par, categorias) {
  return el('div', { class: 'item-balde item-conciliado' }, [
    el('span', { class: 'item-descricao', text: par.extrato.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(par.extrato.data)} · ${fmtBRL(par.extrato.valor)} · ${nomeCategoria(par.app.categoria, categorias)}` }),
  ]);
}

function itemApp(t, categorias) {
  return el('div', { class: 'item-balde' }, [
    el('span', { class: 'item-descricao', text: t.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(t.data)} · ${fmtBRL(t.valor)} · ${nomeCategoria(t.categoria, categorias)}` }),
  ]);
}

// Pura: titulo do balde "No extrato, nao lancado no app". Quando um filtro
// de natureza/forma esta ativo, `linhasFormulario.length` ja veio filtrado
// e pode mostrar "(0)" mesmo havendo trabalho pendente de verdade (Finding 2
// da revisao final) — "X de Y" deixa isso visivel em vez de escondido.
export function tituloBaldeNaoLancado(totalFiltrado, totalSemFiltro, filtroAtivo) {
  return filtroAtivo
    ? `No extrato, não lançado no app (${totalFiltrado} de ${totalSemFiltro})`
    : `No extrato, não lançado no app (${totalFiltrado})`;
}

function balde(titulo, itens, vazio) {
  return el('div', { class: 'balde' }, [
    el('h3', { text: `${titulo} (${itens.length})` }),
    itens.length ? el('div', { class: 'lista-balde' }, itens) : el('p', { class: 'vazio', text: vazio }),
  ]);
}

// Uma "linha de formulario" por item do extratoUnmatched: guarda o estado
// ATUAL (o usuario pode corrigir natureza/categoria/forma antes de lancar),
// nao o sugerido de novo a cada render — o lote usa exatamente este estado.
function montarLinhaFormulario(linha, ctx) {
  // BUG (achado 2026-08-10, investigando "regra de extrato nao aplica"):
  // `linha` (extratoUnmatched, vinda de runReconciliationBank) nunca teve um
  // campo `origem` — ela so carrega `natureza` (atribuirNatureza). aplicarRegra
  // compara regra.escopo === linha.origem, entao com origem sempre undefined
  // NENHUMA regra de escopo 'extrato' jamais casava (so 'ambos' passava,
  // porque a comparacao vira 'ambos' === 'ambos' por outro caminho). Os
  // testes de aplicarRegra nao pegaram isso porque mockam a linha ja com
  // origem:'extrato' explicito, shape que o caller real nunca produzia.
  const regraAplicada = aplicarRegra({ ...linha, origem: 'extrato' }, ctx.regras);
  const formaSugerida = formaPorPrefixoExtrato(linha.tipoDetectado, ctx.formas);
  const estado = {
    selecionado: false,
    natureza: linha.natureza,
    categoria: regraAplicada ? regraAplicada.categoriaId : CATEGORIA_A_CLASSIFICAR,
    formaPagamentoId: (regraAplicada && regraAplicada.formaPagamentoId) || (formaSugerida ? formaSugerida.id : null),
    regraAplicada,
  };

  const chk = el('input', { type: 'checkbox' });
  chk.addEventListener('change', () => { estado.selecionado = chk.checked; });

  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: n, ...(n === estado.natureza ? { selected: 'selected' } : {}) })
  ));
  selNatureza.addEventListener('change', async () => {
    estado.natureza = selNatureza.value;
    // Corrigir a natureza sugerida grava naturezaSugerida na regra aprendida
    // (Task 2) — proximas linhas com a mesma descricao canonica ja vem certas.
    const regra = aprenderRegra({ descricaoCanonica: linha.descricaoCanonica, escopo: 'extrato', categoriaId: estado.categoria, contaId: null }, ctx.regras);
    regra.naturezaSugerida = estado.natureza;
    await storage.put('classificationRules', regra);
  });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === estado.categoria ? { selected: 'selected' } : {}) })
  ));
  selCategoria.addEventListener('change', () => { estado.categoria = selCategoria.value; });

  const selForma = el('select', {}, [
    el('option', { value: '', text: '— sem forma —' }),
    ...ctx.formas.map((f) => el('option', { value: f.id, text: f.nome, ...(f.id === estado.formaPagamentoId ? { selected: 'selected' } : {}) })),
  ]);
  selForma.addEventListener('change', () => { estado.formaPagamentoId = selForma.value || null; });

  const nomeCategoria = (id) => (ctx.categorias.find((c) => c.id === id) || {}).nome || 'A Classificar';

  const botaoLancarUma = el('button', { class: 'btn btn-mini', type: 'button', text: '+ lançar' });

  const linhaEl = el('div', { class: 'item-balde item-form-lote' }, [
    chk,
    botaoLancarUma,
    el('span', { class: 'item-descricao', text: linha.descricao }),
    el('span', { class: 'item-meta', text: `${formatDateBR(linha.data)} · ${fmtBRL(linha.valor)}` }),
    // Wrapper proprio para os 3 selects: precisam SEMPRE ficar em 3 colunas
    // iguais na mesma linha (desktop e mobile), e isso exige um grid de 3
    // colunas independente do grid-template-columns do container externo
    // (pensado pra linha do checkbox/botao/descricao, que tem larguras
    // auto/auto/1fr — nao terços iguais).
    el('div', { class: 'item-form-lote-selects' }, [selNatureza, selCategoria, selForma]),
    // So aparece quando ha uma regra aplicada (sugestao automatica) — sem
    // regra, a categoria selecionada ja e "A Classificar" e o proprio
    // select ja mostra isso, o selo era informacao duplicada.
    regraAplicada ? el('span', { class: 'selo-categoria-sugerida', text: `sugerido: ${nomeCategoria(estado.categoria)}` }) : null,
  ]);

  return { linhaEl, linha, estado, selCategoria, botaoLancarUma };
}

// Corpo compartilhado entre "+ lançar em lote" (linhas com checkbox
// marcado) e "+ lançar" individual (uma linha só, sem depender do
// checkbox) — mesma lógica de gravação + aprendizado de regra +
// aplicação retroativa nos dois casos.
//
// `botoes` (array de botões a desabilitar durante a execução) evita a
// mesma classe de bug já visto em conciliacao-fatura.js (2026-08-12): sem
// desabilitar o botão enquanto o modal "Aplicar retroativamente?" espera
// resposta (ou enquanto o primeiro saveTransactions ainda roda), um clique
// extra reentra na função com o MESMO `selecionadas` (closure antigo, DOM
// ainda não re-renderizado), criando transações duplicadas idênticas.
async function lancarSelecionadas(selecionadas, ctx, aoConcluir, emLote = true, botoes = []) {
  if (!selecionadas.length) return;
  botoes.forEach((b) => { b.disabled = true; });
  try {
    await lancarSelecionadasInterno(selecionadas, ctx, aoConcluir, emLote);
  } finally {
    botoes.forEach((b) => { b.disabled = false; });
  }
}

async function lancarSelecionadasInterno(selecionadas, ctx, aoConcluir, emLote) {

  const novosLancamentos = selecionadas.map((lf) => novaTransaction({
    descricao: lf.linha.descricao,
    valor: lf.linha.valor,
    data: lf.linha.data,
    categoria: lf.estado.categoria,
    formaPagamentoId: lf.estado.formaPagamentoId,
    contaId: ctx.contaId,
    natureza: lf.estado.natureza,
    origem: 'extrato',
    origemRef: { statementId: ctx.statementId, linhaId: lf.linha.id },
    classificadoAutomaticamente: !!lf.estado.regraAplicada,
    regraId: lf.estado.regraAplicada ? lf.estado.regraAplicada.id : null,
  }));

  await saveTransactions(novosLancamentos);

  // Se a categoria escolhida divergiu da sugerida automaticamente, aprende e
  // oferece aplicar retroativamente aos "A Classificar" com a mesma descricao
  // canonica.
  for (const lf of selecionadas) {
    const sugeriaOutraCoisa = lf.estado.regraAplicada && lf.estado.regraAplicada.categoriaId !== lf.estado.categoria;
    const semSugestaoAlguma = !lf.estado.regraAplicada && lf.estado.categoria !== CATEGORIA_A_CLASSIFICAR;
    if (!sugeriaOutraCoisa && !semSugestaoAlguma) continue;

    const regra = aprenderRegra({ descricaoCanonica: lf.linha.descricaoCanonica, escopo: 'extrato', categoriaId: lf.estado.categoria, contaId: null }, ctx.regras);
    await storage.put('classificationRules', regra);

    // Cada transaction precisa da descricaoCanonica da SUA PRÓPRIA linha de
    // origem, não da linha que está sendo lançada agora — usar a mesma
    // descricaoCanonica pra toda transaction com origemRef super-casaria
    // candidatosRetroativos (reclassificaria lançamentos não relacionados).
    // Resolve só contra as linhas DESTE extrato (ctx.linhasPorId); uma
    // transaction cuja origemRef aponta pra outro statement não resolve aqui
    // — fica de fora (null), mais seguro que casar errado.
    const descricaoCanonicaPorTransacao = new Map(ctx.transactions.map((t) => {
      const linhaOrigem = t.origemRef && t.origemRef.statementId === ctx.statementId ? ctx.linhasPorId.get(t.origemRef.linhaId) : null;
      return [t.id, linhaOrigem ? linhaOrigem.descricaoCanonica : null];
    }));
    const candidatos = candidatosRetroativos(ctx.transactions, regra, descricaoCanonicaPorTransacao);
    if (candidatos.length) {
      const aplicar = await abrirModal({
        titulo: 'Aplicar retroativamente?',
        corpo: `${candidatos.length} lançamento(s) em "A Classificar" têm a mesma descrição. Aplicar a categoria escolhida a eles também?`,
        acoes: [{ id: 'nao', rotulo: 'Não' }, { id: 'sim', rotulo: 'Aplicar' }],
      });
      if (aplicar === 'sim') {
        await saveTransactions(candidatos.map((c) => ({ ...c, categoria: lf.estado.categoria, classificadoAutomaticamente: true, regraId: regra.id })));
      }
    }
  }

  const mensagem = emLote
    ? `${novosLancamentos.length} lançamento(s) lançado(s) em lote.`
    : 'Lançamento lançado.';
  toast(mensagem, 'ok');
  await aoConcluir();
}

async function lancarEmLote(linhasFormulario, ctx, aoConcluir, botaoLote) {
  await lancarSelecionadas(linhasFormulario.filter((lf) => lf.estado.selecionado), ctx, aoConcluir, true, [botaoLote]);
}

async function lancarUma(lf, ctx, aoConcluir, botaoLote) {
  await lancarSelecionadas([lf], ctx, aoConcluir, false, [lf.botaoLancarUma, botaoLote]);
}

export async function renderBaldesExtrato(painel, extrato, transactions, accounts, apelidosTitular, categorias, formas, regras, aoMudar) {
  const statementsFatura = (await storage.getAll('statements')).filter((s) => s.tipo === 'fatura');
  const { autoMatched, matched, extratoUnmatched, appUnmatched } = runReconciliationBank(extrato, transactions, accounts, apelidosTitular, statementsFatura);

  const filtroAtivo = { natureza: filtroNatureza, formaPagamentoId: filtroForma };
  const autoMatchedFiltrado = filtrarPorNaturezaEForma(autoMatched, filtroAtivo, (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId }));
  const matchedFiltrado = filtrarPorNaturezaEForma(matched, filtroAtivo, (p) => ({ natureza: p.app.natureza, formaPagamentoId: p.app.formaPagamentoId }));
  const appUnmatchedFiltrado = filtrarPorNaturezaEForma(appUnmatched, filtroAtivo, (t) => ({ natureza: t.natureza, formaPagamentoId: t.formaPagamentoId }));
  const extratoUnmatchedFiltrado = filtrarPorNaturezaEForma(extratoUnmatched, { natureza: filtroNatureza }, (l) => ({ natureza: l.natureza, formaPagamentoId: null }));

  const linhasPorId = new Map((extrato.rows || []).map((linha) => [linha.id, linha]));
  const ctx = { contaId: extrato.contaId, statementId: extrato.id, categorias, formas, regras, transactions, linhasPorId };
  const linhasFormulario = extratoUnmatchedFiltrado.map((linha) => montarLinhaFormulario(linha, ctx));

  const botaoLote = el('button', { class: 'btn btn-primario', text: '+ lançar em lote', disabled: 'disabled' });
  linhasFormulario.forEach((lf) => lf.botaoLancarUma.addEventListener('click', () => lancarUma(lf, ctx, aoMudar, botaoLote)));
  const atualizarBotaoLote = () => { botaoLote.disabled = !linhasFormulario.some((lf) => lf.estado.selecionado); };
  linhasFormulario.forEach((lf) => lf.linhaEl.querySelector('input[type=checkbox]').addEventListener('change', atualizarBotaoLote));
  // aoMudar (renderConciliacao, injetado por conciliacao.js) refaz o fetch de
  // transactions do zero — reusar renderBaldesExtrato aqui com o `transactions`
  // capturado por este closure serviria dados JA DESATUALIZADOS logo apos o
  // lote gravar novos lancamentos, e os baldes ficariam mostrando linhas que
  // acabaram de ser lancadas como se ainda estivessem pendentes.
  botaoLote.addEventListener('click', () => lancarEmLote(linhasFormulario, ctx, aoMudar, botaoLote));

  painel.innerHTML = '';
  painel.append(
    montarBarraFiltrosExtrato(formas, () => renderBaldesExtrato(painel, extrato, transactions, accounts, apelidosTitular, categorias, formas, regras, aoMudar)),
    balde('Conciliado automaticamente', autoMatchedFiltrado.map((par) => itemMatched(par, categorias)), 'Nenhum item conciliado automaticamente.'),
    balde('Conciliado', matchedFiltrado.map((par) => itemMatched(par, categorias)), 'Nenhum item conciliado.'),
    el('div', { class: 'balde' }, [
      el('h3', { text: tituloBaldeNaoLancado(linhasFormulario.length, extratoUnmatched.length, !!(filtroNatureza || filtroForma)) }),
      linhasFormulario.length
        ? el('div', {}, [...linhasFormulario.map((lf) => lf.linhaEl), el('div', { class: 'acoes' }, [botaoLote])])
        : el('p', { class: 'vazio', text: 'Tudo do extrato já está lançado no app.' }),
    ]),
    balde('No app, não no extrato', appUnmatchedFiltrado.map((t) => itemApp(t, categorias)), 'Nenhum lançamento do app ficou de fora do extrato.')
  );
}
