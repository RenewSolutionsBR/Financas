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
import { registrarEvento, TIPOS_EVENTO } from '../domain/audit-log.js';

// interpretarValor, tipoContaParaForma, contasParaForma e
// contaPadraoValidaParaForma moram em lancamentos-form-helpers.js: são
// puras (sem DOM) e testadas separadamente do formulário em si.

// `editandoId` é lido daqui (estado dono de lancamentos.js) e escrito de
// volta via `definirEditandoId` nos pontos em que o fluxo termina (salvar,
// cancelar) ou começa (chamado por lancamentos.js na listagem, fora daqui).
// `aoMudar` é o mesmo callback de re-render que lancamentos.js já usa em
// outros pontos da tela. `rascunho` (opcional) vem do botão "+lançar" da
// Conciliação — { descricao, data, valor, natureza } prontos pra pré-encher
// um lançamento NOVO (nunca se aplica em edição, por isso lancamentos.js só
// passa `rascunho` quando `editandoId` é null).
export async function montarFormularioLancamento(ctx, transacoes, editandoId, definirEditandoId, aoMudar, rascunho) {
  const emEdicao = editandoId ? transacoes.find((t) => t.id === editandoId) : null;
  const ultimaForma = await storage.getMeta('ultimaFormaUsada', null);

  const inpData = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'DD/MM/AAAA', value: formatDateBR(emEdicao ? emEdicao.data : (rascunho ? rascunho.data : todayISO())) });
  const inpDescricao = el('input', { type: 'text', placeholder: 'Descrição', value: emEdicao ? emEdicao.descricao : (rascunho ? rascunho.descricao : '') });
  const inpValor = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: emEdicao ? String(emEdicao.valor).replace('.', ',') : (rascunho ? String(rascunho.valor).replace('.', ',') : '') });

  const selCategoria = el('select', {}, ctx.categorias.map((c) =>
    el('option', { value: c.id, text: c.nome, ...(emEdicao && emEdicao.categoria === c.id ? { selected: 'selected' } : {}) })
  ));

  // A exceção de "continuar selecionável" só vale para o valor do registro em
  // edição — nunca para `ultimaFormaUsada`: se a última forma usada foi
  // desativada nesse meio-tempo, ela não deve aparecer pré-selecionada num
  // lançamento novo, só continuar visível em quem já apontava para ela.
  const formaAtualId = emEdicao ? emEdicao.formaPagamentoId : null;
  const formasOpcoes = opcoesAtivas(ctx.formas, formaAtualId);
  // Rascunho do "+lançar" (Conciliação) já sabe o cartão/conta exatos da
  // fatura (contaId) — nesse caso a forma de pagamento correta é qualquer
  // forma ATIVA cujo tipo bata com essa conta, nunca a ultimaFormaUsada
  // genérica: usar a última forma podia escolher um cartão/conta DIFERENTE
  // do da fatura, o lançamento salvava no lugar errado e nunca conciliava.
  const contaDoRascunho = rascunho && rascunho.contaId ? ctx.contas.find((c) => c.id === rascunho.contaId) : null;
  const formaParaContaDoRascunho = contaDoRascunho
    ? formasOpcoes.find((f) => tipoContaParaForma(f.tipo) === contaDoRascunho.tipo)
    : null;
  const formaSelecionada = emEdicao ? emEdicao.formaPagamentoId
    : (formaParaContaDoRascunho ? formaParaContaDoRascunho.id : ultimaForma);
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
  // contaDoRascunho (definida acima) vence a conta padrão da forma: o
  // rascunho do "+lançar" já sabe exatamente qual cartão/conta é o da
  // fatura, então não faz sentido cair no padrão genérico da forma.
  const contaPadraoInicial = contaDoRascunho ? contaDoRascunho.id : (contaPadraoValida ? contaPadraoValida.id : null);

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

  const naturezaSelecionada = emEdicao ? emEdicao.natureza : (rascunho ? rascunho.natureza : null);
  const selNatureza = el('select', {}, NATUREZAS.map((n) =>
    el('option', { value: n, text: rotuloNatureza(n), ...(naturezaSelecionada === n ? { selected: 'selected' } : {}) })
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
        // Mesma checagem do fluxo de lançamento único: compra parcelada quase
        // sempre é cartão de crédito, e sem contaId NENHUMA das N parcelas
        // geradas jamais vai casar com a conciliação de fatura.
        const formaEscolhidaParcelado = ctx.formas.find((f) => f.id === base.formaPagamentoId);
        if (formaEscolhidaParcelado && tipoContaParaForma(formaEscolhidaParcelado.tipo) !== null && !base.contaId) {
          erros.push('Escolha a conta ou cartão — obrigatório para esta forma de pagamento (senão as parcelas nunca aparecem na conciliação de fatura).');
        }
        if (erros.length) return mostrarErros(erros);

        await saveTransactions(resultado.lista);
        await registrarEvento(TIPOS_EVENTO.LANCAMENTO_CRIADO, `Compra parcelada criada: ${resultado.lista.length} parcela(s)`);
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
        // Rascunho do "+lançar" (Conciliação) carrega parcela_atual/
        // parcela_total/parcelaKey quando o item é parcela de uma compra
        // parcelada — nunca se aplica em edição (rascunho só existe pra
        // lançamento novo).
        ...(!emEdicao && rascunho && rascunho.parcela_atual ? {
          parcela_atual: rascunho.parcela_atual,
          parcela_total: rascunho.parcela_total,
          parcelaKey: rascunho.parcelaKey,
        } : {}),
      };
      const registro = emEdicao ? { ...emEdicao, ...base } : novaTransaction(base);

      // Se o usuário mexeu na categoria, a escolha deixa de ser palpite da máquina.
      if (emEdicao && emEdicao.categoria !== base.categoria) {
        delete registro.classificadoAutomaticamente;
        delete registro.regraId;
      }

      const erros = validateTransaction(registro);
      // Forma cujo tipo espera conta/cartão (tipoContaParaForma !== null,
      // ou seja, tudo exceto dinheiro) mas o campo ficou em "— sem conta —":
      // o lançamento salvava normalmente, só que sem contaId nenhum — a
      // conciliação de fatura filtra por plasticosDoTitular(contaId), então
      // um lançamento sem conta nunca aparecia em NENHUM balde de nenhum
      // cartão, silenciosamente, até o usuário notar sozinho.
      const formaEscolhida = ctx.formas.find((f) => f.id === registro.formaPagamentoId);
      if (formaEscolhida && tipoContaParaForma(formaEscolhida.tipo) !== null && !registro.contaId) {
        erros.push('Escolha a conta ou cartão — obrigatório para esta forma de pagamento (senão o lançamento nunca aparece na conciliação de fatura).');
      }
      if (erros.length) return mostrarErros(erros);

      await saveTransaction(registro);
      await registrarEvento(
        emEdicao ? TIPOS_EVENTO.LANCAMENTO_EDITADO
          : (rascunho ? TIPOS_EVENTO.LANCAR_DA_CONCILIACAO : TIPOS_EVENTO.LANCAMENTO_CRIADO),
        emEdicao ? 'Lançamento editado'
          : (rascunho ? 'Lançamento criado a partir da Conciliação' : 'Lançamento criado')
      );
      await storage.setMeta('ultimaFormaUsada', registro.formaPagamentoId);
      definirEditandoId(null);
      toast(emEdicao ? 'Lançamento atualizado.' : 'Lançamento salvo.', 'ok');
      await aoMudar();
    } finally {
      salvando = false;
      botaoSalvar.disabled = false;
    }
  };

  // Editar um lançamento que já é parcela de uma compra parcelada não deixa
  // mexer nas OUTRAS parcelas (o checkbox de parcelamento nem aparece em
  // edição, de propósito — ver comentário acima) — mas sem nenhuma pista na
  // tela, editar "parcela 3 de 6" parecia um lançamento avulso qualquer,
  // escondendo que existem outras 5 parcelas ligadas à mesma compra.
  const indicadorParcela = emEdicao && emEdicao.parcela_atual
    ? el('p', { class: 'ajuda', text: `Parcela ${emEdicao.parcela_atual} de ${emEdicao.parcela_total} — as demais parcelas não são afetadas por esta edição.` })
    : null;

  return el('form', { class: 'form-lancamento', onsubmit: (ev) => { ev.preventDefault(); salvar(); } }, [
    indicadorParcela,
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
