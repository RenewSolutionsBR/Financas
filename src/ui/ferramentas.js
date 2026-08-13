// Menu "Ferramentas": porta de entrada ÚNICA para tudo que não é uso diário
// — backup, exportações, importação por planilha, diagnóstico e as ações
// destrutivas. Vive no cabeçalho, acessível de qualquer aba.
//
// Por que este módulo existe (pedido do usuário, 2026-08-13): as mesmas
// funções tinham nascido espalhadas por três abas conforme o app crescia, e
// duas delas estavam DUPLICADAS com rótulos diferentes para a mesma ação —
// "Backup completo" (rodapé de Lançamentos) e "Exportar backup" (seção
// Backup de Cadastros) chamavam a mesma `baixarBackup`. Agrupar num lugar só
// resolve a dispersão e elimina o risco de os dois rótulos divergirem.
//
// Nenhuma lógica nova mora aqui: cada ação delega para o módulo que já a
// implementava (backup-comum.js, audit-log, storage, reconcile-card). Este
// arquivo é só a tela do menu.

import { el, toast, abrirModal } from './components.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR } from '../core/dates.js';
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';
import { APP_VERSION } from '../version.js';
import * as storage from '../core/storage.js';
import { registrarEvento, TIPOS_EVENTO, listarEventos } from '../domain/audit-log.js';
import { listTransactions, saveTransactions } from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listAccounts } from '../domain/accounts.js';
import { listFormas } from '../domain/payment-methods.js';
import { buildFullReconciliationRows } from '../domain/reconcile-card.js';
import { baixarModelo } from '../importers/modelos-planilha.js';
import { parseLancamentosPlanilha, matrizDoArquivo, marcarPossiveisDuplicatas } from '../importers/lancamentos-xlsx.js';

// --- Ações que já existiam em outras telas, movidas para cá sem alteração ---

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

async function exportarConciliacaoCompleta() {
  try {
    const [transactions, statements, accounts, apelidosTitular, categorias] = await Promise.all([
      listTransactions(),
      storage.getAll('statements'),
      listAccounts(),
      storage.getMeta('apelidosTitular', []),
      listCategorias(),
    ]);
    const faturas = statements.filter((s) => s.tipo === 'fatura');
    const extratos = statements.filter((s) => s.tipo === 'extrato');
    if (!faturas.length && !extratos.length) {
      toast('Nenhum documento importado para exportar.', 'erro');
      return;
    }
    const rows = buildFullReconciliationRows(faturas, extratos, transactions, accounts, apelidosTitular, categorias);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conciliacao');
    XLSX.writeFile(wb, `conciliacao-completa-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    toast('Não consegui exportar a conciliação: ' + e.message, 'erro');
  }
}

// TEMPORARIO (investigacao de bug em producao, remover depois de resolvido):
// mostra o formato tecnico dos statements direto na tela do aparelho, sem
// precisar de DevTools remoto/cabo — o unico jeito viavel de diagnosticar um
// problema que so acontece no celular do usuario, onde o DevTools via USB se
// mostrou muito instavel pra depurar ao vivo.
async function diagnosticoStatements() {
  const statements = await storage.getAll('statements');
  const linhas = statements.map((s) => {
    const tipoRows = Array.isArray(s.rows) ? `array(${s.rows.length})` : typeof s.rows;
    const camposPrimeiraLinha = Array.isArray(s.rows) && s.rows[0] ? Object.keys(s.rows[0]).join(', ') : '(nenhuma linha)';
    let detalheString = '';
    if (typeof s.rows === 'string') {
      const tam = s.rows.length;
      const meio = Math.floor(tam / 2);
      detalheString = `\ntamanho da string: ${tam}` +
        `\ninicio (0-80): ${JSON.stringify(s.rows.slice(0, 80))}` +
        `\nmeio (${meio}-${meio + 80}): ${JSON.stringify(s.rows.slice(meio, meio + 80))}` +
        `\nfim (ultimos 80): ${JSON.stringify(s.rows.slice(-80))}`;
    }
    return `id: ${s.id}\ntipo: ${s.tipo}\nrows: ${tipoRows}\ncampos da 1a linha: ${camposPrimeiraLinha}${detalheString}`;
  });
  await abrirModal({
    titulo: 'Diagnóstico (técnico)',
    corpo: el('div', {}, linhas.length
      ? linhas.map((texto) => el('pre', { style: 'white-space: pre-wrap; font-size: 0.75rem; border-bottom: 1px solid var(--linha); padding: 8px 0;', text: texto }))
      : [el('p', { text: 'Nenhum documento (fatura/extrato) importado.' })]),
    acoes: [{ id: 'ok', rotulo: 'Fechar' }],
  });
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

function baixar(tipo) {
  try {
    baixarModelo(tipo);
    toast('Modelo baixado.', 'ok');
  } catch (e) {
    toast('Não consegui gerar o modelo: ' + e.message, 'erro');
  }
}

// Importa a planilha de lançamentos direto para a aba Lançamentos (sem
// conciliação). Mostra SEMPRE um resumo antes de gravar: diferente de
// fatura/extrato, aqui não há tela de baldes onde revisar depois — uma vez
// gravado, desfazer seria apagar linha por linha.
async function importarPlanilhaLancamentos(arquivo, aoConcluir) {
  const [categorias, formas, contas] = await Promise.all([listCategorias(), listFormas(), listAccounts()]);
  const matriz = matrizDoArquivo(await arquivo.arrayBuffer(), arquivo.name);
  const { transacoes, avisos, erros } = parseLancamentosPlanilha(matriz, { categorias, formas, contas });

  if (erros.length) {
    await abrirModal({
      titulo: 'Planilha fora do modelo',
      corpo: el('div', {}, erros.map((e) => el('p', { text: e }))),
      acoes: [{ id: 'ok', rotulo: 'Fechar' }],
    });
    return;
  }
  if (!transacoes.length) {
    await abrirModal({
      titulo: 'Nada para importar',
      corpo: el('div', {}, [
        el('p', { text: 'Nenhuma linha da planilha pôde ser importada.' }),
        ...avisos.map((a) => el('p', { class: 'ajuda', text: a })),
      ]),
      acoes: [{ id: 'ok', rotulo: 'Fechar' }],
    });
    return;
  }

  // Aviso de duplicata: esta importação grava direto, sem os baldes da
  // conciliação onde daria pra revisar depois. Reimportar o mesmo arquivo
  // (ou dois arquivos com meses sobrepostos) criava cópias em silêncio.
  const existentes = await listTransactions();
  const marcadas = marcarPossiveisDuplicatas(transacoes, existentes);
  const duplicadas = marcadas.filter((t) => t.possivelDuplicata);
  const novas = marcadas.filter((t) => !t.possivelDuplicata);

  const total = marcadas.reduce((s, t) => s + (t.natureza === 'despesa' ? t.valor : 0), 0);
  const totalNovas = novas.reduce((s, t) => s + (t.natureza === 'despesa' ? t.valor : 0), 0);

  const linhaDuplicata = (t) => {
    const jaExiste = t.possivelDuplicata.existente;
    const certeza = t.possivelDuplicata.descricaoIgual ? '' : ' (descrição diferente — confira)';
    return el('li', { text: `${formatDateBR(t.data)} — ${t.descricao} — ${fmtBRL(t.valor)} · já lançado como "${jaExiste.descricao}"${certeza}` });
  };

  const acoes = duplicadas.length
    ? [
        { id: 'cancelar', rotulo: 'Cancelar' },
        // "Importar tudo" fica disponível porque a heurística é data+valor:
        // dois gastos iguais no mesmo dia (dois cafés de R$ 5,00) são
        // legítimos, e só o usuário sabe. O padrão, porém, é pular.
        { id: 'tudo', rotulo: 'Importar tudo' },
        ...(novas.length ? [{ id: 'so_novas', rotulo: `Importar só ${novas.length} nova(s)` }] : []),
      ]
    : [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'tudo', rotulo: 'Importar' }];

  const escolha = await abrirModal({
    titulo: 'Confirmar importação',
    corpo: el('div', {}, [
      el('p', { text: `${marcadas.length} lançamento(s) prontos para importar (${fmtBRL(total)} em gastos).` }),
      duplicadas.length ? el('p', { class: 'aviso-erro', text: `${duplicadas.length} já parece(m) estar lançado(s) no app (mesma data e mesmo valor):` }) : null,
      duplicadas.length ? el('ul', { class: 'lista-preview' }, duplicadas.map(linhaDuplicata)) : null,
      duplicadas.length && novas.length ? el('p', { class: 'ajuda', text: `As outras ${novas.length} são novas (${fmtBRL(totalNovas)} em gastos).` }) : null,
      avisos.length ? el('p', { class: 'aviso-erro', text: `${avisos.length} linha(s) serão puladas:` }) : null,
      avisos.length ? el('ul', { class: 'lista-preview' }, avisos.map((a) => el('li', { text: a }))) : null,
      el('p', { class: 'ajuda', text: 'Os lançamentos entram direto na aba Lançamentos, sem passar pela conciliação.' }),
    ]),
    acoes,
  });
  if (escolha !== 'tudo' && escolha !== 'so_novas') return;

  // `possivelDuplicata` é só um adorno da tela — nunca vai para o banco.
  const aGravar = (escolha === 'so_novas' ? novas : marcadas).map(({ possivelDuplicata, ...t }) => t);
  await saveTransactions(aGravar);
  await registrarEvento(
    TIPOS_EVENTO.LANCAMENTO_CRIADO,
    `Importou ${aGravar.length} lançamento(s) de planilha` +
    (duplicadas.length ? ` (${duplicadas.length} possível(is) duplicata(s), ${escolha === 'so_novas' ? 'ignorada(s)' : 'importada(s) mesmo assim'})` : '')
  );
  toast(`${aGravar.length} lançamento(s) importados.`, 'ok');
  await aoConcluir();
}

// --- O menu em si ---

function grupo(titulo, ajuda, botoes, perigo) {
  return el('div', { class: `ferramentas-grupo${perigo ? ' ferramentas-grupo-perigo' : ''}` }, [
    el('h3', { class: 'ferramentas-grupo-titulo', text: titulo }),
    ajuda ? el('p', { class: 'ajuda', text: ajuda }) : null,
    el('div', { class: 'ferramentas-botoes' }, botoes),
  ]);
}

// `aoMudar` re-renderiza a aba ativa depois de uma ação que muda dados
// (importar backup, apagar) — sem isso, a tela atrás do menu continuaria
// mostrando lançamentos que acabaram de ser apagados.
export function abrirFerramentas(aoMudar) {
  // Declarado ANTES de `recarregar`: `let` tem zona morta temporal, e
  // `recarregar` (passado para montarInputImportarBackup logo abaixo) chama
  // `fecharMenu()`. Com a declaração depois, importar um backup lançava
  // ReferenceError em vez de fechar o menu.
  let fecharMenu = () => {};

  const recarregar = async () => {
    fecharMenu();
    if (aoMudar) await aoMudar();
  };
  const inputImportarBackup = montarInputImportarBackup(recarregar);

  const inputLancamentos = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'oculto' });
  inputLancamentos.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try {
      await importarPlanilhaLancamentos(arquivo, recarregar);
    } catch (e) {
      toast('Não consegui ler essa planilha: ' + e.message, 'erro');
    } finally {
      // Sempre limpa, inclusive no cancelamento: sem isso, reselecionar o
      // MESMO arquivo não dispara `change` de novo e a tela fica muda.
      ev.target.value = '';
    }
  });

  const corpo = el('div', { class: 'ferramentas' }, [
    grupo('Backup', 'O backup contém todos os seus dados, inclusive faturas e extratos importados. É a única forma de levar seus dados para outro aparelho.', [
      el('button', { class: 'btn', type: 'button', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', type: 'button', text: 'Importar backup', onclick: () => inputImportarBackup.click() }),
      inputImportarBackup,
    ]),
    grupo('Exportar para planilha', 'Gera arquivos para conferir fora do app. Não alteram nada nos seus dados.', [
      el('button', { class: 'btn', type: 'button', text: 'Conciliação completa (.xlsx)', onclick: exportarConciliacaoCompleta }),
      el('button', { class: 'btn', type: 'button', text: 'Log de auditoria (.json)', onclick: exportarLog }),
    ]),
    grupo('Modelos de planilha', 'Baixe o modelo, preencha fora do app e importe. Fatura e extrato são importados na aba Conciliação; lançamentos entram direto, pelo botão abaixo.', [
      el('button', { class: 'btn', type: 'button', text: 'Modelo de fatura (.xlsx)', onclick: () => baixar('fatura') }),
      el('button', { class: 'btn', type: 'button', text: 'Modelo de extrato (.xlsx)', onclick: () => baixar('extrato') }),
      el('button', { class: 'btn', type: 'button', text: 'Modelo de lançamentos (.xlsx)', onclick: () => baixar('lancamentos') }),
      el('button', { class: 'btn', type: 'button', text: 'Importar planilha de lançamentos', onclick: () => inputLancamentos.click() }),
      inputLancamentos,
    ]),
    grupo('Suporte', null, [
      el('button', { class: 'btn', type: 'button', text: 'Diagnóstico', onclick: diagnosticoStatements }),
    ]),
    // Bloco destrutivo por último e visualmente separado: são as únicas ações
    // do menu sem volta, e ficar no fim reduz a chance de toque acidental de
    // quem entrou aqui só para exportar um backup.
    grupo('Apagar dados', 'Estas ações não têm volta. Exporte um backup antes.', [
      el('button', {
        class: 'btn btn-perigo', type: 'button', text: 'Apagar todas as transações',
        onclick: () => apagarTransacoes(recarregar),
      }),
      el('button', {
        class: 'btn btn-perigo', type: 'button', text: 'Apagar todos os dados do app',
        onclick: () => apagarTudo(recarregar),
      }),
    ], true),
    // Versao visivel na propria tela: sem isso, nao ha como o usuario
    // confirmar se o aparelho ja pegou a ultima publicacao ou ainda esta
    // servindo uma versao antiga do cache do service worker (bug real
    // visto em producao, onde um fix so chegava no aparelho depois do
    // usuario confirmar a versao manualmente via este numero).
    el('p', { class: 'ajuda ferramentas-versao', text: `Versão do app: ${APP_VERSION}` }),
  ]);

  const promessa = abrirModal({
    titulo: 'Ferramentas',
    corpo,
    acoes: [{ id: 'fechar', rotulo: 'Fechar' }],
  });
  // abrirModal resolve quando o usuário escolhe uma ação; para fechar o menu
  // programaticamente (depois de importar/apagar), basta clicar no "Fechar"
  // que ele mesmo montou — evita duplicar a lógica de desmontagem do overlay.
  fecharMenu = () => {
    const botao = document.querySelector('#modalRaiz .modal-acoes .btn');
    if (botao) botao.click();
  };
  return promessa;
}
