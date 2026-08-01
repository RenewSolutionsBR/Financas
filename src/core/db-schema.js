// Descrição do schema e conversão de dados. Módulo PURO: não abre banco, não
// toca em IndexedDB. É o que permite testar a migração inteira fora do
// navegador — e a migração é onde um erro custa os dados reais do usuário.

import { isValidISO } from './dates.js';
import { round2 } from './money.js';
import { stableHash } from './ids.js';

export const DB_NAME = 'financas';
export const DB_VERSION = 2;

export const STORES = [
  {
    nome: 'transactions',
    keyPath: 'id',
    indices: [
      { nome: 'by_data', keyPath: 'data', unique: false },
      { nome: 'by_parcelaKey', keyPath: 'parcelaKey', unique: false },
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
    ],
  },
  { nome: 'accounts', keyPath: 'id', indices: [] },
  { nome: 'paymentMethods', keyPath: 'id', indices: [] },
  { nome: 'categories', keyPath: 'id', indices: [] },
  {
    nome: 'statements',
    keyPath: 'id',
    indices: [
      { nome: 'by_contaId', keyPath: 'contaId', unique: false },
      { nome: 'by_tipo', keyPath: 'tipo', unique: false },
    ],
  },
  {
    nome: 'classificationRules',
    keyPath: 'id',
    indices: [{ nome: 'by_padrao', keyPath: 'padrao', unique: false }],
  },
  { nome: 'meta', keyPath: 'key', indices: [] },
];

// O app anterior e o backup .xlsx gravam previsto ora como booleano, ora como
// 1/0. Comparar com === true classificava uma parcela prevista como despesa
// efetivada, e ela passava a somar no total de gastos.
function ehVerdadeiro(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1';
  }
  return false;
}

// Devolve o valor positivo, ou null se for ilegivel. Null nunca vira zero: um
// valor que o app nao entende precisa parar na frente do usuario, e nao se
// disfarcar de lancamento de R$ 0,00. Mesmo principio de parseMoneyBR.
function valorMigrado(v) {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return Math.abs(round2(n));
}

// Nenhuma chave do store `meta` do app anterior tem o MESMO significado no
// app novo — inclusive quando o nome bate. `lastBackupAt`, por exemplo,
// existe nos dois apps, mas cada um se refere ao backup daquele app
// específico; copiá-la por engano sobrescreveria em silêncio o timestamp de
// backup do app novo com o do antigo (foi exatamente esse vazamento que a
// revisão pegou numa fixture de teste — o mesmo risco existia aqui, no
// código de produção). A lista de chaves migráveis começa vazia de
// propósito: se algum dia existir uma chave do legado que faça sentido
// trazer, ela entra aqui, nomeada — nunca por cópia cega de tudo que o
// store meta do legado tiver.
const CHAVES_META_MIGRAVEIS = new Set();

/**
 * Converte o conteúdo do banco do app anterior no schema v2.
 *
 * Não altera a entrada e não conhece persistência: recebe arrays, devolve
 * arrays. Rodar duas vezes com a mesma entrada produz o mesmo resultado, e
 * como os ids são preservados, uma segunda gravação sobrescreve em vez de
 * duplicar.
 */
export function migrateV1ToV2(legado, opcoes) {
  const { cartaoTitularId, formaCreditoId } = opcoes;
  const expenses = (legado && legado.expenses) || [];
  const faturas = (legado && legado.faturas) || [];
  const avisos = [];

  const transactions = [];
  for (const e of expenses) {
    // Sem id não há como gravar (keyPath 'id' em transactions) nem como
    // referenciar o registro num aviso depois — e sem esta guarda, o
    // putMany/putManyAcrossStores inteiro falhava com "key path yielded a
    // value that is not a valid key", derrubando os demais lançamentos bons
    // junto (ou, com a gravação atômica, a migração inteira).
    if (!e || typeof e.id !== 'string' || !e.id) {
      avisos.push('Um lançamento sem identificador válido foi descartado (não é possível migrá-lo com segurança).');
      continue;
    }
    if (!isValidISO(e.data)) {
      avisos.push(`Lançamento "${e.id}" foi descartado por não ter data válida.`);
      continue;
    }
    const valor = valorMigrado(e.valor);
    if (valor === null) {
      avisos.push(`Lançamento "${e.id}" foi descartado porque o valor "${e.valor}" não pôde ser lido.`);
      continue;
    }
    const t = {
      // Espalha a origem primeiro para preservar campos que este código não
      // conhece. O app anterior pode ter acumulado campos que ninguém previu
      // aqui, e descartá-los em silêncio é exatamente o defeito do backup
      // .xlsx que esta função existe para não repetir.
      ...e,
      id: e.id,
      data: e.data,
      descricao: e.descricao || '',
      valor,
      categoria: e.categoria || 'a_classificar',
      natureza: 'despesa',
      formaPagamentoId: formaCreditoId,
      contaId: cartaoTitularId,
      origem: 'manual',
      previsto: ehVerdadeiro(e.previsto),
    };
    transactions.push(t);
  }

  const statements = [];
  const idsDeFaturaVistos = new Set();
  for (const f of faturas) {
    // Sem vencimento válido, duas faturas geravam o mesmo id e a segunda
    // sobrescrevia a primeira no banco. O hash do conteúdo da fatura dá uma
    // referência estável e distinta, e o aviso manda o usuário conferir.
    let referencia = f.vencimento;
    if (!isValidISO(f.vencimento)) {
      referencia = 'sem-vencimento-' + stableHash([
        f.arquivo || '', f.dataCorte || '', (f.rows || []).length, f.importedAt || '',
      ]);
      avisos.push(
        `A fatura "${f.arquivo || 'sem nome'}" não tem vencimento válido e foi importada ` +
        `com uma referência gerada. Confira-a na aba Conciliação.`
      );
    }
    const idBase = `${cartaoTitularId}|fatura|${referencia}`;
    let id = idBase;
    // Mesmo com vencimento válido, o app anterior não impedia reimportar o
    // mesmo PDF duas vezes com o mesmo vencimento — sem esta checagem, a
    // segunda sobrescrevia a primeira em silêncio no put() e a contagem
    // mostrada ao usuário ("N fatura(s) trazidas") não batia com o que
    // sobrava gravado. O desempate é por CONTADOR, não por hash do conteúdo:
    // três faturas com arquivo/dataCorte/quantidade de linhas idênticos
    // produziriam o mesmo hash na 2ª e na 3ª, e a 3ª colidia de novo com a
    // 2ª — o contador incrementa até achar um id livre, não importa quantas
    // colisões existam.
    if (idsDeFaturaVistos.has(id)) {
      let contador = 2;
      while (idsDeFaturaVistos.has(`${idBase}|dup-${contador}`)) contador++;
      id = `${idBase}|dup-${contador}`;
      avisos.push(
        `Duas ou mais faturas do app anterior têm a mesma referência (${referencia}); uma delas ` +
        `foi importada com um identificador ajustado para não sobrescrever as outras. Confira as ` +
        `faturas na aba Conciliação.`
      );
    }
    idsDeFaturaVistos.add(id);
    statements.push({
      id,
      tipo: 'fatura',
      contaId: cartaoTitularId,
      adaptador: 'santander-cartao-pdf',
      arquivo: f.arquivo || '',
      importadoEm: f.importedAt || null,
      vencimento: isValidISO(f.vencimento) ? f.vencimento : null,
      dataCorte: f.dataCorte || null,
      rows: f.rows || [],
    });
  }

  if (expenses.length > 0 && faturas.length === 0) {
    avisos.push(
      'Nenhuma fatura veio na origem dos dados. Se você migrou por arquivo de backup, ' +
      'as faturas importadas não estão nele: reimporte os PDFs de fatura depois.'
    );
  }

  const metaLegado = (legado && legado.meta) || [];
  const meta = metaLegado.filter((m) => m && CHAVES_META_MIGRAVEIS.has(m.key)).map((m) => ({ ...m }));
  const chavesIgnoradas = metaLegado.filter((m) => !(m && CHAVES_META_MIGRAVEIS.has(m.key)));
  if (chavesIgnoradas.length) {
    const nomes = chavesIgnoradas.map((m) => (m && m.key) || '(sem chave)').join(', ');
    avisos.push(
      `Configurações do app anterior (${nomes}) não foram trazidas: não têm o mesmo ` +
      `significado no app novo.`
    );
  }

  return {
    transactions,
    categories: ((legado && legado.categories) || []).map((c) => ({ ...c })),
    statements,
    meta,
    avisos,
  };
}
