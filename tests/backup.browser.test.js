// Ciclo real de backup, passando pelo SheetJS de verdade: só roda no
// navegador (tools/tests.html), porque depende do global XLSX e de
// IndexedDB. Os testes puros de backup.test.js operam sobre objetos JS e
// assumem como o SheetJS trata coluna ausente; este exercita a suposição
// contra a biblioteca real, porque backup/restore é a rede de segurança dos
// dados do usuário.

import { describe, it, assert, assertEqual } from './harness.js';
import { exportarBackup, importarBackup } from '../src/importers/backup-xlsx.js';
import * as storage from '../src/core/storage.js';

describe('backup: ciclo real pelo arquivo xlsx', () => {
  it('exportar e importar preserva os dados atravessando o SheetJS de verdade', async () => {
    const antes = [
      { id: 'bkp_1', data: '2026-06-10', descricao: 'Compra', valor: 23.5, categoria: 'casa',
        natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: 'acc_1', previsto: false },
      { id: 'bkp_2', data: '2026-06-23', descricao: '', valor: 0, categoria: 'casa',
        natureza: 'despesa', formaPagamentoId: 'pm_pix', contaId: null, previsto: false,
        parcelaKey: 'X|2026-01-15|3', parcela_atual: 2, parcela_total: 3,
        conciliadoAutomaticamente: true, origemRef: { statementId: 's1', linhaId: 'ab12' } },
    ];
    await storage.putMany('transactions', antes);

    const blob = await exportarBackup();
    assert(blob.size > 0, 'backup veio vazio');

    await storage.remove('transactions', 'bkp_1');
    await storage.remove('transactions', 'bkp_2');
    assertEqual((await storage.get('transactions', 'bkp_1')), undefined);

    const { contagens, avisos } = await importarBackup(await blob.arrayBuffer(), {});
    assert(contagens.transactions >= 2, `restaurou ${contagens.transactions} transactions`);
    assertEqual(avisos.length, 0);

    const t1 = await storage.get('transactions', 'bkp_1');
    const t2 = await storage.get('transactions', 'bkp_2');
    assertEqual(t1.descricao, 'Compra');
    assertEqual(t1.valor, 23.5);
    assertEqual(t1.previsto, false);
    // Os três casos que quebravam antes, agora contra o arquivo de verdade:
    assertEqual(t2.descricao, '');
    assertEqual('contaId' in t2, true);
    assertEqual(t2.contaId, null);
    assertEqual(t2.valor, 0);
    assertEqual(t2.conciliadoAutomaticamente, true);
    assertEqual(t2.parcela_atual, 2);
    assertEqual(t2.origemRef.linhaId, 'ab12');
    // E a suposição sobre coluna ausente: bkp_1 não tem parcelaKey.
    assertEqual('parcelaKey' in t1, false, 'coluna ausente virou campo vazio em vez de sumir');

    await storage.remove('transactions', 'bkp_1');
    await storage.remove('transactions', 'bkp_2');
  });

  it('recusa um arquivo que não é backup', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ produto: 'Arroz', preco: 20 }]), 'Plan1');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    let erro = null;
    try { await importarBackup(buf, {}); } catch (e) { erro = e; }
    assert(erro !== null, 'aceitou planilha que não é backup');
    assert(/backup/i.test(erro.message), erro.message);
  });
});
