// Testes de importers/legacy-idb.js contra um banco "livro-de-gastos" de
// verdade. Só rodam no navegador (tools/tests.html) porque dependem de
// IndexedDB real — o runner do Node pula este arquivo.
//
// O banco antigo real só existe na origem https://renewsolutionsbr.github.io;
// em localhost ele nunca existe. Por isso este arquivo CRIA um banco legado
// falso, com o mesmo nome e stores (ver fixtures/fake-legacy-db.js), para
// exercitar o caminho "há dados para migrar" sem tocar em dados reais.
// Nenhum dado real do usuário aparece aqui: os registros abaixo são
// inventados, só para cobrir os casos difíceis (previsto numérico, valor
// ilegível, fatura sem vencimento).

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { legacyDatabaseExists, readLegacyDatabase, importLegacyInto } from '../src/importers/legacy-idb.js';
import { LEGACY_DB_NAME } from '../src/core/db-schema.js';
import * as storage from '../src/core/storage.js';
import { criarBancoLegadoFalso, derrubarBancoLegadoFalso, lerBancoLegadoFalso } from './fixtures/fake-legacy-db.js';

// Ids de categoria prefixados com "falso_teste_": migrateV1ToV2 copia
// categories() literalmente para o banco de verdade (categories nao e um
// store isolado por teste), e um id que colidisse com um default real
// (ex.: 'alimentacao') sobrescreveria silenciosamente a categoria de
// verdade do usuario que rodar os testes. Os testes abaixo tambem removem
// essas categorias no finally, para nao deixar lixo permanente na aba
// Cadastros nem impedir seedCategoriasIfEmpty() de povoar os defaults numa
// instalacao nova (ele só semeia quando o store está vazio).
const DADOS_FALSOS = {
  expenses: [
    { id: 'falso_e1', descricao: 'Lanchonete teste', valor: 12.5, data: '2026-05-10', categoria: 'falso_teste_alimentacao', previsto: 1 },
    { id: 'falso_e2', descricao: 'Assinatura teste', valor: 'abc', data: '2026-05-11', categoria: 'falso_teste_casa' },
    { id: 'falso_e3', descricao: 'Farmacia teste', valor: 30, data: '2026-05-12', categoria: 'falso_teste_saude', previsto: 0 },
  ],
  categories: [
    { id: 'falso_teste_alimentacao', nome: 'Alimentação (teste)', cor: '#8a6d3b' },
    { id: 'falso_teste_casa', nome: 'Casa (teste)', cor: '#31708f' },
    { id: 'falso_teste_saude', nome: 'Saúde (teste)', cor: '#a94442' },
  ],
  faturas: [
    { arquivo: 'fatura-falsa-sem-vencimento.pdf', dataCorte: '2026-05-20', importedAt: 1, rows: [{ valor: 12.5 }, { valor: 30 }] },
  ],
  meta: [{ key: 'lastBackupAt', value: 1 }],
};

const OPCOES = { cartaoTitularId: 'acc_teste_cartao_legado', formaCreditoId: 'pm_credito' };

async function limparResultadoDaMigracao() {
  for (const id of ['falso_e1', 'falso_e2', 'falso_e3']) await storage.remove('transactions', id);
  for (const id of DADOS_FALSOS.categories.map((c) => c.id)) await storage.remove('categories', id);
  const todas = await storage.getAll('statements');
  for (const s of todas.filter((s) => s.contaId === 'acc_teste_cartao_legado')) await storage.remove('statements', s.id);
}

describe('legacy-idb: banco antigo ausente', () => {
  it('legacyDatabaseExists() devolve false quando nao ha banco antigo nesta origem', async () => {
    await derrubarBancoLegadoFalso();
    assertEqual(await legacyDatabaseExists(), false);
  });

  it('nao cria banco fantasma ao tentar ler um banco antigo que nao existe', async () => {
    await derrubarBancoLegadoFalso();
    let erro = null;
    try {
      await readLegacyDatabase();
    } catch (e) {
      erro = e;
    }
    assert(erro !== null, 'deveria ter rejeitado: nao ha banco antigo nesta origem');
    // A promessa rejeita assim que onupgradeneeded dispara, mas a transacao de
    // versionchange (abortada ou nao) so termina de comitar/reverter um
    // instante depois — indexedDB.databases() consultado cedo demais nao
    // reflete o resultado final. Sem esta espera, o teste passa mesmo quando
    // a sabotagem (remover o abort()) esta ativa: falso negativo.
    await new Promise((r) => setTimeout(r, 50));
    const bancos = await indexedDB.databases();
    assertEqual(
      bancos.some((b) => b.name === LEGACY_DB_NAME), false,
      'a tentativa de leitura nao pode deixar um banco vazio para tras'
    );
  });
});

describe('legacy-idb: migracao com banco antigo falso (dados inventados)', () => {
  it('legacyDatabaseExists() devolve true depois de criado o banco falso', async () => {
    await criarBancoLegadoFalso(DADOS_FALSOS);
    try {
      assertEqual(await legacyDatabaseExists(), true);
    } finally {
      await derrubarBancoLegadoFalso();
    }
  });

  it('converte previsto numerico, descarta valor ilegivel com aviso, e gera referencia para fatura sem vencimento', async () => {
    await criarBancoLegadoFalso(DADOS_FALSOS);
    try {
      const { transactions, statements, avisos } = await importLegacyInto(OPCOES);
      try {
        const porId = new Map(transactions.map((t) => [t.id, t]));
        assertEqual(porId.get('falso_e1').previsto, true, 'previsto:1 numerico precisa virar true booleano');
        assertEqual(porId.has('falso_e2'), false, 'valor ilegivel (abc) precisa ser descartado, nao virar 0');
        assert(avisos.some((a) => a.includes('falso_e2')), 'precisa avisar sobre o lancamento descartado');
        assertEqual(porId.get('falso_e3').previsto, false);

        assertEqual(statements.length, 1);
        assert(statements[0].id.startsWith('acc_teste_cartao_legado|fatura|sem-vencimento-'), statements[0].id);
        assertEqual(statements[0].vencimento, null);
        assert(avisos.some((a) => /vencimento/i.test(a)));
      } finally {
        await limparResultadoDaMigracao();
      }
    } finally {
      await derrubarBancoLegadoFalso();
    }
  });

  it('rodar a migracao duas vezes nao duplica (mesmos ids, sobrescreve)', async () => {
    await criarBancoLegadoFalso(DADOS_FALSOS);
    try {
      await importLegacyInto(OPCOES);
      await importLegacyInto(OPCOES);
      try {
        const transacoesMigradas = (await storage.getAll('transactions'))
          .filter((t) => ['falso_e1', 'falso_e2', 'falso_e3'].includes(t.id));
        assertEqual(transacoesMigradas.length, 2, 'so falso_e1 e falso_e3 sao validos; nao pode haver duplicata');

        const faturasMigradas = (await storage.getAll('statements'))
          .filter((s) => s.contaId === 'acc_teste_cartao_legado');
        assertEqual(faturasMigradas.length, 1, 'rodar duas vezes nao pode duplicar a fatura');
      } finally {
        await limparResultadoDaMigracao();
      }
    } finally {
      await derrubarBancoLegadoFalso();
    }
  });

  it('a migracao le o banco antigo mas nunca escreve nele: conteudo identico antes e depois', async () => {
    await criarBancoLegadoFalso(DADOS_FALSOS);
    try {
      const antes = await lerBancoLegadoFalso();
      await importLegacyInto(OPCOES);
      const depois = await lerBancoLegadoFalso();
      try {
        assertDeepEqual(depois, antes, 'o banco do app anterior nao pode mudar por causa da migracao');
      } finally {
        await limparResultadoDaMigracao();
      }
    } finally {
      await derrubarBancoLegadoFalso();
    }
  });
});
