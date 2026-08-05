// Seção "Backup" da aba Cadastros. Exporta e importa o arquivo .xlsx que
// contém todos os dados do app; a lógica de leitura/escrita mora em
// importers/backup-xlsx.js — aqui só orquestramos o diálogo de arquivo. A
// lógica de exportar/importar em si é compartilhada com o rodapé de
// Lançamentos e mora em backup-comum.js, pra não duplicar tratamento de erro.

import { el } from './components.js';
import { secao } from './cadastros-comuns.js';
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';

export function secaoBackup(aoMudar) {
  const inputArquivo = montarInputImportarBackup(aoMudar);

  return secao('Backup', [
    el('p', { class: 'ajuda', text: 'O backup contém todos os seus dados, inclusive faturas e extratos importados.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', text: 'Importar backup', onclick: () => inputArquivo.click() }),
    ]),
    inputArquivo,
  ]);
}
