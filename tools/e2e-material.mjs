// Prueba del "material": crea un PDF (un CV de ejemplo), lo carga en el panel y comprueba que
// la práctica y las sugerencias de reunión lo usan.
//   node tools/e2e-material.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const aqui = dirname(fileURLToPath(import.meta.url));
const perfil = mkdtempSync(join(tmpdir(), "meet-coach-material-"));
const pdf = join(perfil, "cv-ejemplo.pdf");
const navegador = await puppeteer.launch({
  executablePath: process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: false, pipe: true, enableExtensions: true, userDataDir: perfil,
  // Micrófono simulado: sin esto se abre la pestaña de permiso y el panel queda en segundo plano.
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s", ...a);
try {
  // 1) Un PDF de verdad, generado por Chrome.
  const hoja = await navegador.newPage();
  await hoja.setContent(`<h1>Ana Torres</h1><p>Frontend developer · Arequipa, Peru</p>
    <h2>Experience</h2><p>2023-2026: React developer at PayFlow, a fintech startup. Built the checkout used by 40,000 users
    and cut page load time by 35%.</p><h2>Skills</h2><p>React, TypeScript, Node.js, PostgreSQL, Figma.</p>
    <h2>Education</h2><p>Software Engineering, Universidad Nacional de San Agustín.</p>`);
  await hoja.pdf({ path: pdf, format: "A4" });
  await hoja.close();

  const id = await navegador.installExtension(resolve(aqui, "..", "extension"));
  const p = await navegador.newPage();
  p.on("pageerror", (e) => log("[panel error]", e.message));
  await p.goto(`chrome-extension://${id}/sidepanel.html`);
  await new Promise((r) => setTimeout(r, 1500));

  // 2) Cargarlo con el botón de archivo.
  await p.click("#btn-material");
  await (await p.$("#input-archivo")).uploadFile(pdf);
  await p.waitForFunction(() => document.getElementById("material-nombre").classList.contains("activo"), { timeout: 20000 });
  log("material:", await p.$eval("#material-nombre", (e) => e.textContent));
  log("texto extraído:", JSON.stringify((await p.evaluate(async () => (await chrome.storage.local.get("material")).material.texto)).slice(0, 160)));

  // 3) Práctica "Sobre mi material".
  await p.click('[data-modo="practica"]');
  log("escenario:", await p.$eval("#escenario", (e) => e.value));
  await p.click("#btn-empezar");
  await p.waitForFunction(() => document.querySelector("#chat .burbuja.ia") || /Error/.test(document.getElementById("chat").innerText), { timeout: 60000 });
  log("chat:", await p.$eval("#chat", (e) => e.innerText));
  log("IA (práctica sobre el CV):", await p.$eval("#chat .burbuja.ia", (e) => e.innerText));

  // 4) Entrevista + material: la IA debería basarse en el CV.
  await p.select("#escenario", "entrevista");
  await p.click("#btn-nueva");
  await p.waitForFunction(() => document.querySelector("#chat .burbuja.ia"), { timeout: 60000 });
  log("IA (entrevista con CV):", await p.$eval("#chat .burbuja.ia", (e) => e.innerText));

  // 5) Sugerencia de reunión con el material.
  const sug = await p.evaluate(async () => {
    const { sugerirRespuesta } = await import("./llm.js");
    const { material } = await chrome.storage.local.get("material");
    const args = { url: "http://127.0.0.1:11434", modelo: "llama3.2:3b", contexto: [], traducir: true };
    return {
      conMaterial: await sugerirRespuesta({ ...args, frase: "So, tell me a little about yourself and your last job.", material }),
      sinMaterial: await sugerirRespuesta({ ...args, frase: "So, tell me a little about yourself and your last job." }),
    };
  });
  log("Reunión con material:", sug.conMaterial.respuesta);
  log("Reunión sin material:", sug.sinMaterial.respuesta);
} finally {
  await navegador.close();
  rmSync(perfil, { recursive: true, force: true });
}
