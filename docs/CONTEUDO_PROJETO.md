# Conteúdo do Projeto — Livro de Gastos

Histórico do projeto, decisões de design importantes e pendências conhecidas fora de escopo.

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

### Regra de registro único do pagamento de fatura (`domain/pagamento-fatura.js`)

O pagamento de uma fatura de cartão aparece documentado em até três lugares: o débito no extrato da conta corrente (o dinheiro saindo de fato), a linha de crédito na fatura seguinte do cartão (a quitação do saldo anterior), e a soma das compras da própria fatura paga (a dívida quitada). Sem uma regra explícita, importar as duas fontes (extrato e fatura seguinte) criaria dois lançamentos para o mesmo evento financeiro.

A regra adotada: o lançamento canônico é sempre o do **extrato**, porque é o único dos três que representa de fato uma movimentação de caixa. A linha correspondente vinda da fatura nunca cria um segundo lançamento — ela procura um lançamento existente por valor e data (com tolerância de poucos dias) e, se achar, apenas complementa o vínculo (`origemRef`) sem duplicar. O mecanismo funciona nas duas ordens de importação (extrato antes da fatura, ou fatura antes do extrato) porque a busca por um lançamento já existente é o mesmo teste, não importa qual fonte chegou primeiro.

## Fase 3 — Dashboard, acabamento e documentação

Entregou a aba Dashboard (até então um placeholder), o filtro por conta/cartão em Lançamentos, revisão de responsividade e modo escuro em todas as abas, o fechamento de lacunas de cobertura de teste, e os três documentos finais (este arquivo entre eles).

### Escopo do Dashboard, decidido com o usuário

O Dashboard replica o layout do app anterior — total do período, gráfico em rosca por categoria, barras mensais dos últimos meses com dado — acrescido de um filtro por forma de pagamento que não existia antes. Um gráfico adicional quebrado por forma de pagamento foi cogitado e descartado nesta fase por YAGNI ("You Aren't Gonna Need It"): não havia demanda concreta por ele, e adicionar uma visualização sem uso real conhecido só aumentaria a superfície de manutenção sem benefício comprovado. Pode ser retomado no futuro se a necessidade aparecer.

## Pendências conhecidas, fora de escopo

Registradas aqui com o motivo de terem ficado de fora, para não serem confundidas com esquecimento:

- **Gráfico de gastos quebrado por forma de pagamento no Dashboard** — cogitado e descartado na Fase 3 por YAGN (ver acima). O agregador de dados (`totaisPorForma`) já existe em `domain/transactions.js` desde a Fase 1 e é usado no tile de total por forma; falta só a visualização, que pode ser adicionada depois sem mudança de modelo de dados.
- **Sincronização entre aparelhos** — decisão de design da spec original: o app é deliberadamente local-only, sem servidor. A única ponte entre instalações é o backup `.xlsx` manual, que carrega um `schemaVersion` para o app poder avisar quando um arquivo estiver desatualizado.
- **Identidade de parcela por texto exato (`parcelaKey`)** — herdada do app anterior; é uma solução heurística (descrição normalizada + data + total de parcelas), não uma chave garantidamente única. `origemRef` (vínculo direto a uma linha de documento importado) reduz a dependência dela para lançamentos que vieram de importação, mas lançamentos manuais parcelados continuam usando `parcelaKey` como está — mudar esse mecanismo quebraria a identidade de parcelas já gravadas em produção, então não foi alterado.
- **Confirmação da grafia da coluna de parcela em faturas Mastercard** — o parser de fatura foi medido apenas contra documentos reais sem nenhuma compra parcelada em várias vezes na diagramação Mastercard (só a Visa pôde ser confirmada). O parser trata a coluna de forma tolerante e emite aviso ao encontrar um formato desconhecido, mas a confirmação definitiva depende de um documento real que ainda não existiu. Não bloqueia o uso normal: faturas sem parcelamento são processadas sem problema.

## Estado da suíte de testes

A suíte roda em dois alvos a partir dos mesmos arquivos de teste (ver `DOCUMENTACAO_TECNICA.md`): `node tools/run-tests.mjs` para a lógica pura, e `tools/tests.html` (aberto via `localhost`) para os testes que dependem de navegador. Cobre, entre outras áreas: identidade e auto-confirmação de parcelas, os três níveis de janela de conciliação de fatura, atribuição de natureza e casamento na conciliação de extrato, a regra de registro único do pagamento de fatura nas duas ordens de importação possíveis, a canonicalização e precedência da memória de classificação, os parsers de fatura e extrato Santander contra fixtures anonimizadas, e a migração v1→v2.
