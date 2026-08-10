# Conta padrão de forma de pagamento passa a considerar cartão de crédito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O campo "Conta padrão" no cadastro de formas de pagamento passa a oferecer cartões (titulares e adicionais) quando o tipo da forma é `credito`, em vez de sempre mostrar só contas bancárias — e reage à troca de tipo dentro do mesmo formulário, sem precisar fechar e reabrir o modal.

**Architecture:** `src/ui/cadastros-formas.js` passa a buscar todas as contas (sem filtro), reusa `tipoContaParaForma` (já existente em `lancamentos-form-helpers.js`) para decidir o tipo esperado a partir do `selTipo` atual, e reconstrói as `<option>` do combo de conta padrão a cada troca de tipo.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Comentários e identificadores de negócio em português; termo técnico consagrado em inglês. Commits em português, imperativo, sem emoji.
- Reusa `tipoContaParaForma` (já existente, exportada de `src/ui/lancamentos-form-helpers.js`) — não duplicar essa lógica em `cadastros-formas.js`.
- Nenhuma mudança em `contaPadraoValidaParaForma`/`contasParaForma` (`lancamentos-form-helpers.js`) — já corretas, só a tela de edição precisa mudar.
- Cartões adicionais entram na lista de opções junto com titulares (decisão já validada com o usuário) — sem filtro extra por `cartaoPaiId`.

---

### Task 1: Combo de conta padrão reage ao tipo da forma

**Files:**
- Modify: `src/ui/cadastros-formas.js` (função `editarForma`)

**Interfaces:**
- Consumes: `tipoContaParaForma(tipoForma)` de `./lancamentos-form-helpers.js` (já existe, assinatura: recebe string do tipo da forma, devolve `TIPO_CARTAO`/`TIPO_CONTA`/`null`).
- Produces: nenhuma interface nova — só comportamento de UI.

- [ ] **Step 1: Ler o estado atual completo de `editarForma`**

Leia `src/ui/cadastros-formas.js` inteiro antes de editar (já é curto, ~85 linhas) — confirme os nomes exatos de variáveis (`selTipo`, `selContaPadrao`, `contas`) e a ordem de montagem do formulário antes do próximo step.

- [ ] **Step 2: Importar `tipoContaParaForma` e `TIPO_CARTAO`**

No topo de `src/ui/cadastros-formas.js`, ajuste os imports:

```js
import { TIPO_CONTA, TIPO_CARTAO, listAccounts } from '../domain/accounts.js';
import { tipoContaParaForma } from './lancamentos-form-helpers.js';
```

(`TIPO_CONTA` continua necessário só se algum outro trecho do arquivo o usar diretamente — confira antes de decidir manter ou remover; `TIPO_CARTAO` não é necessário como import direto se `tipoContaParaForma` já devolve o valor certo, então pode ser dispensado — use isso só se precisar comparar tipos explicitamente em algum outro ponto do arquivo).

- [ ] **Step 3: Buscar todas as contas (sem filtro) e criar uma função de reconstrução do combo**

Substitua o bloco atual (que filtra por `TIPO_CONTA` uma única vez):

```js
  const contas = opcoesAtivas(
    (await listAccounts()).filter((a) => a.tipo === TIPO_CONTA),
    pm.contaPadraoId
  );
  const selContaPadrao = el('select', {}, [
    el('option', { value: '', text: '— nenhuma —' }),
    ...contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === pm.contaPadraoId ? { selected: 'selected' } : {}) })),
  ]);
```

por:

```js
  const todasContas = await listAccounts();
  const selContaPadrao = el('select', {});

  // Reconstroi as opcoes do combo de conta padrao a cada troca de tipo —
  // sem isso, o formulario mostrava sempre conta bancaria como opcao,
  // mesmo pra forma do tipo credito (que precisa de CARTAO como conta
  // padrao). Preserva a selecao atual quando ela ainda for valida pro
  // novo tipo; descarta quando nao for (mesma regra que
  // contaPadraoValidaParaForma ja aplica na leitura, em
  // lancamentos-form-helpers.js).
  function atualizarOpcoesContaPadrao(manterSelecionado) {
    const tipoEsperado = tipoContaParaForma(selTipo.value);
    const contasDoTipo = tipoEsperado === null ? [] : todasContas.filter((c) => c.tipo === tipoEsperado);
    const idAtual = manterSelecionado ? selContaPadrao.value : pm.contaPadraoId;
    const contas = opcoesAtivas(contasDoTipo, idAtual);
    const aindaValida = contas.some((c) => c.id === idAtual);
    selContaPadrao.innerHTML = '';
    selContaPadrao.append(
      el('option', { value: '', text: '— nenhuma —' }),
      ...contas.map((c) => el('option', { value: c.id, text: rotuloComStatus(c), ...(c.id === idAtual && aindaValida ? { selected: 'selected' } : {}) }))
    );
  }
  atualizarOpcoesContaPadrao(false);
  selTipo.addEventListener('change', () => atualizarOpcoesContaPadrao(true));
```

- [ ] **Step 4: Confirmar que `selTipo` já existe ANTES deste bloco**

`selTipo` precisa estar declarado antes de `atualizarOpcoesContaPadrao` (que o referencia) e antes do `addEventListener`. No arquivo atual, `selTipo` já é declarado logo no início de `editarForma` — confirme que a ordem das declarações continua com `selTipo` antes deste novo bloco; se não estiver, mova o bloco novo para depois da declaração de `selTipo`.

- [ ] **Step 5: Rodar a suíte de testes**

Run: `node tools/run-tests.mjs`
Expected: código 0, nenhuma falha (não há teste Node dedicado a `cadastros-formas.js` — é DOM-wiring puro, mesma situação de outros arquivos `cadastros-*.js` do projeto — mas a suíte inteira não pode quebrar).

- [ ] **Step 6: Verificar visualmente no navegador**

Sirva a pasta localmente (`python -m http.server <porta>`), seed via console de pelo menos 1 conta bancária e 1 cartão (titular) + 1 forma de pagamento do tipo `credito`. Abra Cadastros → Formas de pagamento, edite a forma de crédito, confirme que o combo "Conta padrão" mostra o cartão (não a conta bancária). Troque o tipo pra `pix` no mesmo formulário aberto (sem fechar o modal) e confirme que o combo passa a mostrar a conta bancária. Troque pra `dinheiro` e confirme que o combo fica só com "— nenhuma —".

- [ ] **Step 7: Commit**

```bash
git add src/ui/cadastros-formas.js
git commit -m "corrige combo de conta padrao para oferecer cartao em formas do tipo credito"
```

---

## Verificação de fim de fase (self-review do plano)

- [x] Cobertura do spec: Task 1 cobre as seções 3.1 e 3.2 do spec (filtro pelo tipo certo + reação à troca de tipo ao vivo). Nenhuma seção ficou sem task.
- [x] Sem placeholders: código completo no step de implementação.
- [x] Consistência de tipos/nomes: `tipoContaParaForma` importado com o mesmo nome de `lancamentos-form-helpers.js`; nenhuma duplicação de lógica de mapeamento tipo-forma → tipo-conta.
