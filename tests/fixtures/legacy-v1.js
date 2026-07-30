// Fixture anonimizada do banco do app anterior. Nenhum dado real:
// descrições, valores e datas são inventados. Reproduz apenas a estrutura.
export const LEGACY_V1 = {
  expenses: [
    { id: 'e_1', descricao: 'Padaria', valor: 23.5, data: '2026-06-10', categoria: 'alimentacao' },
    {
      id: 'confirmed_LOJA_EXEMPLO_2026_01_15_3_2026-06-30',
      descricao: 'Loja Exemplo', valor: 100, data: '2026-06-23', categoria: 'casa',
      previsto: false, conciliadoAutomaticamente: true,
      parcelaKey: 'LOJA EXEMPLO|2026-01-15|3', parcela_atual: 2, parcela_total: 3,
    },
    {
      id: 'seed_Loja_Exemplo_100_00_2026_07',
      descricao: 'Loja Exemplo (parcela prevista)', valor: 100, data: '2026-07-01',
      categoria: 'casa', previsto: true, origemManual: true, grupo_parcela: 'g_1',
      parcelaKey: 'LOJA EXEMPLO|2026-01-15|3', parcela_atual: 3, parcela_total: 3,
    },
  ],
  categories: [
    { id: 'alimentacao', nome: 'Alimentação', cor: '#8a6d3b' },
    { id: 'casa', nome: 'Casa', cor: '#31708f' },
    { id: 'a_classificar', nome: 'A Classificar', cor: '#999999' },
  ],
  faturas: [
    {
      vencimento: '2026-06-30', dataCorte: '2026-06-23', arquivo: 'fatura.pdf',
      importedAt: 1750000000000,
      rows: [
        { tipo: 'despesa', data: '2026-06-10', descricao: 'Padaria', valor: 23.5, vencimento: '2026-06-30' },
        { tipo: 'parcelamento', data: '2026-01-15', descricao: 'Loja Exemplo', valor: 100, vencimento: '2026-06-30', parcela_atual: 2, parcela_total: 3 },
      ],
    },
  ],
  meta: [{ key: 'lastBackupAt', value: 1750000000000 }],
};
