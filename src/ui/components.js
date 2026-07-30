// Blocos de UI reutilizáveis. Nenhuma regra de negócio mora aqui.

export function el(tag, attrs, filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const filho of [].concat(filhos || [])) {
    // Comparacao explicita em vez de truthy: um filho 0 e legitimo e frequente
    // num app de dinheiro ("R$ 0,00", "0 lancamentos"), e o teste de truthy o
    // descartava calado. false continua sendo filtrado de proposito, porque e
    // o resultado do padrao `condicao && el(...)`.
    if (filho === null || filho === undefined || filho === false) continue;
    node.appendChild(typeof filho === 'object' ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

export function toast(msg, tipo) {
  const raiz = document.getElementById('toastRaiz');
  const node = el('div', { class: `toast ${tipo || 'info'}`, text: msg });
  raiz.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

/**
 * Modal com ações nomeadas. Devolve o id da ação escolhida, ou null se o
 * usuário fechou sem escolher. Existe em vez de window.confirm porque vários
 * fluxos precisam de mais de duas saídas.
 */
export function abrirModal({ titulo, corpo, acoes }) {
  return new Promise((resolve) => {
    const raiz = document.getElementById('modalRaiz');
    const fechar = (valor) => { raiz.innerHTML = ''; document.removeEventListener('keydown', aoTeclar); resolve(valor); };
    const aoTeclar = (ev) => {
      if (ev.key === 'Escape') { fechar(null); return; }
      if (ev.key !== 'Tab') return;
      // Prende o foco dentro do modal: sem isso, Tab levava para o conteudo de
      // fundo enquanto o modal ainda bloqueava a tela, e numa confirmacao
      // destrutiva o usuario podia acionar algo atras dele.
      const focaveis = raiz.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (ev.shiftKey && document.activeElement === primeiro) {
        ev.preventDefault();
        ultimo.focus();
      } else if (!ev.shiftKey && document.activeElement === ultimo) {
        ev.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', aoTeclar);

    const botoes = (acoes || [{ id: 'ok', rotulo: 'OK' }]).map((a) =>
      el('button', { class: `btn ${a.classe || ''}`, text: a.rotulo, onclick: () => fechar(a.id) })
    );

    raiz.appendChild(
      el('div', { class: 'overlay', onclick: (ev) => { if (ev.target.classList.contains('overlay')) fechar(null); } }, [
        el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { text: titulo }),
          typeof corpo === 'string' ? el('p', { text: corpo }) : corpo,
          el('div', { class: 'modal-acoes' }, botoes),
        ]),
      ])
    );
    botoes[botoes.length - 1].focus();
  });
}

export async function confirmar(msg) {
  const r = await abrirModal({
    titulo: 'Confirmar',
    corpo: msg,
    acoes: [
      { id: 'cancelar', rotulo: 'Cancelar' },
      { id: 'ok', rotulo: 'Confirmar', classe: 'btn-perigo' },
    ],
  });
  return r === 'ok';
}
