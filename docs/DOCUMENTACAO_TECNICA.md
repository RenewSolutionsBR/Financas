# Documentação Técnica — Livro de Gastos

Este documento descreve a arquitetura do app para quem for ler, manter ou estender o código.

## Visão geral

Vanilla JS (ES modules nativos do navegador), zero build step, zero dependências de runtime além das bibliotecas vendorizadas em `vendor/` (SheetJS para planilhas, PDF.js para extração de texto de PDF). PWA offline-first com service worker versionado (`sw.js`, `src/version.js` como fonte única da versão de cache).

Todos os dados ficam em IndexedDB, no navegador do próprio usuário. Não há backend, não há sincronização entre aparelhos — a única ponte entre instalações é o backup `.xlsx` manual (`src/importers/backup-xlsx.js`).

## Arquitetura em camadas

O código-fonte (`src/`) é dividido em quatro camadas, cada uma com uma responsabilidade única:

```
src/
├── core/        infraestrutura genérica, sem regra de negócio
├── domain/      regras de negócio, puras sempre que possível
├── importers/   adaptadores de leitura de arquivos externos
└── ui/          telas: montam DOM e orquestram chamadas ao domínio
```

**`core/`** — utilitários sem conhecimento do domínio financeiro: formatação de datas e valores monetários (`dates.js`, `money.js`), geração de identificadores (`ids.js`), normalização de texto (`text.js`), o wrapper de acesso ao IndexedDB (`storage.js`) e a descrição do schema do banco (`db-schema.js`). `storage.js` é a **única** porta de entrada do IndexedDB no projeto — nenhum outro módulo, nem em `domain/`, nem em `ui/`, toca `indexedDB` diretamente. Isso mantém a lógica de transação, rollback e reabertura de conexão concentrada num único lugar.

**`domain/`** — as regras do negócio: contas e cartões (`accounts.js`), formas de pagamento (`payment-methods.js`), categorias (`categories.js`), lançamentos (`transactions.js`), parcelas (`parcelas.js`), memória de classificação (`classification.js`), conciliação de fatura (`reconcile-card.js`) e de extrato (`reconcile-bank.js`), e a regra de registro único do pagamento de fatura (`pagamento-fatura.js`). A maior parte destes módulos é **pura**: recebe dados, devolve dados, não importa `storage.js` no corpo da lógica de decisão — só as funções de persistência no fim de cada arquivo (`list*`, `save*`, `remove*`) tocam o banco. Essa pureza é o que permite testar a lógica financeira inteira no Node, sem abrir navegador.

**`importers/`** — um adaptador por formato de arquivo (fatura Santander em PDF, extrato Santander em `.xls`, tabela genérica com mapeamento de colunas pelo usuário, backup `.xlsx`). Todo adaptador devolve linhas num formato normalizado único (documentado no topo de `importers/registry.js`), de forma que a conciliação e a UI nunca precisem saber de qual banco ou tipo de documento uma linha veio. Adicionar suporte a um banco novo é criar um arquivo em `importers/` e chamar `register()` — não exige tocar em `domain/` nem em `ui/`. Dentro de cada adaptador, a parte de *parsing* de texto/planilha já extraído é pura e testável em Node; só a extração bruta do PDF ou da planilha (que depende das bibliotecas vendorizadas) roda exclusivamente no navegador.

**`ui/`** — uma tela por aba (`lancamentos.js`, `conciliacao.js` e seus módulos-satélite, `parcelas.js`, `dashboard.js`, `cadastros.js` e suas seções). Cada tela monta o DOM, lê e grava dados chamando as funções de persistência do domínio, e delega toda validação e regra de negócio para `domain/`. Nenhuma regra de negócio deve morar aqui.

A regra de dependência entre camadas é direcional: `domain/` nunca importa de `ui/`; `ui/` orquestra, `domain/` decide, `core/` serve os dois.

### Por que essa separação existe

O app anterior a este projeto concentrava UI, handlers de evento, exportação de planilha e lógica de parcelamento num único arquivo de quase mil linhas. A divisão em camadas existe para que cada arquivo tenha um propósito único, caiba na cabeça de quem o lê, e sobretudo para que a lógica financeira (a parte onde um erro custa dinheiro real do usuário) possa ser testada fora do navegador, em Node, sem precisar simular DOM ou IndexedDB.

## Schema do IndexedDB (`core/db-schema.js`)

Banco `financas`, versão de schema `2` (constantes `DB_NAME`/`DB_VERSION`). `core/db-schema.js` é um módulo **puro**: não abre banco, não toca IndexedDB — só descreve o schema e converte dados de uma versão para outra. Isso permite testar a migração inteira no Node.

Stores (todas com `keyPath: 'id'`, exceto `meta` que usa `key`):

| Store | Índices | Descrição |
|---|---|---|
| `transactions` | `by_data`, `by_parcelaKey`, `by_contaId` | lançamento unificado: despesa, receita, transferência ou pagamento de fatura |
| `accounts` | — | contas correntes e cartões (titulares e adicionais) |
| `paymentMethods` | — | formas de pagamento cadastradas pelo usuário |
| `categories` | — | categorias de gasto |
| `statements` | `by_contaId`, `by_tipo` | documento importado: fatura ou extrato, com as linhas normalizadas em `rows[]` |
| `classificationRules` | `by_padrao` | regras da memória de classificação |
| `meta` | — | pares chave/valor de configuração (ex.: `onboardingConcluido`, `apelidosTitular`) |

A abertura do banco e todo `get`/`put`/`delete`/`clear` passam por `core/storage.js`, inclusive as gravações multi-store atômicas (`putManyAcrossStores`, usada por exemplo na migração de backup, que grava `categories`/`transactions`/`statements`/`meta` numa única transação — ou tudo entra, ou nada entra).

### Migração v1 → v2

`migrateV1ToV2` em `db-schema.js` converte o formato de um app anterior (stores `expenses`/`faturas`) para o schema atual. É usada hoje apenas pelo importador de backup `.xlsx` no formato antigo (`importers/backup-xlsx.js`), não por uma leitura ao vivo de outro banco — esse caminho foi removido do escopo por decisão de produto (ver `CONTEUDO_PROJETO.md`). A função é pura, idempotente (ids preservados, uma segunda gravação sobrescreve em vez de duplicar) e nunca descarta um registro sem gerar um aviso explicável ao usuário.

## Convenções de identificador

Definidas em `core/ids.js`:

- **`uid(prefixo)`** — gera um id não determinístico (`prefixo_<tempo em base36><acaso>`), usado para a maioria dos registros novos criados pelo usuário (`tx_`, `acc_`, `pm_`, `cat_`, `rule_`, `grp_`).
- **`stableHash(partes)`** — hash determinístico (FNV-1a) de uma lista de valores, usado para gerar ids **idempotentes**: reimportar o mesmo documento produz o mesmo id de linha, então a importação nunca duplica.
- **`slugId(s)`** — normaliza uma string para um id legível, substituindo qualquer caractere fora de `[a-zA-Z0-9]` por `_`.

Além desses, `domain/parcelas.js` usa dois **namespaces de id fixos**, sem `uid()`, porque o valor previsível é a própria função do namespace:

- **`seed_<...>`** — previsão de parcela futura, gerada por `syncPredictions`. O id é derivado de descrição + valor + mês (não de `uid()`), porque a função recria as previsões do zero a cada chamada (limpando as antigas via `previsto && !origemManual`) e precisa que a mesma parcela futura sempre caia no mesmo id — senão a "recriação" viraria duplicação a cada fatura importada.
- **`confirmed_<...>`** — confirmação de parcela por `autoConfirmParcelas`, quando uma linha de fatura corresponde a uma parcela antes prevista (ou a uma parcela real sem previsão candidata, quando `parcela_atual > 1`). O namespace distinto de `seed_` é o que impede a regeneração de previsões (que só mexe em `seed_*`) de apagar uma confirmação já existente.

## A regra de ouro dos totais

Em `domain/transactions.js`:

```js
export function contaComoGasto(t) {
  return t.natureza === 'despesa' && !t.previsto;
}
```

Todo agregador de "gasto" do sistema — `sumDespesas`, `totaisPorForma`, `totaisPorCategoria`, `totaisPorMes` — filtra por esta função antes de somar qualquer coisa. Ela é a única definição de "isso conta como gasto" no projeto; nenhum outro lugar reimplementa esse critério.

O motivo de existir: um mesmo evento financeiro pode aparecer em mais de um lugar (a compra no cartão e o pagamento da fatura dela, por exemplo, ou o débito no extrato e a linha de crédito correspondente na fatura seguinte — ver `pagamento-fatura.js` e a seção 7.3 da spec original). `natureza` distingue despesa de receita, transferência entre contas próprias e pagamento de fatura; `previsto` distingue uma parcela futura ainda não confirmada de um gasto já efetivado. Sem os dois filtros juntos, o mesmo dinheiro seria contado duas vezes, ou uma parcela ainda não cobrada apareceria somada como se já tivesse acontecido.

`t.valor` é sempre armazenado positivo — o sentido (entra/sai) vem inteiramente de `natureza`, nunca do sinal do número.

## Como rodar os testes

Os arquivos de teste (`tests/*.test.js`) rodam em dois alvos, sem duplicação de código:

- **Linha de comando (Node)**: `node tools/run-tests.mjs`. Roda todos os módulos de `tests/index.js` listados em `TEST_MODULES` — a lógica pura, que não importa IndexedDB nem DOM. Termina com código de saída `0` se tudo passar, `1` se houver falha, e imprime quantos módulos são "só de navegador" e não rodaram por esse caminho.
- **Navegador**: abrir `tools/tests.html` por um servidor local (`http://localhost` ou `127.0.0.1`). Além dos módulos de Node, roda também os módulos `BROWSER_ONLY_MODULES` (os que precisam de DOM real ou do SheetJS vendorizado, como o ciclo completo de exportar/importar backup). Por segurança, a suíte se recusa a rodar fora de `localhost`/`127.0.0.1` — ela grava e apaga dados de verdade no IndexedDB da origem em que é aberta, e como este arquivo é servido pelo GitHub Pages a partir da raiz do repositório, essa é a mesma origem onde o usuário guarda os dados reais dele.

Por que dois alvos: a divisão entre lógica pura (roda nos dois) e a camada fina de persistência/UI por cima (só no navegador) é a mesma fronteira arquitetural de `domain/`/`core/`/`ui/`, aplicada de forma verificável — sem um comando de linha de comando, cada alteração de lógica dependeria de abrir o navegador e conferir manualmente.

## Convenções gerais do código

- Datas circulam internamente sempre em ISO (`YYYY-MM-DD`); a conversão para `DD/MM/AAAA` acontece só na camada `ui/`.
- Valores monetários são sempre números positivos com duas casas decimais (`core/money.js: round2`); o sinal/sentido vem da `natureza` do lançamento.
- Nenhum arquivo deve passar de aproximadamente 250 linhas — arquivos maiores são divididos em módulos satélite (ex.: `conciliacao.js` delega para `conciliacao-import.js`, `conciliacao-fatura.js`, `conciliacao-extrato.js`).
- Gráficos são CSS puro (`conic-gradient` para a rosca, `<div>`s com altura/largura proporcional para as barras) — não há biblioteca de gráficos como dependência.
- Comentários e identificadores de conceito de negócio ficam em português; termos técnicos consagrados (ex. "IndexedDB", "hash") permanecem em inglês.
