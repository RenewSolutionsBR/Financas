import { describe, it, assert, assertEqual, assertDeepEqual } from './harness.js';
import { datasetToSheets, sheetsToDataset, detectBackupVersion, SCHEMA_VERSION_BACKUP } from '../src/importers/backup-xlsx.js';

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
