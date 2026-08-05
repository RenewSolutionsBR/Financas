// Aba Lançamentos: a tela de uso diário, onde cada gasto é digitado. A regra
// de ouro do sistema (o que conta como gasto) mora em domain/transactions.js;
// esta tela só coleta o formulário e delega validação e persistência ao
// domínio — inclusive a marcação visual do que não é gasto, que usa
// contaComoGasto() em vez de reimplementar a metade da regra.
//
// Conta e forma de pagamento desativadas somem do seletor do formulário,
// exceto quando são o valor já gravado no lançamento em edição: um lançamento
// antigo que aponta para uma conta já desativada precisa continuar mostrando
// essa conta e permitir salvar sem forçar o usuário a trocar por outra só
// para poder editar a descrição.

import { el, toast, confirmar } from './components.js';
import { campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import { campoParceladoEModal } from './lancamentos-parcelado.js';
import {
  viewDateParaMes, mesParaViewDate, montarNavegacaoMes, montarBarraFiltros,
} from './lancamentos-filtros.js';
import {
  listTransactions, saveTransaction, saveTransactions, removeTransaction,
  novaTransaction, validateTransaction, filterTransactions, sumDespesas, contaComoGasto, NATUREZAS,
} from '../domain/transactions.js';
import { listCategorias } from '../domain/categories.js';
import { listFormas } from '../domain/payment-methods.js';
import { listAccounts, TIPO_CONTA, TIPO_CARTAO } from '../domain/accounts.js';
import { fmtBRL, parseMoneyBR } from '../core/money.js';
import { formatDateBR, parseDateBR, todayISO, monthKey } from '../core/dates.js';
import * as storage from '../core/storage.js';

let viewDate = mesParaViewDate(monthKey(todayISO()));
let filtros = {};
let editandoId = null;

// Chamado pelo roteador (app.js) ao entrar na aba vindo de outro lugar —
// nunca pelo re-render interno da própria tela, que precisa preservar o
// filtro e a edição em curso. Sem isso, editar um lançamento, ir para
// Cadastros e voltar deixava o formulário armado para sobrescrever um
// lançamento antigo, e o filtro de mês/forma anterior continuava aplicado
// sem nenhum indício.
export function resetLancamentos() {
  editandoId = null;
  viewDate = mesParaViewDate(monthKey(todayISO()));
  filtros = {};
}

// opcoesAtivas e rotuloComStatus moraram aqui e foram extraídas para
// cadastros-comuns.js: os seletores de Cadastros que referenciam outro
// cadastro (ex.: "conta que paga a fatura", "conta padrão da forma")
// precisam da mesma regra — um cadastro desativado sem marca, ou pior,
// escondido, era exatamente o furo que a revisão final pegou.

// Pura: decide o que o campo Valor significa antes de qualquer gravação.
// parseMoneyBR devolve null tanto para "vazio" quanto para "não entendi o
// formato" (ex.: "12.30", ponto decimal ambíguo) — aqui os dois casos são
// distinguidos, porque o segundo merece dizer ao usuário que o formato é
// inválido, em vez de colapsar para 0 e deixar a guarda genérica do domínio
// ("valor precisa ser maior que zero") reclamar de um valor que na
// verdade nunca chegou a existir.
export function interpretarValor(textoDigitado) {
  const texto = String(textoDigitado || '').trim();
  if (!texto) return { valor: 0, erro: null };
  const valor = parseMoneyBR(texto);
  if (valor === null) {
    return { valor: 0, erro: 'Valor inválido. Use vírgula para os centavos, como 12,30 (sem ponto).' };
  }
  return { valor: Math.abs(valor), erro: null };
}

// Pura: a marcação visual de "não é gasto" tem que ser a MESMA regra que
// decide o total (contaComoGasto, usada por sumDespesas) — nunca uma cópia
// parcial dela. Uma despesa prevista (previsto: true) não conta como gasto,
// igual a receita/transferência/pagamento de fatura, e por isso também
// precisa da marca; checar só `natureza !== 'despesa'` deixava passar
// batido uma despesa prevista, que aparecia lado a lado com gasto real sem
// nenhuma pista de que não somava no total.
export function classeDoItem(t) {
  return `item-lancamento${contaComoGasto(t) ? '' : ' nao-gasto'}`;
}

// Pura: que tipo de cadastro o campo "Conta / cartão" deve oferecer, dado o
// tipo da forma de pagamento escolhida. Cartão de crédito só faz sentido com
// um cartão (é dali que a fatura sai); dinheiro não anda em conta nenhuma;
// as demais formas (débito, pix, boleto, transferência...) descontam de uma
// conta corrente. `null` de entrada (nenhuma forma selecionada ainda) cai no
// caso comum, conta corrente, em vez de travar o campo sem necessidade.
export function tipoContaParaForma(tipoForma) {
  if (tipoForma === 'credito') return TIPO_CARTAO;
  if (tipoForma === 'dinheiro') return null;
  return TIPO_CONTA;
}

// Pura: filtra as contas pelo tipo esperado da forma, mas sempre preservando
// a conta em `idAtual` mesmo que ela não bata com o tipo — sem essa exceção,
// abrir para edição um lançamento com combinação legada (ex.: dinheiro com
// uma conta gravada de antes desta regra existir) apagaria o valor do campo
// sem o usuário ter tocado em nada, só por ter carregado a tela.
export function contasParaForma(contas, tipoForma, idAtual) {
  const tipoEsperado = tipoContaParaForma(tipoForma);
  return (contas || []).filter((c) => c.id === idAtual || (tipoEsperado !== null && c.tipo === tipoEsperado));
}

// Pura: a conta padrão de uma forma só serve de preenchimento automático se o
// TIPO dela bater com o que a forma espera. O editor de forma
// (cadastros-formas.js) hoje só deixa escolher conta corrente como "conta
// padrão", mesmo para uma forma do tipo crédito — sem esta checagem, um
// cartão de crédito podia herdar conta corrente como padrão, e o dado errado
// era exatamente o que a conciliação fatura/extrato da Fase 2 vai precisar
// ler certo.
export function contaPadraoValidaParaForma(contas, forma) {
  if (!forma || !forma.contaPadraoId) return null;
  const conta = (contas || []).find((c) => c.id === forma.contaPadraoId);
  if (!conta) return null;
  const tipoEsperado = tipoContaParaForma(forma.tipo);
  return tipoEsperado !== null && conta.tipo === tipoEsperado ? conta : null;
}

export async function renderLancamentos() {
  const painel = document.getElementById('tabLancamentos');
  const [transacoes, categorias, formas, contas] = await Promise.all([
    listTransactions(), listCategorias(), listFormas(), listAccounts(),
  ]);
  const ctx = { categorias, formas, contas };
  filtros.mes = viewDateParaMes(viewDate);
  const visiveis = filterTransactions(transacoes, filtros)
    .sort((a, b) => (a.data < b.data ? 1 : -1));

  painel.innerHTML = '';
  painel.append(
    montarNavegacaoMes(viewDate, async (novoViewDate) => { viewDate = novoViewDate; await renderLancamentos(); }),
    await formulario(ctx, transacoes),
    montarBarraFiltros(ctx, filtros, renderLancamentos),
    el('div', { class: 'total-periodo', text: `Total de gastos no período: ${fmtBRL(sumDespesas(visiveis))}` }),
    listagem(visiveis, ctx)
  );
}

async function formulario(ctx, transacoes) {
  const emEdicao = editandoId ? transacoes.find((t) => t.id === editandoId) : null;
  const ultimaForma = await storage.getMeta('ultimaFormaUsada', null);

  const inpData = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'DD/MM/AAAA', value: formatDateBR(emEdicao ? emEdicao.data : todayISO()) });
  const inpDescricao = el('input', { type: 'text', placeholder: 'Descrição', value: emEdicao ? emEdicao.descricao : '' });
  const inpValor = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: emEdicao ? String(emEdicao.valor).replace('.', ',') : '' });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(emEdicao && emEdicao.categoria === c.id ? { selected: 'selected' } : {}) })
  ));

  // A exceção de "continuar selecionável" só vale para o valor do registro em
  // edição — nunca para `ultimaFormaUsada`: se a última forma usada foi
  // desativada nesse meio-tempo, ela não deve aparecer pré-selecionada num
  // lançamento novo, só continuar visível em quem já apontava para ela.
  const formaAtualId = emEdicao ? emEdicao.formaPagamentoId : null;
  const formasOpcoes = opcoesAtivas(ctx.formas, formaAtualId);
  const formaSelecionada = emEdicao ? emEdicao.formaPagamentoId : ultimaForma;
  const selForma = el('select', {}, formasOpcoes.map((f) =>
    el('option', { value: f.id, text: rotuloComStatus(f), ...(f.id === formaSelecionada ? { selected: 'selected' } : {}) })
  ));

  // Conta padrão da forma já pré-selecionada (ultimaFormaUsada, num novo
  // lançamento): precisa ser calculada aqui, não só reagir ao `change` do
  // seletor de forma — senão o preenchimento automático só valia se o
  // usuário trocasse a forma à mão, e nunca no caso comum (forma já vem
  // certa, usuário só confere e lança). Só considera a forma que REALMENTE
  // vai aparecer selecionada no <select> (presente em formasOpcoes) — uma
  // `ultimaFormaUsada` desativada não fica selecionada (comentário acima), e
  // não pode emprestar sua conta padrão para uma seleção que não é a dela.
  const formaPreSelecionada = !emEdicao && formasOpcoes.some((f) => f.id === formaSelecionada)
    ? ctx.formas.find((f) => f.id === formaSelecionada)
    : null;

  // A conta padrão só se aplica quando a pré-seleção é genuína (ultimaFormaUsada
  // realmente presente e ativa, comentário acima) — e só se o TIPO dela bater
  // com o que a forma espera (contaPadraoValidaParaForma), senão um cartão de
  // crédito podia herdar conta corrente como padrão.
  const contaPadraoValida = formaPreSelecionada ? contaPadraoValidaParaForma(ctx.contas, formaPreSelecionada) : null;
  const contaPadraoInicial = contaPadraoValida ? contaPadraoValida.id : null;

  // A forma que o <select> vai REALMENTE exibir selecionada: se `formaSelecionada`
  // não está entre as opções (primeira instalação, sem ultimaFormaUsada ainda,
  // ou ela foi desativada), o navegador cai sozinho na primeira option da
  // lista — e o filtro de tipo de conta abaixo precisa refletir ESSA forma,
  // não só a pré-seleção genuína, senão o campo de conta mostra o tipo errado
  // para a forma que está visivelmente marcada no formulário.
  const formaExibidaId = emEdicao ? emEdicao.formaPagamentoId
    : (formasOpcoes.some((f) => f.id === formaSelecionada) ? formaSelecionada : (formasOpcoes[0] || {}).id);
  const formaExibida = ctx.formas.find((f) => f.id === formaExibidaId) || null;

  // A conta padrão de uma forma pode estar desativada sem que ninguém tenha
  // desativado a forma junto — opcoesAtivas precisa contar essa conta como
  // "idAtual" também, senão ela fica de fora das opções e o preenchimento
  // automático abaixo não encontra option nenhuma para selecionar, deixando
  // o select em branco.
  const contaAtualId = emEdicao ? emEdicao.contaId : contaPadraoInicial;
  const contasOpcoes = opcoesAtivas(contasParaForma(ctx.contas, formaExibida ? formaExibida.tipo : null, contaAtualId), contaAtualId);
  const selConta = el('select', {}, [
    el('option', { value: '', text: '— sem conta —' }),
    ...contasOpcoes.map((a) => el('option', {
      value: a.id,
      text: rotuloComStatus(a),
      ...((emEdicao ? emEdicao.contaId === a.id : a.id === contaPadraoInicial) ? { selected: 'selected' } : {}),
    })),
  ]);

  // Só preserva a conta atual ao trocar de forma quando o USUÁRIO a escolheu
  // à mão: sem essa distinção, uma conta que só estava lá porque a forma
  // ANTERIOR a preencheu automaticamente "vazava" para a forma seguinte,
  // mesmo quando as duas têm contas padrão diferentes — configurar padrões
  // diferentes por forma parava de funcionar depois da primeira troca.
  let contaEditadaManualmente = false;
  selConta.addEventListener('change', () => { contaEditadaManualmente = true; });

  // Trocar a forma refaz a LISTA de opções de conta (não só o valor
  // selecionado): cartão de crédito só pode oferecer cartão, dinheiro não
  // oferece conta nenhuma, o resto oferece conta corrente — ver
  // tipoContaParaForma. Mantém a conta já escolhida pelo usuário se ela
  // continuar fazendo sentido pro novo tipo; senão cai na conta padrão
  // (válida) da nova forma, ou em branco.
  selForma.addEventListener('change', () => {
    const forma = ctx.formas.find((f) => f.id === selForma.value) || null;
    const tipoEsperado = tipoContaParaForma(forma ? forma.tipo : null);
    const contaEscolhidaContinuaValida = contaEditadaManualmente && selConta.value && tipoEsperado !== null &&
      ctx.contas.some((c) => c.id === selConta.value && c.tipo === tipoEsperado);
    const contaPadrao = contaPadraoValidaParaForma(ctx.contas, forma);
    const novoValor = contaEscolhidaContinuaValida ? selConta.value : (contaPadrao ? contaPadrao.id : '');
    const novasOpcoes = opcoesAtivas(contasParaForma(ctx.contas, forma ? forma.tipo : null, novoValor), novoValor);
    selConta.innerHTML = '';
    selConta.append(
      el('option', { value: '', text: '— sem conta —' }),
      ...novasOpcoes.map((a) => el('option', {
        value: a.id, text: rotuloComStatus(a), ...(a.id === novoValor ? { selected: 'selected' } : {}),
      }))
    );
  });

  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: rotuloNatureza(n), ...(emEdicao && emEdicao.natureza === n ? { selected: 'selected' } : {}) })
  ));

  const botaoSalvar = el('button', { class: 'btn btn-primario', type: 'submit', text: emEdicao ? 'Salvar alterações' : 'Lançar' });

  // Compra parcelada: só faz sentido lançando do zero, nunca editando um
  // lançamento já existente (mesmo raciocínio de não misturar os dois fluxos
  // que o app anterior já tinha) — por isso o checkbox nem aparece em edição.
  const { checkbox: chkParcelado, painelExtra: painelParcelado, confirmarEObterLancamentos } = campoParceladoEModal({
    campo,
    parseMoneyBR,
    onRemoverTransacoes: async (ids) => { for (const id of ids) await removeTransaction(id); },
  });

  // Guarda de reentrância: sem ela, dois disparos de submit antes do primeiro
  // `await saveTransaction` resolver criam dois registros distintos
  // (novaTransaction gera um id novo a cada chamada). A checagem em si é
  // síncrona e roda antes de qualquer await, então bloqueia mesmo um segundo
  // disparo que chega no mesmo tick do primeiro.
  let salvando = false;
  const salvar = async () => {
    if (salvando) return;
    salvando = true;
    botaoSalvar.disabled = true;
    try {
      // Compra parcelada desvia pro fluxo do módulo irmão inteiro: N
      // lançamentos de uma vez em vez de um só, checando duplicidade antes.
      // Fica fora do fluxo de edição de propósito (checkbox nem aparece
      // então) — não faz sentido "editar e parcelar" ao mesmo tempo.
      if (chkParcelado.checked && !emEdicao) {
        const base = {
          descricao: inpDescricao.value.trim(),
          data: parseDateBR(inpData.value),
          categoria: selCategoria.value,
          formaPagamentoId: selForma.value,
          contaId: selConta.value || undefined,
        };
        // allFaturaRows vazio: a importação de fatura ainda não existe nesta
        // fase (chega na Task 8) — sem fatura importada, não há linha pra
        // casar na checagem fraca de duplicidade, só a identidade exata por
        // parcelaKey entre lançamentos já continua funcionando.
        const resultado = await confirmarEObterLancamentos(transacoes, [], base);
        if (resultado.erro) { toast(resultado.erro, 'erro'); return; }
        if (resultado.cancelado) return;

        // Mesma validação do domínio usada no lançamento único, aplicada à
        // parcela 1 (a única que carrega o formato final de todos os campos
        // que o usuário digitou à mão — data, descrição, categoria, forma):
        // pega data inválida, descrição vazia ou categoria/forma não
        // escolhida antes de gravar qualquer coisa.
        const erros = validateTransaction(resultado.lista[0]);
        if (erros.length) return mostrarErros(erros);

        await saveTransactions(resultado.lista);
        await storage.setMeta('ultimaFormaUsada', base.formaPagamentoId);
        editandoId = null;
        toast(`${resultado.lista.length} parcelas lançadas, uma por mês.`, 'ok');
        await renderLancamentos();
        return;
      }

      const { valor, erro: erroValor } = interpretarValor(inpValor.value);
      if (erroValor) return toast(erroValor, 'erro');

      const data = parseDateBR(inpData.value);
      const base = {
        data,
        descricao: inpDescricao.value.trim(),
        valor,
        categoria: selCategoria.value,
        formaPagamentoId: selForma.value,
        contaId: selConta.value || undefined,
        natureza: selNatureza.value,
      };
      const registro = emEdicao ? { ...emEdicao, ...base } : novaTransaction(base);

      // Se o usuário mexeu na categoria, a escolha deixa de ser palpite da máquina.
      if (emEdicao && emEdicao.categoria !== base.categoria) {
        delete registro.classificadoAutomaticamente;
        delete registro.regraId;
      }

      const erros = validateTransaction(registro);
      if (erros.length) return mostrarErros(erros);

      await saveTransaction(registro);
      await storage.setMeta('ultimaFormaUsada', registro.formaPagamentoId);
      editandoId = null;
      toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
      await renderLancamentos();
    } finally {
      salvando = false;
      botaoSalvar.disabled = false;
    }
  };

  return el('form', { class: 'form-lancamento', onsubmit: (ev) => { ev.preventDefault(); salvar(); } }, [
    el('div', { class: 'linha-form' }, [campo('Data', inpData), campo('Valor', inpValor)]),
    campo('Descrição', inpDescricao),
    el('div', { class: 'linha-form' }, [campo('Categoria', selCategoria), campo('Forma de pagamento', selForma)]),
    el('div', { class: 'linha-form' }, [campo('Conta / cartão', selConta), campo('Natureza', selNatureza)]),
    emEdicao ? null : el('label', { class: 'campo-inline' }, [chkParcelado, el('span', { text: 'Compra parcelada' })]),
    emEdicao ? null : painelParcelado,
    el('div', { class: 'acoes' }, [
      botaoSalvar,
      emEdicao ? el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: async () => { editandoId = null; await renderLancamentos(); } }) : null,
    ]),
  ]);
}

function rotuloNatureza(n) {
  return {
    despesa: 'Gasto',
    receita: 'Recebimento (não conta como gasto)',
    transferencia: 'Transferência entre contas próprias',
    pagamento_fatura: 'Pagamento de fatura',
  }[n];
}

function listagem(visiveis, ctx) {
  if (!visiveis.length) return el('p', { class: 'vazio', text: 'Nenhum lançamento neste filtro.' });
  const nome = (lista, id) => (lista.find((x) => x.id === id) || {}).nome || '—';

  return el('div', { class: 'lista-lancamentos' }, visiveis.map((t) =>
    el('div', { class: classeDoItem(t) }, [
      el('div', { class: 'lanc-principal' }, [
        el('span', { class: 'lanc-descricao', text: t.descricao }),
        t.classificadoAutomaticamente ? el('span', { class: 'selo-auto', title: 'Categoria aplicada automaticamente', text: 'auto' }) : null,
      ]),
      el('div', { class: 'lanc-meta', text: `${formatDateBR(t.data)} · ${nome(ctx.categorias, t.categoria)} · ${nome(ctx.formas, t.formaPagamentoId)}` }),
      el('div', { class: 'lanc-valor', text: fmtBRL(t.valor) }),
      el('div', { class: 'acoes' }, [
        el('button', { class: 'btn btn-mini', text: 'Editar', onclick: async () => { editandoId = t.id; await renderLancamentos(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }),
        el('button', { class: 'btn btn-mini btn-perigo', text: 'Excluir', onclick: () => excluir(t) }),
      ]),
    ])
  ));
}

async function excluir(t) {
  if (!(await confirmar(`Excluir "${t.descricao}"?`))) return;
  await removeTransaction(t.id);
  toast('Lançamento excluído.', 'ok');
  await renderLancamentos();
}
