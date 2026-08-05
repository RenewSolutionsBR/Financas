# Lançamentos: redesign no layout do app anterior + fixes de Conciliação (design)

## 1. Contexto

O usuário usou o app anterior (`Pessoal\07 Financeiro\Cartão de Credito\gastos-app`)
por meses antes da migração para este app multi-conta. Depois de usar a aba
Lançamentos do app novo por um tempo, pediu para portar o layout e as
funcionalidades do app anterior — que considera mais confortável — mantendo
os recursos que o app novo tem e o antigo não (multi-conta, múltiplas formas
de pagamento). Junto, relatou dois bugs concretos na aba Conciliação.

Este documento cobre dois pacotes de trabalho independentes:
- **Lançamentos**: redesign do layout/interação, portando do app anterior.
- **Conciliação**: dois fixes pontuais.

## 2. Lançamentos — redesign

### 2.1 Navegação por mês

Hoje o filtro de mês é um `<input type=month>` dentro da barra de filtros.
Passa a ser um cabeçalho de navegação com setas, replicando o app anterior:

```
‹  Agosto de 2026  ›
```

Estado de módulo `viewDate` (um `Date`, primeiro dia do mês exibido — mesmo
padrão do app anterior). `‹`/`›` decrementam/incrementam o mês e re-renderizam.
`filtros.mes` (já existente, formato `YYYY-MM`) passa a ser DERIVADO de
`viewDate`, não editado diretamente por um `<input>`.

Ao lançar um novo gasto ou editar uma data para outro mês, `viewDate` pula
para o mês do lançamento salvo — mesmo comportamento do app anterior (linhas
403-404 e 438-439 de `app.js` do app anterior) — para o usuário ver
imediatamente onde o lançamento caiu.

### 2.2 Barra de filtros (forma, conta, natureza)

Abaixo da navegação por mês, uma linha de filtros sempre visível, filtrando
dentro do mês escolhido:

- **Forma de pagamento** — já existe hoje (`selForma` em `barraFiltros`),
  mantido.
- **Conta/cartão** — já existe hoje (Fase 3), mantido.
- **Natureza** — novo. `<select>` com "Todas" + as 4 naturezas
  (`NATUREZAS` de `domain/transactions.js`: despesa, receita, transferência,
  pagamento de fatura), rótulos via `rotuloNatureza()` já existente.
  `filtros.naturezas = [valor]` ou `[]`, consumido por `filterTransactions`
  (já suporta `f.naturezas`, nenhuma mudança de domínio).
- **"Só classificados automaticamente"** — checkbox já existente, mantido.

Os 4 controles (forma/conta/natureza/checkbox) continuam na mesma
`barraFiltros`, agora abaixo do cabeçalho de navegação em vez de ao lado de
um seletor de mês.

### 2.3 Formulário: parcelamento sem modal

Hoje "Compra parcelada" abre um modal (`lancamentos-parcelado.js`,
`campoParceladoEModal`). Passa a ser um checkbox no próprio formulário,
alternando os campos visíveis — mesmo padrão do app anterior:

- Checkbox "É uma compra parcelada?" (desmarcado por padrão).
- **Desmarcado**: campo "Valor" simples (comportamento de hoje).
- **Marcado**: campo "Valor" some, aparecem "Valor total da compra" e
  "Número de parcelas" (mínimo 2), mais uma prévia de texto
  ("Nx de R$ Y,YY (total R$ Z,ZZ) — um lançamento por mês a partir da data
  escolhida"), recalculada a cada `input` nos dois campos.
- O checkbox some no modo edição (compra parcelada só faz sentido lançando
  do zero — mesma regra já documentada em `lancamentos.js`).

A divisão do valor usa `splitParcelas` (já existe em `domain/parcelas.js`,
reusado sem mudança). A checagem de duplicidade usa `findParcelaDuplicates`
(já existe, reusado sem mudança) — ao detectar duplicata, mostra a mesma
confirmação que existe hoje (reaproveita o fluxo de aviso já implementado,
só movendo de dentro do modal para o formulário principal).

`lancamentos-parcelado.js` e seu modal deixam de ser usados por esta tela;
avaliar na implementação se o arquivo é removido (se nada mais o importa)
ou mantido (se algo mais depende dele) — decisão de implementação, não de
design.

### 2.4 Lista de lançamentos

Agrupamento por dia mantido (já existe). Mudança: botões "Editar" e
"Excluir" passam de empilhados (um embaixo do outro, cores diferentes) para
lado a lado, na mesma linha do lançamento — mesmo padrão visual do app
anterior (`.entry-row` com `.edit`/`.del` como botões compactos na mesma
linha da descrição/valor), mas mantendo texto "Editar"/"Excluir" (não vira
só ícone, decisão já tomada no brainstorming).

### 2.5 Rodapé: exportar, backup, apagar tudo

Hoje a aba Lançamentos não tem nenhuma dessas ações — backup completo já
existe (`ui/cadastros-backup.js`, seção "Backup" da aba Cadastros, cobre as
6 tabelas do schema v2: `transactions`, `accounts`, `paymentMethods`,
`categories`, `statements`, `classificationRules`) e `resetAllData()`
(`core/storage.js:163`) já limpa todas as stores, mas não tem UI em
nenhuma tela.

Adicionar ao rodapé de Lançamentos, replicando a disposição do app anterior:

- **"Backup completo"** e **"Importar backup"** lado a lado — chamam as
  MESMAS funções já usadas em `cadastros-backup.js`
  (`exportarBackup`/`importarBackup`/`detectarVersaoDoArquivo` de
  `importers/backup-xlsx.js`), sem duplicar lógica. Considerar extrair a
  UI de upload/download para uma função compartilhada entre
  `cadastros-backup.js` e `lancamentos.js` se o corpo for idêntico o
  suficiente — decisão de implementação.
- **"Apagar todos os dados do app"** — link de texto discreto (vermelho,
  sublinhado, sem destaque de botão), mesmo padrão visual do app anterior.
  Ao clicar, `confirm()` do navegador com o mesmo teor do app anterior
  ("Isso apaga TODOS os lançamentos, categorias, contas, formas de
  pagamento e faturas importadas deste aparelho, sem volta. Já fez backup?
  Toque OK só se tiver certeza."). Confirmado → chama `resetAllData()` e
  re-renderiza o app inteiro (recarrega a página ou reexecuta o boot,
  decisão de implementação — o efeito observável é: todas as abas voltam
  ao estado de instalação nova).

O botão "Exportar resumo do mês" que já existe (se existir; conferir contra
o código atual — pode já não existir mais neste app, que tem exportação de
conciliação completa em vez disso) não faz parte deste redesign a menos que
já exista hoje; não introduzir um novo exportador de resumo mensal que o
app novo não tinha.

## 3. Conciliação — dois fixes

### 3.1 Aviso de fatura já importada

`commitImportacao` (`ui/conciliacao-import.js`) já monta um id
determinístico para o documento: `${contaId}|${tipo}|${statement.vencimento
|| statement.periodoFim}` (linha 29). Dois documentos do mesmo tipo, mesma
conta e mesmo vencimento colidem no mesmo id — essa é exatamente a
condição de "já foi importada antes" que interessa (decisão do
brainstorming: só mesmo vencimento, não heurística de conteúdo).

Na tela de análise (`renderPreview` em `conciliacao-import.js`), antes de
montar o botão "Confirmar importação": calcular o id determinístico do
`statement` recém-analisado e checar contra os documentos já existentes da
mesma conta (`storage.getByIndex('statements', 'by_contaId', contaId)`,
já disponível no escopo de `renderImportacao`). Se um documento com o
MESMO id já existe, mostrar um aviso na tela de análise, acima do botão de
confirmar, no mesmo estilo visual dos avisos de checksum já existentes
(classe `aviso-erro` ou uma nova classe consistente com o resto da tela):

> "Este documento (vencimento DD/MM/AAAA) já foi importado em [data da
> importação anterior, formatada]. Confirmar agora vai substituir os dados
> anteriores por este novo arquivo."

O comportamento de importação em si NÃO muda: `commitImportacaoEGravar` já
faz `storage.put('statements', ...)` com o mesmo id, que sobrescreve — é
esse mecanismo existente que o aviso está descrevendo, não uma trava nova.
Decisão do brainstorming: só avisar, deixar prosseguir se o usuário
confirmar (mesmo espírito do aviso de checksum divergente que já existe
na mesma tela).

### 3.2 Botão "Exportar conciliação completa" sempre visível

Hoje o botão só existe dentro de `renderBaldesFatura`
(`ui/conciliacao-fatura.js:68`), chamada só quando um documento do tipo
fatura está selecionado (`conciliacao.js:36`) — mas a função que ele chama
(`buildFullReconciliationRows`, `domain/reconcile-card.js`) já recebe TODAS
as faturas de todas as contas, não depende de nenhum documento selecionado.

Mover o botão para `ui/conciliacao.js` (a tela-mãe da aba), visível sempre
que existir ao menos uma conta cadastrada — independente de conta/documento
selecionado. Precisa de `faturasList` (todas as statements tipo fatura, de
todas as contas — hoje `renderBaldesFatura` só recebe as da conta atual;
buscar todas em `conciliacao.js`), `transactions` (`listTransactions()`,
já usado em outros pontos de `conciliacao.js`) e `accounts` (já carregado
no topo de `renderConciliacao`). `renderBaldesFatura` deixa de renderizar
esse botão (removido de `conciliacao-fatura.js`).

## 4. Global Constraints (herdadas, seguem valendo)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Valores monetários sempre positivos; sinal via `natureza`/`sinal`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Nenhum arquivo deve passar de ~250 linhas — `lancamentos.js` já está em
  432 linhas antes deste redesign (constraint já violada, registrado como
  minor deferred na Fase 3); este redesign é a oportunidade natural de
  dividir o arquivo (ex.: extrair `barraFiltros`/navegação de mês para
  `ui/lancamentos-filtros.js`, como já sugerido na revisão final da Fase 3)
  — considerar na hora de planejar as tasks, não obrigatório se o resultado
  ficar bem organizado mesmo maior.
- Idioma: identificadores em português para conceito de negócio, inglês
  para termo técnico consagrado. Comentários e UI em português.
- Commits: mensagem em português, imperativo, sem emoji.

## 5. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Navegação por mês funcionando (setas, lançar em mês diferente pula
      a visão para lá)
- [ ] Filtro de natureza funcionando, combinando com forma/conta/mês
- [ ] Parcelamento sem modal: checkbox troca os campos corretamente,
      preview atualiza, duplicidade ainda detectada
- [ ] Editar/excluir lado a lado, verificado em navegador real (claro e
      escuro, mobile e desktop)
- [ ] Backup completo, importar backup e apagar tudo funcionando a partir
      de Lançamentos (reusando a lógica já existente em
      `importers/backup-xlsx.js`/`core/storage.js`)
- [ ] Aviso de fatura já importada aparecendo corretamente ao reimportar
      o mesmo documento, sem falso positivo em documentos diferentes
- [ ] Botão de exportar conciliação completa visível independente de
      documento selecionado
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
