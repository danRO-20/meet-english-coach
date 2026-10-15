// Prueba del modo Práctica con un micrófono simulado que "dice" un WAV.
//   node tools/e2e-practica.mjs [ruta.wav]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const aqui = dirname(fileURLToPath(import.meta.url));
const wav = resolve(process.argv[2] || join(aqui, "prueba.wav"));
const perfil = mkdtempSync(join(tmpdir(), "meet-coach-practica-"));
const navegador = await puppeteer.launch({
  executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: false, pipe: true, enableExtensions: true, userDataDir: perfil,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`],
});
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s", ...a);
const chat = (p) => p.evaluate(() => [...document.querySelectorAll("#chat > *")].map((e) => `[${e.className}] ${e.innerText.replace(/\n/g, " ")}`));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const id = await navegador.installExtension(resolve(aqui, "..", "extension"));
  const p = await navegador.newPage();
  p.on("pageerror", (e) => log("[panel error]", e.message));
  await p.goto(`chrome-extension://${id}/sidepanel.html`);
  await esperar(1500);
  await p.click('[data-modo="practica"]');
  await p.select("#escenario", "entrevista");
  await p.click("#btn-empezar");
  await p.waitForFunction(() => document.querySelector("#chat .burbuja.ia"), { timeout: 30000 });
  log("IA empieza:", (await chat(p)).join(" / "));

  await p.click("#btn-hablar");
  await esperar(9000); // el micrófono simulado "habla" el WAV
  log("botón mientras graba:", await p.$eval("#txt-hablar", (e) => e.textContent));
  await p.click("#btn-hablar");
  await p.waitForFunction(() => document.querySelectorAll("#chat .burbuja.ia").length >= 2, { timeout: 90000 });
  log("después de hablar:");
  for (const linea of await chat(p)) log("   ", linea);
  log("estado:", await p.$eval("#estado", (e) => e.textContent));
} finally {
  await navegador.close();
  rmSync(perfil, { recursive: true, force: true });
}
