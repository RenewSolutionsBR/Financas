// Seção "Backup" da aba Cadastros. Exporta e importa o arquivo .xlsx que
// contém todos os dados do app; a lógica de leitura/escrita mora em
// importers/backup-xlsx.js — aqui só orquestramos o diálogo de arquivo.

import { el, toast, abrirModal } from './components.js';
import { secao, campo } from './cadastros-comuns.js';
import { listAccounts, TIPO_CARTAO } from '../domain/accounts.js';
import { exportarBackup, importarBackup, detectarVersaoDoArquivo } from '../importers/backup-xlsx.js';
import { migrarDoAppAnterior } from './onboarding.js';

export function secaoBackup(aoMudar) {
  const inputArquivo = el('input', { type: 'file', accept: '.xlsx', class: 'oculto' });
  inputArquivo.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    try {
      const buffer = await arquivo.arrayBuffer();
      const versao = detectarVersaoDoArquivo(buffer);
      if (!versao) {
        toast('Esse arquivo não parece ser um backup do app.', 'erro');
        return;
      }
      // So o formato antigo precisa saber a qual cartao associar: o novo ja
      // traz o cartao dentro. Perguntar sempre fazia o usuario decidir algo
      // que seria descartado.
      let cartaoTitularId = null;
      if (versao === 1) {
        const cartoes = (await listAccounts()).filter((a) => a.tipo === TIPO_CARTAO);
        cartaoTitularId = await escolherCartaoParaImportacao(cartoes);
        if (cartaoTitularId === false) return;
      }
      const { contagens, avisos } = await importarBackup(buffer, { cartaoTitularId, formaCreditoId: 'pm_credito' });
      const total = Object.values(contagens).reduce((a, b) => a + b, 0);
      toast(`${total} registro(s) restaurados.`, 'ok');
      if (avisos.length) await abrirModal({ titulo: 'Atenção', corpo: avisos.join('\n\n') });
      await aoMudar();
    } catch (e) {
      toast('Não consegui ler esse backup: ' + e.message, 'erro');
    } finally {
      // Sempre limpa, inclusive quando o usuario cancela: sem isso o input
      // continuava apontando para o arquivo, e reselecionar o MESMO arquivo
      // nao dispara change de novo - a tela ficava muda.
      ev.target.value = '';
    }
  });

  return secao('Backup', [
    el('p', { class: 'ajuda', text: 'O backup contém todos os seus dados, inclusive faturas e extratos importados.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', text: 'Importar backup', onclick: () => inputArquivo.click() }),
      el('button', { class: 'btn', text: 'Migrar dados do app anterior', onclick: migrarDoAppAnterior }),
    ]),
    inputArquivo,
  ]);
}

/**
 * Só é chamada para backup do formato antigo (versão 1). Devolve o id do
 * cartão a associar, `null` se não há nenhum cartão cadastrado ainda, ou
 * `false` se o usuário cancelou.
 */
async function escolherCartaoParaImportacao(cartoes) {
  if (!cartoes.length) return null;
  if (cartoes.length === 1) return cartoes[0].id;
  const sel = el('select', {}, cartoes.map((c) => el('option', { value: c.id, text: c.nome })));
  const escolha = await abrirModal({
    titulo: 'Backup do app anterior',
    corpo: el('div', { class: 'form' }, [
      el('p', { text: 'Se este for um backup do app anterior, os lançamentos são todos de cartão de crédito. A qual cartão associá-los?' }),
      campo('Cartão', sel),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'ok', rotulo: 'Importar' }],
  });
  return escolha === 'ok' ? sel.value : false;
}

async function baixarBackup() {
  const blob = await exportarBackup();
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `backup-livro-de-gastos-${new Date().toISOString().slice(0, 10)}.xlsx` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Backup gerado.', 'ok');
}
