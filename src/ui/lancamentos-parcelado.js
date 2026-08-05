// Compra parcelada lançada manualmente (não veio de fatura importada). Só a
// parcela 1 vira lançamento REAL agora; 2..N viram previsto+origemManual —
// mesmo tratamento das parcelas que vêm de fatura, pra não competir por
// casamento de valor na conciliação com a parcela real do mês em curso, e
// pra a conciliação automática (por parcelaKey) já reconhecê-las quando a
// fatura de cada mês futuro chegar (ver domain/parcelas.js).

import { uid } from '../core/ids.js';
import { computeParcelaKey, splitParcelas, addMonthsISO, findParcelaDuplicates } from '../domain/parcelas.js';
import { el, abrirModal } from './components.js';
import { formatDateBR } from '../core/dates.js';
import { fmtBRL } from '../core/money.js';

// Pura: o texto de prévia mostrado abaixo dos campos "Valor total"/"Nº de
// parcelas" — mesma mensagem do app anterior. `null` quando os dados ainda
// não são suficientes pra calcular (campo vazio, número < 2), pra quem
// chama decidir esconder o preview em vez de mostrar um texto quebrado.
export function textoPreviewParcela(valorTotal, numParcelas) {
  if (valorTotal === null || valorTotal === undefined || !Number.isFinite(valorTotal)) return null;
  if (!numParcelas || numParcelas < 2) return null;
  const vals = splitParcelas(valorTotal, numParcelas);
  return `${numParcelas}x de ${fmtBRL(vals[0])} (total ${fmtBRL(valorTotal)}) — um lançamento por mês a partir da data escolhida.`;
}

export function montarLancamentosParcelados(dados) {
  const { descricao, data, valorTotal, numParcelas, categoria, formaPagamentoId, contaId } = dados;
  const vals = splitParcelas(valorTotal, numParcelas);
  const parcelaKey = computeParcelaKey(descricao, data, numParcelas);
  const grupoId = uid('grp');
  const lista = [];
  for (let i = 0; i < numParcelas; i++) {
    lista.push({
      id: uid('tx'),
      descricao: i === 0 ? descricao : `${descricao} (parcela prevista)`,
      valor: vals[i],
      data: addMonthsISO(data, i),
      categoria, natureza: 'despesa', origem: 'manual', formaPagamentoId, contaId,
      grupo_parcela: grupoId, parcelaKey, parcela_atual: i + 1, parcela_total: numParcelas,
      ...(i === 0 ? {} : { previsto: true, origemManual: true }),
    });
  }
  return lista;
}

// Modal com três saídas — não window.confirm, que só tem OK/Cancelar:
// apagar os lançamentos antigos e criar os novos no lugar; criar os novos
// mantendo os antigos (o usuário decide depois, caso o aviso seja falso
// positivo); ou desistir de lançar. Duplicatas com `origemRef` (vinculadas a
// uma linha de fatura/extrato já importada — spec 11, pendência do app
// anterior) aparecem PRIMEIRO e marcadas: são confirmadas por documento, não
// só pela heurística de descrição/valor/data parecidos.
async function confirmarDuplicidade(duplicatas) {
  const ordenadas = [...duplicatas].sort((a, b) => (b.origemRef ? 1 : 0) - (a.origemRef ? 1 : 0));
  return abrirModal({
    titulo: 'Compra parecida já lançada',
    corpo: el('div', {}, [
      el('p', { text: 'Encontrei lançamento(s) parecido(s) com esta compra parcelada:' }),
      el('ul', {}, ordenadas.map((d) =>
        el('li', { text: `${d.origemRef ? '[confirmado por documento] ' : ''}${formatDateBR(d.data)} — ${d.descricao} — ${fmtBRL(d.valor)}` })
      )),
    ]),
    acoes: [
      { id: 'cancelar', rotulo: 'Cancelar' },
      { id: 'manter', rotulo: 'Manter os dois' },
      { id: 'apagar', rotulo: 'Apagar os antigos e lançar', classe: 'btn-perigo' },
    ],
  });
}

// Monta o checkbox "Compra parcelada" e os dois campos que ele revela (valor
// total, número de parcelas). `ctx.onRemoverTransacoes(ids)` é chamado
// quando o usuário escolhe "apagar os antigos" — quem chama (lancamentos.js)
// decide como remover (await removeTransaction por id) e re-renderizar.
export function campoParceladoEModal(ctx) {
  const chkParcelado = el('input', { type: 'checkbox' });
  const inpValorTotal = el('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00' });
  const inpNumParcelas = el('input', { type: 'text', inputmode: 'numeric', placeholder: '2' });
  const previewParcela = el('div', { class: 'preview-parcela', style: 'display:none' });
  const painelExtra = el('div', { class: 'painel-parcelado', style: 'display:none' }, [
    el('div', { class: 'linha-form' }, [ctx.campo('Valor total', inpValorTotal), ctx.campo('Nº de parcelas', inpNumParcelas)]),
    previewParcela,
  ]);
  chkParcelado.addEventListener('change', () => {
    painelExtra.style.display = chkParcelado.checked ? '' : 'none';
  });

  const atualizarPreview = () => {
    const valorTotal = ctx.parseMoneyBR(inpValorTotal.value);
    const numParcelas = parseInt(inpNumParcelas.value, 10);
    const texto = textoPreviewParcela(valorTotal, numParcelas);
    previewParcela.textContent = texto || '';
    previewParcela.style.display = texto ? '' : 'none';
  };
  inpValorTotal.addEventListener('input', atualizarPreview);
  inpNumParcelas.addEventListener('input', atualizarPreview);

  async function confirmarEObterLancamentos(transactions, allFaturaRows, base) {
    const valorTotal = ctx.parseMoneyBR(inpValorTotal.value);
    const numParcelas = parseInt(inpNumParcelas.value, 10);
    if (valorTotal === null) return { erro: 'Valor total inválido. Use vírgula para os centavos.' };
    if (!numParcelas || numParcelas < 2) return { erro: 'Número de parcelas precisa ser 2 ou mais.' };

    const duplicatas = findParcelaDuplicates(transactions, allFaturaRows, base.descricao, base.data, numParcelas, valorTotal / numParcelas);
    if (duplicatas.length) {
      const escolha = await confirmarDuplicidade(duplicatas);
      if (escolha === 'cancelar' || escolha === null) return { erro: null, cancelado: true };
      if (escolha === 'apagar') await ctx.onRemoverTransacoes(duplicatas.map((d) => d.id));
    }

    return { lista: montarLancamentosParcelados({ ...base, valorTotal, numParcelas }) };
  }

  return { checkbox: chkParcelado, painelExtra, confirmarEObterLancamentos };
}
