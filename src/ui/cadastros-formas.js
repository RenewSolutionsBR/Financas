// Seção "Formas de pagamento" da aba Cadastros. Só coleta formulário, chama
// validatePaymentMethod() e mostra os erros devolvidos.

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros } from './cadastros-comuns.js';
import {
  TIPOS_FORMA, listFormas, saveForma, removeForma, validatePaymentMethod, novaForma,
} from '../domain/payment-methods.js';
import { listTransactions } from '../domain/transactions.js';

export async function secaoFormas(aoMudar) {
  const todas = await listFormas();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((p) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'chip-cor', style: `background:${p.cor}` }),
      el('span', { class: 'item-nome', text: `${p.nome} (${p.tipo})${p.ativo === false ? ' — desativada' : ''}` }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarForma(p, todas, aoMudar) }),
      el('button', { class: 'btn btn-mini', text: p.ativo === false ? 'Ativar' : 'Desativar', onclick: () => alternarForma(p, aoMudar) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirForma(p, aoMudar) }),
    ]))
  );
  return secao('Formas de pagamento', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Forma de pagamento', onclick: () => editarForma(novaForma({ nome: '', tipo: 'outro' }, todas), todas, aoMudar) }),
    ]),
  ]);
}

async function editarForma(pm, todas, aoMudar) {
  const inputNome = el('input', { type: 'text', value: pm.nome });
  const selTipo = el('select', {}, TIPOS_FORMA.map((t) =>
    el('option', { value: t, text: t, ...(t === pm.tipo ? { selected: 'selected' } : {}) })
  ));
  const inputPadroes = el('input', { type: 'text', value: (pm.padroesExtrato || []).join(', ') });

  const corpo = el('div', { class: 'form' }, [
    campo('Nome', inputNome),
    campo('Tipo (define o comportamento)', selTipo),
    campo('Prefixos no extrato (separados por vírgula)', inputPadroes),
  ]);

  const escolha = await abrirModal({
    titulo: pm.nome ? 'Editar forma' : 'Nova forma de pagamento',
    corpo,
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizado = novaForma({ ...pm, nome: inputNome.value.trim(), tipo: selTipo.value }, todas);
  atualizado.id = pm.id;
  atualizado.ordem = pm.ordem;
  atualizado.padroesExtrato = inputPadroes.value.split(',').map((s) => s.trim()).filter(Boolean);

  const erros = validatePaymentMethod(atualizado, todas);
  if (erros.length) return mostrarErros(erros);

  await saveForma(atualizado);
  toast('Forma de pagamento salva.', 'ok');
  await aoMudar();
}

async function alternarForma(pm, aoMudar) {
  await saveForma({ ...pm, ativo: pm.ativo === false });
  await aoMudar();
}

async function excluirForma(pm, aoMudar) {
  if (!(await confirmar(`Excluir a forma "${pm.nome}"?`))) return;
  try {
    await removeForma(pm.id, await listTransactions());
    toast('Excluída.', 'ok');
    await aoMudar();
  } catch (e) {
    toast(e.message, 'erro');
  }
}
