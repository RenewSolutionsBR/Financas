// Formulário de lançar/editar da aba Lançamentos. Extraído de lancamentos.js
// (revisão final da fase) para manter os dois arquivos abaixo de ~250 linhas.
// `editandoId` continua sendo estado do módulo lancamentos.js (usado também
// pela listagem, fora daqui) — este módulo não guarda esse estado, só recebe
// o valor atual e uma forma de escrevê-lo de volta (`definirEditandoId`),
// para não duplicar a variável em dois lugares.

import { el, toast } from './components.js';
import { campo, mostrarErros, opcoesAtivas, rotuloComStatus } from './cadastros-comuns.js';
import { campoParceladoEModal } from './lancamentos-parcelado.js';
import {
  saveTransaction, saveTransactions, removeTransaction,
  novaTransaction, validateTransaction, NATUREZAS, rotuloNatureza,
} from '../domain/transactions.js';
import {
  interpretarValor, tipoContaParaForma, contasParaForma, contaPadraoValidaParaForma,
} from './lancamentos-form-helpers.js';
import { parseMoneyBR } from '../core/money.js';
import { formatDateBR, parseDateBR, todayISO } from '../core/dates.js';
import * as storage from '../core/storage.js';

// interpretarValor, tipoContaParaForma, contasParaForma e
// contaPadraoValidaParaForma moram em lancamentos-form-helpers.js: são
// puras (sem DOM) e testadas separadamente do formulário em si.

// `editandoId` é lido daqui (estado dono de lancamentos.js) e escrito de
// volta via `definirEditandoId` nos pontos em que o fluxo termina (salvar,
// cancelar) ou começa (chamado por lancamentos.js na listagem, fora daqui).
// `aoMudar` é o mesmo callback de re-render que lancamentos.js já usa em
// outros pontos da tela.
export async function montarFormularioLancamento(ctx, transacoes, editandoId, definirEditandoId, aoMudar) {
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
        definirEditandoId(null);
        toast(`${resultado.lista.length} parcelas lançadas, uma por mês.`, 'ok');
        await aoMudar();
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
      definirEditandoId(null);
      toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
      await aoMudar();
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
      emEdicao ? el('button', { class: 'btn', type: 'button', text: 'Cancelar', onclick: async () => { definirEditandoId(null); await aoMudar(); } }) : null,
    ]),
  ]);
}
