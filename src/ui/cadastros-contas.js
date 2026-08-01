// Seção "Contas e cartões" da aba Cadastros. Só coleta formulário, chama
// validateAccount() e mostra os erros devolvidos: nenhuma regra de negócio é
// reimplementada aqui (cartão adicional, matchers, etc. moram em domain/).

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import {
  TIPO_CONTA, TIPO_CARTAO, listAccounts, saveAccount, removeAccount,
  validateAccount, suggestMatchers, novaConta, novoCartao, isAdicional,
} from '../domain/accounts.js';
import { listTransactions } from '../domain/transactions.js';

export async function secaoContas(aoMudar) {
  const todas = await listAccounts();
  const lista = el('div', { class: 'lista-cadastro' },
    todas.map((a) => el('div', { class: 'item-cadastro' }, [
      el('span', { class: 'item-nome', text: rotuloConta(a) }),
      el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarConta(a, todas, aoMudar) }),
      el('button', { class: 'btn btn-mini', text: a.ativo === false ? 'Ativar' : 'Desativar', onclick: () => alternarConta(a, aoMudar) }),
      el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirConta(a, aoMudar) }),
    ]))
  );
  if (!todas.length) lista.appendChild(el('p', { class: 'vazio', text: 'Nenhuma conta ou cartão cadastrado ainda.' }));

  return secao('Contas e cartões', [
    lista,
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Conta corrente', onclick: () => editarConta(novaConta({ nome: '' }), todas, aoMudar) }),
      el('button', { class: 'btn', text: '+ Cartão', onclick: () => editarConta(novoCartao({ nome: '', final: '' }), todas, aoMudar) }),
    ]),
  ]);
}

function rotuloConta(a) {
  const desativada = a.ativo === false ? ' — desativada' : '';
  if (a.tipo === TIPO_CONTA) return `${a.nome} — ag. ${a.agencia} c/c ${a.numero}${desativada}`;
  const marca = isAdicional(a) ? ' (adicional)' : '';
  return `${a.nome} — ${String(a.bandeira || '').toUpperCase()} final ${a.final}${marca}${desativada}`;
}

async function editarConta(acc, todas, aoMudar) {
  const ehCartao = acc.tipo === TIPO_CARTAO;
  const campos = {};
  const campoConta = (nome, rotulo, valor, tipo) => {
    const input = el('input', { type: tipo || 'text', value: valor == null ? '' : valor, id: 'f_' + nome });
    campos[nome] = input;
    return campo(rotulo, input);
  };

  // opcoesAtivas: uma conta/cartão desativado some do seletor, exceto quando
  // é o valor já gravado neste cadastro — mesma regra do formulário de
  // Lançamentos, para não oferecer sem marca nenhuma um cadastro que o
  // usuário desativou de propósito.
  const cartoesTitulares = opcoesAtivas(
    todas.filter((a) => a.tipo === TIPO_CARTAO && !isAdicional(a) && a.id !== acc.id),
    acc.cartaoPaiId
  );
  const contas = opcoesAtivas(todas.filter((a) => a.tipo === TIPO_CONTA), acc.contaPagadoraId);

  const seletor = (nome, rotulo, opcoes, selecionado) => {
    const sel = el('select', { id: 'f_' + nome }, [
      el('option', { value: '', text: '— nenhum —' }),
      ...opcoes.map((o) => el('option', { value: o.id, text: rotuloComStatus(o), ...(o.id === selecionado ? { selected: 'selected' } : {}) })),
    ]);
    campos[nome] = sel;
    return campo(rotulo, sel);
  };

  const corpo = el('div', { class: 'form' }, [
    campoConta('nome', 'Nome', acc.nome),
    campoConta('instituicao', 'Instituição', acc.instituicao),
    ...(ehCartao
      ? [
          campoConta('bandeira', 'Bandeira', acc.bandeira),
          campoConta('final', 'Final (4 dígitos)', acc.final),
          campoConta('diaVencimento', 'Dia de vencimento', acc.diaVencimento, 'number'),
          seletor('cartaoPaiId', 'É adicional do cartão', cartoesTitulares, acc.cartaoPaiId),
          seletor('contaPagadoraId', 'Conta que paga a fatura', contas, acc.contaPagadoraId),
        ]
      : [campoConta('agencia', 'Agência', acc.agencia), campoConta('numero', 'Número da conta', acc.numero)]),
  ]);

  const escolha = await abrirModal({
    titulo: acc.nome ? 'Editar' : 'Novo cadastro',
    corpo,
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const atualizado = { ...acc };
  for (const [nome, input] of Object.entries(campos)) {
    const v = input.value.trim();
    atualizado[nome] = nome === 'diaVencimento' ? (v ? Number(v) : undefined) : v || undefined;
  }
  if (ehCartao && !atualizado.matchers?.length) atualizado.matchers = suggestMatchers(atualizado);

  const erros = validateAccount(atualizado, todas);
  if (erros.length) return mostrarErros(erros);

  await saveAccount(atualizado);
  toast('Cadastro salvo.', 'ok');
  await aoMudar();
}

async function alternarConta(acc, aoMudar) {
  await saveAccount({ ...acc, ativo: acc.ativo === false });
  await aoMudar();
}

async function excluirConta(acc, aoMudar) {
  if (!(await confirmar(`Excluir "${acc.nome}"? Isso não pode ser desfeito.`))) return;
  try {
    await removeAccount(acc.id, await listTransactions());
    toast('Excluído.', 'ok');
    await aoMudar();
  } catch (e) {
    toast(e.message, 'erro');
  }
}
