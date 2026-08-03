// Registro de adaptadores de importação. Adicionar um banco/formato novo =
// um arquivo em importers/ mais uma chamada a register() — nunca precisa
// tocar em conciliação, domínio ou UI, porque todos consomem só o formato
// de linha normalizada (ver comentário no topo deste arquivo).

// Formato de linha normalizada que TODO adaptador devolve em `rows[]`. A
// conciliação e a UI nunca sabem de qual banco ou tipo de documento a linha
// veio — só enxergam este formato.
//
// {
//   id,                 // hash estável: conta+data+valor+descricao+documento+ordinal
//                        // (ver core/ids.js stableHash). Torna a importação IDEMPOTENTE:
//                        // reimportar um período sobreposto não duplica linha nem lançamento.
//   data,                // ISO
//   valor,               // sempre positivo
//   sinal,               // 'debito' | 'credito'
//   descricao,           // texto original do documento
//   descricaoCanonica,   // canonicalizar(descricao, escopo) de domain/classification.js
//   documento,           // nº do documento, quando houver
//   tipoDetectado,       // prefixo classificador do extrato, quando houver
//   parcela_atual, parcela_total,  // só fatura, null nas demais
//   cartaoFinal,         // só fatura: final do plástico (titular ou adicional) de onde saiu
//   plastico,            // só fatura: 'titular' | 'adicional', null nas demais
//   secao,               // só fatura: 'despesas' | 'pagamentos_creditos'
//   valorUSD,            // só fatura: coluna US$, quando != 0, senão null
//   saldo,               // só extrato, null na fatura
//   raw,                 // linha bruta, para depuração
// }

const adaptadores = [];

export function register(adaptador) {
  adaptadores.push(adaptador);
}

export function limparRegistro() {
  adaptadores.length = 0;
}

export function listAdaptadores() {
  return [...adaptadores];
}

export function adaptadoresParaExtensao(nomeArquivo) {
  const ext = ('.' + String(nomeArquivo || '').split('.').pop()).toLowerCase();
  return adaptadores.filter((a) => a.aceita.some((e) => e.toLowerCase() === ext));
}

export async function detectarMelhorAdaptador(buffer, nomeArquivo) {
  const candidatos = adaptadoresParaExtensao(nomeArquivo);
  let melhor = null;
  let melhorPontuacao = 0;
  for (const adaptador of candidatos) {
    const pontuacao = await adaptador.detectar(buffer);
    if (pontuacao > melhorPontuacao) { melhor = adaptador; melhorPontuacao = pontuacao; }
  }
  return melhor ? { adaptador: melhor, pontuacao: melhorPontuacao } : null;
}
