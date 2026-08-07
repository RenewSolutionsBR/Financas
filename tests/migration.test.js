import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { STORES, DB_NAME, DB_VERSION, migrateV1ToV2 } from '../src/core/db-schema.js';
import { LEGACY_V1 } from './fixtures/legacy-v1.js';

const OPC = { cartaoTitularId: 'acc_cartao_1', formaCreditoId: 'pm_credito' };

describe('db-schema: stores', () => {
  it('declara os oito stores da v3', () => {
    assertDeepEqual(
      STORES.map((s) => s.nome).sort(),
      ['accounts', 'auditLog', 'categories', 'classificationRules', 'meta', 'paymentMethods', 'statements', 'transactions'].sort()
    );
  });

  it('usa banco próprio, distinto do app anterior', () => {
    assertEqual(DB_NAME, 'financas');
    assertEqual(DB_VERSION, 3);
  });

  it('transactions tem índices por data, parcelaKey e conta', () => {
    const t = STORES.find((s) => s.nome === 'transactions');
    assertDeepEqual(t.indices.map((i) => i.nome).sort(), ['by_contaId', 'by_data', 'by_parcelaKey']);
  });
});

describe('db-schema: migração v1 para v2', () => {
  it('converte todo expense em transaction de despesa', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(transactions.length, 3);
    assert(transactions.every((t) => t.natureza === 'despesa'));
    assert(transactions.every((t) => t.formaPagamentoId === 'pm_credito'));
    assert(transactions.every((t) => t.contaId === 'acc_cartao_1'));
    assert(transactions.every((t) => t.origem === 'manual'));
  });

  it('preserva os ids literalmente', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    assertDeepEqual(
      transactions.map((t) => t.id).sort(),
      ['e_1', 'confirmed_LOJA_EXEMPLO_2026_01_15_3_2026-06-30', 'seed_Loja_Exemplo_100_00_2026_07'].sort()
    );
  });

  // É exatamente o que o backup .xlsx perdia. Se este teste passar a falhar,
  // a cadeia de parcelas do usuário quebra na primeira fatura importada.
  it('preserva a metainformação de parcela que o backup xlsx descartava', () => {
    const { transactions } = migrateV1ToV2(LEGACY_V1, OPC);
    const confirmada = transactions.find((t) => t.id.startsWith('confirmed_'));
    assertEqual(confirmada.parcela_atual, 2);
    assertEqual(confirmada.parcela_total, 3);
    assertEqual(confirmada.conciliadoAutomaticamente, true);
    assertEqual(confirmada.parcelaKey, 'LOJA EXEMPLO|2026-01-15|3');

    const prevista = transactions.find((t) => t.id.startsWith('seed_'));
    assertEqual(prevista.previsto, true);
    assertEqual(prevista.origemManual, true);
    assertEqual(prevista.grupo_parcela, 'g_1');
  });

  it('converte fatura em statement do cartão titular', () => {
    const { statements } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(statements.length, 1);
    const s = statements[0];
    assertEqual(s.id, 'acc_cartao_1|fatura|2026-06-30');
    assertEqual(s.tipo, 'fatura');
    assertEqual(s.contaId, 'acc_cartao_1');
    assertEqual(s.vencimento, '2026-06-30');
    assertEqual(s.dataCorte, '2026-06-23');
    assertEqual(s.rows.length, 2);
  });

  it('copia categorias sem alterar', () => {
    const { categories } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(categories.length, 3);
    assert(categories.some((c) => c.id === 'a_classificar'));
  });

  // Nenhuma chave do meta do app anterior tem o MESMO significado no app
  // novo, mesmo quando o nome bate: 'lastBackupAt' existe nos dois, mas
  // cada um se refere ao backup daquele app. Copiar às cegas sobrescreveria
  // em silêncio o timestamp do app novo com o do antigo.
  it('nao traz meta do app anterior (nenhuma chave tem o mesmo significado), e avisa', () => {
    const { meta, avisos } = migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(meta.length, 0);
    assert(avisos.some((a) => a.includes('lastBackupAt')), avisos.join(' | '));
  });

  it('é idempotente: rodar duas vezes produz o mesmo resultado', () => {
    const a = migrateV1ToV2(LEGACY_V1, OPC);
    const b = migrateV1ToV2(LEGACY_V1, OPC);
    assertDeepEqual(a.transactions, b.transactions);
    assertDeepEqual(a.statements, b.statements);
  });

  it('não modifica o objeto de entrada', () => {
    const antes = JSON.stringify(LEGACY_V1);
    migrateV1ToV2(LEGACY_V1, OPC);
    assertEqual(JSON.stringify(LEGACY_V1), antes);
  });

  it('avisa quando o legado vem sem faturas (caso do backup xlsx parcial)', () => {
    const { avisos, statements } = migrateV1ToV2({ ...LEGACY_V1, faturas: [] }, OPC);
    assertEqual(statements.length, 0);
    assert(avisos.some((a) => a.toLowerCase().includes('fatura')));
  });

  it('tolera legado vazio', () => {
    const r = migrateV1ToV2({}, OPC);
    assertDeepEqual(r.transactions, []);
    assertDeepEqual(r.statements, []);
  });

  it('descarta expense sem data válida, avisando', () => {
    const legado = { ...LEGACY_V1, expenses: [{ id: 'x', descricao: 'sem data', valor: 1, data: null, categoria: 'casa' }] };
    const { transactions, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(transactions.length, 0);
    assert(avisos.some((a) => a.includes('x')));
  });

  it('trata previsto gravado como numero, que e como o app anterior grava', () => {
    const legado = { expenses: [
      { id: 'p1', descricao: 'A', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 1 },
      { id: 'p0', descricao: 'B', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 0 },
      { id: 'pt', descricao: 'C', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: true },
      { id: 'pn', descricao: 'D', valor: 10, data: '2026-06-01', categoria: 'casa' },
    ] };
    const porId = new Map(migrateV1ToV2(legado, OPC).transactions.map((t) => [t.id, t]));
    assertEqual(porId.get('p1').previsto, true);
    assertEqual(porId.get('p0').previsto, false);
    assertEqual(porId.get('pt').previsto, true);
    assertEqual(porId.get('pn').previsto, false);
  });

  it('nao deixa duas faturas sem vencimento colidirem no mesmo id', () => {
    const legado = { expenses: [], faturas: [
      { arquivo: 'fatura-A.pdf', rows: [{ valor: 1 }] },
      { arquivo: 'fatura-B.pdf', rows: [{ valor: 2 }, { valor: 3 }] },
    ] };
    const { statements, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(statements.length, 2);
    assert(statements[0].id !== statements[1].id);
    assertEqual(statements[0].vencimento, null);
    assertEqual(avisos.filter((a) => /vencimento/i.test(a)).length, 2);
  });

  it('nao deixa duas faturas com o MESMO vencimento valido colidirem no mesmo id', () => {
    // Diferente do teste acima (sem vencimento): aqui as duas faturas tem
    // vencimento valido e igual - o app anterior nao impedia reimportar o
    // mesmo PDF duas vezes. Sem a dedup, a segunda sobrescrevia a primeira
    // no put() e a contagem mostrada ao usuario nao batia com o gravado.
    const legado = { expenses: [], faturas: [
      { vencimento: '2026-06-30', dataCorte: '2026-06-23', arquivo: 'fatura-1a-via.pdf', rows: [{ valor: 1 }] },
      { vencimento: '2026-06-30', dataCorte: '2026-06-23', arquivo: 'fatura-reimportada.pdf', rows: [{ valor: 1 }, { valor: 2 }] },
    ] };
    const { statements, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(statements.length, 2);
    assert(statements[0].id !== statements[1].id, 'os dois ids precisam ser distintos para nao se sobrescreverem');
    assert(statements[0].id.startsWith('acc_cartao_1|fatura|2026-06-30'));
    assert(statements[1].id.startsWith('acc_cartao_1|fatura|2026-06-30'));
    assert(avisos.some((a) => a.includes('mesma referência')), 'precisa avisar sobre a colisao');
  });

  it('desempata TRES faturas com a mesma referencia e o MESMO conteudo (arquivo/dataCorte/linhas identicos)', () => {
    // A 1a versao da dedup desempatava por hash do conteudo: com tres
    // faturas de conteudo IDENTICO, a 2a e a 3a geravam o MESMO hash, e a
    // 3a colidia de novo com a 2a - so a 1a e a 2a ficavam com ids
    // distintos, a 3a sumia. O desempate por contador nao tem esse limite,
    // nao importa quantas colisoes existam.
    const fatura = { vencimento: '2026-06-30', dataCorte: '2026-06-23', arquivo: 'fatura-identica.pdf', importedAt: 1, rows: [{ valor: 1 }] };
    const legado = { expenses: [], faturas: [{ ...fatura }, { ...fatura }, { ...fatura }] };
    const { statements, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(statements.length, 3);
    const idsUnicos = new Set(statements.map((s) => s.id));
    assertEqual(idsUnicos.size, 3, `esperava 3 ids distintos, achei ${JSON.stringify([...idsUnicos])}`);
    assertEqual(avisos.filter((a) => a.includes('mesma referência')).length, 2, 'um aviso por fatura excedente (a 2a e a 3a)');
  });

  it('descarta expense sem id valido, sem derrubar os demais', () => {
    const legado = { expenses: [
      { descricao: 'sem id nenhum', valor: 10, data: '2026-06-01', categoria: 'casa' },
      { id: '', descricao: 'id vazio', valor: 10, data: '2026-06-01', categoria: 'casa' },
      { id: 42, descricao: 'id numerico', valor: 10, data: '2026-06-01', categoria: 'casa' },
      { id: 'bom', descricao: 'este tem id', valor: 10, data: '2026-06-01', categoria: 'casa' },
    ] };
    const { transactions, avisos } = migrateV1ToV2(legado, OPC);
    assertEqual(transactions.length, 1);
    assertEqual(transactions[0].id, 'bom');
    assertEqual(avisos.filter((a) => a.includes('identificador válido')).length, 3);
  });

  it('preserva campo desconhecido do app anterior em vez de descarta-lo', () => {
    const legado = { expenses: [
      { id: 'x', descricao: 'A', valor: 10, data: '2026-06-01', categoria: 'casa', observacao: 'nota do usuario' },
    ] };
    assertEqual(migrateV1ToV2(legado, OPC).transactions[0].observacao, 'nota do usuario');
  });

  it('le valor em string e normaliza negativo, mas descarta ilegivel com aviso', () => {
    const legado = { expenses: [
      { id: 's', descricao: 'A', valor: '23.50', data: '2026-06-01', categoria: 'casa' },
      { id: 'n', descricao: 'B', valor: -50, data: '2026-06-01', categoria: 'casa' },
      { id: 'z', descricao: 'C', valor: 'abc', data: '2026-06-01', categoria: 'casa' },
    ] };
    const { transactions, avisos } = migrateV1ToV2(legado, OPC);
    const porId = new Map(transactions.map((t) => [t.id, t]));
    assertEqual(porId.get('s').valor, 23.5);
    assertEqual(porId.get('n').valor, 50);
    assertEqual(porId.has('z'), false);
    assert(avisos.some((a) => a.includes('"z"')));
  });
});
