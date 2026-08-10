// Seção "Formas de pagamento" da aba Cadastros. Só coleta formulário, chama
// validatePaymentMethod() e mostra os erros devolvidos.

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import {
  TIPOS_FORMA, listFormas, saveForma, removeForma, validatePaymentMethod, novaForma,
} from '../domain/payment-methods.js';
import { listTransactions } from '../domain/transactions.js';
import { listAccounts } from '../domain/accounts.js';
import { tipoContaParaForma } from './lancamentos-form-helpers.js';

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

  // Conta padrão: ao lançar com esta forma, o formulário de Lançamentos
  // preenche a conta sozinho a partir daqui. opcoesAtivas: uma conta
  // desativada some da lista, exceto se for a já gravada nesta forma — mesma
  // regra usada em Lançamentos e em "conta que paga a fatura" do cartão.
  const todasContas = await listAccounts();
  const selContaPadrao = el('select', {});

  // Reconstroi as opcoes do combo de conta padrao a cada troca de tipo —
  // sem isso, o formulario mostrava sempre conta bancaria como opcao,
  // mesmo pra forma do tipo credito (que precisa de CARTAO como conta
  // padrao). Preserva a selecao atual quando ela ainda for valida pro
  // novo tipo; descarta quando nao for (mesma regra que
  // contaPadraoValidaParaForma ja aplica na leitura, em
  // lancamentos-form-helpers.js).
  function atualizarOpcoesContaPadrao(manterSelecionado) {
    const tipoEsperado = tipoContaParaForma(selTipo.value);
    const contasDoTipo = tipoEsperado === null ? [] : todasContas.filter((c) => c.tipo === tipoEsperado);
    const idAtual = manterSelecionado ? selContaPadrao.value : pm.contaPadraoId;
    const contas = opcoesAtivas(contasDoTipo, idAtual);
    const aindaValida = contas.some((c) => c.id === idAtual);
    selContaPadrao.innerHTML = '';
    selContaPadrao.append(
      el('option', { value: '', text: '— nenhuma —' }),
      ...contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === idAtual && aindaValida ? { selected: 'selected' } : {}) }))
    );
  }
  atualizarOpcoesContaPadrao(false);
  selTipo.addEventListener('change', () => atualizarOpcoesContaPadrao(true));

  const corpo = el('div', { class: 'form' }, [
    campo('Nome', inputNome),
    campo('Tipo (define o comportamento)', selTipo),
    campo('Prefixos no extrato (separados por vírgula)', inputPadroes),
    campo('Conta padrão (preenche a conta ao lançar)', selContaPadrao),
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
  atualizado.contaPadraoId = selContaPadrao.value || undefined;

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
