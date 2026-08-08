// Aba Lançamentos: a tela de uso diário, onde cada gasto é digitado. A regra
// de ouro do sistema (o que conta como gasto) mora em domain/transactions.js;
// esta tela só coleta o formulário e delega validação e persistência ao
// domínio — inclusive a marcação visual do que não é gasto, que usa
// contaComoGasto() em vez de reimplementar a metade da regra.
//
// Conta e forma de pagamento desativadas somem do seletor do formulário,
// exceto quando são o valor já gravado no lançamento em edição: um lançamento
// antigo que aponta para uma conta já desativada precisa continuar mostrando
// essa conta e permitir salvar sem forçar o usuário a trocar por outra só
// para poder editar a descrição.

import { el, toast, confirmar } from './components.js';
import {
  viewDateParaMes, mesParaViewDate, montarNavegacaoMes, montarBarraFiltros,
} from './lancamentos-filtros.js';
import { montarFormularioLancamento } from './lancamentos-form.js';
import { rascunhoLancamento, limparRascunhoLancamento } from './conciliacao-fatura.js';
import {
  listTransactions, removeTransaction, filterTransactions, sumDespesas, contaComoGasto,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { registrarEvento, TIPOS_EVENTO, listarEventos } from '../domain/audit-log.js';
import { listAccounts } from '../domain/accounts.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR, todayISO, monthKey } from '../core/dates.js';
import * as storage from '../core/storage.js';
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';

let viewDate = mesParaViewDate(monthKey(todayISO()));
let filtros = {};
let editandoId = null;

// Chamado pelo roteador (app.js) ao entrar na aba vindo de outro lugar —
// nunca pelo re-render interno da própria tela, que precisa preservar o
// filtro e a edição em curso. Sem isso, editar um lançamento, ir para
// Cadastros e voltar deixava o formulário armado para sobrescrever um
// lançamento antigo, e o filtro de mês/forma anterior continuava aplicado
// sem nenhum indício.
export function resetLancamentos() {
  editandoId = null;
  viewDate = mesParaViewDate(monthKey(todayISO()));
  filtros = {};
}

// opcoesAtivas e rotuloComStatus moraram aqui e foram extraídas para
// cadastros-comuns.js: os seletores de Cadastros que referenciam outro
// cadastro (ex.: "conta que paga a fatura", "conta padrão da forma")
// precisam da mesma regra — um cadastro desativado sem marca, ou pior,
// escondido, era exatamente o furo que a revisão final pegou.
//
// interpretarValor, tipoContaParaForma, contasParaForma e
// contaPadraoValidaParaForma moraram aqui e foram extraídas para
// ui/lancamentos-form.js junto com o formulário de lançar/editar (revisão
// final da fase, para manter os dois arquivos abaixo de ~250 linhas) e são
// testadas em tests/lancamentos-form.test.js.

// Pura: a marcação visual de "não é gasto" tem que ser a MESMA regra que
// decide o total (contaComoGasto, usada por sumDespesas) — nunca uma cópia
// parcial dela. Uma despesa prevista (previsto: true) não conta como gasto,
// igual a receita/transferência/pagamento de fatura, e por isso também
// precisa da marca; checar só `natureza !== 'despesa'` deixava passar
// batido uma despesa prevista, que aparecia lado a lado com gasto real sem
// nenhuma pista de que não somava no total.
export function classeDoItem(t) {
  return `item-lancamento${contaComoGasto(t) ? '' : ' nao-gasto'}`;
}

export async function renderLancamentos() {
  const painel = document.getElementById('tabLancamentos');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };
  filtros.mes = viewDateParaMes(viewDate);
  const visiveis = filterTransactions(transacoes, filtros)
    .sort((a, b) => (a.data < b.data ? 1 : -1));

  // O rascunho vindo do botão "+lançar" da Conciliação (conciliacao-fatura.js)
  // só serve UMA vez: lido aqui e limpo na hora, senão ele voltaria a
  // preencher o formulário em todo re-render seguinte (trocar filtro, navegar
  // de mês, editar outro lançamento) até o usuário sair da aba.
  const rascunho = editandoId ? null : rascunhoLancamento;
  if (rascunho) limparRascunhoLancamento();

  painel.innerHTML = '';
  painel.append(
    montarNavegacaoMes(viewDate, async (novoViewDate) => { viewDate = novoViewDate; await renderLancamentos(); }),
    await montarFormularioLancamento(ctx, transacoes, editandoId, (novoId) => { editandoId = novoId; }, renderLancamentos, rascunho),
    montarBarraFiltros(ctx, filtros, renderLancamentos),
    el('div', { class: 'total-periodo', text: `Total de gastos no período: ${fmtBRL(sumDespesas(visiveis))}` }),
    listagem(visiveis, ctx),
    rodape(renderLancamentos)
  );
}

// Atalhos de backup/importar/apagar tudo, disponíveis direto na aba de uso
// diário — sem precisar ir até Cadastros. Reusa a mesma lógica de
// exportar/importar de backup-comum.js (ver seção "Backup" de Cadastros),
// pra não duplicar tratamento de erro de leitura de arquivo.
async function exportarLog() {
  const eventos = await listarEventos();
  // dataHora (string legivel) e adicionada so na EXPORTACAO, ao lado do
  // timestamp numerico ja existente (mantido, util pra reprocessamento
  // automatizado) — sem essa conversao, abrir o .json exportado mostrava
  // so o numero epoch, ilegivel sem converter manualmente.
  const eventosComData = eventos.map((e) => ({ ...e, dataHora: new Date(e.timestamp).toLocaleString('pt-BR') }));
  const blob = new Blob([JSON.stringify(eventosComData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `log-financas-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Log exportado.', 'ok');
}

function rodape(aoMudar) {
  const inputImportar = montarInputImportarBackup(aoMudar);
  inputImportar.id = 'inputImportarBackupLancamentos';
  return el('div', { class: 'rodape-lancamentos' }, [
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', type: 'button', text: 'Backup completo', onclick: baixarBackup }),
      el('label', { class: 'btn', for: 'inputImportarBackupLancamentos', style: 'text-align:center; cursor:pointer;' }, ['Importar backup']),
      el('button', { class: 'btn', type: 'button', text: 'Exportar log', onclick: exportarLog }),
    ]),
    inputImportar,
    el('div', { class: 'links-perigo' }, [
      el('button', {
        class: 'link-perigo', type: 'button', text: 'Apagar todas as transações',
        onclick: () => apagarTransacoes(aoMudar),
      }),
      el('button', {
        class: 'link-perigo', type: 'button', text: 'Apagar todos os dados do app',
        onclick: () => apagarTudo(aoMudar),
      }),
    ]),
  ]);
}

// window.confirm (não o confirmar() genérico de components.js) porque o
// aviso precisa do texto específico de "sem volta" e "já fez backup?" — um
// diálogo de uma linha não é suficiente pra uma ação destrutiva.
async function apagarTransacoes(aoMudar) {
  const ok = window.confirm(
    'Isso apaga TODOS os lançamentos e documentos importados (faturas/extratos) deste ' +
    'aparelho, sem volta. Contas, formas de pagamento, categorias e regras cadastradas ' +
    'são preservadas. Já fez backup? Toque OK só se tiver certeza.'
  );
  if (!ok) return;
  await storage.resetTransacoes();
  await registrarEvento(TIPOS_EVENTO.APAGAR_TRANSACOES, 'Apagou todas as transações e documentos importados');
  toast('Lançamentos e documentos importados foram apagados.', 'ok');
  await aoMudar();
}

async function apagarTudo(aoMudar) {
  const ok = window.confirm(
    'Isso apaga TODOS os lançamentos, categorias, contas, formas de pagamento e faturas ' +
    'importadas deste aparelho, sem volta. Já fez backup? Toque OK só se tiver certeza.'
  );
  if (!ok) return;
  await storage.resetAllData();
  await registrarEvento(TIPOS_EVENTO.APAGAR_TUDO, 'Apagou todos os dados do app');
  toast('Todos os dados foram apagados.', 'ok');
  await aoMudar();
}

function listagem(visiveis, ctx) {
  if (!visiveis.length) return el('p', { class: 'vazio', text: 'Nenhum lançamento neste filtro.' });
  const nome = (lista, id) => (lista.find((x) => x.id === id) || {}).nome || '—';

  return el('div', { class: 'lista-lancamentos' }, visiveis.map((t) =>
    el('div', { class: classeDoItem(t) }, [
      el('div', { class: 'lanc-principal' }, [
        el('span', { class: 'lanc-descricao', title: `${t.descricao}${t.parcela_atual ? ` (${t.parcela_atual}/${t.parcela_total})` : ''}`, text: `${t.descricao}${t.parcela_atual ? ` (${t.parcela_atual}/${t.parcela_total})` : ''}` }),
        t.classificadoAutomaticamente ? el('span', { class: 'selo-auto', title: 'Categoria aplicada automaticamente', text: 'auto' }) : null,
      ]),
      el('div', { class: 'lanc-meta', text: `${formatDateBR(t.data)} · ${nome(ctx.categorias, t.categoria)} · ${nome(ctx.formas, t.formaPagamentoId)}` }),
      el('div', { class: 'lanc-valor', text: fmtBRL(t.valor) }),
      el('div', { class: 'item-lancamento-acoes' }, [
        el('button', { class: 'btn btn-mini', text: '✎', 'aria-label': 'Editar', title: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: '✕', 'aria-label': 'Excluir', title: 'Excluir', onclick: () => excluir(t) }),
      ]),
    ])
  ));
}

async function excluir(t) {
  if (!(await confirmar(`Excluir "${t.descricao}"?`))) return;
  await removeTransaction(t.id);
  await registrarEvento(TIPOS_EVENTO.LANCAMENTO_EXCLUIDO, 'Lançamento excluído');
  toast('Lançamento excluído.', 'ok');
  await renderLancamentos();
}
