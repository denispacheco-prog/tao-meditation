# vendor/

Motor das vozes naturais (Piper), copiado para o repositório com versão fixa.
Nada vem de CDN: o site divide a origem `denispacheco-prog.github.io` com o
artigos, que guarda um token do GitHub no localStorage, e todo código que roda
aqui tem acesso a ele.

| Pasta | Origem | Licença |
|---|---|---|
| `onnxruntime-web-1.30.0/` | npm `onnxruntime-web@1.30.0` (Microsoft), arquivos `dist/ort.wasm.min.mjs`, `dist/ort-wasm-simd-threaded.mjs` e `.wasm`. A linha `sourceMappingURL` foi removida (o `.map` não veio). | MIT |
| `piper-phonemize-1.0.0/` | npm `@diffusionstudio/piper-wasm@1.0.0`, pasta `build/`. `piper_phonemize.mjs` é o `piper_phonemize.js` original com `export default createPiperPhonemize;` no fim, para ser importado como módulo. | MIT (o invólucro); inclui o espeak-ng compilado e seus dados, **GPL-3.0**: código-fonte em https://github.com/espeak-ng/espeak-ng e https://github.com/rhasspy/piper-phonemize |

Os modelos de voz não ficam aqui: o app baixa de
https://huggingface.co/rhasspy/piper-voices (cada voz tem seu `MODEL_CARD`
com a licença) e guarda no aparelho.

Para trocar de versão, crie uma pasta nova com o número da versão (o service
worker guarda `vendor/` por caminho, sem revalidar) e atualize os imports em
`js/piper-worker.js`.
