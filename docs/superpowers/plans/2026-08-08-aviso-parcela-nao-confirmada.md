# Aviso na aba Parcelas para grupo sem parcela 1 confirmada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar um aviso na aba Parcelas quando as datas projetadas de um grupo de parcelamento são estimativas (nenhuma transação confirmada existe ainda para aquela compra — só previsões), sem mudar a lógica proposital de que a parcela 1/n exige confirmação manual ("+ lançar") antes de virar lançamento real.

**Architecture:** `parcelaGroupsDaConta` (`src/domain/parcelas.js`) passa a expor um campo booleano `ancoraNaoConfirmada` em cada grupo retornado, indicando que a âncora escolhida é uma previsão (`previsto: true`), não uma transação confirmada. A aba Parcelas (`src/ui/parcelas.js`) renderiza um aviso curto no grupo quando esse campo for `true`.

**Tech Stack:** Vanilla JS ES modules, zero build step, zero dependências em runtime.

## Global Constraints

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Datas ISO internamente (`AAAA-MM-DD`), `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Comentários e identificadores de negócio em português; termo técnico consagrado em inglês. UI em português.
- Commits em português, imperativo, sem emoji. Texto de UI pode usar símbolo de aviso se fizer sentido visualmente — não é a mesma regra de commits.
- Sem migração retroativa.
- A trava "parcela 1 exige confirmação manual" em `autoConfirmParcelas` (`src/domain/parcelas.js:259`) NÃO muda nesta fase — é comportamento intencional, decisão já confirmada com o usuário nesta sessão.
- Nenhuma mudança em `syncPredictions`, `autoConfirmParcelas`, `computeParcelaGroups` — só `parcelaGroupsDaConta` ganha o campo novo, e só na função em si, sem alterar sua lógica de cálculo de meses.

---

### Task 1: Expor `ancoraNaoConfirmada` em `parcelaGroupsDaConta`

**Files:**
- Modify: `src/domain/parcelas.js:165-208` (função `parcelaGroupsDaConta`)
- Test: `tests/parcelas.test.js`

**Interfaces:**
- Consumes: nada novo — usa `t.previsto` da âncora já selecionada por `melhorAncoraDeParcela`.
- Produces: cada objeto de grupo retornado por `parcelaGroupsDaConta` ganha o campo `ancoraNaoConfirmada: boolean`.

- [ ] **Step 1: Escrever os testes (devem falhar primeiro)**

Em `tests/parcelas.test.js`, adicione dois testes novos no describe `'parcelas: parcelaGroupsDaConta'` (confira o nome exato do describe existente lendo o arquivo — não crie um describe novo se um equivalente já existir):

```js
  it('grupo cuja ancora e uma PREVISAO (nenhuma transacao confirmada pra essa parcelaKey) marca ancoraNaoConfirmada: true', () => {
    const key = computeParcelaKey('LOJA SO PREVISAO ANCORA', '2026-08-01', 5);
    const previsao = {
      id: 'seed_ancora_1', previsto: true, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA SO PREVISAO ANCORA (parcela prevista)', data: '2026-09-01',
      parcela_atual: 2, parcela_total: 5, valor: 40,
    };
    const grupos = parcelaGroupsDaConta([previsao], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].ancoraNaoConfirmada, true, 'ancora prevista significa data estimada, precisa avisar o usuario');
  });

  it('grupo cuja ancora e uma transacao CONFIRMADA marca ancoraNaoConfirmada: false', () => {
    const key = computeParcelaKey('LOJA CONFIRMADA ANCORA', '2026-01-01', 4);
    const confirmada = {
      id: 'confirmed_ancora_1', previsto: false, parcelaKey: key, contaId: CONTA,
      descricao: 'LOJA CONFIRMADA ANCORA', data: '2026-01-25',
      faturaVencimento: '2026-01-30', parcela_atual: 2, parcela_total: 4, valor: 100,
    };
    const grupos = parcelaGroupsDaConta([confirmada], CONTA);
    assertEqual(grupos.length, 1);
    assertEqual(grupos[0].ancoraNaoConfirmada, false, 'ancora confirmada significa vencimento real, nao precisa avisar');
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `node tools/run-tests.mjs`
Expected: os dois testes novos falham (`ancoraNaoConfirmada` é `undefined`, não `true`/`false`).

- [ ] **Step 3: Implementar o campo**

Em `src/domain/parcelas.js`, dentro do loop `for (const t of porKey.values())` de `parcelaGroupsDaConta`, capture o booleano e propague no objeto retornado por `computeParcelaGroups` (que precisa ser espalhado, já que `computeParcelaGroups` não conhece esse conceito — ele não deve mudar). Adicione logo após a chamada existente:

```js
    const primeiraNoMesmoMes = !!t.previsto;
    const gruposDoRow = computeParcelaGroups([row], { primeiraNoMesmoMes });
    // Ancora e uma previsao (t.previsto truthy) -> nenhuma transacao
    // confirmada existe ainda pra essa parcelaKey -> o mes mostrado e uma
    // ESTIMATIVA (mes sintetico gerado por syncPredictions a partir do
    // vencimento da fatura que confirmou a parcela ANTERIOR, nao um
    // vencimento real desta parcela) ate o usuario confirmar a parcela 1
    // (fatura auto-confirma so parcela_atual > 1 — ver autoConfirmParcelas).
    grupos.push(...gruposDoRow.map((g) => ({ ...g, ancoraNaoConfirmada: !!t.previsto })));
```

Substituindo a linha existente `grupos.push(...computeParcelaGroups([row], { primeiraNoMesmoMes }));`.

- [ ] **Step 4: Rodar os testes de novo**

Run: `node tools/run-tests.mjs`
Expected: PASS, incluindo os dois testes novos e todos os testes pré-existentes do arquivo (nenhum assert antigo muda de valor — o campo é aditivo).

- [ ] **Step 5: Commit**

```bash
git add src/domain/parcelas.js tests/parcelas.test.js
git commit -m "expoe ancoraNaoConfirmada nos grupos de parcelaGroupsDaConta"
```

---

### Task 2: Mostrar o aviso na aba Parcelas

**Files:**
- Modify: `src/ui/parcelas.js:43-56`
- Modify: `styles.css` (novo seletor, perto do bloco `.grupo-parcela` existente, por volta da linha 603-623)

**Interfaces:**
- Consumes: `g.ancoraNaoConfirmada` (produzido pela Task 1).
- Produces: nenhuma interface nova — só renderização condicional.

- [ ] **Step 1: Adicionar o aviso condicional**

Em `src/ui/parcelas.js`, dentro do `.map((g) => el('div', { class: 'grupo-parcela' }, [...]))`, adicione um elemento condicional (usando o padrão já existente no projeto de `condicao ? el(...) : null` — `el()` já ignora filhos `null`):

```js
      ...porCartao.get(c.id).map((g) => el('div', { class: 'grupo-parcela' }, [
        el('div', { class: 'grupo-parcela-titulo', text: `${g.descricao} — ${fmtBRL(g.valor)}/mês` }),
        el('div', { class: 'grupo-parcela-meta', text: `parcela ${g.parcelaAtual} de ${g.parcelaTotal} · faltam ${g.remaining}` }),
        g.ancoraNaoConfirmada
          ? el('p', { class: 'grupo-parcela-aviso', text: 'Datas estimadas — confirme a parcela 1 na Conciliação de fatura ("+ lançar") para usar o vencimento real.' })
          : null,
        el('ul', {}, g.months.map((m) => el('li', { text: `${formatMesAno(m.ym)} — ${fmtBRL(m.valor)}` }))),
      ])),
```

- [ ] **Step 2: Adicionar o estilo**

Em `styles.css`, logo após o bloco `.grupo-parcela ul { ... }` existente (por volta da linha 618-623):

```css
.grupo-parcela-aviso {
  margin: 6px 0 0;
  padding: 4px 8px;
  font-size: 0.76rem;
  color: var(--latao);
  background: color-mix(in srgb, var(--latao) 12%, transparent);
  border-radius: 4px;
}
```

Confira antes se `--latao` é a variável de cor de "aviso/atenção" já usada no projeto (usada em `.selo-categoria-sugerida`, ver `styles.css`); se o projeto usar outro token para avisos amarelos/atenção, use esse token em vez de `--latao` — não invente uma cor nova sem checar as variáveis existentes em `:root`.

- [ ] **Step 3: Verificar visualmente no navegador**

Sirva a pasta localmente (`python -m http.server <porta>`), seed via console/Playwright de uma compra parcelada só com previsões (sem transação confirmada) numa conta de cartão, abra a aba Parcelas, confirme que o aviso aparece só nesse grupo — grupos com âncora confirmada (outros testes/dados) não devem mostrar nada a mais do que já mostravam.

- [ ] **Step 4: Rodar a suíte completa**

Run: `node tools/run-tests.mjs`
Expected: código 0, nenhuma falha (esta task não tem teste Node novo — é só DOM/CSS — mas a suíte não pode quebrar).

- [ ] **Step 5: Commit**

```bash
git add src/ui/parcelas.js styles.css
git commit -m "mostra aviso na aba Parcelas quando a data e uma estimativa nao confirmada"
```

---

## Verificação de fim de fase (self-review do plano)

- [x] Cobertura do spec: Task 1 cobre a seção 3 (campo novo em `parcelaGroupsDaConta`); Task 2 cobre a seção 3 (aviso na UI). Nenhuma seção do spec ficou sem task.
- [x] Sem placeholders: código completo em todos os steps, exceto a checagem manual do token de cor `--latao` (Step 2 da Task 2), que é uma verificação explícita contra o código real, não um placeholder — o implementador deve olhar `:root` em `styles.css` antes de escrever a regra final.
- [x] Consistência de tipos/nomes: `ancoraNaoConfirmada` usado com o mesmo nome em `parcelas.js` (produção) e `parcelas.test.js` (consumo nos asserts) e em `ui/parcelas.js` (consumo na renderização).
