# Tao Meditation

PWA pessoal de meditação guiada (em inglês) com trechos do Tao Te Ching na tradução de Stephen Mitchell.

**O livro nunca entra no repositório.** O app lê o EPUB que você carrega no próprio aparelho e guarda os capítulos no IndexedDB do navegador. O `.gitignore` bloqueia `*.epub`.

## Publicar
1. Suba esta pasta para um repositório no GitHub.
2. Ative o GitHub Pages (Settings → Pages → branch `main`, pasta `/`).
3. No Android, abra o link no Chrome → menu → *Instalar app*.
4. No app, toque em **Load EPUB** e escolha o arquivo.

## Estrutura
- `sessions/*.json`: roteiros (liste novos em `sessions/index.json`)
- `js/player.js`: executa os roteiros e distribui o tempo dos passos `fill`
- `js/speech.js`: voz do navegador (Web Speech API)
- `js/audio.js`: sino e sons de respiração (Web Audio API)
- `js/epub.js`, `js/zip.js`: importação do EPUB sem dependências
- `js/store.js`: IndexedDB e preferências

## Formato dos roteiros
| tipo | campos |
|---|---|
| `speak` | `text` |
| `pause` | `seconds` **ou** `fill` (peso) |
| `bell` | `strikes` |
| `tao` | `chapter`, `stanzas` (ex.: `[1]`), `lineGap` (s entre versos) |
| `breath` | `pattern` `{inhale, hold?, exhale, holdOut?}`, `count` `{to, voiced: none/first-round/all}`, `cues` (nº de respirações com "In/Hold/Out" falado), `seconds` **ou** `fill` |

Qualquer passo aceita `minMinutes` / `maxMinutes`: ele só entra quando a duração escolhida está nesse intervalo. Assim o mesmo roteiro serve de 3 a 20 min.

Os passos com `fill` dividem o tempo que sobra até a duração escolhida, em proporção aos pesos.

## Testar
Adicione `?fast=20` ao endereço para rodar 20× mais rápido, sem voz.
Ao alterar arquivos, aumente `VERSION` em `sw.js`.
