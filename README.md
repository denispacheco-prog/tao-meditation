# Tao Meditation

PWA pessoal de meditação guiada (em inglês) com trechos do Tao Te Ching na tradução de Stephen Mitchell.

**O livro nunca entra no repositório.** O app lê o EPUB que você carrega no próprio aparelho e guarda os capítulos no IndexedDB do navegador. O `.gitignore` bloqueia `*.epub`.

## Publicar
1. Suba esta pasta para um repositório no GitHub.
2. Ative o GitHub Pages (Settings → Pages → branch `main`, pasta `/`).
3. No Android, abra o link no Chrome → menu → *Instalar app*.
4. No app, toque em **Load EPUB** e escolha o arquivo.

## Estrutura
- `sessions/*.json`: roteiros (liste novos em `sessions/index.json`); `sessions/pools.json`: bancos de frases compartilhados (ex.: as intros do pós-treino)
- `js/player.js`: executa os roteiros e distribui o tempo dos passos `fill`
- `js/speech.js`: voz do navegador (Web Speech API), ou a voz natural quando escolhida
- `js/neural.js`, `js/piper-worker.js`, `js/piper-core.js`: as duas vozes (Jenny e Alan), Piper rodando no aparelho; o modelo é baixado uma vez do Hugging Face. O ajuste de cada voz (andamento, ritmo, tom, pausa, sala) fica em `NEURAL_VOICES`. Motor em `vendor/` (veja `vendor/README.md`)
- `js/audio.js`: sino e sons de respiração (Web Audio API)
- `js/routines.js`: sessões montadas na hora: a jornada pelos 81 capítulos (um capítulo inteiro por sessão) e o timer silencioso com sinos
- `js/journal.js`: diário só no aparelho (localStorage): sessões, minutos, humor e versos guardados com ♡
- `js/epub.js`, `js/zip.js`: importação do EPUB sem dependências
- `js/store.js`: IndexedDB e preferências

## Formato dos roteiros

Campos do roteiro: `mode` (`practice`, padrão, ou `after` para o pós-treino), `short` (a palavra do cartão), `icon` (`dots`, `square`, `wave`, `body`, `enso`, `pulse`, `release`, `leaf`), `closing` (tema do trecho que aparece no fim; sem ele, um tema ao acaso).
| tipo | campos |
|---|---|
| `speak` | `text`, **ou** `variants` (lista), **ou** `pool` (nome em `pools.json`): com lista, uma frase por dia, girando pela semana |
| `pause` | `seconds` **ou** `fill` (peso) |
| `bell` | `strikes` |
| `tao` | `theme` (stillness / softness / letting-go / nature) e `maxLines`, **ou** `chapter` + `stanzas` fixos; `lineGap` (s entre versos) |
| `breath` | `pattern` `{inhale, inhale2?, hold?, exhale, holdOut?}` (`inhale2`: segunda inspiração curta, o suspiro fisiológico), `count` `{to, voiced: none/first-round/all}`, `cues` (nº de respirações com "In/Hold/Out" falado), `seconds` **ou** `fill` |

Qualquer passo aceita `minMinutes` / `maxMinutes`: ele só entra quando a duração escolhida está nesse intervalo. Assim o mesmo roteiro serve de 3 a 20 min.

Os passos com `fill` dividem o tempo que sobra até a duração escolhida, em proporção aos pesos.

Com `theme`, o app sorteia um capítulo do tema e uma estrofe curta, evitando os 30 capítulos lidos mais recentemente (temas em `js/tao.js`).

## Testar
Adicione `?fast=20` ao endereço para rodar 20× mais rápido, sem voz.
Ao alterar arquivos, aumente `VERSION` em `sw.js`.
