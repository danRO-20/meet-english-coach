// Mide la velocidad de Whisper dentro de la extensión (mismo origen y aislamiento que el offscreen).
//   node tools/bench.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const aqui = dirname(fileURLToPath(import.meta.url));
const perfil = mkdtempSync(join(tmpdir(), "meet-coach-bench-"));
const navegador = await puppeteer.launch({
  executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: false, pipe: true, enableExtensions: true, userDataDir: perfil,
});
try {
  const id = await navegador.installExtension(resolve(aqui, "..", "extension"));
  const p = await navegador.newPage();
  await p.goto(`chrome-extension://${id}/permission.html`);
  const wav = readFileSync(join(aqui, "prueba.wav")).toString("base64");
  p.setDefaultTimeout(0);
  const r = await p.evaluate(async (wavB64) => {
    const { pipeline, env } = await import("./lib/transformers.min.js");
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
    const bytes = Uint8Array.from(atob(wavB64), (c) => c.charCodeAt(0));
    const audio = (await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer)).getChannelData(0);
    const clip = audio.slice(16000 * 3.5, 16000 * 8.5); // "So, how was your weekend?…"
    const out = { coi: self.crossOriginIsolated, cores: navigator.hardwareConcurrency, filas: [] };
    for (const [modelo, hilos] of [["whisper-tiny.en", 4], ["whisper-tiny.en", 8], ["whisper-base.en", 4], ["whisper-base.en", 8]]) {
      env.backends.onnx.wasm.numThreads = hilos;
      const asr = await pipeline("automatic-speech-recognition", "onnx-community/" + modelo, { device: "wasm", dtype: "q8" });
      await asr(clip);
      const t = performance.now();
      const txt = (await asr(clip)).text;
      out.filas.push({ modelo, hilos, seg: ((performance.now() - t) / 1000).toFixed(2), txt });
      await asr.dispose();
    }
    return out;
  }, wav);
  console.log(JSON.stringify(r, null, 1));
} finally {
  await navegador.close();
  rmSync(perfil, { recursive: true, force: true });
}
