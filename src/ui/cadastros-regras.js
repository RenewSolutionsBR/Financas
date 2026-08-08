// Seção "Regras" da aba Cadastros: lista, edita, desativa e exclui as
// regras de classification.js. Diferente de conta/forma/categoria, uma
// regra não é referenciada por transaction via chave estrangeira — excluir
// não tem guarda de "em uso", só a confirmação padrão.

import { el, toast, abrirModal, confirmar } from './components.js';
import { secao, campo, mostrarErros } from './cadastros-comuns.js';
import { listRegras, saveRegra, removeRegra, novaRegra } from '../domain/classification.js';
import { listCategorias } from '../domain/categories.js';

const ROTULO_TIPO_MATCH = { exato: 'Exata', contem: 'Contém', regex: 'Expressão regular' };
const ROTULO_ESCOPO = { fatura: 'Fatura', extrato: 'Extrato', ambos: 'Fatura e extrato' };

export async function secaoRegras(aoMudar) {
  const [todas, categorias] = await Promise.all([listRegras(), listCategorias()]);
  const nomeCategoria = (id) => (categorias.find((c) => c.id === id) || {}).nome || '—';

  const ordenadas = [...todas].sort((a, b) => (b.acertos || 0) - (a.acertos || 0));
  const lista = el('div', { class: 'lista-cadastro' },
    ordenadas.map((r) => el('div', { class: `item-regra${r.ativa === false ? ' inativo' : ''}` }, [
      el('span', { class: 'item-nome', text: `${r.padrao}${r.ativa === false ? ' — desativada' : ''}` }),
      el('span', { class: 'item-meta', text: `${ROTULO_TIPO_MATCH[r.tipoMatch]} · ${ROTULO_ESCOPO[r.escopo]} · ${nomeCategoria(r.categoriaId)} · ${r.acertos || 0} acerto(s) · ${r.origem === 'aprendida' ? 'aprendida' : 'manual'}` }),
      el('div', { class: 'item-regra-acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: () => editarRegra(r, categorias, aoMudar) }),
        el('button', { class: 'btn btn-mini', text: r.ativa === false ? 'Ativar' : 'Desativar', onclick: () => alternarAtiva(r, aoMudar) }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluirRegra(r, aoMudar) }),
      ]),
    ]))
  );

  return secao('Regras de classificação', [
    ordenadas.length ? lista : el('p', { class: 'vazio', text: 'Nenhuma regra ainda. Regras nascem sozinhas quando você corrige a categoria de um lançamento importado, ou você cria uma manualmente.' }),
    el('div', { class: 'acoes' }, [
      el('button', { class: 'btn', text: '+ Regra manual', onclick: () => editarRegra(novaRegra({ padrao: '', categoriaId: categorias[0] ? categorias[0].id : '' }), categorias, aoMudar) }),
    ]),
  ]);
}

async function editarRegra(regra, categorias, aoMudar) {
  const inpPadrao = el('input', { type: 'text', value: regra.padrao });
  const selTipoMatch = el('select', {}, Object.entries(ROTULO_TIPO_MATCH).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.tipoMatch ? { selected: 'selected' } : {}) })
  ));
  const selEscopo = el('select', {}, Object.entries(ROTULO_ESCOPO).map(([v, texto]) =>
    el('option', { value: v, text: texto, ...(v === regra.escopo ? { selected: 'selected' } : {}) })
  ));
  const selCategoria = el('select', {}, categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(c.id === regra.categoriaId ? { selected: 'selected' } : {}) })
  ));
  const ajudaRegex = el('p', {
    class: `ajuda${selTipoMatch.value === 'regex' ? '' : ' oculto'}`,
    text: 'Expressão regular JavaScript padrão. Exemplos: "^UBER" casa descrições que COMEÇAM com UBER; "MERCADO|SUPERMERCADO" casa qualquer uma das duas, em qualquer posição.',
  });
  selTipoMatch.addEventListener('change', () => {
    ajudaRegex.classList.toggle('oculto', selTipoMatch.value !== 'regex');
  });

  const escolha = await abrirModal({
    titulo: regra.padrao ? 'Editar regra' : 'Nova regra',
    corpo: el('div', { class: 'form' }, [
      campo('Padrão (descrição canônica)', inpPadrao),
      campo('Tipo de correspondência', selTipoMatch),
      ajudaRegex,
      campo('Vale para', selEscopo),
      campo('Categoria', selCategoria),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'salvar', rotulo: 'Salvar' }],
  });
  if (escolha !== 'salvar') return;

  const padrao = inpPadrao.value.trim();
  if (!padrao) return mostrarErros(['O padrão não pode ficar em branco.']);
  if (selTipoMatch.value === 'regex') {
    try { new RegExp(padrao); } catch (e) { return mostrarErros([`Expressão regular inválida: ${e.message}`]); }
  }

  await saveRegra({ ...regra, padrao, tipoMatch: selTipoMatch.value, escopo: selEscopo.value, categoriaId: selCategoria.value });
  toast('Regra salva.', 'ok');
  await aoMudar();
}

async function alternarAtiva(regra, aoMudar) {
  await saveRegra({ ...regra, ativa: regra.ativa === false });
  toast(regra.ativa === false ? 'Regra ativada.' : 'Regra desativada.', 'ok');
  await aoMudar();
}

async function excluirRegra(regra, aoMudar) {
  if (!(await confirmar(`Excluir a regra "${regra.padrao}"?`))) return;
  await removeRegra(regra.id);
  toast('Excluída.', 'ok');
  await aoMudar();
}
