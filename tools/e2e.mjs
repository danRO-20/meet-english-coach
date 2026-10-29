// Prueba de punta a punta con la extensión instalada en un Chrome aparte (perfil temporal):
// reproduce un WAV en una pestaña, la "escucha" con la extensión y registra lo que muestra el panel.
// Con una carpeta como 3.er argumento guarda capturas del cuadro flotante sobre la página.
//   node tools/e2e.mjs [ruta.wav] [segundos] [carpeta-capturas]
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "..");
const wav = resolve(process.argv[2] || join(aqui, "prueba.wav"));
const segundos = Number(process.argv[3] || 90);
const carpetaCapturas = process.argv[4];
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Servidor mínimo: una página que reproduce el WAV en bucle.
const servidor = createServer((req, res) => {
  if (req.url.startsWith("/audio.wav")) {
    res.writeHead(200, { "Content-Type": "audio/wav" });
    return res.end(readFileSync(wav));
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end('<title>Audio de prueba</title><audio id="a" src="/audio.wav" loop autoplay controls></audio>');
}).listen(8766);

const perfil = mkdtempSync(join(tmpdir(), "meet-coach-e2e-"));
// Copia de la extensión con permiso para inyectar el cuadro flotante en la página de prueba
// (en el uso real ese permiso lo da el clic en el icono, que un script no puede hacer).
const copia = join(perfil, "extension");
cpSync(join(raiz, "extension"), copia, { recursive: true });
const manifest = JSON.parse(readFileSync(join(copia, "manifest.json"), "utf8"));
manifest.host_permissions.push("http://localhost:8766/*");
writeFileSync(join(copia, "manifest.json"), JSON.stringify(manifest, null, 2));
const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  pipe: true,
  enableExtensions: true,
  userDataDir: perfil,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1100,800",
    // Permite tabCapture sin el clic en el icono (que un script no puede hacer).
    `--allowlisted-extension-id=${readFileSync(join(aqui, ".extension-id"), "utf8").trim()}`,
  ],
});
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + "s", ...a);

try {
  const id = await navegador.installExtension(copia);
  log("extensión instalada:", id);

  const audio = await navegador.newPage();
  await audio.goto("http://localhost:8766/");
  await audio.evaluate(() => document.getElementById("a").play());

  const panel = await navegador.newPage();
  panel.on("console", (m) => log("[panel console]", m.text()));
  panel.on("pageerror", (e) => log("[panel error]", e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await new Promise((r) => setTimeout(r, 1500));
  // IDIOMA=es para probar los subtítulos en español.
  if (process.env.IDIOMA) await panel.select("#idioma-audio", process.env.IDIOMA);

  const resultado = await panel.evaluate(async () => {
    // Sin el permiso "tabs" no vemos URLs: la pestaña de audio es la anterior a la del panel.
    const actual = await chrome.tabs.getCurrent();
    const pestana = (await chrome.tabs.query({ windowId: actual.windowId })).find((t) => t.index === actual.index - 1);
    try {
      await globalThis.meetCoach.escucharPestana(pestana.id);
      return { ok: true, aviso: document.getElementById("aviso-reunion").textContent };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  log("escuchar:", JSON.stringify(resultado));
  await audio.bringToFront(); // como en una llamada real: la pestaña de Meet delante

  // Cada vez que cambia el texto en vivo, apuntamos la hora: así se ve cada cuánto se actualiza.
  await panel.evaluate(() => {
    globalThis.__cambios = [];
    new MutationObserver(() => globalThis.__cambios.push([performance.now(), document.getElementById("parcial").textContent]))
      .observe(document.getElementById("parcial"), { childList: true, characterData: true, subtree: true });
  });
  let captura = 0;
  if (carpetaCapturas) {
    const intervalo = setInterval(async () => {
      try { await audio.screenshot({ path: join(carpetaCapturas, `overlay-${++captura}.png`) }); } catch {}
    }, 2500);
    setTimeout(() => clearInterval(intervalo), segundos * 1000);
  }

  let anterior = "";
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) {
    const estado = await panel.evaluate(() => ({
      estado: document.getElementById("estado").textContent,
      boton: document.getElementById("btn-escuchar").textContent,
      aviso: document.getElementById("aviso-reunion").textContent,
      parcial: document.getElementById("parcial").textContent,
      indicador: document.getElementById("indicador")?.textContent ?? "",
      feed: [...document.querySelectorAll("#feed .item")].map((i) => i.innerText.replace(/\n+/g, " | ")),
    }));
    const texto = JSON.stringify(estado);
    if (texto !== anterior) {
      log(texto);
      anterior = texto;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const cambios = await panel.evaluate(() => globalThis.__cambios.filter(([, t]) => t));
  const pasos = cambios.slice(1).map(([t], i) => t - cambios[i][0]).filter((d) => d < 3000);
  log(`texto en vivo: ${cambios.length} actualizaciones; cada ${(pasos.reduce((a, b) => a + b, 0) / Math.max(1, pasos.length) / 1000).toFixed(2)} s de media mientras hablan`);
} finally {
  await navegador.close();
  servidor.close();
  rmSync(perfil, { recursive: true, force: true });
}
