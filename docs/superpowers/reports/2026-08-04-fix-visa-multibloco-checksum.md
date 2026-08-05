# Fix: checksum "DIVERGE" falso-negativo em faturas Visa (blocos tipados compartilhando um "VALOR TOTAL")

## O que mudou e por quê

`src/importers/santander-cartao-pdf.js`, dentro de `parseFaturaTexto`: a função
`abandonarSecaoAtual()` deixou de ser chamada em TODA transição de rótulo de
seção (`Pagamento e Demais Créditos` / `Parcelamentos` / `Despesas`) e passou a
ser chamada só quando o **grupo** muda de verdade.

Introduzi um helper `grupoAtual(mode)` que mapeia:
- `mode === 'credito'` → grupo `'credito'`
- `mode === 'despesa'` ou `mode === 'parcelamento'` → grupo `'despesa-like'`

Nos três pontos de leitura de rótulo de seção, a lógica agora é: só chama
`abandonarSecaoAtual()` se `grupoAtual(mode)` (o grupo ANTES de atualizar
`mode`) for diferente do grupo do rótulo que acabou de aparecer. Isso preserva
o comportamento de reset:
- ao trocar de cabeçalho de cartão (chamada incondicional, inalterada);
- ao trocar de grupo `credito` ↔ `despesa-like` (o caso original medido em
  Mastercard: "Pagamento e Demais Créditos" com 1 lançamento e sem "VALOR
  TOTAL" impresso, seguido direto de "Despesas" — sem isso, a soma do
  pagamento vazava pra dentro da soma de despesas).

E elimina o reset indevido:
- `Parcelamentos` → `Despesas` (ou vice-versa) do mesmo cartão: ambos ficam no
  grupo `'despesa-like'`, então `sectionSum`/`sectionCount` continuam
  acumulando através da transição — necessário porque a fatura Visa real
  mostrou os dois blocos compartilhando UM único "VALOR TOTAL" no final.
- Repetição do rótulo `Despesas` (cabeçalho de continuação de página): como o
  grupo não muda (já estava em `'despesa-like'`), não há reset — a listagem
  continua sendo tratada como uma seção só.

## Testes de regressão adicionados (`tests/santander-cartao-pdf.test.js`)

Todas as fixtures são 100% sintéticas, seguindo a convenção já usada no
arquivo (nomes tipo "LOJA EXEMPLO", valores redondos, sem qualquer dado real).

### 1. Blocos tipados compartilhando um "VALOR TOTAL" combinado
`LINHAS_PARCELAMENTO_DESPESA_TOTAL_UNICO`: `Parcelamentos` (1 linha, 150,00)
seguido direto de `Despesas` (2 linhas, 320,50 + 45,00), com um único
`VALOR TOTAL 515,50` no final.

Assert: `checksum.ok === true`, `sections.length === 1` (os dois blocos viram
UMA seção avaliada), `computed === 515.5` (soma combinada, não só os 365,50 de
Despesas), `nLinhas === 3`.

**Evidência RED/GREEN (sabotagem aplicada):**
- Reverti temporariamente os 3 pontos de leitura de rótulo para o
  comportamento antigo (`abandonarSecaoAtual()` incondicional em toda
  transição de rótulo), mantendo o resto do arquivo intacto.
- Rodei `node tools/run-tests.mjs`: **RED confirmado** — exatamente o sintoma
  descrito no bug real:
  ```
  FALHOU  ... Parcelamentos seguido de Despesas ...
  [{"secaoTipo":"despesas","expected":null,"computed":150,"ok":null,"nLinhas":1},
   {"secaoTipo":"despesas","expected":515.5,"computed":365.5,"ok":false,"nLinhas":2}]
  ```
  A seção do Parcelamentos (150) foi descartada como "sem total impresso", e a
  seção de Despesas comparou 365,50 (soma calculada, SEM os 150 do
  Parcelamentos) contra o total impresso real de 515,50 → `ok:false`, soma
  calculada MENOR que a impressa — o padrão "DIVERGE" relatado pelo usuário.
  A segunda fixture nova (rótulo repetido) também falhou do mesmo jeito
  (`computed:200` vs `expected:300`).
  Resultado: `353/355 passaram, 2 falharam`.
- Restaurei o fix (arquivo do backup pré-sabotagem). Rodei os testes de novo:
  **GREEN confirmado** — `355/355 passaram`.

### 2. Rótulo de seção repetido (simulação de cabeçalho de continuação de página)
`LINHAS_DESPESAS_ROTULO_REPETIDO`: `Despesas` aparece duas vezes para o mesmo
cartão, com uma linha de despesa antes e outra depois da repetição, um único
`VALOR TOTAL 300,00` no final.

Assert: `checksum.ok === true`, `sections.length === 1`, `computed === 300`
(soma dos dois lados do rótulo repetido), `nLinhas === 2`.

### 3. Guarda de regressão explícita para o caso original medido em Mastercard
Além dos testes já existentes (`LINHAS_SECAO_SEM_TOTAL` e variantes, no bloco
`describe('santander-cartao-pdf: secao sem "VALOR TOTAL" proprio nao
contamina a secao seguinte')`, que **continuam passando sem modificação**),
adicionei um teste isolado especificamente para o mecanismo de troca de GRUPO:
"Pagamento e Demais Créditos" (700,00, sem total impresso) seguido de
"Parcelamentos" (90,00, com total próprio). Assert: `checksum.ok === true`,
`avaliada.computed === 90` (os 700 do crédito não vazam para dentro da soma do
parcelamento), `avaliada.secaoTipo === 'despesas'`.

## Confirmação: guarda de regressão original ainda vale

Os testes pré-existentes que cobrem o caso Mastercard original —
`'checksum fecha considerando so a secao que TEM total impresso (Despesas),
ignorando o pagamento sem total'`, `'secao sem total com MAIS DE 1 lancamento
gera aviso'`, `'secao sem total com 1 lancamento SO ... NAO gera aviso'` —
continuam passando **sem nenhuma alteração no código de teste ou na fixture**
(`LINHAS_SECAO_SEM_TOTAL`). Isso é esperado: a transição `Pagamento e Demais
Créditos` → `Despesas` nessa fixture é uma troca de GRUPO (`credito` →
`despesa-like`), que continua disparando `abandonarSecaoAtual()`
normalmente.

## Trace do caso simples (sem regressão)

Cenário: um cartão com APENAS um bloco `Despesas` e seu próprio total (o caso
comum, já coberto por `LINHAS_TITULAR_ADICIONAL` e `LINHAS_FATURA_SINTETICA`
nos testes existentes).

Passo a passo: `mode` começa `null` (após o cabeçalho do cartão). Ao ler o
rótulo `Despesas`, `grupoAtual(null)` retorna `null`, que é `!== 'despesa-like'`
→ chama `abandonarSecaoAtual()` (no-op, pois `sectionCount === 0` nesse ponto)
→ seta `mode = 'despesa'`. As linhas de despesa acumulam normalmente em
`sectionSum`/`sectionCount`. Ao ler `VALOR TOTAL`, `flushSection` compara a
soma acumulada contra o total impresso, como sempre. Comportamento idêntico ao
anterior à mudança — confirmado pelos testes existentes desses dois fixtures,
que continuam passando sem alteração.

## Contagem de testes

- Antes da mudança: **352/352 passaram** (5 módulos só de navegador não
  rodam no runner Node).
- Depois da mudança (com os 3 novos testes): **355/355 passaram**.

## Preocupações

- A fixture sintética `LINHAS_PARCELAMENTO_DESPESA_TOTAL_UNICO` assume que
  "Parcelamentos" sempre vem ANTES de "Despesas" quando os dois compartilham
  total — isso reflete a ordem observada na estrutura já documentada no
  arquivo (`LINHAS_FATURA_SINTETICA` original também segue essa ordem), mas
  não testei explicitamente a ordem inversa (`Despesas` antes de
  `Parcelamentos` compartilhando total). O código não depende de ordem — a
  lógica de grupo é simétrica — mas não há teste dedicado a essa variante.
- Não tive acesso a nenhum PDF real; toda a validação depende inteiramente da
  fidelidade da descrição estrutural fornecida pelo controller (nomes de
  seção, presença/ausência de "VALOR TOTAL", ordem dos blocos). Se a estrutura
  real divergir sutilmente da descrição (por exemplo, mais de dois blocos
  tipados compartilhando um total, ou um terceiro grupo além de
  `despesa`/`parcelamento`), o fix pode precisar de ajuste adicional.
