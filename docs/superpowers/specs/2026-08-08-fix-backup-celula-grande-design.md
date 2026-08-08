# Fix do backup completo travando em extrato grande (design)

## 1. Contexto

Usuário reportou: botão "Backup completo" não faz nada ao clicar. Sem
tratamento de erro em `baixarBackup` (`src/ui/backup-comum.js`), a falha
era silenciosa — nenhum toast, nenhuma pista.

Diagnóstico ao vivo (comando de console, só nomes técnicos de campo,
nenhum dado financeiro): `XLSX.write` lança `Text length must not exceed
32767 characters` — limite real do formato `.xlsx` por célula. A célula
específica identificada pelo próprio usuário:
`store=statements id=...|extrato|2026-06-30 campo=rows tamanho=39171`.

## 2. Causa raiz

`datasetToSheets` (`src/importers/backup-xlsx.js:59`) serializa QUALQUER
campo objeto/array como uma única string JSON numa única célula
(`serializarValor`, linha 30-46). Para `statements.rows` — o array
completo de linhas de uma fatura OU extrato importado — isso normalmente
cabe (faturas têm até ~100 linhas, cada uma um objeto pequeno). Mas o
importador de extrato (`src/importers/santander-extrato-xls.js:115`)
grava um campo `raw: l.join(' | ')` em CADA linha — a linha inteira da
planilha original, todas as colunas concatenadas — bem maior que o `raw`
de uma linha de fatura (só a descrição). Um extrato com muitos
lançamentos (extratos bancários tendem a ter mais linhas que faturas de
cartão) faz o JSON de `rows` inteiro passar de 32.767 caracteres, e o
SheetJS lança esse erro na hora de escrever o arquivo — sem nenhuma
chance de recuperação, o backup INTEIRO falha, mesmo que só um statement
específico seja grande demais.

## 3. Fix: dividir célula grande em múltiplas colunas, sem tocar nos importadores

Mudar o formato dos importadores (reduzir o que cada um grava) quebraria
o propósito de guardar o dado bruto original — fora de escopo e
arriscado sem necessidade. O fix fica isolado em `backup-xlsx.js`, sem
mudar nenhum importador: qualquer valor serializado que exceda o limite
seguro do XLSX é dividido em pedaços, gravados em colunas adicionais
(`campo`, `campo__2`, `campo__3`, ...) na mesma linha da planilha, e
remontados na importação.

### 3.1 Limite seguro

Usar um limite prático abaixo do limite real do XLSX (32.767), com folga
pra evitar passar do limite em arredondamentos: `LIMITE_CELULA = 30000`.

### 3.2 Serialização (exportarBackup / datasetToSheets)

`serializarValor` continua devolvendo a string serializada inteira (sem
mudança na função em si — ela não sabe em qual célula vai parar). A
divisão acontece em `datasetToSheets`, no loop que monta cada linha da
planilha: depois de serializar um campo, se o resultado passar de
`LIMITE_CELULA`, divide a string em pedaços de até `LIMITE_CELULA`
caracteres e grava cada pedaço numa coluna extra (`${campo}__2`,
`${campo}__3`, ...) na mesma linha. A primeira coluna (`campo`) recebe só
o primeiro pedaço.

### 3.3 Desserialização (importarBackup / sheetsToDataset)

Antes de desserializar uma linha, reconstruir os campos divididos:
detectar colunas cujo nome bate o padrão `algumNome__N` (N ≥ 2), agrupar
por nome base, concatenar os pedaços NA ORDEM (`__2`, `__3`, ...) de
volta na coluna `algumNome`, e então seguir o fluxo de desserialização já
existente sem nenhuma outra mudança. Colunas `__N` nunca aparecem como
campos próprios do registro final.

### 3.4 Compatibilidade com backups antigos

Um backup exportado ANTES deste fix nunca teve colunas `__N` — a lógica
de reconstrução simplesmente não encontra nenhuma e segue o fluxo atual
inalterado. Nenhuma migração necessária, backups antigos continuam
importáveis exatamente como hoje.

## 4. `baixarBackup` ganha tratamento de erro

Além do fix de causa raiz, `baixarBackup` (`src/ui/backup-comum.js`)
precisa parar de falhar em silêncio pra qualquer erro futuro não previsto
(rede, quota de armazenamento, etc.) — mesmo padrão de try/catch +
`toast('erro')` já usado em `montarInputImportarBackup` no mesmo arquivo:

```js
export async function baixarBackup() {
  try {
    const blob = await exportarBackup();
    // ... resto igual
    toast('Backup gerado.', 'ok');
  } catch (e) {
    toast('Não consegui gerar o backup: ' + e.message, 'erro');
  }
}
```

## 5. Global Constraints (herdadas)

- Zero build step, zero dependências em runtime.
- Repositório é PÚBLICO — nenhum dado pessoal em código, teste ou
  fixture. Testes de célula grande usam string sintética repetida
  (`'x'.repeat(...)`), nunca dado real do usuário.
- Comentários e identificadores em português; termo técnico consagrado em
  inglês. Commits em português, imperativo, sem emoji.
- Ciclo exportar→importar precisa continuar devolvendo exatamente o mesmo
  conjunto de dados (invariante já documentada no topo de
  `backup-xlsx.js`) — incluindo campos que precisaram ser divididos em
  múltiplas colunas.
- Sem mudança em nenhum importador (`santander-extrato-xls.js`,
  `santander-cartao-pdf.js`, etc.) — o fix fica isolado em
  `backup-xlsx.js`.

## 6. Verificação de fim de fase

- [ ] `node tools/run-tests.mjs` termina com código 0, nenhuma falha
- [ ] Teste de ciclo completo (`datasetToSheets` → `sheetsToDataset`) com
      um valor sintético maior que `LIMITE_CELULA` continua batendo
      exatamente com o valor original depois do ciclo
- [ ] Teste confirma que um valor pequeno (abaixo do limite) NÃO gera
      colunas extras (`campo__2` etc.) — comportamento inalterado pro
      caso comum
- [ ] `baixarBackup` mostra um toast de erro (não falha em silêncio) se
      `exportarBackup` lançar qualquer exceção
- [ ] Cenário real do usuário confirmado: um `statements.rows` sintético
      de tamanho equivalente ao relatado (>32767 caracteres serializado)
      exporta e reimporta sem erro, com os dados idênticos
- [ ] Nenhum dado pessoal em nenhum artefato desta fase
