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

## Aviso: repositório público

Este repositório é **público**. Nenhum documento financeiro real (extratos,
faturas, comprovantes, backups) ou dado pessoal (número de conta, agência,
final de cartão, nome de pessoa, valor real) deve ser adicionado a ele — nem
em código, nem em testes, nem em fixtures. O `.gitignore` já bloqueia
extensões de documento financeiro comuns (`.pdf`, `.xls`, `.xlsx`, `.csv`,
`.ofx`, `.ofc`, `.qif`); mesmo assim, confira antes de commitar.
