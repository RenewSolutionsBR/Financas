// Seção "Backup" da aba Cadastros. Exporta e importa o arquivo .xlsx que
// contém todos os dados do app; a lógica de leitura/escrita mora em
// importers/backup-xlsx.js — aqui só orquestramos o diálogo de arquivo. A
// lógica de exportar/importar em si é compartilhada com o rodapé de
// Lançamentos e mora em backup-comum.js, pra não duplicar tratamento de erro.

import { el, abrirModal } from './components.js';
import { secao } from './cadastros-comuns.js';
import { baixarBackup, montarInputImportarBackup } from './backup-comum.js';
import { APP_VERSION } from '../version.js';
import * as storage from '../core/storage.js';

// TEMPORARIO (investigacao de bug em producao, remover depois de resolvido):
// mostra o formato tecnico dos statements direto na tela do aparelho, sem
// precisar de DevTools remoto/cabo — o unico jeito viavel de diagnosticar um
// problema que so acontece no celular do usuario, onde o DevTools via USB se
// mostrou muito instavel pra depurar ao vivo.
async function diagnosticoStatements() {
  const statements = await storage.getAll('statements');
  const linhas = statements.map((s) => {
    const tipoRows = Array.isArray(s.rows) ? `array(${s.rows.length})` : typeof s.rows;
    const camposPrimeiraLinha = Array.isArray(s.rows) && s.rows[0] ? Object.keys(s.rows[0]).join(', ') : '(nenhuma linha)';
    let detalheString = '';
    if (typeof s.rows === 'string') {
      // rows virou string em vez de array: o JSON remontado esta malformado
      // (desserializarValor engoliu o erro de JSON.parse em silencio). Mostra
      // o TAMANHO e so as BORDAS (inicio/fim/meio) pra achar onde quebrou,
      // sem expor o conteudo financeiro inteiro na tela.
      const tam = s.rows.length;
      const meio = Math.floor(tam / 2);
      detalheString = `\ntamanho da string: ${tam}` +
        `\ninicio (0-80): ${JSON.stringify(s.rows.slice(0, 80))}` +
        `\nmeio (${meio}-${meio+80}): ${JSON.stringify(s.rows.slice(meio, meio + 80))}` +
        `\nfim (ultimos 80): ${JSON.stringify(s.rows.slice(-80))}`;
    }
    return `id: ${s.id}\ntipo: ${s.tipo}\nrows: ${tipoRows}\ncampos da 1a linha: ${camposPrimeiraLinha}${detalheString}`;
  });
  await abrirModal({
    titulo: 'Diagnóstico (técnico)',
    corpo: el('div', {}, linhas.length
      ? linhas.map((texto) => el('pre', { style: 'white-space: pre-wrap; font-size: 0.75rem; border-bottom: 1px solid var(--linha); padding: 8px 0;', text: texto }))
      : [el('p', { text: 'Nenhum documento (fatura/extrato) importado.' })]),
    acoes: [{ id: 'ok', rotulo: 'Fechar' }],
  });
}

export function secaoBackup(aoMudar) {
  const inputArquivo = montarInputImportarBackup(aoMudar);

  return secao('Backup', [
    el('p', { class: 'ajuda', text: 'O backup contém todos os seus dados, inclusive faturas e extratos importados.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: 'Exportar backup', onclick: baixarBackup }),
      el('button', { class: 'btn', text: 'Importar backup', onclick: () => inputArquivo.click() }),
      el('button', { class: 'btn', text: 'Diagnóstico', onclick: diagnosticoStatements }),
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
