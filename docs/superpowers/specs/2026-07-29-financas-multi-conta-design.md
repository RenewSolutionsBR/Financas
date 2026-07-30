# Livro de Gastos 2.0 — controle financeiro multi-conta e multi-cartão

Design aprovado em 2026-07-29. Sucessor do app `Cartao_Credito` (gastos-app), que passa a
ficar congelado como referência.

- **Repositório**: `RenewSolutionsBR/Financas` (público, GitHub Pages a partir de `main` /)
- **Local**: `07 Financeiro/Gastos/financas-app/`
- **Antecessor**: `07 Financeiro/Cartão de Credito/gastos-app/` — não é modificado

## 1. Objetivo

Ampliar o app de conciliação de fatura de cartão para um controle de gastos por **qualquer
forma de pagamento** (crédito, débito, Pix, dinheiro, boleto, débito automático,
transferência), alimentado por **duas fontes de importação** — fatura de cartão (PDF) e
extrato bancário (.xls/.csv) — sobre uma arquitetura que suporta **vários bancos e vários
cartões** sem alteração de código no núcleo.

Duas capacidades novas sustentam o ganho de produtividade:

1. **Memória de classificação**: a relação `descrição do documento → categoria` é aprendida
   a cada conciliação e reaplicada automaticamente nas importações seguintes.
2. **Natureza do lançamento**: distingue gasto de receita, transferência entre contas
   próprias e pagamento de fatura — o que impede a dupla contagem entre o extrato e a
   fatura do cartão.

## 2. Princípios preservados do app atual

Estas decisões são do app atual, foram validadas em produção com faturas reais de 09/2025 a
06/2026, e **não mudam**:

- Vanilla JS (ES modules), zero build step, zero framework, bibliotecas vendorizadas em
  `vendor/` (SheetJS, PDF.js). PWA offline-first com service worker versionado.
- Dados 100% locais em IndexedDB. Sem servidor, sem sincronização entre aparelhos. A única
  ponte entre instalações é o backup `.xlsx` manual.
- Datas em ISO (`YYYY-MM-DD`) internamente, formatação BR só na camada de UI.
- Gráficos em CSS puro (`conic-gradient` e divs) — sem Chart.js, para manter o app leve.
- Identidade de parcela (`computeParcelaKey`), namespaces de id separados (`seed_` para
  previsão, `confirmed_` para confirmação), janela de conciliação por `dataCorte`
  encadeada, `POOL_SLACK_DAYS = 3`, checksum obrigatório na importação de fatura,
  categoria `a_classificar` buscada por id.

O detalhamento de por que cada uma existe está em
`Cartão de Credito/gastos-app/docs/DOCUMENTACAO_TECNICA.md`, que deve ser lido antes de
qualquer alteração na lógica de parcelas.

## 3. Privacidade

O repositório é **público**. Portanto:

- Nenhum dado pessoal no código: sem número de conta, agência, final de cartão, nome ou
  valores reais em seeds, testes ou fixtures.
- Os seeds de primeira execução contêm apenas **formas de pagamento e categorias
  genéricas**. Contas e cartões são cadastrados pelo usuário num assistente de primeira
  execução.
- Fixtures de teste são derivadas dos arquivos reais mas **anonimizadas** (nomes,
  contrapartes, números de conta e valores substituídos), preservando só a estrutura que o
  parser precisa exercitar.
- Arquivos-fonte (extratos, faturas, backups) ficam **fora do repositório**, em
  `07 Financeiro/Gastos/Extratos/` e `.../Faturas/`. O `.gitignore` bloqueia
  `*.pdf`, `*.xls`, `*.xlsx`, `*.csv`, `*.ofx` na raiz do projeto.

## 4. Estrutura de pastas

```
07 Financeiro/Gastos/
├── financas-app/                    repo git → RenewSolutionsBR/Financas
│   ├── index.html manifest.webmanifest sw.js styles.css .gitignore README.md
│   ├── src/
│   │   ├── version.js               APP_VERSION — fonte única, sw.js importa daqui
│   │   ├── app.js                   boot + roteamento de abas apenas
│   │   ├── core/
│   │   │   ├── storage.js           wrapper IndexedDB genérico
│   │   │   ├── db-schema.js         stores, índices e migrações versionadas
│   │   │   ├── money.js dates.js text.js
│   │   ├── domain/
│   │   │   ├── accounts.js payment-methods.js categories.js transactions.js
│   │   │   ├── classification.js    memória descrição → categoria
│   │   │   ├── parcelas.js          computeParcelaKey/Groups, syncPredictions, autoConfirm
│   │   │   ├── reconcile-card.js    conciliação de fatura
│   │   │   └── reconcile-bank.js    conciliação de extrato
│   │   ├── importers/
│   │   │   ├── registry.js          registro de adaptadores + detecção de formato
│   │   │   ├── santander-cartao-pdf.js   fatura Visa e Mastercard
│   │   │   ├── santander-extrato-xls.js
│   │   │   ├── generic-table.js     CSV/XLS com mapeamento de colunas
│   │   │   ├── backup-xlsx.js       backup/restore completo do schema v2
│   │   │   └── legacy-idb.js        leitura do banco do app anterior (mesma origem)
│   │   └── ui/
│   │       ├── components.js tabs.js
│   │       └── lancamentos.js conciliacao.js cadastros.js parcelas.js dashboard.js
│   ├── vendor/ icons/               copiados do app atual
│   ├── tests/*.test.js              lógica pura + fixtures anonimizadas
│   ├── tools/tests.html             runner no browser, zero dependências
│   ├── tools/test-parser.html       harness multi-adaptador
│   └── docs/
│       ├── MANUAL_USUARIO.md DOCUMENTACAO_TECNICA.md CONTEUDO_PROJETO.md
│       └── superpowers/specs/       este documento
├── Extratos/Santander/              arquivos de extrato (fora do repo)
└── Faturas/                         PDFs de fatura novos (fora do repo)
```

O `app.js` atual tem 982 linhas e concentra UI, handlers, exportação, parsing de planilha e
dashboard. A divisão em `core/`, `domain/`, `importers/` e `ui/` existe para que cada
arquivo tenha um propósito único e possa ser lido e testado isoladamente. Nenhum módulo de
`domain/` importa de `ui/`; `ui/` orquestra, `domain/` decide, `core/` serve os dois.

## 5. Modelo de dados (IndexedDB `financas`, schema v2)

O banco tem nome novo, distinto do `livro-de-gastos` usado pelo app anterior. Isso é o que
permite ler o banco antigo sem alterá-lo (ver 5.7) e manter o app anterior funcionando como
retaguarda durante a transição.

### 5.1 `accounts` — contas e cartões

Chave `id`.

| Campo | Descrição |
|---|---|
| `tipo` | `'conta'` \| `'cartao'` |
| `nome` | rótulo livre exibido na UI |
| `instituicao` | nome do banco/emissor |
| `agencia`, `numero` | só quando `tipo === 'conta'` |
| `bandeira`, `final` | só quando `tipo === 'cartao'` |
| `diaVencimento` | dia nominal de vencimento da fatura (cartão) |
| `contaPagadoraId` | cartão → `accounts.id` da conta que o debita |
| `cartaoPaiId` | cartão **adicional** → `accounts.id` do cartão titular. Ver 5.1.1 |
| `matchers` | array de padrões que identificam a conta/cartão na descrição do extrato (ex.: `FINAL 0000`). Ao cadastrar um cartão, o app **sugere** o matcher a partir de `bandeira` e `final`; a lista é editável, porque a grafia varia entre bancos |
| `mapeamentoImportacao` | mapeamento de colunas salvo para o importador genérico |
| `cor`, `ativo` | apresentação e desativação sem exclusão |

#### 5.1.1 Cartão titular e cartão adicional

Uma fatura Santander contém os lançamentos de **mais de um plástico**: o do titular e os
adicionais, estes marcados com `@` antes do nome no PDF. Cada plástico tem seu próprio
bloco de despesas e seu próprio `VALOR TOTAL`, mas o banco debita **um único valor
consolidado** na conta corrente.

O modelo reflete exatamente isso:

- Cada plástico é um registro em `accounts` com `tipo: 'cartao'`. O adicional aponta para o
  titular por `cartaoPaiId`.
- O `statements` da fatura pertence sempre ao **cartão titular** — é ele que tem vencimento,
  data de corte e débito em conta.
- Cada `transactions` gerado carrega em `contaId` o plástico **de onde o gasto realmente
  saiu** (titular ou adicional), o que permite filtrar e somar por plástico no Dashboard.
- A conciliação com o extrato usa sempre o titular, porque é o valor consolidado que aparece
  na conta corrente.
- Só o cartão titular tem `contaPagadoraId`; num adicional esse campo fica vazio, e a conta
  pagadora efetiva é a do pai.

### 5.2 `paymentMethods` — formas de pagamento

Chave `id`. Cadastro gerenciável pelo usuário (criar, editar, reordenar, desativar).

| Campo | Descrição |
|---|---|
| `nome` | rótulo livre ("Pix", "Cartão de Crédito", "Boleto") |
| `tipo` | comportamento, não rótulo: `credito` \| `debito` \| `pix` \| `dinheiro` \| `boleto` \| `transferencia` \| `outro` |
| `contaPadraoId` | conta/cartão sugerido ao escolher esta forma |
| `conciliaCom` | `'fatura'` \| `'extrato'` \| `'nenhum'` |
| `padroesExtrato` | prefixos do extrato que inferem esta forma (ex.: `PIX ENVIADO`, `PAGAMENTO DE BOLETO`) |
| `cor`, `ordem`, `ativo` | |

Seed inicial genérico: Cartão de Crédito, Cartão de Débito, Pix, Dinheiro, Boleto, Débito
Automático, Transferência (TED/DOC). Exclusão é bloqueada se a forma estiver em uso; a UI
oferece desativar no lugar.

### 5.3 `transactions` — lançamento unificado (substitui `expenses`)

| Campo | Descrição |
|---|---|
| `id`, `data`, `descricao`, `valor`, `categoria` | `valor` sempre positivo; o sinal vem de `natureza` |
| **`natureza`** | `'despesa'` \| `'receita'` \| `'transferencia'` \| `'pagamento_fatura'` |
| `formaPagamentoId`, `contaId` | forma usada e conta/cartão de onde saiu |
| `previsto`, `origemManual`, `grupo_parcela` | idênticos ao app atual |
| `parcelaKey`, `parcela_atual`, `parcela_total` | idênticos ao app atual |
| **`origem`** | `'manual'` \| `'fatura'` \| `'extrato'` |
| **`origemRef`** | `{ statementId, linhaId }` — vínculo direto à linha importada que o originou |
| `conciliadoAutomaticamente` | conciliado sem toque manual |
| `classificadoAutomaticamente`, `regraId` | classificado pela memória, e por qual regra |
| `faturaVinculadaId` | quando `natureza === 'pagamento_fatura'`, o `statements.id` da fatura correspondente |

**Regra de ouro dos totais**: Dashboard, exportações e qualquer soma de "gasto" consideram
exclusivamente `natureza === 'despesa' && !previsto`. Receita, transferência entre contas
próprias e pagamento de fatura são registrados, exibíveis e filtráveis, mas nunca somam
como gasto.

### 5.4 `statements` — documento importado (substitui `faturas`)

Chave `id` = `${contaId}|${tipo}|${referencia}`.

| Campo | Descrição |
|---|---|
| `tipo` | `'fatura'` \| `'extrato'` |
| `contaId`, `adaptador`, `arquivo`, `importadoEm` | procedência |
| `vencimento`, `dataCorte`, `totalImpresso` | só fatura |
| `periodoInicio`, `periodoFim`, `saldoInicial`, `saldoFinal` | só extrato |
| `rows[]` | linhas normalizadas (seção 6) |

### 5.5 `classificationRules` — memória de classificação

| Campo | Descrição |
|---|---|
| `padrao` | descrição canônica que dispara a regra |
| `tipoMatch` | `'exato'` \| `'contem'` \| `'regex'` |
| `escopo` | `'fatura'` \| `'extrato'` \| `'ambos'` |
| `contaId` | opcional, restringe a regra a uma conta/cartão |
| `categoriaId` | categoria aplicada. **Opcional**: uma regra pode existir só para fixar natureza ou forma de pagamento (ex.: marcar uma contraparte recorrente como transferência), sem opinar sobre categoria |
| `formaPagamentoId`, `naturezaSugerida` | opcionais, aplicados junto |
| `origem` | `'aprendida'` (nasceu de uma edição do usuário) \| `'manual'` (criada na tela de Regras) |
| `acertos`, `criadoEm`, `ultimoUsoEm`, `ativa` | auditoria |

### 5.6 `categories` e `meta`

Inalterados. `categories` mantém `a_classificar` com id fixo e ganha no seed "Tarifas e
impostos bancários". `meta` ganha `schemaVersion`, `onboardingConcluido` e
**`apelidosTitular`** — lista de nomes pelos quais o próprio usuário aparece como
contraparte no extrato (a mesma pessoa aparece com grafias diferentes conforme o banco
emissor). É editável em Cadastros e alimenta a detecção de transferência entre contas
próprias descrita em 7.2. Como é dado pessoal, nasce vazia no código e é preenchida no
assistente de primeira execução.

### 5.7 Migração v1 → v2

**O backup `.xlsx` do app atual é parcial e não serve como caminho principal.** Sua planilha
`Backup_Lancamentos` grava apenas `id, descricao, valor, data, categoria, previsto,
parcelaKey`: perde `parcela_atual`, `parcela_total`, `conciliadoAutomaticamente`,
`origemManual` e `grupo_parcela`, e o store `faturas` não é exportado de forma alguma.
Migrar por ele descartaria todas as faturas importadas e a metainformação da cadeia de
parcelas.

**Caminho principal: leitura direta do IndexedDB da mesma origem.** Os dois apps são
publicados sob `https://renewsolutionsbr.github.io` — o caminho difere (`/Cartao_Credito/` e
`/Financas/`), mas a origem é a mesma, e IndexedDB é isolado por origem, não por caminho.
O app novo, portanto, enxerga o banco `livro-de-gastos` do app antigo.

Regras dessa leitura:

- O app novo usa um banco **de nome diferente** (`financas`). Ele abre `livro-de-gastos`
  **sem informar versão**, o que o conecta à versão existente sem disparar
  `onupgradeneeded` — o banco antigo é lido, nunca alterado. O app anterior continua
  íntegro e utilizável como retaguarda.
- A conversão é integral: `expenses` → `transactions`, `faturas` → `statements`,
  `categories` e `meta` copiados. Nenhum campo se perde, porque nada passa por planilha.
- `expenses` recebem `natureza: 'despesa'`, `origem: 'manual'`, a forma de pagamento
  "Cartão de Crédito" e o `contaId` do cartão indicado pelo usuário no assistente.
- Ids são preservados literalmente (`seed_*`, `confirmed_*`), para que a cadeia de parcelas
  de 09/2025 a 06/2026 continue conciliando.
- A migração é idempotente e não destrutiva: rodar de novo não duplica (os ids são os
  mesmos) e nunca apaga nada do banco de origem.

**Caminho alternativo: backup `.xlsx`.** Continua existindo para quem instalar o app num
aparelho ou navegador que nunca teve o app anterior. Nesse caso o app avisa explicitamente
que faturas e metainformação de parcela não vêm no arquivo, e recomenda reimportar os PDFs
de fatura em seguida.

**Backup do app novo é completo.** O `backup-xlsx.js` exporta todos os stores, incluindo
`statements`, `accounts`, `paymentMethods` e `classificationRules`, com um cabeçalho de
`schemaVersion` — a limitação encontrada na v1 não se repete.

## 6. Contrato de importação

Todo adaptador devolve `{ statement, rows, avisos }`, com `rows` neste formato — a
conciliação e a UI nunca sabem de qual banco a linha veio:

```js
{
  id,                  // hash estável de conta+data+valor+descricao+documento+ordinal
  data,                // ISO
  valor,               // positivo
  sinal,               // 'debito' | 'credito'
  descricao,           // texto original do documento
  descricaoCanonica,   // normalizada para casar regras (seção 8.1)
  documento,           // nº do documento, quando houver
  tipoDetectado,       // prefixo classificador do extrato, quando houver
  parcela_atual, parcela_total,  // só fatura
  cartaoFinal,         // só fatura: de qual plástico saiu o gasto (titular ou adicional)
  secao,               // só fatura: 'despesas' | 'pagamentos_creditos'
  valorUSD,            // só fatura: coluna US$, quando diferente de zero
  saldo,               // só extrato
  raw                  // linha bruta, para depuração
}
```

O `id` por hash torna a importação **idempotente**: reimportar um extrato cujo período se
sobrepõe a outro já importado não duplica linhas nem lançamentos.

### 6.1 Registro de adaptadores

```js
register({
  id: 'santander-extrato-xls',
  label: 'Extrato Santander (.xls)',
  aceita: ['.xls', '.xlsx'],
  detectar(buffer) → número 0..1,   // assinatura do cabeçalho
  parse(buffer)   → { statement, rows, avisos }
});
```

Ao escolher um arquivo, o app roda `detectar` em todos os adaptadores compatíveis com a
extensão e propõe o de maior pontuação, com opção de trocar manualmente. **Adicionar um
banco novo = um arquivo em `importers/` mais uma linha de registro**, sem tocar em
conciliação, domínio ou UI.

### 6.2 Adaptadores desta entrega

| Adaptador | Fonte | Observação |
|---|---|---|
| `santander-cartao-pdf` | fatura Visa **e** Mastercard em PDF | é o `pdf-parser.js` atual, estendido — ver 6.4 |
| `santander-extrato-xls` | extrato de conta corrente `.xls` | novo — formato descrito em 6.3 |
| `generic-table` | CSV/XLS de qualquer banco | mapeamento de colunas definido pelo usuário e salvo em `accounts.mapeamentoImportacao` |

### 6.3 Formato do extrato Santander

Planilha BIFF8 (`.xls`), uma aba. Estrutura observada no arquivo de referência:

- Linha de título `EXTRATO DE CONTA CORRENTE`; cabeçalho com `Conta: <agencia>-<numero>` e
  `Extrato de DD/MM/AAAA a DD/MM/AAAA`.
- Cabeçalho de tabela: `Data · Descrição · Docto · Situação · Crédito (R$) · Débito (R$) ·
  Saldo (R$)`. Valores em formato BR (`-7.781,06`), débitos negativos.
- Rodapé: linha `SALDO ANTERIOR`, linha `TOTAL`, e um bloco de saldos consolidados que deve
  ser ignorado pelo parser.
- A descrição é `TIPO` + espaços múltiplos + `CONTRAPARTE`
  (ex.: `PIX ENVIADO⎵⎵⎵Fulano de Tal`). O parser separa os dois por `\s{2,}`; quando não há
  contraparte, `tipoDetectado` e `descricaoCanonica` coincidem.
- `detectar` pontua por: célula A1 igual a `EXTRATO DE CONTA CORRENTE`, presença de `Conta:`
  no cabeçalho e do cabeçalho de tabela com as 7 colunas.
- O arquivo vem em code page 1252; a leitura precisa decodificar corretamente os acentos
  (`Descrição`, `Situação`).

Validação de integridade análoga ao checksum da fatura: `saldoInicial + Σcréditos −
Σdébitos = saldoFinal`. Divergência bloqueia a confirmação salvo marcação explícita de
"importar mesmo assim".

### 6.4 Formato da fatura Santander (Visa e Mastercard)

A comparação entre as faturas Visa (`1234…0000`) e Mastercard (`5678…0000`) mostrou que os
dois documentos têm a **mesma estrutura lógica**, diferindo apenas no layout físico: a Visa
é diagramada em duas colunas por página, a Mastercard em coluna única. Por isso não há dois
parsers, e sim um adaptador (`santander-cartao-pdf`) que já resolve colunas dinamicamente
pelo histograma de posição X — a Mastercard é o caso degenerado de uma coluna só.

**A ordem de trabalho é: primeiro rodar o parser atual contra as faturas Mastercard no
harness e medir onde ele falha; só então tratar as diferenças reais.** Escrever um segundo
parser antes dessa medição seria trabalho especulativo.

Estrutura comum aos dois documentos:

- Marcador de início `Detalhamento da Fatura`; bounds verticais até `Juros e Custo Efetivo
  Total`, como já implementado.
- Um bloco por plástico, iniciado por `NOME - BBBB XXXX XXXX FFFF`. O **cartão adicional** é
  prefixado por `@`. O `FFFF` alimenta `cartaoFinal` na linha normalizada.
- Dentro de cada bloco, seções `Pagamento e Demais Créditos` e `Despesas`, cada uma
  encerrada por `VALOR TOTAL`. A seção alimenta o campo `secao`.
- Colunas: `Compra · Data · Descrição · Parcela · R$ · US$`. A coluna `Parcela` traz `NN/NN`
  (ex.: `09/09`) quando é compra parcelada, e fica vazia nas avulsas.
- Página 1 traz a frase de corte (`compras … realizadas até DD/MM`) e o bloco `Período das
  compras` com quatro faixas `DD/MM/AA a DD/MM/AA`.
- Bloco `Resumo da Fatura`: `Saldo Anterior`, `(+) Total Despesas/Débitos no Brasil`, `(+) …
  no Exterior`, `(-) Total de pagamentos`, `(-) Total de créditos`, `(=) Saldo Desta
  Fatura` — permite um checksum mais forte que a simples soma de linhas por seção.

**Período de compras impresso.** As quatro faixas do bloco `Período das compras` dão o
início e o fim da janela diretamente, sem estimativa. Os rótulos `Esta Fatura` e `Fatura
Aberta` impressos ao lado **não são confiáveis** para parear com a faixa correta (o
alinhamento visual não corresponde à ordem lógica). A regra é: escolher a faixa cujo **fim
coincide com o `dataCorte`** já extraído da frase da página 1. Isso identifica a faixa sem
ambiguidade e, de quebra, valida uma extração contra a outra — se nenhuma faixa terminar no
`dataCorte`, o parser emite aviso e o app cai no encadeamento descrito em 7.1.

**Seção `Pagamento e Demais Créditos`.** Contém o pagamento da fatura anterior
(`DEB AUTOM DE FATURA EM C/`, valor negativo). Linhas desta seção nunca são despesa: recebem
`natureza: 'pagamento_fatura'` (ou `receita`, para estornos e créditos diversos) e ficam
fora de qualquer total de gasto. Ver 7.3.

## 7. Conciliação

### 7.1 Fatura (`reconcile-card.js`)

Fluxo atual preservado: preview com checksum, quatro baldes (conciliado automático,
conciliado manual, só na fatura, só no app), auto-confirmação de parcelas por identidade,
pool alargado em `POOL_SLACK_DAYS = 3`. Três mudanças:

**a) Isolamento por cartão.** O pool de candidatos passa a ser filtrado pelo cartão titular
da fatura e seus adicionais (`contaId ∈ {titular} ∪ {adicionais}`), o que permite Visa e
Mastercard conviverem sem confundir lançamentos entre si.

**b) Janela vinda do documento.** `getReconciliationWindow` passa a ter três níveis, nesta
ordem de precedência:

1. **Período de compras impresso no PDF** (6.4) — a faixa cujo fim coincide com o
   `dataCorte`. Fonte primária: dá início e fim exatos, sem inferência.
2. **Encadeamento por `dataCorte`** com a fatura anterior — o comportamento atual, mantido
   como fallback para faturas sem o bloco de períodos (ex.: importadas via planilha).
3. **Estimativa de 35 dias** antes do corte — último recurso, inalterado.

A precedência é deliberada: o nível 1 é estritamente mais preciso que o 2 (não depende de a
fatura anterior ter sido importada) e elimina o único ponto onde a janela era adivinhada. O
nível 2 continua existindo porque nem toda fatura traz o bloco, e porque é lógica validada
em produção com dez faturas reais — não se remove o que funciona, se antecede.

**c) Natureza por seção.** Linhas da seção `Pagamento e Demais Créditos` não entram como
despesa (ver 7.3).

### 7.2 Extrato (`reconcile-bank.js`)

**Etapa 1 — atribuição de natureza**, antes de qualquer casamento. É o mecanismo que
impede a dupla contagem:

| Condição na linha | `natureza` | Efeito |
|---|---|---|
| descrição casa um `matcher` de conta do tipo cartão, em lançamento de débito | `pagamento_fatura` | fora do total; vincula ao `statements` de fatura daquele cartão com vencimento mais próximo da data, e confronta a soma da fatura com o valor debitado |
| contraparte casa um `apelidosTitular` ou outra conta cadastrada | `transferencia` | fora do total |
| `sinal === 'credito'` | `receita` | fora do total, mas registrada |
| demais débitos | `despesa` | conta no total |

A natureza atribuída é editável linha a linha na tela de preview, e a correção é gravada
como regra (`naturezaSugerida`) para as importações seguintes.

Quando o confronto fatura × débito diverge, o app exibe um aviso não bloqueante indicando
os dois valores e a diferença — pode ser legítimo (encargos, pagamento parcial) e a decisão
é do usuário.

**Etapa 2 — casamento** com lançamentos existentes: valor com tolerância de R$ 0,01, data
com tolerância de 2 dias, e conta compatível (a conta do extrato deve bater com `contaId`
do lançamento, ou o lançamento não ter conta definida). Empate é desfeito pela maior
similaridade de descrição canônica.

**Etapa 3 — quatro baldes**, iguais aos da fatura, mais um recurso obrigatório:

**`+ lançar em lote`** — seleção múltipla no balde "só no extrato", criando todos os
lançamentos de uma vez. Diferente da fatura de cartão (onde o usuário já digitava os
lançamentos à mão), o extrato traz dezenas de linhas que nunca existiram no app: débito
automático de concessionárias, boletos, IOF, tarifas. Sem lançamento em lote o fluxo é
impraticável. Cada linha selecionada já chega com categoria sugerida pela memória de
classificação e forma de pagamento inferida de `tipoDetectado` via `padroesExtrato`.

### 7.3 O pagamento de fatura aparece nas duas fontes

Um mesmo pagamento de fatura é documentado três vezes:

| Onde | Como aparece | Papel |
|---|---|---|
| Extrato da conta | `DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 0000`, débito | o dinheiro efetivamente saindo da conta |
| Fatura **seguinte** do cartão | `DEB AUTOM DE FATURA EM C/`, crédito, seção `Pagamento e Demais Créditos` | quitação do saldo anterior |
| Fatura **paga** | soma das compras da fatura anterior | a dívida que foi quitada |

Verificado nos documentos reais: o extrato registra `04/05 … MASTER CARD FINAL 0000
−123,01` e a fatura de 01/06 registra `04/05 DEB AUTOM DE FATURA EM C/ −123,01`. Mesmo
evento, duas fontes.

**Regra de registro único:** o lançamento canônico é o do **extrato**, porque é ali que o
dinheiro sai da conta e é o único dos três que representa uma movimentação de caixa. A linha
correspondente da fatura **não cria** um segundo lançamento — ela é casada com o existente
(valor idêntico e data a até 2 dias) e serve como confirmação. Se o extrato daquele período
ainda não tiver sido importado, a linha da fatura cria o lançamento com
`natureza: 'pagamento_fatura'`; quando o extrato chegar depois, o casamento por valor e data
o encontra e apenas complementa `origemRef`, sem duplicar.

Nenhuma das três representações entra em qualquer total de gasto: o gasto real são as
compras detalhadas, já registradas individualmente.

## 8. Memória de classificação (`classification.js`)

### 8.1 Descrição canônica

A canonicalização é o que faz a memória funcionar, porque a descrição bruta do banco
carrega ruído variável. `canonicalizar(descricao, escopo)` aplica, em ordem:

1. Separação `tipo` / `contraparte` por `\s{2,}` (extrato). A contraparte é a chave; sem
   contraparte, o próprio tipo vira a chave.
2. Maiúsculas, remoção de acentos, colapso de espaços.
3. Remoção de sufixo de parcela `NN/NN`.
4. Remoção de prefixos de adquirente (`PAG*`, `MP*`, `PAGSEGURO*` e similares).
5. Remoção de sequências de 6 ou mais dígitos (números de documento, NSU).
6. Remoção de sufixo de cidade/UF quando reconhecível.

A canonicalização é usada **apenas** para casar regras. `computeParcelaKey` continua
usando `normalizeDescricao` (trim/upper/colapso), inalterado — mexer nele quebraria a
identidade das parcelas já gravadas.

### 8.2 Precedência

Na aplicação, a primeira regra que casar nesta ordem vence; empate é decidido pelo maior
número de `acertos`:

1. `exato` com `contaId` igual ao da linha
2. `exato` com `escopo` igual ao da origem
3. `exato` com `escopo: 'ambos'`
4. `contem`
5. `regex`

### 8.3 Aprendizado

Sempre que o usuário define ou altera a categoria de um lançamento que possui `origemRef`,
a regra correspondente é criada ou sobrescrita, com `origem: 'aprendida'`, `escopo` igual à
origem do lançamento e `padrao` igual à descrição canônica daquela linha. Se já existia
regra com categoria diferente, a nova prevalece e `acertos` é zerado — **o usuário sempre
vence a máquina**, que é o requisito explícito de poder sempre atualizar a classificação
pela aba Lançamentos.

Ao aprender uma regra, o app oferece aplicá-la retroativamente aos lançamentos anteriores
que estejam em `a_classificar` com a mesma descrição canônica, informando quantos são.

### 8.4 Aplicação e auditoria

A memória é aplicada no momento em que uma linha importada vira lançamento (individual ou
em lote), marcando `classificadoAutomaticamente: true` e `regraId`. Na aba Lançamentos o
registro exibe um selo `auto` e existe filtro "classificados automaticamente", para revisão.
Editar a categoria remove o selo e retreina a regra.

Cadastros → Regras lista todas as regras com padrão, escopo, categoria e número de acertos,
permitindo editar, desativar e excluir.

## 9. Telas

| Aba | Mudanças |
|---|---|
| **Lançamentos** | novos campos Forma de pagamento (obrigatório, default = última usada) e Conta/Cartão (preenchido pela forma, editável); campo Natureza com default `despesa`; filtros por forma, conta e "classificados automaticamente"; selo `auto` |
| **Conciliação** | seletor de documento passa a oferecer Fatura de cartão e Extrato bancário, agrupados por conta/cartão; fluxo de fatura preservado; fluxo de extrato conforme 7.2, com `+ lançar em lote` |
| **Parcelas** | inalterada, exceto por passar a exibir o cartão de origem |
| **Dashboard** | filtros de forma de pagamento e conta/cartão (múltipla escolha) somados aos de ano/mês; faixa de tiles com total por forma; barras mensais empilhadas por forma; rosca por categoria mantida |
| **Cadastros** *(nova)* | Contas & Cartões, Formas de Pagamento, Categorias, Regras de classificação, Backup/Restore, Reset |

O assistente de primeira execução (`onboarding`) pede o cadastro da primeira conta e do
primeiro cartão, e oferece a importação do backup do app anterior.

Os gráficos permanecem em CSS puro. A revisão visual aplica as skills `dataviz` (paleta
categórica consistente e acessível em claro e escuro) e `frontend-design` (responsividade em
tela pequena e suporte a dark mode do sistema), resolvendo a pendência registrada no app
atual.

## 10. Testes

Runner próprio em `tools/tests.html`: carrega os módulos como ES modules, executa os
arquivos de `tests/` e imprime o resultado na página. Zero dependências, zero build, roda
inclusive no celular.

**Dois alvos, os mesmos arquivos de teste.** Os mesmos `tests/*.test.js` também rodam por
linha de comando com `node tools/run-tests.mjs`, porque Node executa ES modules nativamente.
Isso não adiciona nenhuma dependência ao app — o Node não é usado para build, empacotamento
nem execução, apenas como um segundo executor dos mesmos arquivos. A razão é prática: sem um
comando verificável, cada alteração de lógica dependeria de abrir o navegador e conferir a
olho, o que não é verificação.

A divisão decorrente é: **lógica pura em módulos que não importam IndexedDB nem DOM**
(rodam nos dois alvos), e uma camada fina de persistência e UI por cima (testada no
navegador). Isso é o mesmo princípio de fronteiras da seção 4 — `domain/` decide, `core/`
serve, `ui/` orquestra — agora com uma consequência verificável.

Cobertura pretendida:

- `parcelas.test.js` — casos já validados em produção: parcela 1 exige `+ lançar`; parcela
  maior que 1 auto-confirma mesmo sem previsão candidata; namespace de id separado impede
  que a regeneração de previsões apague uma confirmação; `addMonths` preserva o dia sem
  estourar o mês.
- `reconcile-card.test.js` — os três níveis de precedência da janela (período impresso,
  encadeamento, estimativa) e o aviso quando nenhuma faixa termina no `dataCorte`;
  `POOL_SLACK_DAYS`; balde "só no app" restrito à janela oficial; isolamento entre cartões
  diferentes; inclusão dos adicionais no pool do titular.
- `reconcile-bank.test.js` — atribuição de natureza nos quatro casos, casamento por
  valor/data/conta, idempotência do hash em reimportação sobreposta, confronto fatura ×
  débito.
- `pagamento-fatura.test.js` — a regra de registro único de 7.3 nas duas ordens de
  importação: extrato antes da fatura, e fatura antes do extrato. Em ambas, exatamente um
  lançamento, com `origemRef` completo e fora dos totais de gasto.
- `classification.test.js` — canonicalização (cada uma das 6 etapas), precedência das cinco
  categorias de regra, aprendizado sobrescrevendo regra anterior.
- `importers.test.js` — parser do extrato contra fixture anonimizada; parser de fatura
  contra fixtures de texto já extraído das **duas** diagramações (Visa em duas colunas,
  Mastercard em coluna única), incluindo separação por plástico titular/adicional, seções
  `Despesas` e `Pagamento e Demais Créditos`, e leitura do bloco `Período das compras`;
  pontuação de `detectar`.
- `migration.test.js` — conversão v1 → v2 preservando ids, `parcela_atual`/`parcela_total`,
  `conciliadoAutomaticamente` e `origemManual`; conversão de `faturas` em `statements`;
  idempotência (rodar duas vezes não duplica); e o caminho degradado do backup `.xlsx`
  parcial, que deve avisar sobre o que não veio no arquivo.

## 11. Pendências do app atual endereçadas

| Pendência registrada em `CONTEUDO_PROJETO.md` §6 | Tratamento |
|---|---|
| `parcelaKey` por texto exato é frágil para lançamento manual | `origemRef` dá vínculo direto à linha de origem, e a memória de classificação reduz a digitação livre. `parcelaKey` em si não é alterado |
| Sem sincronização entre aparelhos | Fora de escopo, por decisão. O backup ganha `schemaVersion` e o app avisa quando está desatualizado |
| `findParcelaDuplicates` é heurística | Passa a checar `origemRef` primeiro (duplicata real = mesma linha de origem); a heurística de três condições vira segundo nível |
| Sem testes automatizados | Suíte da seção 10 |
| Dashboard nunca verificado em navegador real | Skills `dataviz` e `frontend-design`, mais verificação real via Playwright antes de publicar |
| `tools/test-parser.html` desatualizado | Substituído por harness multi-adaptador |
| `CACHE_VERSION` com bump manual a cada deploy | `src/version.js` como fonte única, importada pelo `sw.js` |

## 12. Fases de entrega

**Fase 1 — Fundação e cadastros.** Repositório, estrutura de pastas, `core/` e
`db-schema.js` com migração v1→v2, aba Cadastros (Contas & Cartões, Formas de Pagamento,
Categorias), assistente de primeira execução, aba Lançamentos com forma de pagamento e
conta, importação do backup do app anterior, PWA publicada no Pages. Ao fim desta fase o
app já é utilizável em produção pelo usuário.

**Fase 2 — Importação, conciliação e memória.** Registro de adaptadores;
`santander-cartao-pdf` (parser atual migrado, medido contra as faturas Mastercard e
estendido onde falhar, com leitura de plástico titular/adicional, seções e período de
compras impresso); `santander-extrato-xls` novo; `generic-table`; `reconcile-card`
multi-cartão com a janela de três níveis; `reconcile-bank` completo com natureza automática
e vínculo fatura × débito; regra de registro único do pagamento de fatura;
`+ lançar em lote`; `classification.js` e a tela de Regras.

**Fase 3 — Dashboard, acabamento e documentação.** Filtros e tiles por forma e conta,
revisão visual dos gráficos, responsividade e dark mode, suíte de testes completa,
`MANUAL_USUARIO.md`, `DOCUMENTACAO_TECNICA.md` e `CONTEUDO_PROJETO.md`, deploy final.

Cada fase termina com a suíte de testes verde e verificação no navegador real antes da
entrega ao usuário.

## 13. Itens dependentes do usuário

1. **Uma fatura Mastercard com compra parcelada em várias vezes.** As três faturas
   fornecidas (05, 06 e 07/2026) não contêm nenhuma, então a grafia da coluna `Parcela` na
   diagramação Mastercard não pôde ser confirmada — só se sabe como a Visa a imprime
   (`NN/NN`). O parser trata a coluna de forma tolerante (`NN/NN`, vazio) e emite aviso ao
   encontrar um formato desconhecido, mas a confirmação depende de um documento real. Não
   bloqueia nada: faturas sem parcelamento são processadas normalmente.
2. **Confirmação do cadastro inicial** de contas e cartões no assistente de primeira
   execução (os dados não podem vir no código, por ser repositório público). São quatro
   plásticos identificados nos documentos: Visa titular e adicional, Mastercard titular e
   adicional, todos ligados à mesma conta corrente.
