// 4 baldes de uma fatura selecionada (runReconciliation, Task 8), "+lancar"
// individual por item nao lancado (segue pra aba Lancamentos, formulario
// completo) e "+lancar em lote" (mesmo espirito do lote de
// conciliacao-extrato.js, grava direto sem sair da tela — contaId/natureza
// fixos pelo proprio cartao da fatura, parcela propagada automaticamente),
// e exportacao da conciliacao completa (buildFullReconciliationRows) em .xlsx.

import { el, toast, abrirModal } from './components.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR } from '../core/dates.js';
import { runReconciliation } from '../domain/reconcile-card.js';
import { computeParcelaKey } from '../domain/parcelas.js';
import { aplicarRegra, aprenderRegra, candidatosRetroativos, canonicalizar } from '../domain/classification.js';
import { novaTransaction, saveTransactions } from '../domain/transactions.js';
import { CATEGORIA_A_CLASSIFICAR } from '../domain/categories.js';
import { tipoContaParaForma } from './lancamentos-form-helpers.js';
import { TIPO_CARTAO } from '../domain/accounts.js';
import * as storage from '../core/storage.js';
import { irParaAba } from './tabs.js';

// Pura: forma de pagamento a pré-selecionar no lote para o cartão desta
// fatura — prioriza uma forma cuja conta padrão SEJA este cartão
// (contaPadraoId === contaId), senão cai na primeira forma de crédito ativa.
// Mesma heurística de tipo usada em lancamentos-form.js (tipoContaParaForma),
// só que aqui não há usuário escolhendo à mão: o lote precisa de um palpite
// razoável sozinho.
export function formaCreditoParaCartao(contaId, formas) {
  const ativas = (formas || []).filter((f) => f.ativo !== false && tipoContaParaForma(f.tipo) === TIPO_CARTAO);
  return ativas.find((f) => f.contaPadraoId === contaId) || ativas[0] || null;
}

// Estado de modulo lido por ui/lancamentos.js no proximo render, mesmo
// espirito do pendingParcelaKey do app anterior citado no brief: o botao
// "+lancar" preenche este rascunho e troca de aba; lancamentos.js decide
// como usa-lo (fora do escopo desta task).
export let rascunhoLancamento = null;
export function limparRascunhoLancamento() { rascunhoLancamento = null; }

// Mesmo sufixo "(atual/total)" nos três baldes que mostram lançamento de
// parcelamento — sem ele, uma parcela e sua irmã de outro mês apareciam
// como itens idênticos na tela, sem nenhuma pista de qual é qual.
function sufixoParcela(item) {
  return item.parcela_atual ? ` (${item.parcela_atual}/${item.parcela_total})` : '';
}

// Uma "linha de formulario" por item do faturaUnmatched: junta o "+lançar"
// individual original (segue pra Lançamentos, formulário completo) com
// checkbox+categoria para o lote (grava direto). Mesma linha, dois fluxos —
// evita duplicar o item na tela. Natureza/contaId nunca aparecem como campo
// aqui (diferente do extrato): sempre 'despesa'/o cartão da própria fatura.
function montarLinhaFatura(item, ctx) {
  const regraAplicada = aplicarRegra({ descricaoCanonica: item.descricaoCanonica, origem: 'fatura', contaId: ctx.contaId }, ctx.regras);
  const estado = {
    selecionado: false,
    categoria: regraAplicada ? regraAplicada.categoriaId : CATEGORIA_A_CLASSIFICAR,
    formaPagamentoId: (regraAplicada && regraAplicada.formaPagamentoId) || (ctx.formaCredito ? ctx.formaCredito.id : null),
    regraAplicada,
  };

  const chk = el('input', { type: 'checkbox' });
  chk.addEventListener('change', () => { estado.selecionado = chk.checked; });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === estado.categoria ? { selected: 'selected' } : {}) })
  ));
  selCategoria.addEventListener('change', () => { estado.categoria = selCategoria.value; });

  const nomeCategoria = (id) => (ctx.categorias.find((c) => c.id === id) || {}).nome || 'A Classificar';

  const botaoLancarIndividual = el('button', {
    class: 'btn btn-mini',
    text: '+ lançar',
    onclick: () => {
      rascunhoLancamento = {
        descricao: item.descricao, data: item.data, valor: item.valor, natureza: 'despesa',
        // Sem o contaId do proprio cartao da fatura, o formulario de
        // Lancamentos caia na conta padrao da ultima forma usada (que pode
        // ser outro cartao/conta) — o lancamento salvava com contaId
        // errado, runReconciliation nunca achava ele no pool desse cartao
        // (poolDoCartao filtra por plasticosDoTitular), o item continuava
        // aparecendo em "nao lancado" pra sempre, e cada novo clique em
        // "+lancar" criava outro lancamento duplicado.
        contaId: ctx.contaId,
        // Origem/descricaoCanonica propagadas para o formulario poder
        // aprender uma regra nova quando o usuario confirma/corrige a
        // categoria sugerida (mesmo espirito do lote).
        origem: 'fatura',
        origemRef: { statementId: ctx.statementId, linhaId: item.id },
        descricaoCanonica: item.descricaoCanonica,
        regraAplicada,
        // Usa a categoria JA escolhida no select desta linha (o usuario pode
        // ter corrigido a sugestao antes de clicar "+lancar"), nao sempre a
        // sugestao original — mesmo estado que o lote usaria.
        categoria: estado.categoria !== CATEGORIA_A_CLASSIFICAR ? estado.categoria : undefined,
        formaPagamentoId: estado.formaPagamentoId || undefined,
        // Linha de parcelamento carrega parcela_atual/parcela_total: sem
        // propagar isso pro rascunho, o lançamento manual saía "solto"
        // (sem número de parcela nem parcelaKey), diferente do lançamento
        // que a mesma compra teria se tivesse sido auto-confirmada.
        ...(item.parcela_atual ? {
          parcela_atual: item.parcela_atual,
          parcela_total: item.parcela_total,
          parcelaKey: computeParcelaKey(item.descricao, item.data, item.parcela_total),
          // Vencimento REAL da fatura (nao a data da compra, que e item.data)
          // — sem isso, parcelaGroupsDaConta usava a data da compra como
          // ancora de projecao (empurrando as parcelas restantes ~1 mes pra
          // tras), porque parcela 1/n nunca e auto-confirmada
          // (autoConfirmParcelas exige parcela_atual > 1 ou candidato
          // previo) e so chega em transactions por este botao.
          faturaVencimento: ctx.faturaVencimento,
        } : {}),
      };
      irParaAba('Lancamentos');
    },
  });

  const linhaEl = el('div', { class: 'item-balde item-form-lote' }, [
    chk,
    botaoLancarIndividual,
    el('span', { class: 'item-descricao', text: `${item.descricao}${sufixoParcela(item)}` }),
    el('span', { class: 'item-meta', text: `${formatDateBR(item.data)} · ${fmtBRL(item.valor)}` }),
    // Reusa o wrapper de grid de conciliacao-extrato.js (styles.css) mesmo
    // com um select só (fatura não tem natureza/forma editável por linha,
    // só categoria) — sem o wrapper, o select cairia fora do grid-row
    // esperado por .item-form-lote e quebraria o layout da linha.
    el('div', { class: 'item-form-lote-selects uma-coluna' }, [selCategoria]),
    regraAplicada ? el('span', { class: 'selo-categoria-sugerida', text: `sugerido: ${nomeCategoria(estado.categoria)}` }) : null,
  ]);

  return { linhaEl, item, estado };
}

// Grava em lote as linhas com checkbox marcado — mesma lógica de gravação +
// aprendizado de regra + aplicação retroativa que lancarSelecionadas de
// conciliacao-extrato.js, adaptada ao formato de item de fatura.
//
// `botaoLote` some desabilitado por toda a duração da função (bug real,
// medido 2026-08-12): sem essa guarda, o botão continuava clicável enquanto
// o modal "Aplicar retroativamente?" esperava resposta do usuário (ou
// enquanto o primeiro saveTransactions ainda rodava) — cliques extras
// nesse intervalo reentravam na função com o MESMO `linhasFormulario`
// (closure antigo, DOM ainda não re-renderizado pelo aoConcluir), gerando
// várias transações idênticas (mesmo origemRef.linhaId) para a mesma linha
// da fatura. Cada cópia extra nunca casa no runReconciliation (só a
// primeira usa o único slot disponível), então a linha real da fatura
// parecia "presa" no balde e cada nova tentativa criava mais uma duplicata.
async function lancarEmLoteFatura(linhasFormulario, ctx, aoConcluir, botaoLote) {
  const selecionadas = linhasFormulario.filter((lf) => lf.estado.selecionado);
  if (!selecionadas.length) return;

  botaoLote.disabled = true;
  try {
    await lancarEmLoteFaturaInterno(selecionadas, ctx, aoConcluir);
  } finally {
    botaoLote.disabled = false;
  }
}

async function lancarEmLoteFaturaInterno(selecionadas, ctx, aoConcluir) {

  const novosLancamentos = selecionadas.map((lf) => novaTransaction({
    descricao: lf.item.descricao,
    valor: lf.item.valor,
    data: lf.item.data,
    categoria: lf.estado.categoria,
    formaPagamentoId: lf.estado.formaPagamentoId,
    contaId: ctx.contaId,
    natureza: 'despesa',
    origem: 'fatura',
    origemRef: { statementId: ctx.statementId, linhaId: lf.item.id },
    classificadoAutomaticamente: !!lf.estado.regraAplicada,
    regraId: lf.estado.regraAplicada ? lf.estado.regraAplicada.id : null,
    // Mesma propagacao de parcela que o "+lancar" individual ja faz — sem
    // isso, uma parcela lancada em lote saia sem parcelaKey/faturaVencimento,
    // diferente da mesma compra lancada uma a uma.
    ...(lf.item.parcela_atual ? {
      parcela_atual: lf.item.parcela_atual,
      parcela_total: lf.item.parcela_total,
      parcelaKey: computeParcelaKey(lf.item.descricao, lf.item.data, lf.item.parcela_total),
      faturaVencimento: ctx.faturaVencimento,
    } : {}),
  }));

  await saveTransactions(novosLancamentos);

  // Se a categoria escolhida divergiu da sugerida (ou não havia sugestão),
  // aprende/corrige a regra e oferece aplicar retroativamente — mesmo
  // espirito do lote de extrato.
  for (const lf of selecionadas) {
    const sugeriaOutraCoisa = lf.estado.regraAplicada && lf.estado.regraAplicada.categoriaId !== lf.estado.categoria;
    const semSugestaoAlguma = !lf.estado.regraAplicada && lf.estado.categoria !== CATEGORIA_A_CLASSIFICAR;
    if (!sugeriaOutraCoisa && !semSugestaoAlguma) continue;

    const regra = aprenderRegra({ descricaoCanonica: lf.item.descricaoCanonica, escopo: 'fatura', categoriaId: lf.estado.categoria, contaId: null }, ctx.regras);
    await storage.put('classificationRules', regra);

    const transacoes = await storage.getAll('transactions');
    const descricaoCanonicaPorTransacao = new Map(
      transacoes.filter((t) => !novosLancamentos.some((n) => n.id === t.id)).map((t) => [
        t.id, t.origemRef ? canonicalizar(t.descricao, t.origem) : null,
      ])
    );
    const candidatos = candidatosRetroativos(transacoes, regra, descricaoCanonicaPorTransacao);
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

  toast(`${novosLancamentos.length} lançamento(s) lançado(s) em lote.`, 'ok');
  await aoConcluir();
}

// `categorias` vem por parâmetro (não capturado do módulo) porque estas
// duas funções são puras o bastante para não depender de estado externo —
// mesmo padrão do restante do arquivo, que sempre recebe `ctx`/dados por
// argumento em vez de globals.
function nomeCategoria(categoriaId, categorias) {
  return (categorias.find((c) => c.id === categoriaId) || {}).nome || 'A Classificar';
}

function itemMatched(par, categorias) {
  return el('div', { class: 'item-balde item-conciliado' }, [
    el('span', { class: 'item-descricao', text: `${par.fatura.descricao}${sufixoParcela(par.fatura)}` }),
    el('span', { class: 'item-meta', text: `${formatDateBR(par.fatura.data)} · ${fmtBRL(par.fatura.valor)} · ${nomeCategoria(par.app.categoria, categorias)}` }),
  ]);
}

function itemApp(t, categorias) {
  return el('div', { class: 'item-balde' }, [
    el('span', { class: 'item-descricao', text: `${t.descricao}${sufixoParcela(t)}` }),
    el('span', { class: 'item-meta', text: `${formatDateBR(t.data)} · ${fmtBRL(t.valor)} · ${nomeCategoria(t.categoria, categorias)}` }),
  ]);
}

function balde(titulo, itens, vazio) {
  return el('div', { class: 'balde' }, [
    el('h3', { text: `${titulo} (${itens.length})` }),
    itens.length ? el('div', { class: 'lista-balde' }, itens) : el('p', { class: 'vazio', text: vazio }),
  ]);
}

export async function renderBaldesFatura(painel, fatura, faturasList, transactions, accounts, regras, formas, categorias, aoMudar) {
  const { autoMatched, matched, faturaUnmatched, appUnmatched } = runReconciliation(fatura, faturasList, transactions, accounts);

  const ctx = {
    contaId: fatura.contaId, statementId: fatura.id, faturaVencimento: fatura.vencimento,
    categorias, regras, formaCredito: formaCreditoParaCartao(fatura.contaId, formas),
  };
  const linhasFormulario = faturaUnmatched.map((item) => montarLinhaFatura(item, ctx));

  const botaoLote = el('button', { class: 'btn btn-primario', text: '+ lançar em lote', disabled: 'disabled' });
  const atualizarBotaoLote = () => { botaoLote.disabled = !linhasFormulario.some((lf) => lf.estado.selecionado); };
  linhasFormulario.forEach((lf) => lf.linhaEl.querySelector('input[type=checkbox]').addEventListener('change', atualizarBotaoLote));
  // aoMudar (renderConciliacao) refaz o fetch de transactions do zero — mesma
  // razão de conciliacao-extrato.js: reusar os dados capturados neste
  // closure logo após o lote gravar mostraria itens já lançados como se
  // ainda estivessem pendentes.
  botaoLote.addEventListener('click', () => lancarEmLoteFatura(linhasFormulario, ctx, aoMudar, botaoLote));

  painel.innerHTML = '';
  painel.append(
    balde('Conciliado automaticamente', autoMatched.map((par) => itemMatched(par, categorias)), 'Nenhum item conciliado automaticamente.'),
    balde('Conciliado', matched.map((par) => itemMatched(par, categorias)), 'Nenhum item conciliado.'),
    el('div', { class: 'balde' }, [
      el('h3', { text: `Na fatura, não lançado no app (${faturaUnmatched.length})` }),
      linhasFormulario.length
        ? el('div', {}, [...linhasFormulario.map((lf) => lf.linhaEl), el('div', { class: 'acoes' }, [botaoLote])])
        : el('p', { class: 'vazio', text: 'Tudo da fatura já está lançado no app.' }),
    ]),
    balde('No app, não na fatura', appUnmatched.map((t) => itemApp(t, categorias)), 'Nenhum lançamento do app ficou de fora da fatura.')
  );
}
