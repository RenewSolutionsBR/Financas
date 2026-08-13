// Upload, deteccao/escolha de adaptador, mapeamento manual (generic-table),
// preview com checksum e commit da importacao. commitImportacao e o coracao
// da task: orquestra os modulos de dominio na ordem que evita estado
// intermediario inconsistente (spec Task 12) — e e PURA (nao toca storage),
// para poder ser testada de integracao sem IndexedDB (tests/conciliacao-import.test.js).
// Quem persiste de fato e commitImportacaoEGravar, logo abaixo.

import { el, toast, confirmar } from './components.js';
import { fmtBRL } from '../core/money.js';
import { formatDateBR } from '../core/dates.js';
import { uid } from '../core/ids.js';
import * as storage from '../core/storage.js';
import { detectarMelhorAdaptador, adaptadoresParaExtensao } from '../importers/registry.js';
// Importados só pelo efeito colateral de register() (Task 1) — sem isto
// nenhum adaptador aparece em adaptadoresParaExtensao.
import '../importers/generic-table.js';
import '../importers/santander-cartao-pdf.js';
import '../importers/santander-extrato-xls.js';
import { MAPEAMENTO_MODELO } from '../importers/modelos-planilha.js';
import { autoConfirmParcelas, syncPredictions } from '../domain/parcelas.js';
import { atribuirNatureza, confrontarFaturaDebito } from '../domain/reconcile-bank.js';
import { processarPagamentoFatura } from '../domain/pagamento-fatura.js';
import { registrarEvento, TIPOS_EVENTO } from '../domain/audit-log.js';

// Orquestra statement -> parcelamento (fatura) OU natureza bancaria (extrato)
// -> regra de registro unico do pagamento de fatura -> (classificacao
// automatica do que sobrou fica para a tela de extrato/lote, Step 3 — aqui
// so lancamentos JA INEQUIVOCOS, pagamento_fatura e parcela confirmada, sao
// produzidos). Devolve um PLANO de gravacao (nunca grava sozinha), para ser
// testavel como integracao de dominio pura e para o chamador decidir a
// ordem/atomicidade real da persistencia.
// Mesma montagem de id usada em commitImportacao (statementToPut.id,
// abaixo) — extraída pra função própria pra não duplicar a fórmula entre
// o commit de verdade e o aviso de "já importado" na tela de análise.
export function idDeterministicoDoDocumento(contaId, tipo, statement) {
  return `${contaId}|${tipo}|${statement.vencimento || statement.periodoFim}`;
}

// Devolve o documento já salvo com o MESMO id determinístico, ou null.
// `documentosExistentes` é a lista de statements já salvos da MESMA conta
// (quem chama já filtra por contaId antes de passar aqui).
export function documentoJaImportado(contaId, tipo, statement, documentosExistentes) {
  const id = idDeterministicoDoDocumento(contaId, tipo, statement);
  return (documentosExistentes || []).find((d) => d.id === id) || null;
}

export async function commitImportacao({ tipo, contaId, statement, rows, transactions, accounts, apelidosTitular, allStatements, regras, formas }) {
  // As linhas devolvidas pelo adaptador (rows) carregam a data da COMPRA
  // (r.data), nao a data de VENCIMENTO da fatura — so o statement tem essa
  // informacao. autoConfirmParcelas/syncPredictions (domain/parcelas.js)
  // precisam de row.vencimento pra gerar o id da parcela confirmada e a
  // data de cada previsao futura, e runReconciliation (Conciliacao) precisa
  // do MESMO row.vencimento pra recalcular a parcelaKey ao re-exibir a
  // fatura depois de salva. O carimbo precisa ir pro `rows` gravado no
  // statementToPut (nao so numa variavel local usada so na hora do
  // commit): salvar sem ele fazia autoConfirmParcelas confirmar direito na
  // hora da importacao, mas toda vez que a fatura era reaberta depois
  // (Conciliacao, ou uma 2a fatura importada), runReconciliation lia
  // row.vencimento undefined do storage e o matching por data/parcelaKey
  // falhava silenciosamente — as proprias parcelas que a fatura tinha
  // confirmado apareciam de volta em "No app, nao na fatura".
  const rowsComVencimento = rows.map((r) => ({ ...r, vencimento: r.vencimento || statement.vencimento }));
  const statementToPut = { ...statement, id: idDeterministicoDoDocumento(contaId, tipo, statement), contaId, tipo, rows: rowsComVencimento };

  const transactionsToPut = [];
  const transactionIdsToRemove = [];
  let baseTransactions = transactions || [];

  const registrarPagamento = (linhaPagamento, origemLinha, faturaVinculadaId) => {
    const { acao, transaction } = processarPagamentoFatura(linhaPagamento, origemLinha, baseTransactions, faturaVinculadaId);
    if (acao === 'ja_completo') return;
    const gravado = acao === 'criado' ? { ...transaction, id: uid('tx') } : transaction;
    transactionsToPut.push(gravado);
    // baseTransactions atualizado: varias linhas de pagamento no mesmo commit
    // nao podem colidir entre si nem duplicar.
    baseTransactions = [...baseTransactions.filter((t) => t.id !== gravado.id), gravado];
  };

  if (tipo === 'fatura') {
    const rowsParcelamento = rowsComVencimento.filter((r) => r.tipo === 'parcelamento' && r.secao !== 'pagamentos_creditos');
    const rowsPagamento = rowsComVencimento.filter((r) => r.secao === 'pagamentos_creditos');

    // Mesma resolucao da Fase 1 (Task 14, achado #9): busca a forma ATIVA do
    // tipo certo, nunca crava 'pm_credito' — o usuario pode ter renomeado,
    // desativado ou excluido a forma padrao antes de importar.
    const formaCredito = (formas || []).find((f) => f.tipo === 'credito' && f.ativo !== false);
    if (!formaCredito) {
      throw new Error('Cadastre uma forma de pagamento do tipo "Crédito" antes de importar uma fatura (Cadastros → Formas de pagamento).');
    }

    const { updatedTransactions, confirmed, removedIds } = autoConfirmParcelas(rowsParcelamento, baseTransactions, statementToPut.dataCorte, contaId, formaCredito.id);
    transactionIdsToRemove.push(...removedIds);
    // `confirmed` (nao "id e novo"): reimportar uma fatura corrigida gera um
    // registro com o MESMO id determinístico (confirmed_${key}_${vencimento})
    // mas valor/categoria/dataCorte atualizados — filtrar por "id ja existia"
    // descartava essa correcao em silencio. putMany e idempotente por id,
    // entao regravar um registro inalterado nao tem custo real.
    for (const { after } of confirmed) transactionsToPut.push(after);
    baseTransactions = updatedTransactions;

    const { toAdd, toRemoveIds } = syncPredictions(rowsParcelamento, baseTransactions, contaId, formaCredito.id);
    transactionIdsToRemove.push(...toRemoveIds);
    transactionsToPut.push(...toAdd);
    baseTransactions = [...baseTransactions.filter((t) => !toRemoveIds.includes(t.id)), ...toAdd];

    const statementsFaturaDoCartao = (allStatements || []).filter((s) => s.tipo === 'fatura' && s.contaId === contaId);
    const faturaAnterior = statementsFaturaDoCartao
      .filter((s) => s.id !== statementToPut.id && s.vencimento < statementToPut.vencimento)
      .sort((a, b) => (a.vencimento < b.vencimento ? 1 : -1))[0];

    for (const linhaPagamento of rowsPagamento) {
      registrarPagamento({ ...linhaPagamento, statementId: statementToPut.id }, 'fatura', faturaAnterior ? faturaAnterior.id : null);
    }
  } else if (tipo === 'extrato') {
    const comNatureza = rows.map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));
    for (const linha of comNatureza) {
      if (linha.natureza !== 'pagamento_fatura') continue; // transferencia/receita/despesa esperam +lancar/+lancar em lote (Step 3)
      const statementsFatura = (allStatements || []).filter((s) => s.tipo === 'fatura');
      const confronto = confrontarFaturaDebito(linha, statementsFatura);
      registrarPagamento({ ...linha, statementId: statementToPut.id, contaId }, 'extrato', confronto ? confronto.faturaId : null);
    }
  }

  return { statementToPut, transactionsToPut, transactionIdsToRemove };
}

// Wrapper fino que persiste o plano devolvido por commitImportacao. So esta
// funcao toca storage — commitImportacao em si permanece pura e testavel.
export async function commitImportacaoEGravar(args) {
  const plano = await commitImportacao(args);
  await storage.put('statements', plano.statementToPut);
  for (const id of plano.transactionIdsToRemove) await storage.remove('transactions', id);
  if (plano.transactionsToPut.length) await storage.putMany('transactions', plano.transactionsToPut);

  const totalLinhas = (plano.statementToPut.rows || []).length;
  const confirmadas = plano.transactionsToPut.filter((t) => !t.previsto && t.origem === 'fatura').length;
  const previstas = plano.transactionsToPut.filter((t) => t.previsto).length;
  const pagamentos = plano.transactionsToPut.filter((t) => t.natureza === 'pagamento_fatura').length;
  const resumo = args.tipo === 'fatura'
    ? `Importou fatura (${plano.statementToPut.arquivo}): ${totalLinhas} linha(s), ${confirmadas} confirmada(s) automaticamente, ${previstas} prevista(s), ${pagamentos} pagamento(s)`
    : `Importou extrato: ${totalLinhas} linha(s), ${pagamentos} pagamento(s) de fatura reconhecido(s)`;
  await registrarEvento(
    args.tipo === 'fatura' ? TIPOS_EVENTO.IMPORTACAO_FATURA : TIPOS_EVENTO.IMPORTACAO_EXTRATO,
    resumo
  );

  return plano;
}

// --- UI: upload, deteccao de adaptador, mapeamento manual, preview, commit ---

export async function renderImportacao(painel, contaId, escopoSugerido, aoImportar) {
  painel.innerHTML = '';
  if (!contaId) {
    painel.append(el('p', { class: 'ajuda', text: 'Escolha uma conta ou cartão acima para importar um documento.' }));
    return;
  }

  const inputArquivo = el('input', { type: 'file', accept: '.pdf,.csv,.xls,.xlsx' });
  const areaPreview = el('div', { class: 'preview-importacao' });
  const areaResultado = el('div', { class: 'resultado-analise' });
  let estado = null; // { buffer, arquivo, tipo, adaptador, candidatos, mapeamento }

  inputArquivo.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    const buffer = await arquivo.arrayBuffer();
    const candidatos = adaptadoresParaExtensao(arquivo.name);
    const melhor = await detectarMelhorAdaptador(buffer, arquivo.name);
    estado = { buffer, arquivo: arquivo.name, candidatos, adaptadorId: melhor ? melhor.adaptador.id : (candidatos[0] || {}).id, mapeamento: null };
    areaResultado.innerHTML = '';
    renderEscolhaAdaptador();
  });

  function renderEscolhaAdaptador() {
    areaPreview.innerHTML = '';
    if (!estado || !estado.candidatos.length) {
      areaPreview.append(el('p', { class: 'ajuda', text: 'Nenhum adaptador reconhece essa extensão de arquivo.' }));
      return;
    }
    const selAdaptador = el('select', {}, estado.candidatos.map((a) =>
      el('option', { value: a.id, text: a.label, ...(a.id === estado.adaptadorId ? { selected: 'selected' } : {}) })
    ));
    selAdaptador.addEventListener('change', () => { estado.adaptadorId = selAdaptador.value; estado.mapeamento = null; renderEscolhaAdaptador(); });

    const adaptadorEscolhido = estado.candidatos.find((a) => a.id === estado.adaptadorId);
    const botaoAnalisar = el('button', { class: 'btn btn-primario', text: 'Analisar arquivo', onclick: () => analisar(adaptadorEscolhido) });
    areaPreview.append(el('div', { class: 'form' }, [
      el('label', { class: 'campo' }, [el('span', { text: 'Adaptador' }), selAdaptador]),
      adaptadorEscolhido && adaptadorEscolhido.id === 'generic-table' ? painelMapeamentoManual() : null,
      el('div', { class: 'acoes' }, [botaoAnalisar]),
    ]));
  }

  function painelMapeamentoManual() {
    const escopoInicial = escopoSugerido || 'extrato';
    const inpData = el('input', { type: 'number', min: '0', value: '0' });
    const inpDescricao = el('input', { type: 'number', min: '0', value: '1' });
    const inpValor = el('input', { type: 'number', min: '0', value: '2' });
    const inpDocumento = el('input', { type: 'number', min: '0', placeholder: '(opcional)' });
    const inpParcela = el('input', { type: 'number', min: '0', placeholder: '(opcional)' });
    const chkCabecalho = el('input', { type: 'checkbox', checked: 'checked' });
    const selEscopo = el('select', {}, ['fatura', 'extrato'].map((v) => el('option', { value: v, text: v, ...(v === escopoInicial ? { selected: 'selected' } : {}) })));
    // Vencimento da fatura: a planilha traz só os lançamentos, e uma fatura
    // pode conter compras de vários meses — deduzir o ciclo das datas das
    // linhas seria chute. Sem este campo, o id do documento saía
    // `contaId|fatura|undefined` e TODA fatura da mesma conta colidia no
    // mesmo id, substituindo a anterior em silêncio (medido 2026-08-13).
    const inpVencimento = el('input', { type: 'date' });
    const campoVencimento = el('label', { class: 'campo' }, [el('span', { text: 'Vencimento da fatura' }), inpVencimento]);

    // Botão de atalho: preenche o mapeamento com a ordem de colunas do
    // modelo baixado em Ferramentas, para quem usou o modelo não precisar
    // contar coluna nenhuma. Os campos continuam editáveis depois.
    const aplicarModelo = () => {
      const m = MAPEAMENTO_MODELO[selEscopo.value];
      if (!m) return;
      inpData.value = String(m.colData);
      inpDescricao.value = String(m.colDescricao);
      inpValor.value = String(m.colValor);
      inpDocumento.value = m.colDocumento == null ? '' : String(m.colDocumento);
      inpParcela.value = m.colParcela == null ? '' : String(m.colParcela);
      chkCabecalho.checked = m.temCabecalho;
      capturar();
      toast('Colunas preenchidas com a ordem do modelo.', 'ok');
    };

    const capturar = () => {
      const escopo = selEscopo.value;
      campoVencimento.classList.toggle('oculto', escopo !== 'fatura');
      estado.mapeamento = {
        colData: Number(inpData.value), colDescricao: Number(inpDescricao.value), colValor: Number(inpValor.value),
        colDocumento: inpDocumento.value === '' ? null : Number(inpDocumento.value),
        colParcela: inpParcela.value === '' ? null : Number(inpParcela.value),
        temCabecalho: chkCabecalho.checked, escopo,
        vencimento: escopo === 'fatura' ? (inpVencimento.value || null) : null,
      };
    };
    [inpData, inpDescricao, inpValor, inpDocumento, inpParcela, chkCabecalho, selEscopo, inpVencimento]
      .forEach((c) => c.addEventListener('change', capturar));
    capturar();

    return el('div', { class: 'mapeamento-manual' }, [
      el('p', { class: 'ajuda', text: 'Planilha sem adaptador dedicado: informe em qual coluna (0 = primeira) está cada dado. Se você usou um modelo baixado em Ferramentas, toque em "Usar ordem do modelo".' }),
      el('div', { class: 'acoes' }, [
        el('button', { class: 'btn btn-mini', type: 'button', text: 'Usar ordem do modelo', onclick: aplicarModelo }),
      ]),
      el('div', { class: 'linha-form' }, [
        el('label', { class: 'campo' }, [el('span', { text: 'Coluna Data' }), inpData]),
        el('label', { class: 'campo' }, [el('span', { text: 'Coluna Descrição' }), inpDescricao]),
      ]),
      el('div', { class: 'linha-form' }, [
        el('label', { class: 'campo' }, [el('span', { text: 'Coluna Valor' }), inpValor]),
        el('label', { class: 'campo' }, [el('span', { text: 'Coluna Documento' }), inpDocumento]),
      ]),
      el('div', { class: 'linha-form' }, [
        el('label', { class: 'campo' }, [el('span', { text: 'Coluna Parcela (ex.: 3/10)' }), inpParcela]),
        el('label', { class: 'campo' }, [el('span', { text: 'Escopo' }), selEscopo]),
      ]),
      el('div', { class: 'linha-form' }, [
        el('label', { class: 'campo-inline' }, [chkCabecalho, el('span', { text: 'Primeira linha é cabeçalho' })]),
        campoVencimento,
      ]),
    ]);
  }

  async function analisar(adaptadorEscolhido) {
    if (!adaptadorEscolhido) return;
    if (adaptadorEscolhido.id === 'generic-table' && !estado.mapeamento) {
      toast('Preencha o mapeamento de colunas antes de analisar.', 'erro');
      return;
    }
    // Sem vencimento, o id do documento fica `contaId|fatura|undefined` e a
    // próxima fatura de planilha desta conta sobrescreveria esta em
    // silêncio — inclusive sem disparar o aviso de "já importado", que
    // compara justamente por esse id.
    if (adaptadorEscolhido.id === 'generic-table' && estado.mapeamento.escopo === 'fatura' && !estado.mapeamento.vencimento) {
      toast('Informe a data de vencimento da fatura antes de analisar.', 'erro');
      return;
    }
    try {
      const resultado = await adaptadorEscolhido.parse(estado.buffer, { contaId, arquivo: estado.arquivo, mapeamento: estado.mapeamento });
      const documentosExistentes = await storage.getByIndex('statements', 'by_contaId', contaId);
      const duplicata = documentoJaImportado(contaId, resultado.statement.tipo, resultado.statement, documentosExistentes);
      estado.resultado = resultado;
      renderPreview(resultado, duplicata);
    } catch (e) {
      toast('Não consegui ler esse arquivo: ' + e.message, 'erro');
    }
  }

  function renderPreview(resultado, duplicata) {
    const { statement, rows, avisos, checksum } = resultado;
    const linhasChecksum = (checksum.sections || []).map((s) =>
      el('li', { text: `Cartão final ${s.cardEnding || '—'} (${s.secaoTipo}): ${s.ok === false ? 'DIVERGE' : s.ok === true ? 'confere' : 'sem total impresso'}` })
    );

    const botaoConfirmar = el('button', { class: 'btn btn-primario', text: 'Confirmar importação' });
    botaoConfirmar.addEventListener('click', () => confirmarImportacao(statement, rows, checksum));

    areaResultado.innerHTML = '';
    areaResultado.append(
      el('div', { class: 'preview-resultado' }, [
        el('p', { text: `${rows.length} linha(s) lidas.` }),
        // "Total das despesas desta fatura", não "total a pagar": statement.totalImpresso
        // soma só Despesas+Parcelamentos (o que o checksum confere) — nunca inclui
        // Saldo Anterior nem os créditos/pagamentos. Pode divergir bastante do "Saldo
        // Desta Fatura"/"Total a Pagar" impresso no PDF (a diferença é exatamente o
        // saldo rotativo herdado do mês anterior), e chamar isso de "total da fatura"
        // sem qualificar já causou confusão real: usuário reportou como se os dois
        // números devessem bater.
        statement.totalImpresso != null ? el('p', { text: `Total das despesas desta fatura: ${fmtBRL(statement.totalImpresso)}` }) : null,
        duplicata ? el('p', { class: 'aviso-erro', text: `Este documento (vencimento ${formatDateBR(statement.vencimento) || statement.vencimento || statement.periodoFim}) já foi importado${duplicata.importadoEm ? ' em ' + new Date(duplicata.importadoEm).toLocaleDateString('pt-BR') : ''}. Confirmar agora vai substituir os dados anteriores por este novo arquivo.` }) : null,
        el('p', { class: checksum.ok === false ? 'aviso-erro' : 'aviso-ok', text: checksum.ok === false ? 'Checksum NÃO confere.' : 'Checksum confere.' }),
        linhasChecksum.length ? el('ul', {}, linhasChecksum) : null,
        avisos.length ? el('ul', { class: 'lista-avisos' }, avisos.map((a) => el('li', { text: a }))) : null,
        el('div', { class: 'acoes' }, [botaoConfirmar]),
      ])
    );
  }

  async function confirmarImportacao(statement, rows, checksum) {
    if (checksum.ok === false) {
      const seguir = await confirmar('O checksum desta importação não confere. Importar mesmo assim?');
      if (!seguir) return;
    }
    try {
      const [transactions, accounts, allStatements, regras, formas] = await Promise.all([
        storage.getAll('transactions'), storage.getAll('accounts'), storage.getAll('statements'),
        storage.getAll('classificationRules'), storage.getAll('paymentMethods'),
      ]);
      const apelidosTitular = await storage.getMeta('apelidosTitular', []);
      await commitImportacaoEGravar({
        tipo: statement.tipo, contaId, statement, rows, transactions, accounts, apelidosTitular, allStatements, regras, formas,
      });
      toast('Importação concluída.', 'ok');
      inputArquivo.value = '';
      estado = null;
      areaPreview.innerHTML = '';
      areaResultado.innerHTML = '';
      await aoImportar();
    } catch (e) {
      toast('Não consegui concluir a importação: ' + e.message, 'erro');
    }
  }

  painel.append(
    el('div', { class: 'form' }, [el('label', { class: 'campo' }, [el('span', { text: 'Arquivo' }), inputArquivo])]),
    areaPreview,
    areaResultado
  );
}
