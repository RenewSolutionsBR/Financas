# Livro de Gastos

Aplicativo PWA de controle financeiro pessoal. Roda inteiramente no navegador,
sem servidor de back-end e sem build step: é HTML, CSS e JavaScript puros
(ES modules), com bibliotecas de terceiros servidas localmente em `vendor/`.

## Rodando localmente

Não há build. Basta servir os arquivos estáticos a partir da raiz do projeto:

```bash
python -m http.server 8000
```

E abrir [http://localhost:8000](http://localhost:8000) no navegador.

## Rodando os testes

Os testes vivem em `tests/` e rodam sem nenhuma dependência externa, nos dois
alvos abaixo, a partir do mesmo conjunto de arquivos.

### Alvo Node

Da raiz do projeto:

```bash
node tools/run-tests.mjs
```

### Alvo navegador

Suba o servidor estático:

```bash
python -m http.server 8000
```

E abra [http://localhost:8000/tools/tests.html](http://localhost:8000/tools/tests.html).

## PWA e cache offline

O app registra `sw.js` como service worker (módulo ES, porque ele importa
`src/version.js`) e faz cache de todos os arquivos estáticos em
`caches.open('livro-de-gastos-<APP_VERSION>')`, permitindo abrir e usar o
app sem conexão depois da primeira visita.

Para publicar uma nova versão, suba `APP_VERSION` em `src/version.js`. É o
único lugar a alterar: o `sw.js` lê essa constante para nomear o cache, e o
`activate` do service worker apaga automaticamente qualquer cache de versão
anterior. Esquecer de subir a versão é o que fazia aparelhos do app anterior
continuarem servindo arquivos velhos indefinidamente.

`navigator.serviceWorker.register('sw.js', { type: 'module' })` depende de
suporte a *module service workers*, suportado em Safari/iOS 15+ (WebKit,
Safari 15, set/2021) além de Chrome/Edge/Android WebView atuais — qualquer
iPhone em uso hoje passa folgado, sem necessidade de bundler ou de duplicar
a constante de versão.

A publicação em si (merge para `main`, GitHub Pages, instalação no celular)
acontece no fechamento da Fase 1, não nesta task.

## Aviso: repositório público

Este repositório é **público**. Nenhum documento financeiro real (extratos,
faturas, comprovantes, backups) ou dado pessoal (número de conta, agência,
final de cartão, nome de pessoa, valor real) deve ser adicionado a ele — nem
em código, nem em testes, nem em fixtures. O `.gitignore` já bloqueia
extensões de documento financeiro comuns (`.pdf`, `.xls`, `.xlsx`, `.csv`,
`.ofx`, `.ofc`, `.qif`); mesmo assim, confira antes de commitar.
