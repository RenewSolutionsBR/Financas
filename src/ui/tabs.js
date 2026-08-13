// O callback de renderização fica no módulo, não é passado a cada chamada:
// outras telas navegam por irParaAba(nome) e precisam que a aba de destino
// seja renderizada, não apenas exibida vazia.
let aoTrocar = null;

export function initTabs(onTrocar) {
  aoTrocar = onTrocar;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => irParaAba(btn.dataset.tab));
  });
}

// Nome da aba visível agora. O menu Ferramentas usa isto para re-renderizar
// a tela de fundo depois de uma ação que muda dados (importar backup,
// apagar tudo) — o menu é global, então ele não sabe de qual aba foi aberto.
export function abaAtiva() {
  const botao = document.querySelector('.tab-btn.active');
  return botao ? botao.dataset.tab : null;
}

export function irParaAba(nome) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const ativo = b.dataset.tab === nome;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', String(ativo));
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'tab' + nome);
  });
  if (aoTrocar) aoTrocar(nome);
}
