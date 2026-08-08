// Seção "Categorias" da aba Cadastros. Só coleta formulário, chama
// validateCategoria() e mostra os erros devolvidos. A categoria fixa
// "A Classificar" é protegida por removeCategoria() no domínio, não aqui.

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros } from './cadastros-comuns.js';
import {
  listCategorias, saveCategoria, removeCategoria, validateCategoria, novaCategoria,
} from '../domain/categories.js';
import { listTransactions } from '../domain/transactions.js';

export async function secaoCategorias(aoMudar) {
  const todas = await listCategorias();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((c) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'chip-cor', style: `background:${c.cor}` }),
      el('span', { class: 'item-nome', text: c.nome, ...(c.descricao ? { title: c.descricao } : {}) }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarCategoria(c, todas, aoMudar) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirCategoria(c, aoMudar) }),
    ]))
  );
  return secao('Categorias', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Categoria', onclick: () => editarCategoria(novaCategoria('', null, todas), todas, aoMudar) }),
    ]),
  ]);
}

async function editarCategoria(cat, todas, aoMudar) {
  const inputNome = el('input', { type: 'text', value: cat.nome });
  const inputCor = el('input', { type: 'color', value: cat.cor });
  const inputDescricao = el('textarea', { rows: '2', text: cat.descricao || '' });
  const escolha = await abrirModal({
    titulo: cat.nome ? 'Editar categoria' : 'Nova categoria',
    corpo: el('div', { class: 'form' }, [
      campo('Nome', inputNome),
      campo('Cor', inputCor),
      campo('Descrição (opcional)', inputDescricao),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizada = { ...cat, nome: inputNome.value.trim(), cor: inputCor.value, descricao: inputDescricao.value.trim() };
  const erros = validateCategoria(atualizada, todas);
  if (erros.length) return mostrarErros(erros);

  await saveCategoria(atualizada);
  toast('Categoria salva.', 'ok');
  await aoMudar();
}

async function excluirCategoria(cat, aoMudar) {
  if (!(await confirmar(`Excluir a categoria "${cat.nome}"?`))) return;
  try {
    await removeCategoria(cat.id, await listTransactions());
    toast('Excluída.', 'ok');
    await aoMudar();
  } catch (e) {
    toast(e.message, 'erro');
  }
}
