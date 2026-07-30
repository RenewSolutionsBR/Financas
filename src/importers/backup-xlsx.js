// Backup completo do app. Ao contrário do backup do app anterior, exporta
// TODOS os stores, inclusive statements: um ciclo exportar→importar precisa
// devolver exatamente o mesmo conjunto de dados, e o teste de ciclo garante
// que essa limitação não volte.
//
// datasetToSheets/sheetsToDataset/detectBackupVersion são puros e não tocam
// no global XLSX: é isso que permite testar o ciclo completo no Node, onde
// XLSX não existe. Só exportarBackup/importarBackup, que integram com o
// SheetJS vendorizado e com o storage, tocam XLSX e indexedDB.

import { STORES, migrateV1ToV2 } from '../core/db-schema.js';
import { APP_VERSION } from '../version.js';
import * as storage from '../core/storage.js';

export const SCHEMA_VERSION_BACKUP = 2;

const ABA_INFO = '_backup_info';
const STORES_EXPORTAVEIS = STORES.map((s) => s.nome);

// Prefixo que marca um valor serializado como JSON. Sem ele, não dá para
// distinguir a string "[1,2]" digitada pelo usuário de um array de verdade.
const MARCA_JSON = '@json:';

function serializarValor(v) {
  // undefined vira célula vazia e some na volta, que é o certo: o campo não
  // existia. Mas null e string vazia são valores de verdade, e precisam voltar
  // como null e string vazia — por isso viajam marcados, e não como célula
  // vazia (célula vazia é indistinguível de "campo ausente").
  if (v === undefined) return '';
  if (v === null) return MARCA_JSON + 'null';
  if (v === '') return MARCA_JSON + '""';
  // Uma string que por acaso começa com o próprio marcador também viaja
  // marcada, senão voltaria como o valor que o marcador representa: um
  // usuário que digitasse "@json:null" numa descrição veria virar null na
  // restauração.
  if (typeof v === 'string' && v.startsWith(MARCA_JSON)) return MARCA_JSON + JSON.stringify(v);
  if (typeof v === 'object') return MARCA_JSON + JSON.stringify(v);
  if (typeof v === 'boolean') return MARCA_JSON + JSON.stringify(v);
  return v;
}

function desserializarValor(v) {
  if (typeof v === 'string' && v.startsWith(MARCA_JSON)) {
    try {
      return JSON.parse(v.slice(MARCA_JSON.length));
    } catch (e) {
      return v;
    }
  }
  return v === '' ? undefined : v;
}

export function datasetToSheets(dataset) {
  const sheets = {
    [ABA_INFO]: [
      { chave: 'schemaVersion', valor: SCHEMA_VERSION_BACKUP },
      { chave: 'appVersion', valor: APP_VERSION },
      { chave: 'exportadoEm', valor: new Date().toISOString() },
    ],
  };
  for (const store of STORES_EXPORTAVEIS) {
    sheets[store] = ((dataset && dataset[store]) || []).map((registro) => {
      const linha = {};
      for (const [k, v] of Object.entries(registro)) linha[k] = serializarValor(v);
      return linha;
    });
  }
  return sheets;
}

export function sheetsToDataset(sheets) {
  const nomes = Object.keys(sheets || {});
  const versao = detectBackupVersion(nomes);
  const avisos = [];

  if (versao === 1) {
    const expenses = (sheets.Backup_Lancamentos || []).map((r) => ({
      id: r.id != null ? String(r.id) : null,
      descricao: r.descricao || '',
      valor: Number(r.valor) || 0,
      data: typeof r.data === 'string' ? r.data.slice(0, 10) : r.data,
      categoria: r.categoria || 'a_classificar',
      previsto: !!Number(r.previsto),
      parcelaKey: r.parcelaKey || undefined,
    }));
    avisos.push(
      'Este é um backup do app anterior. Ele não contém as faturas importadas nem os ' +
      'campos de parcela (número da parcela, marca de conciliação automática). Depois de ' +
      'restaurar, reimporte os PDFs das faturas para recuperar essa parte.'
    );
    return {
      versao: 1,
      avisos,
      dataset: { expenses, categories: sheets.Backup_Categorias || [], faturas: [], meta: [] },
    };
  }

  const dataset = {};
  for (const store of STORES_EXPORTAVEIS) {
    dataset[store] = (sheets[store] || []).map((linha) => {
      const registro = {};
      for (const [k, v] of Object.entries(linha)) {
        const valor = desserializarValor(v);
        if (valor !== undefined) registro[k] = valor;
      }
      return registro;
    });
  }
  // Devolve o que foi detectado, sem inventar versão: com `|| SCHEMA_VERSION_BACKUP`
  // aqui, uma planilha qualquer virava "backup v2 vazio" e a guarda de
  // importarBackup nunca disparava — o usuário via "restaurado" tendo
  // selecionado o arquivo errado.
  return { versao, avisos, dataset };
}

export function detectBackupVersion(nomesDeAbas) {
  const nomes = nomesDeAbas || [];
  if (nomes.includes(ABA_INFO) || nomes.includes('transactions')) return 2;
  if (nomes.includes('Backup_Lancamentos')) return 1;
  return null;
}

// --- Integração com SheetJS e storage ---

export async function exportarBackup() {
  const dataset = {};
  for (const store of STORES_EXPORTAVEIS) dataset[store] = await storage.getAll(store);
  const sheets = datasetToSheets(dataset);
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  for (const [nome, linhas] of Object.entries(sheets)) {
    const aba = nome.slice(0, 31);
    // O formato xlsx limita nome de aba a 31 caracteres. Se dois stores
    // truncarem para o mesmo nome, o SheetJS lança um erro obscuro e o backup
    // inteiro falha — melhor parar aqui, dizendo qual é o problema.
    if (usados.has(aba)) throw new Error(`Dois stores geram o mesmo nome de aba ("${aba}"). Renomeie um deles.`);
    usados.add(aba);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba);
  }
  const saida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await storage.setMeta('lastBackupAt', Date.now());
  return new Blob([saida], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function importarBackup(arrayBuffer, opcoes) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = {};
  for (const nome of wb.SheetNames) {
    sheets[nome] = XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' });
  }

  const { dataset, versao, avisos } = sheetsToDataset(sheets);
  if (!versao) throw new Error('Este arquivo não parece ser um backup do app.');

  const final = versao === 1 ? migrateV1ToV2(dataset, opcoes) : dataset;
  if (versao === 1) avisos.push(...final.avisos);

  const contagens = {};
  // Categorias e cadastros antes de transactions: se a gravação for
  // interrompida, nenhum lançamento fica apontando para algo inexistente.
  for (const store of ['categories', 'accounts', 'paymentMethods', 'statements', 'classificationRules', 'transactions', 'meta']) {
    const lista = final[store] || [];
    await storage.putMany(store, lista);
    contagens[store] = lista.length;
  }
  return { contagens, avisos };
}
