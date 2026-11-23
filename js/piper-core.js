// Piper neural text-to-speech: text -> phoneme ids (espeak-ng compiled to
// wasm) -> audio samples (ONNX model). Shared by the browser worker and
// by local tests in Node, so it takes its dependencies as arguments.

export async function createPiper({ ort, createPhonemize, locateFile }) {
  // The phonemizer is created once and its main() is called per sentence;
  // it answers synchronously through print().
  let answer = null;
  const phonemizer = await createPhonemize({
    print: line => { answer = JSON.parse(line).phoneme_ids; },
    printErr: () => {},               // espeak warnings are not fatal
    locateFile,
    noInitialRun: true,
  });

  let session = null;
  let config = null;

  function phonemeIds(text) {
    answer = null;
    phonemizer.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]),
      '--espeak_data', '/espeak-ng-data']);
    if (!answer) throw new Error('Could not phonemize: ' + text);
    return answer;
  }

  return {
    async load(model, modelConfig) {
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      config = modelConfig;
    },

    // slow > 1 stretches the speech (Piper's length_scale).
    async synth(text, slow = 1) {
      if (!session) throw new Error('No voice loaded.');
      const ids = phonemeIds(text.trim());
      const { noise_scale, length_scale, noise_w } = config.inference;
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
        scales: new ort.Tensor('float32', Float32Array.from([noise_scale, length_scale * slow, noise_w])),
      };
      if (Object.keys(config.speaker_id_map || {}).length) {
        feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]));
      }
      const { output } = await session.run(feeds);
      return { pcm: Float32Array.from(output.data), sampleRate: config.audio.sample_rate };
    },
  };
}
