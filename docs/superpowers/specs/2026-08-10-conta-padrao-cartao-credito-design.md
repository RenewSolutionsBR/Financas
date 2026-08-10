# Conta padrão de forma de pagamento não considera cartão de crédito (design)

## 1. Contexto

Usuário reportou: no cadastro de formas de pagamento, o campo "Conta
padrão" funciona certo para Pix, débito, débito automático (mostra
contas bancárias, preenche sozinho no lançamento) — mas para **crédito**
mostra só a opção de conta bancária, nunca cartões, então o
preenchimento automático nunca funciona pra esse tipo de forma.

O próprio código já sinalizava essa limitação como conhecida (comentário
em `src/ui/lancamentos-form-helpers.js:47-53`, função
`contaPadraoValidaParaForma`): "O editor de forma (cadastros-formas.js)
hoje só deixa escolher conta corrente como 'conta padrão', mesmo para
uma forma do tipo crédito". A função de leitura (usada no formulário de
Lançamentos) já está preparada para o caso — ela valida se o TIPO da
conta padrão bate com o tipo esperado pela forma (`tipoContaParaForma`),
e para `credito` isso já retorna `TIPO_CARTAO`. Só o formulário de EDIÇÃO
da forma (`cadastros-formas.js`) nunca ofereceu cartão como opção.

## 2. Causa raiz

`src/ui/cadastros-formas.js`, função `editarForma`, monta o combo de
"Conta padrão" com um filtro fixo:

```js
const contas = opcoesAtivas(
  (await listAccounts()).filter((a) => a.tipo === TIPO_CONTA),
  pm.contaPadraoId
);
```

`TIPO_CONTA` está hardcoded — nunca `TIPO_CARTAO`, independente do tipo
escolhido no select `selTipo` do mesmo formulário. Além disso, a lista de
contas é montada UMA VEZ antes do modal abrir; trocar o tipo da forma
no próprio formulário (select `selTipo`) não atualiza as opções do combo
de conta padrão.

## 3. Fix

### 3.1 Filtro pelo tipo certo

Reusa `tipoContaParaForma` (já existe em
`src/ui/lancamentos-form-helpers.js`, exportada) para decidir que tipo de
conta oferecer, a partir do tipo ATUAL selecionado no formulário:

```js
import { tipoContaParaForma } from './lancamentos-form-helpers.js';
```

Cartões adicionais entram na lista junto com titulares — decisão do
usuário, mais flexível para quem faz a maioria das compras num cartão
adicional específico. Nenhum filtro extra por `cartaoPaiId` é necessário
além do filtro de tipo já existente (`listAccounts()` já devolve
titulares e adicionais juntos).

### 3.2 Reagir à troca de tipo ao vivo

Hoje a lista de contas é buscada uma única vez, antes do modal abrir —
trocar o tipo no `selTipo` não reflete no combo de conta padrão. Fix:
buscar TODAS as contas uma vez (`listAccounts()`, sem filtro), montar o
combo de conta padrão, e reconstruir suas `<option>` toda vez que
`selTipo` mudar, filtrando pelo tipo então selecionado. Quando o tipo
muda para algo cuja `tipoContaParaForma` retorna `null` (`dinheiro`), o
combo de conta padrão deve ficar vazio/desabilitado — dinheiro não tem
conta associada, comportamento já existente em `contasParaForma` no
formulário de Lançamentos (`!tipoForma → null`).

Se a conta padrão já selecionada deixar de bater com o novo tipo (porque
o usuário trocou o tipo da forma no mesmo formulário), ela é descartada
da seleção — mesma lógica que `contaPadraoValidaParaForma` já aplica na
LEITURA (uma conta de tipo incompatível nunca serve como padrão).

## 4. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture.
- Comentários e identificadores em português; termo técnico consagrado
  em inglês. Commits em português, imperativo, sem emoji.
- Reusa `tipoContaParaForma` já existente — não duplicar a lógica de
  mapeamento tipo-de-forma → tipo-de-conta em `cadastros-formas.js`.
- Nenhuma mudança em `contaPadraoValidaParaForma`/`contasParaForma`
  (`lancamentos-form-helpers.js`) — a lógica de leitura já está correta,
  só a de edição precisa mudar.

## 5. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Editar uma forma do tipo `credito` mostra cartões (titulares e
      adicionais) no combo de conta padrão, não contas bancárias
- [ ] Editar uma forma de outro tipo (`pix`/`debito`/`debito_automatico`)
      continua mostrando contas bancárias, comportamento inalterado
- [ ] Trocar o tipo no select da forma, dentro do mesmo formulário
      aberto, atualiza as opções do combo de conta padrão sem precisar
      fechar e reabrir o modal
- [ ] Trocar pra tipo `dinheiro` deixa o combo de conta padrão vazio
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
