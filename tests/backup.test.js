import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { datasetToSheets, sheetsToDataset, detectBackupVersion, SCHEMA_VERSION_BACKUP } from '../src/importers/backup-xlsx.js';
import { STORES } from '../src/core/db-schema.js';

const DATASET = {
  transactions: [
    { id: 'tx_1', data: '2026-06-10', descricao: 'Compra', valor: 23.5, categoria: 'casa', natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_1', previsto: false },
    { id: 'tx_2', data: '2026-06-23', descricao: 'Parcelada', valor: 100, categoria: 'casa', natureza: 'despesa', formaPagamentoId: 'pm_credito', contaId: 'acc_2', previsto: false, parcelaKey: 'PARCELADA|2026-01-15|3', parcela_atual: 2, parcela_total: 3, conciliadoAutomaticamente: true, origemRef: { statementId: 'acc_2|fatura|2026-06-30', linhaId: 'ab12cd34' } },
    { id: 'tx_3', data: '2026-06-25', descricao: '', valor: 0, categoria: 'casa',
      natureza: 'despesa', formaPagamentoId: 'pm_dinheiro', contaId: null, previsto: false,
      observacaoLivre: '[1,2]', outraObservacao: '{"a":1}' },
  ],
  accounts: [{ id: 'acc_1', tipo: 'conta', nome: 'Conta', agencia: '0001', numero: '1234', matchers: [] }],
  paymentMethods: [{ id: 'pm_pix', nome: 'Pix', tipo: 'pix', conciliaCom: 'extrato', padroesExtrato: ['PIX ENVIADO'], ordem: 1, ativo: true }],
  categories: [{ id: 'casa', nome: 'Casa', cor: '#111111' }],
  statements: [{ id: 'acc_2|fatura|2026-06-30', tipo: 'fatura', contaId: 'acc_2', vencimento: '2026-06-30', dataCorte: '2026-06-23', rows: [{ tipo: 'despesa', data: '2026-06-10', descricao: 'Compra', valor: 23.5 }] }],
  classificationRules: [{ id: 'r_1', padrao: 'PADARIA', tipoMatch: 'exato', escopo: 'extrato', categoriaId: 'casa', origem: 'aprendida', acertos: 3, ativa: true }],
  meta: [{ key: 'lastBackupAt', value: 1750000000000 }],
};

describe('backup: identificação', () => {
  it('reconhece o backup do app anterior pelas abas', () => {
    assertEqual(detectBackupVersion(['Backup_Lancamentos', 'Backup_Categorias']), 1);
  });

  it('reconhece o backup novo', () => {
    assertEqual(detectBackupVersion(Object.keys(datasetToSheets(DATASET))), 2);
  });

  it('devolve null para planilha que não é backup', () => {
    assertEqual(detectBackupVersion(['Plan1']), null);
  });

  it('planilha que não é backup não vira backup vazio', () => {
    const { versao, dataset } = sheetsToDataset({ Plan1: [{ produto: 'Arroz', preco: 20 }] });
    assertEqual(versao, null, 'planilha aleatória foi aceita como backup');
    assertDeepEqual(dataset.transactions, []);
  });
});

describe('backup: ciclo completo', () => {
  // Este é o teste que impede a limitação do backup anterior de voltar.
  it('exportar e importar devolve exatamente os mesmos dados', () => {
    const sheets = datasetToSheets(DATASET);
    const { dataset, versao } = sheetsToDataset(sheets);
    assertEqual(versao, SCHEMA_VERSION_BACKUP);
    for (const store of Object.keys(DATASET)) {
      assertDeepEqual(dataset[store], DATASET[store], `store ${store} não sobreviveu ao ciclo`);
    }
  });

  it('preserva campos aninhados: rows da fatura e origemRef', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    assertEqual(dataset.statements[0].rows.length, 1);
    assertEqual(dataset.statements[0].rows[0].valor, 23.5);
    assertEqual(dataset.transactions[1].origemRef.linhaId, 'ab12cd34');
  });

  // Reproduz o achado da revisão final do log de auditoria: STORES_EXPORTAVEIS
  // é derivado de STORES (schema ao vivo), não de uma lista escrita à mão —
  // sem este teste, uma store nova no schema (como auditLog, Task 1) entrava
  // no backup em silêncio sem que NENHUM teste do ciclo notasse, porque o
  // teste acima roda sobre um DATASET fixo, nunca sobre STORES de verdade.
  // auditLog é a única exceção deliberada (log de diagnóstico, tem exportação
  // própria em .json — ver src/importers/backup-xlsx.js) — todo o resto do
  // schema precisa continuar aparecendo nas abas do backup.
  it('toda store do schema (exceto auditLog, que tem exportação própria) aparece nas abas do backup', () => {
    const sheets = datasetToSheets(DATASET);
    const nomesDasAbas = Object.keys(sheets);
    const storesEsperadas = STORES.map((s) => s.nome).filter((nome) => nome !== 'auditLog');
    for (const nome of storesEsperadas) {
      assert(nomesDasAbas.includes(nome), `store "${nome}" do schema não apareceu nas abas do backup`);
    }
    assert(!nomesDasAbas.includes('auditLog'), 'auditLog é log de diagnóstico, não deveria entrar no backup');
  });

  it('preserva booleanos e não os transforma em texto', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    assertEqual(dataset.transactions[1].conciliadoAutomaticamente, true);
    assertEqual(dataset.transactions[0].previsto, false);
  });

  it('grava a versão do schema numa aba própria', () => {
    const sheets = datasetToSheets(DATASET);
    assert(sheets._backup_info);
    assert(sheets._backup_info.some((r) => r.chave === 'schemaVersion' && Number(r.valor) === SCHEMA_VERSION_BACKUP));
  });

  it('dataset vazio produz backup válido e vazio', () => {
    const { dataset } = sheetsToDataset(datasetToSheets({}));
    assertDeepEqual(dataset.transactions, []);
  });

  it('null e string vazia voltam como null e string vazia, não como ausência', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    const t3 = dataset.transactions.find((t) => t.id === 'tx_3');
    assertEqual(t3.descricao, '', 'string vazia virou ausência');
    assertEqual('contaId' in t3, true, 'campo null sumiu do registro');
    assertEqual(t3.contaId, null, 'null não voltou como null');
    assertEqual(t3.valor, 0);
    assertEqual(t3.previsto, false);
  });

  it('texto que parece JSON continua sendo texto', () => {
    const { dataset } = sheetsToDataset(datasetToSheets(DATASET));
    const t3 = dataset.transactions.find((t) => t.id === 'tx_3');
    assertEqual(t3.observacaoLivre, '[1,2]');
    assertEqual(t3.outraObservacao, '{"a":1}');
  });

  it('texto que comeca com o proprio marcador continua sendo texto', () => {
    const ds = { transactions: [{ id: 'tx_m', descricao: '@json:null', obs: '@json:true', obs2: '@json:{"a":1}' }] };
    const { dataset } = sheetsToDataset(datasetToSheets(ds));
    assertEqual(dataset.transactions[0].descricao, '@json:null');
    assertEqual(dataset.transactions[0].obs, '@json:true');
    assertEqual(dataset.transactions[0].obs2, '@json:{"a":1}');
  });
});

describe('backup: celula grande (acima do limite de 32767 caracteres do XLSX)', () => {
  it('campo cujo valor serializado excede o limite e dividido em colunas extras na exportacao', () => {
    const rowsGrandes = Array.from({ length: 2000 }, (_, i) => ({ id: 'r' + i, descricao: 'LINHA DE TESTE NUMERO ' + i, valor: i }));
    const dataset = { statements: [{ id: 'st_grande', tipo: 'extrato', contaId: 'acc_1', rows: rowsGrandes }] };
    const sheets = datasetToSheets(dataset);
    const linha = sheets.statements[0];
    const tamanhoSerializado = JSON.stringify(rowsGrandes).length;
    assert(tamanhoSerializado > 32767, 'pre-condicao do teste: o array sintetico precisa realmente exceder o limite do XLSX');
    assert(typeof linha.rows === 'string' && linha.rows.length <= 30000, 'primeira coluna (rows) nao pode exceder o limite seguro');
    assert('rows__2' in linha, 'valor grande precisa gerar pelo menos uma coluna extra (rows__2)');
  });

  it('ciclo completo (exportar+importar) devolve o array grande EXATAMENTE igual ao original', () => {
    const rowsGrandes = Array.from({ length: 2000 }, (_, i) => ({ id: 'r' + i, descricao: 'LINHA DE TESTE NUMERO ' + i, valor: i }));
    const dataset = { statements: [{ id: 'st_grande', tipo: 'extrato', contaId: 'acc_1', rows: rowsGrandes }] };
    const { dataset: dataset2 } = sheetsToDataset(datasetToSheets(dataset));
    assertDeepEqual(dataset2.statements[0].rows, rowsGrandes, 'array grande nao sobreviveu ao ciclo dividido em colunas');
  });

  it('campo pequeno (abaixo do limite) NAO gera coluna extra — comportamento do caso comum inalterado', () => {
    const sheets = datasetToSheets(DATASET);
    const linha = sheets.statements[0];
    assert(!('rows__2' in linha), 'campo pequeno nao deveria gerar coluna extra');
  });
});

describe('backup: caminho degradado do formato anterior', () => {
  it('avisa que faturas não vêm no backup do app anterior', () => {
    const sheets = {
      Backup_Lancamentos: [{ id: 'e_1', descricao: 'X', valor: 10, data: '2026-06-01', categoria: 'casa', previsto: 0, parcelaKey: '' }],
      Backup_Categorias: [{ id: 'casa', nome: 'Casa', cor: '#111' }],
    };
    const { versao, avisos } = sheetsToDataset(sheets);
    assertEqual(versao, 1);
    assert(avisos.some((a) => /fatura/i.test(a)));
  });
});
