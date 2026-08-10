# Conteúdo do Projeto — Livro de Gastos

Histórico do projeto, decisões de design importantes e pendências conhecidas. Atualizado até v11 (2026-08-10).

## Origem

O Livro de Gastos é o sucessor de um app anterior de conciliação de fatura de cartão de crédito (mesmo autor, mesmo repositório de projetos pessoais), que fica congelado como referência. A decisão de reescrever em vez de estender veio da necessidade de ampliar o escopo de "um cartão, uma fatura" para "qualquer forma de pagamento, várias contas e cartões, duas fontes de importação (fatura e extrato bancário)" — uma mudança de modelo de dados grande demais para caber incrementalmente na arquitetura anterior.

O design aprovado do projeto (spec original, 2026-07-29) preservou deliberadamente as partes do app anterior já validadas em produção com faturas reais: identidade de parcela por chave de texto, os dois namespaces de id (`seed_`/`confirmed_`), a janela de conciliação encadeada por data de corte, a folga de 3 dias no pool de candidatos (`POOL_SLACK_DAYS`), o checksum obrigatório na importação de fatura, e a busca da categoria fixa "A Classificar" sempre por id.

## Fase 1 — Fundação e cadastros

Entregou a base do app: estrutura de pastas em camadas (`core`/`domain`/`importers`/`ui`), o schema do IndexedDB (`db-schema.js`) com a migração v1→v2, a aba Cadastros (Contas & Cartões, Formas de Pagamento, Categorias), o assistente de primeira execução, e a aba Lançamentos já com os campos de forma de pagamento e conta. Ao fim desta fase o app já era utilizável em produção para lançamento manual de gastos.

**Decisão notável desta fase**: a migração de dados do app anterior por leitura ao vivo do IndexedDB dele (prevista na spec original, seção 5.7) foi removida do escopo por decisão direta do usuário em 2026-07-31 — ele optou por não trazer esse histórico automaticamente. O caminho de backup/restore via `.xlsx` (que já precisava existir de qualquer forma) cobre a necessidade real de continuidade entre instalações. `src/importers/legacy-idb.js` foi removido; a função de conversão `migrateV1ToV2` permanece em `db-schema.js` porque o importador de backup ainda a usa para ler arquivos `.xlsx` no formato antigo.

## Fase 2 — Importação, conciliação e memória

Entregou o registro de adaptadores de importação, o adaptador de fatura Santander em PDF (Visa e Mastercard, um único parser para as duas diagramações), o adaptador de extrato Santander em `.xls`, o adaptador genérico por mapeamento de colunas, a conciliação de fatura e de extrato completas, a regra de registro único do pagamento de fatura, o lançamento em lote a partir do extrato, e a memória de classificação com a tela de Regras.

### Isolamento por cartão (`plasticosDoTitular`, `domain/accounts.js`)

Uma fatura Santander pode conter os lançamentos de mais de um plástico — o cartão titular e seus adicionais, cada um com seu próprio bloco de despesas, mas debitados como um único valor consolidado na conta corrente. O modelo reflete isso deixando cada plástico como um registro próprio em `accounts`, com o adicional apontando para o titular via `cartaoPaiId`.

`plasticosDoTitular(titularId, todas)` resolve, a partir de qualquer id de plástico (titular ou adicional), o grupo completo titular+adicionais. A conciliação de fatura usa essa função para filtrar o pool de lançamentos candidatos apenas ao grupo do cartão daquela fatura — sem isso, o cartão Visa e o cartão Mastercard do mesmo titular confundiriam lançamentos entre si, já que ambos podem ter compras de valor e data próximos no mesmo período.

### Janela de conciliação de três níveis (`getReconciliationWindow`, `domain/reconcile-card.js`)

Para saber que período de compras uma fatura cobre, a conciliação usa três fontes possíveis, em ordem de precedência:

1. **Período impresso no PDF da fatura** — quando o documento traz o bloco com as faixas de data, a que termina exatamente na data de corte é usada como janela exata. É a fonte mais confiável, porque não depende de nada além do próprio documento.
2. **Encadeamento pela data de corte da fatura anterior** — usado quando o documento não traz o período impresso (por exemplo, faturas importadas via planilha genérica). É o comportamento original, herdado do app anterior e validado com faturas reais.
3. **Estimativa de 35 dias antes do corte** — último recurso, quando nem o período impresso nem a fatura anterior estão disponíveis.

A ordem existe porque o nível 1 é estritamente mais preciso que o 2 (não depende de a fatura anterior já ter sido importada) e elimina o único ponto em que a janela era só estimada; o nível 2 continua existindo porque nem todo documento traz o bloco de período, e é lógica já validada em produção — não se descarta o que funciona, se antecede por algo melhor quando disponível.

Ver seção "Lógica detalhada — conciliação de fatura" mais abaixo para o exemplo real com a tabela "Histórico de Faturas" e o passo a passo de casamento.

### Regra de registro único do pagamento de fatura (`domain/pagamento-fatura.js`)

O pagamento de uma fatura de cartão aparece documentado em até três lugares: o débito no extrato da conta corrente (o dinheiro saindo de fato), a linha de crédito na fatura seguinte do cartão (a quitação do saldo anterior), e a soma das compras da própria fatura paga (a dívida quitada). Sem uma regra explícita, importar as duas fontes (extrato e fatura seguinte) criaria dois lançamentos para o mesmo evento financeiro.

A regra adotada: o lançamento canônico é sempre o do **extrato**, porque é o único dos três que representa de fato uma movimentação de caixa. A linha correspondente vinda da fatura nunca cria um segundo lançamento — ela procura um lançamento existente por valor e data (com tolerância de poucos dias) e, se achar, apenas complementa o vínculo (`origemRef`) sem duplicar. O mecanismo funciona nas duas ordens de importação (extrato antes da fatura, ou fatura antes do extrato) porque a busca por um lançamento já existente é o mesmo teste, não importa qual fonte chegou primeiro.

## Fase 3 — Dashboard, acabamento e documentação

Entregou a aba Dashboard (até então um placeholder), o filtro por conta/cartão em Lançamentos, revisão de responsividade e modo escuro em todas as abas, o fechamento de lacunas de cobertura de teste, e os três documentos finais (este arquivo entre eles).

### Escopo do Dashboard, decidido com o usuário

O Dashboard replica o layout do app anterior — total do período, gráfico em rosca por categoria, barras mensais dos últimos meses com dado — acrescido de um filtro por forma de pagamento que não existia antes. Um gráfico adicional quebrado por forma de pagamento foi cogitado e descartado nesta fase por YAGNI ("You Aren't Gonna Need It"): não havia demanda concreta por ele, e adicionar uma visualização sem uso real conhecido só aumentaria a superfície de manutenção sem benefício comprovado. Pode ser retomado no futuro se a necessidade aparecer.

## Fase 4 — Correções pós-produção e endurecimento (2026-08-08 a 2026-08-10, v3→v11)

Sequência de investigações disparadas por uso real do app (não achados de revisão de código): bugs de conciliação de parcelas com múltiplas causas raiz empilhadas, backup corrompendo silenciosamente em documentos grandes, exportação de conciliação não cobrindo extrato bancário, e cadastro de conta padrão não oferecendo cartão para forma de crédito. Ver seção "Lições aprendidas" para o resumo do que essa fase ensinou sobre o processo de investigação em si.

### Aba Parcelas — três causas raiz do mesmo sintoma

O usuário relatou repetidamente "a aba Parcelas mostra o mês errado" após cada fix aparentemente completo. Três causas diferentes, descobertas em sequência:

1. **Offset de mês errado em `computeParcelaGroups`** (`domain/parcelas.js`) — a função é compartilhada por dois chamadores com necessidades opostas: `syncPredictions` (durante importação de fatura) precisa que a primeira previsão caia no MESMO mês civil do vencimento, para não deixar lacuna quando duas faturas vencem no mesmo mês civil; `parcelaGroupsDaConta` (aba Parcelas, a qualquer momento) precisa que a primeira parcela restante comece no mês SEGUINTE quando a âncora é uma transação já confirmada (mês já pago). Corrigido com o parâmetro `primeiraNoMesmoMes` — default `true` preserva o comportamento de importação, `parcelaGroupsDaConta` passa `false` quando a âncora é confirmada.
2. **Parcela 1/n lançada via "+lançar" nunca ganhava `faturaVencimento`** — o botão "+lançar" da Conciliação de fatura preenchia o rascunho do lançamento com a DATA DA COMPRA, não o vencimento real da fatura (só `autoConfirmParcelas`, usado na importação automática, gravava esse campo). Corrigido propagando `fatura.vencimento` pelo rascunho até a transação salva.
3. **Parcela 1/n nunca confirmada = âncora é uma previsão "adivinhada"** — por decisão de produto (ver abaixo), a parcela 1 de uma compra nova nunca é auto-confirmada; enquanto isso, a única "âncora" disponível para projetar as parcelas restantes é uma previsão sintética, sem vencimento real nenhum por trás. Não é bug: virou um aviso visual (`ancoraNaoConfirmada`) na aba Parcelas, orientando o usuário a confirmar a parcela 1 na Conciliação.

### Backup `.xlsx` — célula acima do limite do formato

O formato XLSX tem limite de 32.767 caracteres por célula. `statements.rows` de um extrato bancário com muitos lançamentos (cada linha carrega um campo `raw` com o texto bruto original, maior que o de uma linha de fatura) podia ultrapassar esse limite — o SheetJS lançava exceção na exportação sem nenhum tratamento de erro no botão, fazendo "Backup completo" parecer travado (clicar e nada acontecer). Pior: versões do app anteriores a este fix (pré-v5) tinham o mesmo problema mas o SheetJS **truncava a célula em silêncio ao escrever**, sem lançar erro — um backup exportado nessa janela de tempo tem o dado perdido de forma irrecuperável ao ser reimportado (vira uma string malformada em vez do array esperado). Corrigido dividindo valores grandes em colunas extras (`campo__2`, `campo__3`...) na exportação, remontadas na importação — e adicionando tratamento de erro visível no botão.

### Exportação "Conciliação completa" não cobria extrato bancário

`buildFullReconciliationRows` (a função por trás do botão) foi escrita cobrindo só conciliação de fatura — o nome do arquivo gerado (`conciliacao-fatura-*.xlsx`, antes do fix) já denunciava isso. Toda transação conciliada com um EXTRATO bancário aparecia como "Só no app", como se nunca tivesse sido casada com nada, mesmo estando corretamente conciliada na aba Conciliação. Corrigido com um segundo loop de casamento espelhando `runReconciliationBank`, incluindo a exclusão de transações de `origem: 'fatura'` do pool de candidatos (revisão final pegou essa lacuna: sem a exclusão, uma transação de fatura podia ser "roubada" por uma linha de extrato coincidente em valor/data). Nome do arquivo mudou para `conciliacao-completa-*.xlsx`.

### Conta padrão de forma de pagamento não oferecia cartão de crédito

O campo "Conta padrão" no cadastro de Formas de pagamento (`cadastros-formas.js`) tinha o filtro do combo fixo em `TIPO_CONTA` — nunca oferecia cartão, mesmo quando o tipo da forma era `credito`. A lógica de LEITURA (`contaPadraoValidaParaForma`, usada no formulário de Lançamentos) já estava preparada para o caso; só a tela de EDIÇÃO da forma nunca ofereceu cartão como opção. Corrigido reusando `tipoContaParaForma` para filtrar dinamicamente, com o combo se reconstruindo ao vivo quando o usuário troca o tipo no mesmo formulário aberto.

## Lógica detalhada — Conciliação de fatura (datas e períodos)

### Vocabulário

| Termo | Significado |
|---|---|
| **Vencimento** | Data em que a fatura vence (paga). Extraído do texto do PDF (`vencimentoFromText`). |
| **Data de corte** (`dataCorte`) | Data limite de compras incluídas NESTA fatura — compras depois disso caem na PRÓXIMA. |
| **Período de compras** (`periodoCompras`) | Faixa impressa na própria fatura ("24/04/26 a 25/05/26") — é o dado MAIS preciso disponível, quando existe. |

### Exemplo real (fatura de vencimento 30/05), tabela "Histórico de Faturas"

```
MAR.  R$ 7.416,70   R$7.416,70   24/02/26 a 23/03/26   ← fatura de março (já paga)
ABR.  R$ 6.620,20   R$6.620,22   24/03/26 a 23/04/26   ← fatura de abril (já paga)
MAI.  R$ 4.728,63   Esta Fatura  24/04/26 a 25/05/26   ← A FATURA ATUAL (vence 30/05)
JUN.  R$   947,00   Fatura Aberta 26/05/26 a 23/06/26  ← próxima fatura, ainda abrindo
```

O PDF da fatura de vencimento 30/05 imprime essas 4 faixas "DD/MM/AA a DD/MM/AA" logo no topo. `extrairPeriodoCompras` (`santander-cartao-pdf-datas.js`) varre essas linhas e escolhe a faixa cujo **fim bate exatamente com a `dataCorte`** já extraída dessa mesma fatura — ou seja, para a fatura de 30/05, pega a linha "MAI." (`24/04/26 a 25/05/26`), não as outras 3.

### Janela de conciliação — 3 níveis de precisão (`getReconciliationWindow`)

```
Nível 1 (periodo_impresso)   Nível 2 (encadeamento)         Nível 3 (estimativa)
  ├─ fatura.periodoCompras     ├─ dataCorte da FATURA          ├─ dataCorte atual
  │  já extraído do PDF        │  ANTERIOR (já importada)      │  menos 35 dias
  │  desta própria fatura      │  + 1 dia = início              │  (nenhuma fatura
  │  = MAIS PRECISO            │  dataCorte desta = fim         │  anterior disponível)
  └─ vence sempre que existe   └─ só se fatura anterior         └─ último recurso
                                  foi importada
```

Cada nível só é usado se o anterior não estiver disponível — nível 1 vence sempre que existir (não depende de nenhuma outra fatura já importada). `getPoolWindow` adiciona ±3 dias de folga (`POOL_SLACK_DAYS`) na janela final, pra tolerar pequena divergência entre a data que o banco imprime e a data real do lançamento no app.

### Casamento (matching) — como uma linha de fatura vira "Conciliado"

```
Para cada linha da fatura (exceto "pagamentos_creditos"):
  SE é parcelamento (tipo === 'parcelamento'):
    1º tenta achar por parcelaKey (identidade da compra) + data mais próxima do vencimento
    2º fallback: mesmo valor, dentro da janela de datas do cartão
  SENÃO (compra avulsa):
    valor bate (diferença < R$0,01) E data dentro de 2 dias E dentro da janela do cartão

  SE achou par não usado ainda:
    → "Conciliado" (manual) ou "Conciliado (automático)" (se conciliadoAutomaticamente=true)
  SENÃO:
    → "Só na fatura" (usuário precisa "+lançar")

Sobra no pool (app) sem casar E dentro da janela:
    → "Só no app"
```

O pool de transações candidatas é restrito por `plasticosDoTitular` (titular + seus adicionais) — nunca mistura cartões diferentes.

### Conciliação de extrato bancário (`reconcile-bank.js`) — diferente de fatura

1. `atribuirNatureza` classifica cada linha do extrato ANTES de qualquer casamento, por ordem de precedência: `pagamento_fatura` (bate matcher de cartão + é débito) > `transferencia` (bate matcher de outra conta própria/apelido do titular) > `receita` (crédito sem matcher) > `despesa` (default).
2. Pool = transações não-previstas com `origem !== 'fatura'` (parcela confirmada/pagamento de fatura pertence SÓ à conciliação de fatura, nunca pode ser "roubada" aqui).
3. Casamento: valor bate + data dentro de 2 dias + mesma conta (ou sem conta definida).

### Pagamento de fatura — evento único, visto por dois lados

O mesmo pagamento aparece no EXTRATO (débito saindo da conta) e na FATURA seguinte (linha "pagamentos_creditos"). `processarPagamentoFatura` (`pagamento-fatura.js`) usa valor+data (tolerância 2 dias) pra reconhecer que é o MESMO evento, não importa qual lado chegou primeiro — o segundo lado a chegar só complementa `origemRef`, nunca duplica o lançamento.

## Fluxo entre abas e origens de dado

```
                    ┌─────────────────────────────────────────────┐
                    │              IndexedDB (storage.js)          │
                    │  transactions · accounts · paymentMethods ·  │
                    │  categories · statements · classificationRules│
                    └───────────────┬───────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────────┐
        │                            │                                │
   ORIGEM: manual              ORIGEM: fatura                  ORIGEM: extrato
        │                            │                                │
┌───────▼────────┐         ┌────────▼─────────┐            ┌─────────▼──────────┐
│ aba Lançamentos │         │ aba Conciliação   │            │ aba Conciliação     │
│ (formulário      │         │  → sub-fluxo      │            │  → sub-fluxo         │
│  direto ou        │         │    "Fatura"        │            │    "Extrato"          │
│  "+lançar" vindo   │◄────────┤                     │            │                        │
│  de um balde        │  botão  │ importa PDF          │            │ importa .xls           │
│  "não lançado")      │ +lançar│  (santander-*-pdf)    │            │  (santander-extrato)    │
└───────┬────────────┘         │                          │            │  ou genérico (mapeado  │
        │                       │ autoConfirmParcelas:      │            │   manualmente)          │
        │                       │  parcela_atual>1 confirma  │            │                          │
        │                       │  sozinha; parcela 1/n NUNCA │            │ atribuirNatureza →       │
        │                       │  (exige revisão manual)      │            │  pagamento_fatura/       │
        │                       │                                │            │  transferencia/receita/  │
        │                       │ syncPredictions: gera         │            │  despesa                 │
        │                       │  previsão (previsto:true)      │            │                          │
        │                       │  das parcelas restantes          │            │ runReconciliationBank:  │
        │                       │                                    │            │  4 baldes (Conciliado   │
        │                       │ runReconciliation: 4 baldes         │            │  auto/manual, Não       │
        │                       │  (Conciliado auto/manual, Só na       │            │  lançado, Só no app)    │
        │                       │  fatura, Só no app)                    │            │                          │
        │                       └────────────┬───────────────────────────┘            └──────────┬───────────────┘
        │                                     │                                                    │
        │                                     └──────────────────┬─────────────────────────────────┘
        │                                                        │
        │                                          ┌─────────────▼──────────────┐
        │                                          │ buildFullReconciliationRows  │
        │                                          │ (export "Conciliação completa"│
        │                                          │  .xlsx — cobre fatura+extrato) │
        │                                          └─────────────────────────────┘
        │
┌───────▼─────────┐    ┌──────────────────┐    ┌───────────────┐    ┌─────────────┐
│ aba Parcelas      │    │ aba Dashboard      │    │ Cadastros       │    │ Backup       │
│ (parcelaGroupsDa   │    │ (totais, categoria,│    │ (contas, formas,│    │ (export/     │
│  Conta — só leitura│    │  mês — só leitura   │    │  categorias,     │    │  import       │
│  de transactions)   │    │  de transactions)    │    │  regras)          │    │  .xlsx        │
└────────────────────┘    └────────────────────┘    └──────────────────┘    │  completo)   │
                                                                              └─────────────┘
```

## Decisões críticas de design (para não reverter sem querer)

- **Regra de ouro (`transactions.js:contaComoGasto`)**: só `natureza === 'despesa' && !previsto` soma como gasto. Nunca reimplementar essa checagem em outro lugar — sempre importar `contaComoGasto`.
- **`APP_VERSION` (`src/version.js`) precisa subir a CADA publicação que muda comportamento visível.** O nome do cache do service worker vem daqui; sem bump, o navegador do usuário continua servindo JS velho do cache mesmo depois do `git push`. Esquecer isso causou reincidência do MESMO sintoma reportado como "bug" pelo menos 4 vezes na Fase 4 — sempre desconfiar de "o fix não funcionou" antes de reinvestigar lógica.
- **`faturaVencimento` é separado de `data`**: uma transação confirmada por fatura grava `faturaVencimento` (vencimento real) SEPARADO de `data` (que guarda `dataCorte`, usado para exibição). Usar `data` como vencimento em qualquer projeção de parcela futura é a causa raiz que já apareceu 3 formas diferentes (ver Fase 4).
- **`autoConfirmParcelas` nunca confirma sozinha a parcela 1/n de uma compra nova.** Proposital: força o usuário a revisar categoria/forma antes de virar lançamento real (via "+ lançar" na Conciliação). Não é bug — não "corrigir" sem perguntar.
- **Sem migração retroativa em dado já salvo.** Toda correção de campo (ex.: `faturaVencimento`) usa fallback pro campo antigo (`t.faturaVencimento || t.data`) em vez de reescrever histórico.
- **`buildFullReconciliationRows` precisa espelhar `runReconciliation`/`runReconciliationBank`.** Já divergiu 2 vezes por ter sido escrita separada. Ao alterar uma, checar a outra.
- **Backup `.xlsx` com célula > 32767 caracteres**: dividir em colunas extras (`campo__2`...), nunca truncar nem falhar em silêncio.
- **Repositório é PÚBLICO.** Nenhum dado pessoal em código, teste, fixture ou log de auditoria.
- **`origem` da transação é o discriminador de proveniência** (`'manual'` | `'fatura'` | implícito extrato) — impede que exportação/conciliação "roube" uma transação da fonte errada.

## Lições aprendidas (Fase 4, sessão 2026-08-08/10, v3→v11)

- **"O fix não funcionou" quase sempre era cache, não código.** 4 ocorrências do mesmo padrão: código corrigido e testado, publicado, usuário reporta que continua igual → causa real era `APP_VERSION` não bumpado. Diagnóstico correto: conferir a versão exibida em Cadastros → Backup ANTES de reinvestigar lógica.
- **Não confiar em reprodução sintética quando o dado real está disponível.** Vários bugs (parcela 1/n nunca confirmada, backup truncado por versão antiga) só foram encontrados pedindo ao usuário um dump técnico real (console/DevTools) — testes sintéticos "razoáveis" não reproduziam por não bater com a forma exata dos dados de produção.
- **Um mesmo sintoma pode ter múltiplas causas raiz empilhadas.** "Parcela mostrando mês errado" teve 3 causas diferentes em sequência (ver Fase 4). Corrigir a primeira causa encontrada não significa que o sintoma sumiu — sempre re-testar com o cenário exato do usuário depois de cada fix.
- **Lógica duplicada entre tela e exportação diverge silenciosamente.** Toda vez que uma tela e uma exportação fazem "a mesma coisa" (conciliação ao vivo vs. `buildFullReconciliationRows`), extrair função compartilhada ou testar as duas juntas.
- **DevTools remoto via USB é frágil para depuração ao vivo em Android.** Quando precisar diagnosticar algo que só acontece no aparelho do usuário, preferir adicionar uma tela/botão de diagnóstico temporário no próprio app (visível sem cabo) a insistir em `chrome://inspect`.
- **Erro engolido em silêncio (catch vazio) esconde a causa raiz.** Toda função que pode falhar de forma não prevista deveria expor o erro (toast + mensagem na tela), nunca falhar mudo.
- **Decisão de produto pode parecer bug.** Antes de "corrigir" um comportamento estranho, confirmar com o usuário se é intencional — o fix certo pode ser um AVISO na UI, não mudar a regra.

## Pendências conhecidas, fora de escopo

Registradas aqui com o motivo de terem ficado de fora, para não serem confundidas com esquecimento:

- **Gráfico de gastos quebrado por forma de pagamento no Dashboard** — cogitado e descartado na Fase 3 por YAGNI. O agregador de dados (`totaisPorForma`) já existe em `domain/transactions.js` desde a Fase 1; falta só a visualização.
- **Sincronização entre aparelhos** — decisão de design da spec original: o app é deliberadamente local-only, sem servidor. A única ponte entre instalações é o backup `.xlsx` manual.
- **Identidade de parcela por texto exato (`parcelaKey`)** — herdada do app anterior; é uma solução heurística (descrição normalizada + data + total de parcelas), não uma chave garantidamente única. Mudar esse mecanismo quebraria a identidade de parcelas já gravadas em produção.
- **Confirmação da grafia da coluna de parcela em faturas Mastercard** — o parser foi medido apenas contra documentos reais sem compra parcelada em várias vezes na diagramação Mastercard (só a Visa foi confirmada). Não bloqueia uso normal.
- **Botão "Diagnóstico" temporário em `cadastros-formas.js`/`cadastros-backup.js`** (`diagnosticoStatements`) — adicionado 2026-08-08 para investigar o bug de extrato truncado no celular, marcado `TEMPORARIO` no comentário, ainda não removido.
- **Desempate de casamento em `buildFullReconciliationRows` (loop de extrato)** não usa similaridade de descrição como `runReconciliationBank` usa — pode escolher um par diferente do que a tela mostraria em caso de ambiguidade. Marcado Minor/opcional na última revisão, não implementado.
- **`buildFullReconciliationRows` recebe `accounts`/`apelidosTitular` sem usar** dentro do corpo, após remoção de um loop morto — parâmetros mortos, cosmético, sem risco funcional.
- **Sem teste automatizado de UI para arquivos `cadastros-*.js`** — validação hoje é só manual/visual via Playwright ad-hoc quando investigado.

## Estado da suíte de testes

A suíte roda em dois alvos a partir dos mesmos arquivos de teste (ver `DOCUMENTACAO_TECNICA.md`): `node tools/run-tests.mjs` para a lógica pura (424 testes em v11), e `tools/tests.html` (aberto via `localhost`) para os testes que dependem de navegador. Cobre, entre outras áreas: identidade e auto-confirmação de parcelas, os três níveis de janela de conciliação de fatura, atribuição de natureza e casamento na conciliação de extrato e de fatura, a regra de registro único do pagamento de fatura nas duas ordens de importação possíveis, a canonicalização e precedência da memória de classificação, os parsers de fatura e extrato Santander contra fixtures anonimizadas, a migração v1→v2, e o ciclo completo de backup (incluindo divisão/remontagem de célula grande).
