// Primeira execução: assistente de cadastro da conta e do cartão do usuário.
//
// Os dados de conta do usuário não podem vir no código porque o repositório
// é público — por isso este assistente existe em vez de um seed.
//
// Este módulo não migra dados do app anterior: por decisão do usuário
// (2026-07-31), a Fase 1 não traz lançamentos/faturas do app anterior via
// leitura do IndexedDB dele — backup/restore do app novo (Task 10, ver
// importers/backup-xlsx.js) cobre a necessidade real de continuidade.

import { el, toast, abrirModal } from './components.js';
import { campo, mostrarErros } from './cadastros-comuns.js';
import { listAccounts, saveAccount, novaConta, novoCartao, validateAccount } from '../domain/accounts.js';
import { irParaAba } from './tabs.js';
import * as storage from '../core/storage.js';

export async function talvezOferecerOnboarding() {
  if (await storage.getMeta('onboardingConcluido', false)) return;
  const contas = await listAccounts();
  if (contas.length) {
    await storage.setMeta('onboardingConcluido', true);
    return;
  }

  const escolha = await abrirModal({
    titulo: 'Bem-vindo ao Livro de Gastos',
    corpo: el('div', {}, [
      el('p', { text: 'Para começar, cadastre a conta e o cartão que você usa. Seus dados ficam só neste aparelho.' }),
      el('p', { class: 'ajuda', text: 'Se você usava o app anterior, exporte um backup lá e importe em Cadastros.' }),
    ]),
    acoes: [
      { id: 'depois', rotulo: 'Depois' },
      { id: 'cadastrar', rotulo: 'Cadastrar agora', classe: 'btn-primario' },
    ],
  });

  if (escolha === 'cadastrar') return assistenteCadastro();
}

/** Devolve `true` se salvou, `false` se o usuário desistiu. */
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
      mostrarErros(erros);
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
