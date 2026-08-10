# CONTEUDO_PROJETO.md — Memory Bank

> Atualizado até v11 (2026-08-10). Ler este arquivo primeiro, antes de reler código.

## 1. OBJETIVO DO APP

Controle financeiro pessoal offline-first (PWA) que importa faturas de cartão e extratos bancários, concilia automaticamente contra lançamentos, e projeta parcelas futuras — sem enviar dado nenhum a servidor externo.

## 2. STACK TECNOLÓGICA

- JavaScript vanilla, ES modules nativos do navegador. **Zero build step, zero framework, zero dependência de runtime instalada via npm** (não há `package.json`).
- Persistência: IndexedDB direto (sem wrapper), schema em `src/core/db-schema.js`, `DB_VERSION = 3`.
- PWA: `sw.js` (service worker, cache offline-first) + `manifest.webmanifest`.
- Bibliotecas vendorizadas em `vendor/` (arquivo baixado e comitado, não npm):
  - `pdf.min.mjs` / `pdf.worker.min.mjs` — pdf.js, extração de texto de fatura PDF.
  - `xlsx.full.min.js` — SheetJS, leitura de extrato `.xls` e backup/export `.xlsx`.
- Testes: runner próprio em `tools/run-tests.mjs` (Node, sem framework) + suíte browser-only via `tools/tests.html` (para código que toca IndexedDB/DOM real).
- Deploy: GitHub Pages, branch `main`, sem CI/CD, sem PR — commits diretos.
- Idioma: identificadores de negócio e comentários em português; termo técnico consagrado em inglês. UI 100% português.

## 3. ARQUITETURA E DIRETÓRIOS

Camadas: `core/` (sem regra de negócio) → `domain/` (regra de negócio, puro sempre que possível) → `ui/` (DOM, delega tudo pro domain) → `importers/` (adaptadores de fatura/extrato/backup, formato de linha normalizado).

```
index.html          — shell da SPA, carrega vendor/ + src/app.js
sw.js                — service worker; nome do cache = APP_VERSION (src/version.js)
src/version.js       — ÚNICA fonte de versão; bump obrigatório a cada publicação (ver seção 4)
src/app.js           — boot + roteador de abas (RENDERIZADORES); zero regra de negócio

src/core/
  storage.js          — ÚNICA porta de entrada do IndexedDB (nenhum outro módulo toca indexedDB)
  db-schema.js         — STORES (schema), migrateV1ToV2 (app anterior → este)
  dates.js, money.js, text.js, ids.js — utilitários puros (ISO, BRL, normalização, uid/hash)
  cache-policy.js       — regra pura do que o SW pode gravar em cache

src/domain/            — regra de negócio, testável em Node sem DOM/IndexedDB
  transactions.js       — "regra de ouro": só natureza=despesa && !previsto conta como gasto
  accounts.js            — contas/cartões, cartão adicional→titular, matchers de descrição
  payment-methods.js     — formas de pagamento; tipo define comportamento (não o nome)
  categories.js           — categorias; "A Classificar" é id fixo protegido
  classification.js       — regras aprendidas (categoria/forma por descrição recorrente)
  parcelas.js              — identidade de parcela, previsão de parcelas futuras, auto-confirmação
  pagamento-fatura.js       — dedup do pagamento de fatura (aparece no extrato E na fatura seguinte)
  reconcile-card.js         — conciliação de FATURA (janela de datas, casamento, export completo)
  reconcile-bank.js          — conciliação de EXTRATO bancário (natureza, casamento)
  audit-log.js                — log técnico (nunca guarda descrição/valor/nome — repo é público)

src/importers/
  registry.js            — registro de adaptadores; formato de linha normalizado (contrato único)
  santander-cartao-pdf.js + -datas.js + -extrair.js — fatura PDF (Visa/Mastercard Santander)
  santander-extrato-xls.js — extrato .xls (BIFF8) Santander
  generic-table.js         — adaptador manual (usuário mapeia colunas), fallback p/ qualquer banco
  backup-xlsx.js            — backup/restore completo do app em .xlsx (todos os stores)

src/ui/
  tabs.js               — troca de aba, callback de render fica no módulo
  app.js (RENDERIZADORES) → Lancamentos | Cadastros | Parcelas | Conciliacao | Dashboard
  lancamentos.js + -form.js + -form-helpers.js + -parcelado.js + -filtros.js — aba Lançamentos
  cadastros.js + cadastros-{contas,formas,categorias,regras,backup,comuns}.js — aba Cadastros
  conciliacao.js + conciliacao-{import,fatura,extrato}.js — aba Conciliação
  parcelas.js            — aba Parcelas (vitrine de domain/parcelas.js, não escreve nada)
  dashboard.js            — totais, rosca por categoria, barras mensais
  onboarding.js            — assistente 1ª execução (cadastra conta/cartão do zero, sem seed de dado real)
  backup-comum.js           — baixarBackup/importarBackup, usado por Cadastros E rodapé Lançamentos
  components.js              — el(), toast(), abrirModal(), confirmar() — sem regra de negócio
```

## 4. DECISÕES CRÍTICAS DE DESIGN

- **Regra de ouro (`transactions.js:contaComoGasto`)**: só `natureza === 'despesa' && !previsto` soma como gasto. Receita, transferência e pagamento_fatura NUNCA contam — é o que evita fatura de cartão e extrato bancário contarem o mesmo dinheiro duas vezes. Nunca reimplementar essa checagem em outro lugar — sempre importar `contaComoGasto`.
- **`APP_VERSION` (`src/version.js`) precisa subir a CADA publicação que muda comportamento visível.** O nome do cache do service worker vem daqui; sem bump, o navegador do usuário continua servindo JS velho do cache mesmo depois do `git push`. Esquecer isso causou reincidência do MESMO sintoma reportado como "bug" pelo menos 4 vezes na sessão de 2026-08-08/10 — sempre desconfiar de "o fix não funcionou" antes de assumir que o código está errado.
- **`parcelaKey` e `faturaVencimento`**: `parcelaKey` identifica a COMPRA inteira (não uma parcela específica). Uma transação confirmada por fatura grava `faturaVencimento` (vencimento real) SEPARADO de `data` (que guarda `dataCorte`, usado para exibição) — usar `data` como vencimento em qualquer projeção de parcela futura é o bug raiz que já apareceu 3 formas diferentes: (1) offset de mês errado em `computeParcelaGroups` (corrigido via parâmetro `primeiraNoMesmoMes`), (2) parcela 1/n lançada via "+lançar" nunca ganhava `faturaVencimento` (corrigido propagando do botão), (3) parcela 1/n nunca confirmada = âncora é previsão "adivinhada", sem vencimento real nenhum (não é bug, é aviso visual `ancoraNaoConfirmada` — decisão: não forçar auto-confirmação de parcela 1, é proposital, exige revisão manual de categoria).
- **`autoConfirmParcelas` nunca confirma sozinha a parcela 1/n de uma compra nova.** Proposital: força o usuário a revisar categoria/forma antes de virar lançamento real (via botão "+ lançar" na Conciliação). Não "corrigir" isso sem perguntar — é decisão de produto, não bug.
- **Sem migração retroativa em dado já salvo.** Toda correção de campo (ex.: `faturaVencimento`) usa fallback pro campo antigo (`t.faturaVencimento || t.data`) em vez de reescrever histórico — decisão repetida em várias sessões.
- **Conciliação de fatura usa janela de 3 níveis de precisão** (`reconcile-card.js:getReconciliationWindow`): (1) `periodoCompras` impresso na própria fatura (mais preciso, não depende de fatura anterior) > (2) encadeamento pelo `dataCorte` da fatura anterior +1 dia > (3) estimativa de 35 dias antes do corte. Ver seção 6 para lógica detalhada.
- **`buildFullReconciliationRows` (export "Conciliação completa") precisa espelhar EXATAMENTE a lógica de `runReconciliation`/`runReconciliationBank`** usadas nas telas — já divergiu 2 vezes (não cobria extrato; casava transação de origem=fatura contra linha de extrato por engano) porque foi escrita como função separada em vez de reusar as duas. Ao alterar uma, checar a outra.
- **Backup `.xlsx` com célula > 32767 caracteres**: formato XLSX tem limite de caracteres por célula (SheetJS lança exceção). `datasetToSheets`/`sheetsToDataset` (`backup-xlsx.js`) dividem valor grande em colunas extras (`campo__2`, `campo__3`...) e remontam na importação — nunca truncar nem falhar em silêncio. Backups exportados ANTES deste fix (pré-v5) podem ter dado truncado de forma IRRECUPERÁVEL (SheetJS antigo cortava em silêncio sem lançar erro) — só solução é reexportar da fonte original.
- **Repositório é PÚBLICO.** Nenhum dado pessoal (nome, número de conta/cartão, valor real) em código, teste, fixture ou log de auditoria — `audit-log.js` só guarda contagens e tipos de evento, nunca descrição/valor/nome.
- **Card adicional**: fatura e débito em conta pertencem ao TITULAR; cada gasto guarda de qual plástico saiu (`plasticosDoTitular` resolve adicional→titular antes de qualquer pool de conciliação).
- **`origem` da transação é o discriminador de proveniência**: `'manual'` | `'fatura'` | `'extrato'` (implícito por natureza) — usado pra impedir que a exportação/conciliação "roube" uma transação de fatura pra um par de extrato coincidente em valor/data, e vice-versa.

## 5. ESTADO ATUAL E PONTOS DE ENTRADA

- Entrada: `index.html` → `<script type="module" src="src/app.js">` → `boot()` → `seedCategoriasIfEmpty`/`seedFormasIfEmpty` (só na 1ª execução) → `initTabs` → renderiza aba `Lancamentos` → registra service worker (fire-and-forget) → `talvezOferecerOnboarding` (assistente de cadastro inicial, se ainda não configurado).
- Roteador simples: `src/app.js` mapeia nome de aba → função de render (`RENDERIZADORES`). Nenhuma lib de rota.
- **100% operacional (v11)**: lançamento manual e parcelado; import de fatura PDF Santander (Visa/Mastercard) e extrato `.xls` Santander; adaptador genérico manual pra outros bancos; conciliação de fatura e de extrato (4 baldes cada); aba Parcelas com projeção e aviso de data estimada; regras de classificação aprendidas; backup/restore completo `.xlsx` (com chunking de célula grande); export "Conciliação completa" cobrindo fatura E extrato; dashboard; PWA instalável offline.
- Convenção de branch: tudo direto em `main`, sem worktree, sem PR — confirmado com o usuário em sessões anteriores.

## 6. LÓGICA DETALHADA — CONCILIAÇÃO DE FATURA (datas e períodos)

### 6.1 Vocabulário

| Termo | Significado |
|---|---|
| **Vencimento** | Data em que a fatura vence (paga). Extraído do texto do PDF (`vencimentoFromText`). |
| **Data de corte** (`dataCorte`) | Data limite de compras incluídas NESTA fatura — compras depois disso caem na PRÓXIMA. |
| **Período de compras** (`periodoCompras`) | Faixa impressa na própria fatura ("24/04/26 a 25/05/26") — é o dado MAIS preciso disponível, quando existe. |

### 6.2 Exemplo real (fatura de vencimento 30/05), tabela "Histórico de Faturas"

```
MAR.  R$ 7.416,70   R$7.416,70   24/02/26 a 23/03/26   ← fatura de março (já paga)
ABR.  R$ 6.620,20   R$6.620,22   24/03/26 a 23/04/26   ← fatura de abril (já paga)
MAI.  R$ 4.728,63   Esta Fatura  24/04/26 a 25/05/26   ← A FATURA ATUAL (vence 30/05)
JUN.  R$   947,00   Fatura Aberta 26/05/26 a 23/06/26  ← próxima fatura, ainda abrindo
```

O PDF da fatura de vencimento 30/05 imprime essas 4 faixas "DD/MM/AA a DD/MM/AA" logo no topo. `extrairPeriodoCompras` (`santander-cartao-pdf-datas.js`) varre essas linhas e escolhe a faixa cujo **fim bate exatamente com a `dataCorte`** já extraída dessa mesma fatura — ou seja, para a fatura de 30/05, pega a linha "MAI." (`24/04/26 a 25/05/26`), não as outras 3.

### 6.3 Janela de conciliação — 3 níveis de precisão (`getReconciliationWindow`)

```
Nível 1 (periodo_impresso)   Nível 2 (encadeamento)         Nível 3 (estimativa)
  ├─ fatura.periodoCompras     ├─ dataCorte da FATURA          ├─ dataCorte atual
  │  já extraído do PDF        │  ANTERIOR (já importada)      │  menos 35 dias
  │  desta própria fatura      │  + 1 dia = início              │  (nenhuma fatura
  │  = MAIS PRECISO            │  dataCorte desta = fim         │  anterior disponível)
  └─ vence sempre que existe   └─ só se fatura anterior         └─ último recurso
                                  foi importada
```

Cada nível só é usado se o anterior não estiver disponível — nível 1 vence sempre que existir (não depende de nenhuma outra fatura já importada).

`getPoolWindow` adiciona ±3 dias de folga (`POOL_SLACK_DAYS`) na janela final, pra tolerar pequena divergência entre a data que o banco imprime e a data real do lançamento no app.

### 6.4 Casamento (matching) — como uma linha de fatura vira "Conciliado"

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

### 6.5 Conciliação de extrato bancário (`reconcile-bank.js`) — diferente de fatura

1. `atribuirNatureza` classifica cada linha do extrato ANTES de qualquer casamento, por ordem de precedência: `pagamento_fatura` (bate matcher de cartão + é débito) > `transferencia` (bate matcher de outra conta própria/apelido do titular) > `receita` (crédito sem matcher) > `despesa` (default).
2. Pool = transações não-previstas com `origem !== 'fatura'` (parcela confirmada/pagamento de fatura pertence SÓ à conciliação de fatura, nunca pode ser "roubada" aqui — bug real já corrigido).
3. Casamento: valor bate + data dentro de 2 dias + mesma conta (ou sem conta definida).

### 6.6 Pagamento de fatura — evento único, visto por dois lados

O mesmo pagamento aparece no EXTRATO (débito saindo da conta) e na FATURA seguinte (linha "pagamentos_creditos"). `processarPagamentoFatura` (`pagamento-fatura.js`) usa valor+data (tolerância 2 dias) pra reconhecer que é o MESMO evento, não importa qual lado chegou primeiro — o segundo lado a chegar só complementa `origemRef`, nunca duplica o lançamento.

## 7. FLUXO ENTRE ABAS E ORIGENS DE DADO

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

## 8. LIÇÕES APRENDIDAS (sessão 2026-08-08/10, v3→v11)

- **"O fix não funcionou" quase sempre era cache, não código.** 4 ocorrências do mesmo padrão: código corrigido e testado, publicado, usuário reporta que continua igual → causa real era `APP_VERSION` não bumpado (service worker servindo JS velho). Diagnóstico correto: pedir pro usuário conferir a versão exibida em Cadastros → Backup ANTES de reinvestigar lógica.
- **Não confiar em reprodução sintética quando o dado real está disponível.** Vários bugs (parcela 1/n nunca confirmada, backup truncado por versão antiga) só foram encontrados pedindo ao usuário um dump técnico real (console/DevTools) — testes sintéticos "razoáveis" não reproduziam por não bater com a forma exata dos dados de produção.
- **Um mesmo sintoma pode ter múltiplas causas raiz empilhadas.** "Parcela mostrando mês errado" teve 3 causas diferentes descobertas em sequência: offset de mês, falta de `faturaVencimento` no "+lançar", e parcela nunca confirmada. Corrigir a primeira causa encontrada não significa que o sintoma sumiu — sempre re-testar com o cenário exato do usuário depois de cada fix.
- **Lógica duplicada entre tela e exportação diverge silenciosamente.** `buildFullReconciliationRows` foi escrita separada de `runReconciliation`/`runReconciliationBank` e por isso não cobria extrato, e depois casava transação de origem errada — toda vez que uma tela e uma exportação fazem "a mesma coisa", extrair função compartilhada ou testar as duas juntas.
- **DevTools remoto via USB é frágil para depuração ao vivo em Android.** Quando precisar diagnosticar algo que só acontece no aparelho do usuário, preferir adicionar uma tela/botão de diagnóstico temporário no próprio app (visível sem cabo) a insistir em `chrome://inspect`.
- **Erro engolido em silêncio (catch vazio) esconde a causa raiz.** `desserializarValor` (backup) e `renderConciliacao` (tela) não tinham tratamento de erro visível — a UI ficava em branco sem pista nenhuma. Toda função que pode falhar de forma não prevista deveria expor o erro (toast + mensagem na tela), nunca falhar mudo.
- **Decisão de produto ("parcela 1 exige confirmação manual") pode parecer bug.** Antes de "corrigir" um comportamento estranho, confirmar com o usuário se é intencional — nesse caso era, e o fix certo foi um AVISO na UI, não mudar a regra.

## 9. PENDÊNCIAS / AJUSTES FUTUROS

- **Remover o botão "Diagnóstico" temporário** em `src/ui/cadastros-backup.js` (`diagnosticoStatements`) — foi adicionado só para investigar o bug de extrato truncado no celular (2026-08-08), marcado `TEMPORARIO` no comentário, ainda não removido.
- **Desempate de casamento em `buildFullReconciliationRows` (loop de extrato) não usa similaridade de descrição** como `runReconciliationBank` usa (`similaridadeCanonica`) — pode escolher um par diferente do que a tela mostraria em caso de ambiguidade (dois candidatos com mesmo valor/data). Marcado como Minor/opcional na última revisão, não implementado.
- **`buildFullReconciliationRows` recebe `accounts`/`apelidosTitular` sem usar** dentro do corpo da função, após a remoção do loop morto de `atribuirNatureza` no fix de origem=fatura — parâmetros mortos, cosmético, sem risco funcional.
- **Sem teste automatizado de UI para `cadastros-formas.js`** (nem outros arquivos `cadastros-*.js`) — validação hoje é só manual/visual via Playwright ad-hoc quando investigado.
- **Onboarding não migra dados do app anterior via leitura direta do IndexedDB dele** — decisão explícita (2026-07-31): migração só via backup/restore do app novo.
