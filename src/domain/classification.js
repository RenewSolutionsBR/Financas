// Memória de classificação: aprende a categoria (e opcionalmente forma de
// pagamento/natureza) de uma descrição recorrente a partir das correções do
// usuário, e aplica sozinha da próxima vez que a mesma descrição aparecer
// numa fatura ou extrato importado. Nunca opina sobre lançamento MANUAL — só
// atua no momento em que uma linha importada vira lançamento (spec 8.4).

import { uid } from '../core/ids.js';
import { CATEGORIA_A_CLASSIFICAR } from './categories.js';
import * as storage from '../core/storage.js';

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// Alternativas mais longas ANTES das mais curtas: PAGSEGURO precisa ser
// tentado antes de PAG, senão o regex casa "PAG" dentro de "PAGSEGURO" e
// sobra "SEGURO*..." no meio do nome do estabelecimento.
const PREFIXO_ADQUIRENTE_RE = /^(PAGSEGURO|PAG|MP)\*/;
const SUFIXO_PARCELA_RE = /\s*\d{2}\/\d{2}\s*$/;
const DOCUMENTO_RE = /\d{6,}/g;

export function canonicalizar(descricaoBruta, escopo) {
  let texto = String(descricaoBruta || '').trim();
  if (!texto) return '';

  // 1. Extrato: "TIPO␣␣CONTRAPARTE" (espaçamento duplo, ver 6.3) — a
  // contraparte é a chave; sem espaço duplo, o texto inteiro (o "tipo") vira
  // a chave. Fatura não separa: um espaço duplo ali é só formatação do PDF,
  // não um separador semântico, e cortar pela metade perderia nome de loja.
  if (escopo === 'extrato') {
    const partes = texto.split(/\s{2,}/).filter(Boolean);
    texto = partes.length > 1 ? partes[partes.length - 1] : partes[0] || texto;
  }

  // 2. Maiúsculas, sem acento, espaços colapsados. \p{Mn} (marca não
  // espaçadora) é o que a decomposição NFD produz para cada acento — mais
  // robusto que listar o intervalo Unicode de marcas combinantes na mão.
  texto = texto
    .toUpperCase()
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. Prefixo de adquirente.
  texto = texto.replace(PREFIXO_ADQUIRENTE_RE, '');

  // 4. Sequência de 6+ dígitos (documento/NSU) — um código de 5 dígitos ou
  // menos costuma ser parte legítima do nome (CEP curto, código de loja).
  texto = texto.replace(DOCUMENTO_RE, '').replace(/\s+/g, ' ').trim();

  // 5. Sufixo de UF, quando o último token é uma sigla de estado válida —
  // por lista fechada de 27, não "duas letras maiúsculas no fim" (evitaria
  // cortar siglas legítimas de nome de loja, tipo "BR"). Roda ANTES do
  // sufixo de parcela de propósito: numa descrição tipo "...02/06 SP", o
  // "02/06" só vira sufixo de verdade depois que a UF que vem depois dele
  // já saiu — na ordem inversa, o regex de parcela (ancorado em `$`) nunca
  // bate porque a UF ainda está no caminho.
  const tokens = texto.split(' ');
  const ultimo = tokens[tokens.length - 1];
  if (tokens.length > 1 && UFS.includes(ultimo)) {
    texto = tokens.slice(0, -1).join(' ');
  }

  // 6. Sufixo de parcela NN/NN.
  texto = texto.replace(SUFIXO_PARCELA_RE, '').trim();

  return texto.trim();
}

function padraoCasa(regra, descricaoCanonica) {
  if (regra.tipoMatch === 'exato') return regra.padrao === descricaoCanonica;
  if (regra.tipoMatch === 'contem') return descricaoCanonica.includes(regra.padrao);
  if (regra.tipoMatch === 'regex') {
    try { return new RegExp(regra.padrao).test(descricaoCanonica); }
    catch (e) { return false; } // padrão inválido nunca casa, nunca derruba a conciliação
  }
  return false;
}

function escopoCompativel(regra, origemLinha) {
  return regra.escopo === origemLinha || regra.escopo === 'ambos';
}

// Precedência (spec 8.2): a primeira regra que casar nesta ordem vence;
// empate (mais de uma regra no mesmo nível) é decidido pelo maior `acertos`.
// Compatibilidade de escopo é pré-condição em TODOS os níveis — os níveis
// 1-3 além disso escalonam a especificidade dentro do tipoMatch 'exato'.
export function aplicarRegra(linha, regras) {
  const ativas = (regras || []).filter((r) =>
    r.ativa !== false && escopoCompativel(r, linha.origem) && padraoCasa(r, linha.descricaoCanonica)
  );
  if (!ativas.length) return null;

  const melhorDoNivel = (candidatas) => {
    if (!candidatas.length) return null;
    return candidatas.reduce((a, b) => ((b.acertos || 0) > (a.acertos || 0) ? b : a));
  };

  const exatas = ativas.filter((r) => r.tipoMatch === 'exato');
  const nivel1 = melhorDoNivel(exatas.filter((r) => r.contaId && r.contaId === linha.contaId));
  if (nivel1) return nivel1;

  const nivel2 = melhorDoNivel(exatas.filter((r) => r.escopo === linha.origem));
  if (nivel2) return nivel2;

  const nivel3 = melhorDoNivel(exatas.filter((r) => r.escopo === 'ambos'));
  if (nivel3) return nivel3;

  const nivel4 = melhorDoNivel(ativas.filter((r) => r.tipoMatch === 'contem'));
  if (nivel4) return nivel4;

  return melhorDoNivel(ativas.filter((r) => r.tipoMatch === 'regex'));
}

// Cria ou sobrescreve a regra aprendida com esta descrição canônica+escopo.
// Não persiste — devolve o objeto pronto para `saveRegra`. `acertos` zera
// quando a categoria muda (o usuário está corrigindo a máquina); permanece
// quando a categoria é a mesma de antes (não é uma correção).
export function aprenderRegra(dados, regrasExistentes) {
  const existente = (regrasExistentes || []).find((r) =>
    r.tipoMatch === 'exato' && r.padrao === dados.descricaoCanonica && r.escopo === dados.escopo
  );
  const mudouCategoria = existente && existente.categoriaId !== dados.categoriaId;
  return {
    id: existente ? existente.id : uid('rule'),
    padrao: dados.descricaoCanonica,
    tipoMatch: 'exato',
    escopo: dados.escopo,
    contaId: dados.contaId || null,
    categoriaId: dados.categoriaId,
    formaPagamentoId: (existente && !mudouCategoria) ? existente.formaPagamentoId : null,
    naturezaSugerida: (existente && !mudouCategoria) ? existente.naturezaSugerida : null,
    origem: 'aprendida',
    acertos: existente && !mudouCategoria ? (existente.acertos || 0) : 0,
    criadoEm: existente ? existente.criadoEm : Date.now(),
    ultimoUsoEm: Date.now(),
    ativa: true,
  };
}

// Lançamentos ainda em "A Classificar", com origem numa linha importada, cuja
// descrição canônica bate com a regra recém aprendida. `descricaoCanonicaPorTransacao`
// é pré-calculada pelo chamador (Map id->descricaoCanonica) porque a transação
// em si não guarda esse campo, só a linha de origem guarda. Só regras EXATAS
// reaplicam retroativamente — 'contem'/'regex' aplicadas em massa sobre o
// histórico têm risco real de falso positivo que o usuário não pediu.
export function candidatosRetroativos(transactions, regra, descricaoCanonicaPorTransacao) {
  if (!regra || regra.tipoMatch !== 'exato') return [];
  return (transactions || []).filter((t) =>
    t.categoria === CATEGORIA_A_CLASSIFICAR &&
    t.origemRef &&
    descricaoCanonicaPorTransacao.get(t.id) === regra.padrao
  );
}

// Reaplica as regras ativas a lançamentos já existentes, a qualquer momento
// (não só no instante em que uma regra nasce/muda, como candidatosRetroativos
// cobre). Só considera transações com `origemRef` (vieram de fatura ou
// extrato) — nunca lançamento manual puro, mesma restrição de design do
// resto do módulo (spec 8.4). `soNaoClassificados=true` restringe a "A
// Classificar"; `false` também revê classificação já feita (útil quando uma
// regra foi corrigida depois de já ter sido usada em massa).
export function reclassificarComRegras(transactions, regras, { soNaoClassificados = true } = {}) {
  const candidatas = (transactions || []).filter((t) => t.origemRef);
  const resultado = [];
  for (const t of candidatas) {
    if (soNaoClassificados && t.categoria !== CATEGORIA_A_CLASSIFICAR) continue;
    const descricaoCanonica = canonicalizar(t.descricao, t.origem);
    const regraAplicada = aplicarRegra({ descricaoCanonica, origem: t.origem, contaId: t.contaId }, regras);
    if (!regraAplicada || regraAplicada.categoriaId === t.categoria) continue;
    resultado.push({ transacao: t, regra: regraAplicada });
  }
  return resultado;
}

export function novaRegra(dados) {
  return {
    id: uid('rule'),
    tipoMatch: 'exato',
    escopo: 'ambos',
    contaId: null,
    formaPagamentoId: null,
    naturezaSugerida: null,
    origem: 'manual',
    acertos: 0,
    criadoEm: Date.now(),
    ultimoUsoEm: null,
    ativa: true,
    ...dados,
  };
}

// --- Persistência ---

export async function listRegras() {
  return storage.getAll('classificationRules');
}

export async function saveRegra(regra) {
  return storage.put('classificationRules', regra);
}

export async function removeRegra(id) {
  return storage.remove('classificationRules', id);
}
