# Aba Parcelas: fix de âncora + Cadastros: descrição de categoria e layout de regras (design)

## 1. Contexto

Três achados relatados pelo usuário após uso real:
- Um bug real na aba Parcelas: parcelas já pagas aparecem como futuras, e o
  total futuro soma um mês que já foi pago.
- Duas melhorias em Cadastros: campo de descrição em categorias, e
  alinhamento em colunas no cadastro de regras de classificação.
- Uma dúvida (não é um bug): como usar expressão regular no cadastro de
  regras — já existe, respondida na seção 4 deste documento em vez de gerar
  trabalho de implementação.

## 2. Aba Parcelas — fix da âncora de data

### 2.1 Causa raiz

Quando uma fatura confirma uma parcela (`autoConfirmParcelas`,
`domain/parcelas.js:233-248`), a transação gravada usa
`data: dataCorte || row.vencimento` — a data de CORTE do período de
compras, não o vencimento da fatura. Para uma fatura com vencimento
30/01, a data de corte cai tipicamente no mês anterior (ex.: ~23/12).

A aba Parcelas (`parcelaGroupsDaConta`, `domain/parcelas.js:148-164`)
reconstrói os grupos de parcelamento a partir das transactions salvas,
usando `t.data` como se fosse o vencimento da fatura
(`vencimento: t.data`, linha 159). Isso ancora o cálculo de parcelas
futuras (`computeParcelaGroups`) na data de CORTE em vez do vencimento
real — a sequência de meses previstos "escorrega" para trás, incluindo
o mês já pago e omitindo o mês seguinte de verdade.

Exemplo real do usuário: fatura de vencimento 30/01 confirma parcela
4/9. A aba mostra parcelas restantes de janeiro a maio (5 meses,
remaining = 9-4 = 5), quando deveria mostrar fevereiro a junho — o mês
de janeiro já foi pago nesta própria fatura.

### 2.2 Fix

O vencimento real da fatura nunca é gravado como campo próprio na
transação confirmada — só existe embutido na `data` (=dataCorte, campo
errado para esse propósito) e no sufixo do id
(`confirmed_${key}_${vencimento}`, uma string não estruturada, não
reaproveitável).

Adicionar um campo `faturaVencimento` (data ISO) à transação confirmada
em `autoConfirmParcelas`, gravando o `row.vencimento` real da fatura
(que já chega correto para essa função — o bug está só em `data`, que
continua sendo `dataCorte` para fins de exibição na aba Lançamentos,
sem mudança nesse comportamento já aceito pelo usuário em investigação
anterior).

`parcelaGroupsDaConta` passa a usar `t.faturaVencimento || t.data` como
`vencimento` da linha reconstruída (fallback para `t.data` cobre
transações confirmadas ANTES deste fix, ou lançamentos manuais de
parcela que nunca passaram por `autoConfirmParcelas` — nesses casos o
comportamento é o mesmo de hoje, sem regressão, mas também sem a
correção — decisão já validada com o usuário: corrigir só daqui para
frente, sem migração retroativa dos dados já importados).

### 2.3 Escopo explícito

- Sem migração de dados: parcelamentos já confirmados por faturas
  antigas continuam com o comportamento atual até a PRÓXIMA fatura
  daquele cartão ser importada (que vai gravar `faturaVencimento`
  corretamente a partir de então, corrigindo a projeção seguinte).
- `syncPredictions`/`computeParcelaGroups` (o caminho usado na
  importação, não na aba Parcelas) já usa `r.vencimento` corretamente
  — não precisa de mudança; o bug é exclusivo de `parcelaGroupsDaConta`
  reconstruindo o vencimento a partir da transação salva.

## 3. Cadastros — descrição em categorias

### 3.1 Schema

`domain/categories.js`: `novaCategoria` e `validateCategoria` ganham um
campo opcional `descricao` (string, pode ser vazio). Sem mudança de
schema no `db-schema.js` (IndexedDB não precisa de migração de versão
para campo opcional novo em um objeto já existente).

### 3.2 Formulário

`ui/cadastros-categorias.js`, `editarCategoria`: adicionar um terceiro
campo `<textarea>` (ou `<input type=text>`, decisão de implementação —
textarea permite descrição um pouco mais longa sem quebrar o layout do
modal) rotulado "Descrição (opcional)", abaixo de Nome e Cor.

### 3.3 Exibição na lista

Não aparece como texto visível na listagem compacta de categorias — só
como `title` (tooltip nativo do navegador) no `span.item-nome`, mostrado
ao passar o mouse ou touch-and-hold. Quando `descricao` estiver vazia,
omitir o atributo `title` (não mostrar tooltip vazio).

## 4. Cadastros — layout em colunas nas regras de classificação

### 4.1 Causa raiz

`ui/cadastros-regras.js`, `secaoRegras`: cada item usa
`class: 'item-cadastro'`, uma classe COMPARTILHADA entre 4 telas de
Cadastros (categorias, formas, contas, regras) — `styles.css:250-258`,
flexbox `flex-wrap: wrap` sem larguras fixas, mesmo padrão que já
causava desalinhamento na lista de Lançamentos (corrigido em fase
anterior). Regras tem 3 botões (Editar/Ativar-Desativar/Excluir) contra
2 nas outras telas, então a classe compartilhada não pode simplesmente
virar grid — mudaria o layout das outras 3 telas também.

### 4.2 Fix

Nova classe `item-regra`, aplicada em vez de `item-cadastro` só nesta
tela (mantendo os estilos base compartilhados via uma segunda classe se
necessário, ou duplicando o mínimo indispensável — decisão de
implementação). CSS Grid com colunas fixas:

```
padrão + meta (1fr, ocupando a largura disponível) | Editar | Ativar/Desativar | Excluir
```

Mesma técnica já usada em `.item-lancamento` (fase anterior): grid com
`grid-template-columns`, os 3 botões em colunas de largura fixa
(`auto` ou largura mínima consistente), texto de padrão truncando com
ellipsis se necessário para não empurrar os botões. Meta (tipo de
correspondência · escopo · categoria · acertos · origem) desce para uma
segunda linha dentro da mesma célula do padrão, como já feito em
Lançamentos.

## 5. Dúvida: como usar expressão regular no cadastro de regras

Não é um bug — a funcionalidade já existe. Ao criar ou editar uma
regra em Cadastros → Regras de classificação, o campo "Tipo de
correspondência" tem 3 opções: Exata, Contém, e **Expressão regular**.
Ao escolher "Expressão regular", o campo "Padrão" passa a ser
interpretado como uma regex JavaScript padrão (`new RegExp(padrao)`,
`domain/classification.js`) — validada no momento de salvar (regex
inválida mostra erro imediato, "Expressão regular inválida: ...").

Exemplos práticos:
- `^UBER` — casa qualquer descrição que COMECE com "UBER".
- `MERCADO|SUPERMERCADO` — casa "MERCADO" OU "SUPERMERCADO" em qualquer
  posição.
- `\d{4}$` — casa descrições terminando em 4 dígitos.

Regras do tipo regex têm a MENOR prioridade de match entre os 3 tipos
(exata > contém > regex, `aplicarRegra`,
`domain/classification.js:89-114`) — usadas como "rede de segurança"
para padrões que a correspondência exata ou "contém" não cobrem. Nenhum
trabalho de implementação necessário; resposta a incluir na resposta ao
usuário e, opcionalmente, como texto de ajuda (`ajuda`) no formulário de
regras, mostrado quando "Expressão regular" está selecionado — ver
seção 6.

## 6. Ajuda contextual no formulário de regras (extra, ligado à seção 5)

Já que a dúvida do usuário mostra que a opção existe mas não é óbvia
como usar, adicionar um parágrafo de ajuda (`p.ajuda`, mesmo padrão já
usado em outros formulários do app) no formulário de
`editarRegra`, visível SÓ quando `selTipoMatch.value === 'regex'`
(atualizado via listener de `change`), com um exemplo curto (ex.: texto
fixo "Ex.: ^UBER casa descrições que começam com UBER"). Pequeno, não
gera nova tela nem documentação separada.

## 7. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.
- Campo novo em objeto de domínio (categoria.descricao,
  transaction.faturaVencimento) não exige mudança de `DB_VERSION` —
  IndexedDB não valida schema de objeto, só a lista de stores/índices.

## 8. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Nova fatura importada confirmando parcela N/M projeta corretamente
      as parcelas restantes a partir do MÊS SEGUINTE ao vencimento desta
      fatura, nunca incluindo o mês já pago
- [ ] Parcelamentos confirmados ANTES do fix continuam funcionando sem
      erro (fallback `t.faturaVencimento || t.data`), mesmo sem a
      correção retroativa
- [ ] Categoria com descrição mostra tooltip ao passar o mouse sobre o
      nome na lista; categoria sem descrição não mostra tooltip vazio
- [ ] Lista de regras com Editar/Ativar-Desativar/Excluir alinhados em
      colunas fixas, verificado em navegador real (claro/escuro,
      mobile/desktop), sem afetar o layout de categorias/formas/contas
- [ ] Texto de ajuda sobre regex aparece só quando "Expressão regular"
      está selecionado no formulário de regras
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
