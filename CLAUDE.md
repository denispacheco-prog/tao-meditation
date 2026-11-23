# Tao Meditation

PWA pessoal de meditação guiada (em inglês) com trechos do Tao Te Ching na
tradução de Stephen Mitchell, publicado no GitHub Pages
(https://denispacheco-prog.github.io/tao-meditation/). HTML + CSS + JS puro,
sem framework, sem dependências e sem etapa de build. Estrutura e formato dos
roteiros estão no `README.md`.

## Regras

- **O livro nunca entra no repositório (público).** A tradução de Mitchell tem
  direitos autorais: o app lê o EPUB no aparelho e guarda os capítulos no
  IndexedDB. Nada de `.epub`, nem trechos do livro copiados para o código, os
  roteiros ou os testes. O `.gitignore` bloqueia `*.epub`; não o afrouxe.
- **Toda mudança de arquivo pede `VERSION` nova em `sw.js`** (hoje `v7`), senão
  o app instalado continua servindo a versão antiga do cache. Arquivo novo
  (um roteiro em `sessions/`, um script em `js/`) também precisa entrar na
  lista `FILES` do `sw.js`, ou não funciona offline.
- **Roteiro novo:** crie o `.json` em `sessions/`, liste em
  `sessions/index.json` e no `FILES` do `sw.js`.
- **Teste rápido:** abra com `?fast=20` (20× mais rápido, sem voz).
- **O projeto é editado em mais de uma máquina.** Rode `git pull` antes de
  mexer.
- **Pergunte antes de commitar ou dar push.** O dono confirma cada um.
