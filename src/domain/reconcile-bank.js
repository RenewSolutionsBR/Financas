// Conciliação de extrato bancário. A etapa 1 (atribuirNatureza) é o
// mecanismo que impede a dupla contagem entre extrato e fatura: roda ANTES
// de qualquer casamento, e só natureza:'despesa' soma no total (regra de
// ouro, domain/transactions.js).

import { contaQueCasaDescricao, TIPO_CARTAO } from './accounts.js';
import { canonicalizar } from './classification.js';

function dateDiffDays(iso1, iso2) {
  return Math.abs((new Date(iso1) - new Date(iso2)) / 86400000);
}

// Ordem de precedência (spec 7.2, tabela): pagamento_fatura > transferencia
// > receita (por sinal) > despesa (default). Cada nível só se aplica se o
// anterior não casou — pagamento_fatura vence mesmo que a descrição também
// contenha, por acidente, um apelido do titular.
export function atribuirNatureza(linha, accounts, apelidosTitular) {
  const cartoes = (accounts || []).filter((a) => a.tipo === TIPO_CARTAO);
  const contaCartao = contaQueCasaDescricao(linha.descricao, cartoes);
  if (linha.sinal === 'debito' && contaCartao) {
    return { natureza: 'pagamento_fatura', contaCasadaId: contaCartao.id };
  }

  // Só contas que NÃO são cartão entram aqui: um matcher de cartão já foi
  // decidido acima (só vale para pagamento_fatura em débito). Reincluir
  // cartões nesta busca faria uma linha de CRÉDITO com a mesma descrição de
  // um débito de fatura (ex: estorno) cair em 'transferencia' por engano —
  // o matcher do cartão casaria de novo aqui e mascararia a regra de sinal.
  const contasNaoCartao = (accounts || []).filter((a) => a.tipo !== TIPO_CARTAO);
  const contasComoApelido = (apelidosTitular || []).map((nome) => ({ matchers: [nome] }));
  const contaTransferencia = contaQueCasaDescricao(linha.descricao, [...contasNaoCartao, ...contasComoApelido]);
  if (contaTransferencia) {
    return { natureza: 'transferencia', contaCasadaId: contaTransferencia.id || null };
  }

  if (linha.sinal === 'credito') return { natureza: 'receita', contaCasadaId: null };
  return { natureza: 'despesa', contaCasadaId: null };
}

// Vincula o débito de pagamento de fatura ao statement de FATURA daquele
// cartão com vencimento mais próximo da data do débito, e confronta o valor.
// A divergência é só um AVISO — pagamento parcial ou encargo são legítimos.
export function confrontarFaturaDebito(linha, statementsFatura) {
  const doCartao = (statementsFatura || []).filter((s) => s.tipo === 'fatura' && s.contaId === linha.contaCasadaId);
  if (!doCartao.length) return null;
  const maisProxima = [...doCartao].sort((a, b) => dateDiffDays(a.vencimento, linha.data) - dateDiffDays(b.vencimento, linha.data))[0];
  const diferenca = Math.round(Math.abs(maisProxima.totalImpresso - linha.valor) * 100) / 100;
  const divergiu = diferenca >= 0.02;
  return {
    faturaId: maisProxima.id,
    valorFatura: maisProxima.totalImpresso,
    diferenca,
    aviso: divergiu ? `O débito de ${linha.data} (R$ ${linha.valor.toFixed(2)}) não bate com o total da fatura vinculada (R$ ${maisProxima.totalImpresso.toFixed(2)}).` : null,
  };
}

function similaridadeCanonica(a, b) {
  const setA = new Set(canonicalizar(a, 'extrato').split(' ').filter(Boolean));
  const setB = new Set(canonicalizar(b, 'extrato').split(' ').filter(Boolean));
  if (!setA.size || !setB.size) return 0;
  let intersecao = 0;
  for (const t of setA) if (setB.has(t)) intersecao++;
  return intersecao / new Set([...setA, ...setB]).size; // Jaccard
}

export function runReconciliationBank(extrato, transactions, accounts, apelidosTitular, statementsFatura) {
  const comNatureza = (extrato.rows || []).map((linha) => ({ ...linha, ...atribuirNatureza(linha, accounts, apelidosTitular) }));

  // Lançamentos de origem fatura (parcelas confirmadas, pagamentos de
  // fatura) pertencem exclusivamente à conciliação de fatura
  // (conciliacao-fatura.js) — nunca deveriam sobrar aqui em "No app, não
  // no extrato" só porque não casaram por valor/data com nenhuma linha do
  // extrato bancário.
  const pool = (transactions || []).filter((t) => !t.previsto && t.origem !== 'fatura').map((t) => ({ ...t, used: false }));
  const autoMatched = [];
  const matched = [];
  const extratoUnmatched = [];

  comNatureza.forEach((linha) => {
    const candidatos = pool
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.used && Math.abs(t.valor - linha.valor) < 0.01 && dateDiffDays(t.data, linha.data) <= 2 && (!t.contaId || t.contaId === extrato.contaId));
    if (!candidatos.length) { extratoUnmatched.push(linha); return; }
    candidatos.sort((a, b) => similaridadeCanonica(linha.descricao, b.t.descricao) - similaridadeCanonica(linha.descricao, a.t.descricao));
    const escolhido = candidatos[0];
    pool[escolhido.i].used = true;
    const bucket = escolhido.t.conciliadoAutomaticamente ? autoMatched : matched;
    bucket.push({ extrato: linha, app: escolhido.t });
  });

  const appUnmatched = pool.filter((t) => !t.used);
  return { autoMatched, matched, extratoUnmatched, appUnmatched };
}
