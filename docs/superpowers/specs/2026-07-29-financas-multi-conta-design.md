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
│   │   │   ├── santander-visa-pdf.js
│   │   │   ├── santander-extrato-xls.js
│   │   │   ├── generic-table.js     CSV/XLS com mapeamento de colunas
│   │   │   └── backup-xlsx.js       backup/restore + conversor do schema v1
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

## 5. Modelo de dados (IndexedDB `livro-de-gastos`, schema v2)

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
| `matchers` | array de padrões que identificam a conta/cartão na descrição do extrato (ex.: `FINAL 0000`). Ao cadastrar um cartão, o app **sugere** o matcher a partir de `bandeira` e `final`; a lista é editável, porque a grafia varia entre bancos |
| `mapeamentoImportacao` | mapeamento de colunas salvo para o importador genérico |
| `cor`, `ativo` | apresentação e desativação sem exclusão |

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

Executada no `openDB` por `db-schema.js` e também pelo importador de backup:

- `expenses` → `transactions` com `natureza:'despesa'`, `origem:'manual'`, forma "Cartão de
  Crédito" e `contaId` do cartão escolhido no assistente de migração.
- `faturas` → `statements` com `tipo:'fatura'` e o mesmo `contaId`.
- Ids preservados literalmente (`seed_*`, `confirmed_*`), para que a cadeia de parcelas de
  09/2025 a 06/2026 continue conciliando.

O caminho recomendado ao usuário é: app atual → "Backup completo (.xlsx)" → app novo →
"Importar backup", porque as duas instalações têm origens diferentes e não compartilham
IndexedDB.

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
| `santander-visa-pdf` | fatura Visa em PDF | é o `pdf-parser.js` atual, movido sem alteração de lógica |
| `santander-extrato-xls` | extrato de conta corrente `.xls` | novo — formato descrito abaixo |
| `generic-table` | CSV/XLS de qualquer banco | mapeamento de colunas definido pelo usuário e salvo em `accounts.mapeamentoImportacao` |
| fatura Mastercard | — | **bloqueado**: falta arquivo de exemplo. Atendido pelo `generic-table` até lá |

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

## 7. Conciliação

### 7.1 Fatura (`reconcile-card.js`)

Fluxo atual preservado integralmente: preview com checksum, quatro baldes (conciliado
automático, conciliado manual, só na fatura, só no app), auto-confirmação de parcelas por
identidade, janela por `dataCorte` encadeada, pool alargado em 3 dias.

Única mudança: o pool de candidatos passa a ser **filtrado pelo `contaId` do cartão**, o
que permite vários cartões conviverem sem confundir lançamentos entre si.

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
inclusive no celular. Cobertura pretendida:

- `parcelas.test.js` — casos já validados em produção: parcela 1 exige `+ lançar`; parcela
  maior que 1 auto-confirma mesmo sem previsão candidata; namespace de id separado impede
  que a regeneração de previsões apague uma confirmação; `addMonths` preserva o dia sem
  estourar o mês.
- `reconcile-card.test.js` — janela por `dataCorte` encadeada, `POOL_SLACK_DAYS`, balde "só
  no app" restrito à janela oficial, isolamento entre cartões diferentes.
- `reconcile-bank.test.js` — atribuição de natureza nos quatro casos, casamento por
  valor/data/conta, idempotência do hash em reimportação sobreposta, confronto fatura ×
  débito.
- `classification.test.js` — canonicalização (cada uma das 6 etapas), precedência das cinco
  categorias de regra, aprendizado sobrescrevendo regra anterior.
- `importers.test.js` — parser do extrato contra fixture anonimizada, parser da fatura
  contra fixture de texto já extraído, pontuação de `detectar`.
- `migration.test.js` — conversão v1 → v2 preservando ids e cadeia de parcelas.

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

**Fase 2 — Importação, conciliação e memória.** Registro de adaptadores,
`santander-visa-pdf` migrado, `santander-extrato-xls` novo, `generic-table`,
`reconcile-card` multi-cartão, `reconcile-bank` completo com natureza automática e vínculo
fatura × débito, `+ lançar em lote`, `classification.js` e a tela de Regras.

**Fase 3 — Dashboard, acabamento e documentação.** Filtros e tiles por forma e conta,
revisão visual dos gráficos, responsividade e dark mode, suíte de testes completa,
`MANUAL_USUARIO.md`, `DOCUMENTACAO_TECNICA.md` e `CONTEUDO_PROJETO.md`, deploy final.

Cada fase termina com a suíte de testes verde e verificação no navegador real antes da
entrega ao usuário.

## 13. Itens dependentes do usuário

1. **PDF da fatura Mastercard (final 0000)** — necessário para o adaptador dedicado. Até
   lá, o cartão é atendido pelo importador genérico.
2. **Confirmação do cadastro inicial** de contas e cartões no assistente de primeira
   execução (os dados não podem vir no código, por ser repositório público).
