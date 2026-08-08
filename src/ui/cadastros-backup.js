// Seção "Backup" da aba Cadastros. Exporta e importa o arquivo .xlsx que
// contém todos os dados do app; a lógica de leitura/escrita mora em
// importers/backup-xlsx.js — aqui só orquestramos o diálogo de arquivo. A
// lógica de exportar/importar em si é compartilhada com o rodapé de
// Lançamentos e mora em backup-comum.js, pra não duplicar tratamento de erro.

import { el } from './components.js';
import { secao } from './cadastros-comuns.js';
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';
import { APP_VERSION } from '../version.js';

export function secaoBackup(aoMudar) {
  const inputArquivo = montarInputImportarBackup(aoMudar);

  return secao('Backup', [
    el('p', { class: 'ajuda', text: 'O backup contém todos os seus dados, inclusive faturas e extratos importados.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', text: 'Importar backup', onclick: () => inputArquivo.click() }),
    ]),
    inputArquivo,
    // Versao visivel na propria tela: sem isso, nao ha como o usuario
    // confirmar se o aparelho ja pegou a ultima publicacao ou ainda esta
    // servindo uma versao antiga do cache do service worker (bug real
    // visto em producao, onde um fix so chegava no aparelho depois do
    // usuario confirmar a versao manualmente via este numero).
    el('p', { class: 'ajuda', text: `Versão do app: ${APP_VERSION}` }),
  ]);
}
