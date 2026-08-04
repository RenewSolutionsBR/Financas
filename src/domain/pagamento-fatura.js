// Regra de registro único do pagamento de fatura (spec 7.3): o mesmo evento
// aparece no extrato (canônico) e na fatura seguinte (confirmação). Funciona
// nas duas ordens de importação porque a busca por um lançamento existente
// (valor+data, dentro de tolerância) é o mesmo teste não importa qual fonte
// chegou primeiro. `origem` guarda QUAL lado criou o registro; `origemRef`
// só é preenchido quando o OUTRO lado confirma — é isso que distingue
// "criado por um lado, esperando o outro" (complementa) de "reprocessando
// o mesmo lado de novo" (ja_completo, idempotente) de "os dois lados já
// confirmaram" (ja_completo também, em qualquer chamada seguinte).
import { CATEGORIA_A_CLASSIFICAR } from './categories.js';

const TOLERANCIA_DIAS = 2;

export function processarPagamentoFatura(linhaPagamento, origemLinha, transactions, faturaVinculadaId) {
  const existente = (transactions || []).find((t) =>
    t.natureza === 'pagamento_fatura' &&
    Math.abs(t.valor - linhaPagamento.valor) < 0.01 &&
    Math.abs((new Date(t.data) - new Date(linhaPagamento.data)) / 86400000) <= TOLERANCIA_DIAS
  );

  if (existente) {
    if (existente.origemRef || existente.origem === origemLinha) {
      return { acao: 'ja_completo', transaction: existente };
    }
    return {
      acao: 'complementado',
      transaction: { ...existente, origemRef: { statementId: linhaPagamento.statementId, linhaId: linhaPagamento.id } },
    };
  }

  return {
    acao: 'criado',
    transaction: {
      descricao: linhaPagamento.descricao,
      valor: linhaPagamento.valor,
      data: linhaPagamento.data,
      natureza: 'pagamento_fatura',
      origem: origemLinha,
      faturaVinculadaId: faturaVinculadaId || null,
      contaId: linhaPagamento.contaId || null,
      categoria: CATEGORIA_A_CLASSIFICAR,
      conciliadoAutomaticamente: true,
      previsto: false,
    },
  };
}
