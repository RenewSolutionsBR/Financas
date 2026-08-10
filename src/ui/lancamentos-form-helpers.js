// Funções puras usadas pelo formulário de lançar/editar (lancamentos-form.js)
// e pelos testes. Separadas do formulário em si (que monta DOM) para manter
// os dois arquivos abaixo de ~250 linhas.

import { TIPO_CONTA, TIPO_CARTAO } from '../domain/accounts.js';
import { parseMoneyBR } from '../core/money.js';

// Pura: decide o que o campo Valor significa antes de qualquer gravação.
// parseMoneyBR devolve null tanto para "vazio" quanto para "não entendi o
// formato" (ex.: "12.30", ponto decimal ambíguo) — aqui os dois casos são
// distinguidos, porque o segundo merece dizer ao usuário que o formato é
// inválido, em vez de colapsar para 0 e deixar a guarda genérica do domínio
// ("valor precisa ser maior que zero") reclamar de um valor que na
// verdade nunca chegou a existir.
export function interpretarValor(textoDigitado) {
  const texto = String(textoDigitado || '').trim();
  if (!texto) return { valor: 0, erro: null };
  const valor = parseMoneyBR(texto);
  if (valor === null) {
    return { valor: 0, erro: 'Valor inválido. Use vírgula para os centavos, como 12,30 (sem ponto).' };
  }
  return { valor: Math.abs(valor), erro: null };
}

// Pura: que tipo de cadastro o campo "Conta / cartão" deve oferecer, dado o
// tipo da forma de pagamento escolhida. Cartão de crédito só faz sentido com
// um cartão (é dali que a fatura sai); dinheiro não anda em conta nenhuma;
// as demais formas (débito, pix, boleto, transferência...) descontam de uma
// conta corrente. `null` de entrada (nenhuma forma selecionada ainda) cai no
// caso comum, conta corrente, em vez de travar o campo sem necessidade.
export function tipoContaParaForma(tipoForma) {
  if (tipoForma === 'credito') return TIPO_CARTAO;
  if (tipoForma === 'dinheiro') return null;
  return TIPO_CONTA;
}

// Pura: filtra as contas pelo tipo esperado da forma, mas sempre preservando
// a conta em `idAtual` mesmo que ela não bata com o tipo — sem essa exceção,
// abrir para edição um lançamento com combinação legada (ex.: dinheiro com
// uma conta gravada de antes desta regra existir) apagaria o valor do campo
// sem o usuário ter tocado em nada, só por ter carregado a tela.
export function contasParaForma(contas, tipoForma, idAtual) {
  const tipoEsperado = tipoContaParaForma(tipoForma);
  return (contas || []).filter((c) => c.id === idAtual || (tipoEsperado !== null && c.tipo === tipoEsperado));
}

// Pura: a conta padrão de uma forma só serve de preenchimento automático se o
// TIPO dela bater com o que a forma espera. O editor de forma
// (cadastros-formas.js) já oferece a conta certa conforme o tipo (corrente
// ou cartão), mas esta checagem continua como segunda camada de defesa: ela
// protege formas cadastradas antes desse fix, que podem ter uma conta padrão
// de tipo incompatível já salva — e esse dado errado é exatamente o que a
// conciliação fatura/extrato da Fase 2 vai precisar ler certo.
export function contaPadraoValidaParaForma(contas, forma) {
  if (!forma || !forma.contaPadraoId) return null;
  const conta = (contas || []).find((c) => c.id === forma.contaPadraoId);
  if (!conta) return null;
  const tipoEsperado = tipoContaParaForma(forma.tipo);
  return tipoEsperado !== null && conta.tipo === tipoEsperado ? conta : null;
}
