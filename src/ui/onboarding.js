// Primeira execução: cadastro inicial e migração do app anterior.
//
// Os dados de conta do usuário não podem vir no código porque o repositório é
// público — por isso este assistente existe em vez de um seed.
//
// Este módulo NUNCA abre indexedDB por conta própria: a leitura do banco
// anterior passa inteira por importers/legacy-idb.js, que é a única exceção à
// regra de que só core/storage.js toca IndexedDB do app novo — e mesmo essa
// exceção só lê o banco antigo, nunca escreve nele.

import { el, toast, abrirModal } from './components.js';
import { campo } from './cadastros-comuns.js';
import { legacyDatabaseExists, importLegacyInto } from '../importers/legacy-idb.js';
import { TIPO_CARTAO, listAccounts, saveAccount, novaConta, novoCartao, validateAccount } from '../domain/accounts.js';
import { listFormas } from '../domain/payment-methods.js';
import { irParaAba } from './tabs.js';
import * as storage from '../core/storage.js';

export async function talvezOferecerOnboarding() {
  if (await storage.getMeta('onboardingConcluido', false)) return;
  const contas = await listAccounts();
  if (contas.length) {
    await storage.setMeta('onboardingConcluido', true);
    return;
  }

  const temLegado = await legacyDatabaseExists();
  const escolha = await abrirModal({
    titulo: 'Bem-vindo ao Livro de Gastos',
    corpo: el('div', {}, [
      el('p', { text: 'Para começar, cadastre a conta e o cartão que você usa. Seus dados ficam só neste aparelho.' }),
      temLegado
        ? el('p', { text: 'Encontrei os dados do app de cartão de crédito neste navegador. Posso trazer tudo para cá — lançamentos, categorias e faturas importadas — sem alterar o app antigo.' })
        : el('p', { class: 'ajuda', text: 'Se você usava o app anterior em outro aparelho, exporte um backup lá e importe em Cadastros.' }),
    ]),
    acoes: [
      { id: 'depois', rotulo: 'Depois' },
      ...(temLegado ? [{ id: 'migrar', rotulo: 'Trazer dados do app anterior' }] : []),
      { id: 'cadastrar', rotulo: 'Cadastrar agora', classe: 'btn-primario' },
    ],
  });

  if (escolha === 'migrar') return migrarDoAppAnterior();
  if (escolha === 'cadastrar') return assistenteCadastro();
}

/**
 * Devolve `true` se salvou (para quem encadeia, como migrarDoAppAnterior
 * retomando a migração depois do cadastro), `false` se o usuário desistiu.
 */
async function assistenteCadastro() {
  // Os inputs são criados uma única vez, fora do laço de novas tentativas:
  // um erro de validação (ex.: final de cartão com 2 dígitos) reabre o modal
  // reaproveitando os MESMOS nós, e não reconstruindo tudo do zero — sem
  // isso, o usuário via os sete campos voltarem vazios depois de um erro,
  // exatamente o tipo de atrito que a primeira tela do app não pode ter.
  const inpBanco = el('input', { type: 'text', placeholder: 'Ex.: Banco X' });
  const inpAgencia = el('input', { type: 'text', placeholder: '0000' });
  const inpNumero = el('input', { type: 'text', placeholder: '00000-0' });
  const inpCartaoNome = el('input', { type: 'text', placeholder: 'Ex.: Cartão principal' });
  const inpBandeira = el('input', { type: 'text', placeholder: 'visa / master' });
  const inpFinal = el('input', { type: 'text', inputmode: 'numeric', placeholder: '0000' });
  // Como o próprio usuário aparece nomeado no extrato dele quando transfere
  // entre contas próprias, e a grafia varia conforme o banco emissor. A Fase 2
  // usa isto para classificar essas linhas como transferência, e não gasto.
  const inpApelidos = el('input', { type: 'text', placeholder: 'Ex.: JOAO DA SILVA, JOAO SILVA' });

  for (;;) {
    const escolha = await abrirModal({
      titulo: 'Sua conta e seu cartão',
      corpo: el('div', { class: 'form' }, [
        el('h3', { text: 'Conta corrente' }),
        campo('Banco', inpBanco), campo('Agência', inpAgencia), campo('Número', inpNumero),
        el('h3', { text: 'Cartão de crédito' }),
        campo('Nome', inpCartaoNome), campo('Bandeira', inpBandeira), campo('Final (4 dígitos)', inpFinal),
        el('h3', { text: 'Seu nome no extrato' }),
        campo('Como você aparece (separe variações por vírgula)', inpApelidos),
        el('p', { class: 'ajuda', text: 'Quando você transfere dinheiro entre contas suas, seu nome aparece no extrato. Isso serve para o app não contar essas transferências como gasto.' }),
        el('p', { class: 'ajuda', text: 'Você pode cadastrar mais contas, cartões e adicionais depois, na aba Cadastros.' }),
      ]),
      acoes: [{ id: 'cancelar', rotulo: 'Depois' }, { id: 'salvar', rotulo: 'Salvar', classe: 'btn-primario' }],
    });
    if (escolha !== 'salvar') return false;

    const conta = novaConta({
      nome: `${inpBanco.value.trim()} — conta corrente`,
      instituicao: inpBanco.value.trim(),
      agencia: inpAgencia.value.trim(),
      numero: inpNumero.value.trim(),
    });
    const cartao = novoCartao({
      nome: inpCartaoNome.value.trim(),
      instituicao: inpBanco.value.trim(),
      bandeira: inpBandeira.value.trim().toLowerCase(),
      final: inpFinal.value.trim(),
      contaPagadoraId: conta.id,
    });

    const erros = [...validateAccount(conta, []), ...validateAccount(cartao, [conta])];
    if (erros.length) {
      toast(erros.join(' '), 'erro');
      continue; // reabre o modal com os mesmos inputs, valores preservados
    }

    await saveAccount(conta);
    await saveAccount(cartao);
    await storage.setMeta(
      'apelidosTitular',
      inpApelidos.value.split(',').map((s) => s.trim()).filter(Boolean)
    );
    await storage.setMeta('onboardingConcluido', true);
    toast('Cadastro criado. Bom uso!', 'ok');
    irParaAba('Cadastros');
    return true;
  }
}

export async function migrarDoAppAnterior() {
  const contas = await listAccounts();
  // Cartão desativado não pode ser oferecido como destino de dados novos —
  // mesma regra que os seletores de Lançamentos (Task 13) já aplicam.
  const cartoes = contas.filter((a) => a.tipo === TIPO_CARTAO && a.ativo !== false);
  if (!cartoes.length) {
    await abrirModal({
      titulo: 'Cadastre o cartão primeiro',
      corpo: 'Os lançamentos do app anterior são todos de cartão de crédito, então preciso saber a qual cartão associá-los. Cadastre o cartão e eu trago os dados em seguida.',
    });
    // Antes, esta função sempre encadeava para o cadastro e nunca retomava a
    // migração — o botão "Trazer dados do app anterior" do modal de
    // boas-vindas não migrava nada e o usuário nem ficava sabendo, porque
    // assistenteCadastro() marca onboardingConcluido e o convite não
    // reaparece. Agora só seguimos adiante se o cadastro foi salvo, e aí
    // retomamos a MESMA função — que desta vez encontra o cartão recém
    // criado e continua para a escolha de migração de verdade.
    const cadastrou = await assistenteCadastro();
    if (!cadastrou) return;
    return migrarDoAppAnterior();
  }

  // A forma de crédito não pode ser cravada em 'pm_credito': o usuário pode
  // ter renomeado, desativado ou excluído a forma padrão em Cadastros antes
  // de migrar, e gravar um formaPagamentoId que não existe mais deixaria
  // todo lançamento migrado com uma forma de pagamento invisível na UI.
  const formas = await listFormas();
  const formaCredito = formas.find((f) => f.tipo === 'credito' && f.ativo !== false);
  if (!formaCredito) {
    toast(
      'Cadastre uma forma de pagamento do tipo "Crédito" antes de migrar (Cadastros → Formas de pagamento).',
      'erro'
    );
    return;
  }

  const selCartao = el('select', {}, cartoes.map((c) => el('option', { value: c.id, text: c.nome })));
  const escolha = await abrirModal({
    titulo: 'Trazer dados do app anterior',
    corpo: el('div', { class: 'form' }, [
      el('p', { text: 'Todos os lançamentos, categorias e faturas do app anterior serão copiados. O app antigo não é alterado e continua funcionando.' }),
      campo('Associar os lançamentos a qual cartão?', selCartao),
    ]),
    acoes: [{ id: 'cancelar', rotulo: 'Cancelar' }, { id: 'migrar', rotulo: 'Trazer dados', classe: 'btn-primario' }],
  });
  if (escolha !== 'migrar') return;

  try {
    // Idempotente por construção: importLegacyInto preserva os ids do app
    // anterior literalmente, e a gravação por put() (numa única transação
    // atômica, ver storage.putManyAcrossStores) sobrescreve os mesmos
    // registros em vez de duplicá-los (spec 5.7).
    const { transactions, statements, avisos } = await importLegacyInto({
      cartaoTitularId: selCartao.value,
      formaCreditoId: formaCredito.id,
    });
    await storage.setMeta('onboardingConcluido', true);
    await abrirModal({
      titulo: 'Pronto',
      corpo: el('div', {}, [
        el('p', { text: `${transactions.length} lançamento(s) e ${statements.length} fatura(s) foram trazidos.` }),
        ...avisos.map((a) => el('p', { class: 'ajuda', text: a })),
      ]),
    });
    irParaAba('Lancamentos');
  } catch (e) {
    // A mensagem já distingue leitura de escrita (ver importLegacyInto):
    // não precisamos mais adivinhar aqui qual das duas falhou.
    toast(e.message, 'erro');
  }
}
