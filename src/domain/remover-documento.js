// Exclusão de um documento importado (statement) junto dos lançamentos que
// ele originou — ação pedida pelo usuário depois de um caso real (2026-08-14):
// reimportou uma fatura com o vencimento digitado errado (26/01 em vez de
// 30/01) e, como `idDeterministicoDoDocumento` inclui o vencimento na chave,
// o app tratou como um documento NOVO — sem aviso de duplicata, sem relação
// com o anterior. Apagar só os lançamentos duplicados deixaria o documento
// errado (statement) órfão no seletor de "Documento" da aba Conciliação,
// sem nenhum lançamento correspondente.
//
// Pura: devolve o QUE apagar, nunca toca storage — quem chama decide a
// ordem/atomicidade real da persistência (mesmo padrão de commitImportacao,
// em ui/conciliacao-import.js).

// Uma transação pertence a um documento de FATURA por `faturaVencimento`
// (não por `origemRef`): autoConfirmParcelas grava faturaVencimento em toda
// parcela que confirma automaticamente, e "+lançar"/lote (manual) também —
// então cobre os dois jeitos de uma compra virar lançamento. `origemRef`
// sozinho ficaria de fora das parcelas confirmadas automaticamente, que
// nunca passam por "+lançar".
function pertenceAoDocumentoDeFatura(t, doc) {
  return t.contaId === doc.contaId && t.faturaVencimento === doc.vencimento;
}

// Documento de EXTRATO não tem campo equivalente a faturaVencimento —
// `origemRef.statementId` é a única ligação (gravada em "+lançar"/lote do
// extrato, ver conciliacao-extrato.js).
function pertenceAoDocumentoDeExtrato(t, doc) {
  return !!t.origemRef && t.origemRef.statementId === doc.id;
}

/**
 * Separa as transações ligadas a `doc` em dois grupos:
 *
 * - `paraExcluir`: lançamentos comuns (despesa/receita/transferência) que só
 *   existem por causa deste documento — seguros de apagar junto.
 * - `pagamentosParaRevisar`: lançamentos `natureza === 'pagamento_fatura'`
 *   ligados a este documento. NUNCA entram em `paraExcluir` automaticamente:
 *   um pagamento pode ter sido criado pelo lado do EXTRATO primeiro (evento
 *   único visto por dois lados, ver `pagamento-fatura.js`) — apagar cego
 *   apagaria um registro que também tem raiz num documento diferente deste.
 *   Quem chama decide se avisa o usuário e apaga à parte.
 *
 * Não inclui previsões (`previsto: true`): elas não têm `faturaVencimento`
 * nem `origemRef` (são geradas por `syncPredictions`, projeção pura) e somem
 * sozinhas no próximo recálculo de qualquer fatura da mesma compra — ou,
 * se a compra parcelada inteira sumiu do histórico, ficam órfãs mas
 * inofensivas (não aparecem em nenhum total, só na aba Parcelas).
 */
export function transacoesDoDocumento(doc, transactions) {
  const pertence = doc.tipo === 'fatura' ? pertenceAoDocumentoDeFatura : pertenceAoDocumentoDeExtrato;
  const relacionadas = (transactions || []).filter((t) => !t.previsto && pertence(t, doc));
  return {
    paraExcluir: relacionadas.filter((t) => t.natureza !== 'pagamento_fatura'),
    pagamentosParaRevisar: relacionadas.filter((t) => t.natureza === 'pagamento_fatura'),
  };
}
