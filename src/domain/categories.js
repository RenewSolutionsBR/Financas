// Regras de categoria. A parte pura não importa storage e é testada no Node;
// as funções de persistência são invólucros finos no fim do arquivo.

import { uid } from '../core/ids.js';
import * as storage from '../core/storage.js';

// Id fixo, contrato do sistema. É buscado SEMPRE por id, nunca por nome: o
// usuário pode renomear a categoria à vontade sem quebrar nada.
export const CATEGORIA_A_CLASSIFICAR = 'a_classificar';

export const PALETA = [
  '#8a6d3b', '#31708f', '#3c763d', '#a94442', '#6f5499',
  '#00695c', '#bf6516', '#5d4037', '#455a64', '#827717',
];

export const DEFAULT_CATEGORIES = [
  { id: 'alimentacao', nome: 'Alimentação', cor: PALETA[0] },
  { id: 'moradia', nome: 'Moradia', cor: PALETA[1] },
  { id: 'transporte', nome: 'Transporte', cor: PALETA[2] },
  { id: 'saude', nome: 'Saúde', cor: PALETA[3] },
  { id: 'lazer', nome: 'Lazer', cor: PALETA[4] },
  { id: 'educacao', nome: 'Educação', cor: PALETA[5] },
  { id: 'servicos', nome: 'Serviços e assinaturas', cor: PALETA[6] },
  { id: 'tarifas_bancarias', nome: 'Tarifas e impostos bancários', cor: PALETA[7] },
  { id: 'outros', nome: 'Outros', cor: PALETA[8] },
  { id: CATEGORIA_A_CLASSIFICAR, nome: 'A Classificar', cor: PALETA[9] },
];

export function validateCategoria(cat, todas) {
  const erros = [];
  if (!cat || typeof cat !== 'object') return ['Categoria inválida.'];
  const nome = String(cat.nome || '').trim();
  if (!nome) erros.push('O nome da categoria não pode ficar em branco.');
  const repetida = (todas || []).some(
    (c) => c.id !== cat.id && String(c.nome || '').trim().toLowerCase() === nome.toLowerCase()
  );
  if (repetida) erros.push(`Já existe uma categoria chamada "${nome}".`);
  return erros;
}

export function garantirAClassificar(todas) {
  const lista = [...(todas || [])];
  if (!lista.some((c) => c.id === CATEGORIA_A_CLASSIFICAR)) {
    // Copia em vez de empurrar o objeto do proprio DEFAULT_CATEGORIES: as telas
    // recebem esta lista e podem editar um item no lugar, e isso vazaria para a
    // constante do modulo, contaminando todo seed seguinte da sessao.
    lista.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === CATEGORIA_A_CLASSIFICAR) });
  }
  return lista;
}

export function novaCategoria(nome, cor, todas) {
  const lista = todas || [];
  const usadas = new Set(lista.map((c) => c.cor));
  // Primeira cor livre da paleta, em vez de indexar pelo tamanho da lista: sem
  // isso, duas chamadas seguidas sobre a mesma lista devolviam a mesma cor.
  const corLivre = PALETA.find((c) => !usadas.has(c)) || PALETA[lista.length % PALETA.length];
  return {
    id: uid('cat'),
    nome: String(nome || '').trim(),
    cor: cor || corLivre,
  };
}

// --- Persistência ---

export async function listCategorias() {
  return garantirAClassificar(await storage.getAll('categories'));
}

export async function saveCategoria(c) {
  return storage.put('categories', c);
}

export async function removeCategoria(id, transactions) {
  if (id === CATEGORIA_A_CLASSIFICAR) {
    throw new Error('A categoria "A Classificar" não pode ser excluída: ela é o destino de tudo que ainda não foi classificado.');
  }
  // Sem `transactions` (undefined), (transactions || []) virava lista vazia
  // e a guarda de "em uso" abaixo nunca disparava — exclusao em silencio.
  // Exige o array explicitamente: quem chama precisa passar [] de proposito,
  // nunca deixar o parametro ausente silenciar a guarda.
  if (!Array.isArray(transactions)) {
    throw new Error('removeCategoria precisa da lista de lançamentos (passe [] se não houver nenhum) para checar se a categoria está em uso.');
  }
  // A guarda de integridade mora aqui, e nao na tela: senao qualquer outro
  // chamador apaga uma categoria em uso e deixa lancamento apontando para nada.
  const emUso = transactions.filter((t) => t.categoria === id).length;
  if (emUso) {
    throw new Error(`Não dá para excluir: ${emUso} lançamento(s) usam esta categoria. Reclassifique-os antes de excluir.`);
  }
  return storage.remove('categories', id);
}

export async function seedCategoriasIfEmpty() {
  const existentes = await storage.getAll('categories');
  if (existentes.length) {
    // Instalação antiga sem a categoria fixa: acrescenta sem tocar no resto.
    if (!existentes.some((c) => c.id === CATEGORIA_A_CLASSIFICAR)) {
      await storage.put('categories', { ...DEFAULT_CATEGORIES.find((c) => c.id === CATEGORIA_A_CLASSIFICAR) });
    }
    return false;
  }
  await storage.putMany('categories', DEFAULT_CATEGORIES);
  return true;
}
