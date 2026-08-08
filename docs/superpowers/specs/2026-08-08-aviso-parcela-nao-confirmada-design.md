# Aviso na aba Parcelas para grupo ainda sem parcela 1 confirmada (design)

## 1. Contexto (achado pós-deploy)

Depois do fix anterior (`faturaVencimento` propagado pelo "+ lançar"), o
usuário reportou o MESMO sintoma (parcela restante caindo em janeiro em
vez de fevereiro) mesmo após apagar tudo e reimportar a fatura de 30/01
com o código já atualizado (confirmado pelo log de auditoria, que já
mostra o nome do arquivo — feature só disponível na versão mais recente).

Investigação ao vivo (Playwright, reproduções isoladas de
`autoConfirmParcelas`/`syncPredictions`/`parcelaGroupsDaConta`) confirmou
que TODO o código dos dois fixes anteriores está correto — toda
reprodução manual deu o mês certo. O dump real do IndexedDB do usuário
(comando de console, só campos técnicos, sem dado sensível) revelou a
causa verdadeira: para a compra BLESSI, NÃO existe nenhuma transação
`previsto:false` — só 3 previsões (`seed_...`, parcela_atual 2/3/4).

## 2. Causa raiz: parcela 1/n nunca confirmada = âncora sempre "adivinhada"

`autoConfirmParcelas` (`src/domain/parcelas.js:259`) tem uma trava
proposital: uma linha de fatura com `parcela_atual === 1` NUNCA é
confirmada automaticamente — só quando o usuário clica "+ lançar"
(pra revisar categoria/forma de pagamento antes de virar lançamento
real). Essa trava é intencional e correta, e **não muda** neste fix
(decisão do usuário, ver seção 1 do brainstorming desta sessão).

Consequência não óbvia dessa trava: enquanto a parcela 1 não é
confirmada, `syncPredictions` só tem a LINHA DA FATURA (não uma
transação salva) como fonte de verdade — e o que fica salvo em
`transactions` são só previsões (`previsto:true`) com `data` sintética
(`ym + '-01'`, um mês "adivinhado" a partir do vencimento da fatura que
trouxe a parcela 1, não confirmado por nenhum dado real). Em
`parcelaGroupsDaConta`, `melhorAncoraDeParcela` escolhe corretamente a
previsão de MENOR `parcela_atual` como âncora (comportamento correto,
documentado e sem mudança) — mas essa âncora usa "mesmo mês" por ser uma
previsão (`primeiraNoMesmoMes: !!t.previsto` → `true`), e o mês sintético
da PRIMEIRA previsão é sempre o mês seguinte ao vencimento da fatura que
confirmou a parcela anterior — que aqui é o PRÓPRIO vencimento da fatura
recém-importada, porque não há "parcela anterior confirmada" nenhuma.

Resultado: a aba Parcelas mostra a previsão adivinhada como se fosse
definitiva, sem nenhum aviso de que a data pode estar errada até a
parcela 1 ser confirmada manualmente. O usuário não tem como saber, só
olhando a aba Parcelas, que aquele grupo específico ainda não tem
vencimento real nenhum por trás.

## 3. Fix: aviso visual na aba Parcelas, sem mudar a lógica de confirmação

Nenhuma mudança em `autoConfirmParcelas`, `syncPredictions`,
`computeParcelaGroups` ou `parcelaGroupsDaConta` — a trava de "parcela 1
exige confirmação manual" continua exatamente como está, decisão já
validada nesta sessão.

`parcelaGroupsDaConta` (`src/domain/parcelas.js`) passa a expor, em cada
grupo retornado, se a âncora usada é uma previsão pura (nenhuma
transação `previsto:false` existe pra aquela `parcelaKey`) — um novo
campo booleano no objeto de grupo, ex. `ancoraNaoConfirmada`. A forma mais
simples: dentro do loop de `parcelaGroupsDaConta`, checar se a âncora
escolhida (`t`) tem `t.previsto` truthy, e propagar isso pro grupo.

Na aba Parcelas (`src/ui/parcelas.js`), quando `g.ancoraNaoConfirmada` for
true, mostrar um aviso curto acima da lista de meses do grupo, ex.:

> ⚠ Datas estimadas — confirme a parcela 1 na Conciliação ("+ lançar")
> pra usar o vencimento real da fatura.

Sem emoji conforme convenção de commits, mas está OK em texto de UI
(convenção de commits não se aplica a strings de interface — confirmar
se o projeto já usa algum ícone de aviso em outro lugar da UI antes de
decidir o símbolo exato; se não usar, texto puro sem símbolo).

## 4. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou fixture.
- Datas ISO internamente, `DD/MM/AAAA` só em `ui/`.
- Nenhum módulo fora de `core/storage.js` toca `indexedDB` diretamente.
- Comentários e UI em português; commits em português, imperativo, sem
  emoji.
- Sem migração retroativa.
- A trava "parcela 1 exige confirmação manual" em `autoConfirmParcelas`
  NÃO muda nesta fase — é comportamento intencional, não um bug.

## 5. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Grupo cuja âncora é só previsão (nenhuma transação confirmada pra
      aquela parcelaKey) mostra o aviso na aba Parcelas
- [ ] Grupo cuja âncora é confirmada (via fatura ou "+ lançar") NÃO mostra
      aviso nenhum, comportamento igual ao de hoje
- [ ] Nenhuma mudança em `autoConfirmParcelas`/`syncPredictions` — testes
      existentes desses fluxos continuam passando sem alteração de asserts
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
