// Panel lateral: interfaz de los dos modos, llamadas a Ollama y voz de la IA.
import { responderPractica, verificarOllama } from "./llm.js";
import { leerArchivo, prepararMaterial, textoParaIA } from "./material.js";

const $ = (id) => document.getElementById(id);

const AJUSTES_POR_DEFECTO = {
  modelo: "llama3.2:3b",
  url: "http://127.0.0.1:11434",
  modeloWhisper: "auto",
  traducir: true,
  cuadroFlotante: true,
  voz: "",
  velocidad: 0.95,
  umbralVoz: 0.004,
};
let ajustes = { ...AJUSTES_POR_DEFECTO };
let puerto = null;
const estados = {};
let material = null; // { nombre, texto, recortado }

// ================================================================== utilidades de interfaz
function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function agregarAlFeed(feed, el) {
  feed.querySelector(".vacio")?.remove();
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  return el;
}

function mostrarEstado(clave, texto) {
  estados[clave] = texto;
  const t = [estados.stt, estados.llm].filter(Boolean).join(" · ");
  $("estado").textContent = t;
  $("estado").title = t;
}

// ================================================================== conexión con el offscreen
async function conectar() {
  const r = await chrome.runtime.sendMessage({ type: "asegurar-offscreen" });
  if (r?.error) {
    mostrarEstado("stt", "Error: " + r.error);
    return;
  }
  puerto = chrome.runtime.connect({ name: "panel" });
  puerto.onMessage.addListener(manejarMensaje);
  puerto.onDisconnect.addListener(() => {
    puerto = null;
    setTimeout(conectar, 500); // el offscreen aún no estaba listo: reintentamos
  });
  enviarAjustes();
  puerto.postMessage({ type: "precargar", uso: "reunion" });
}

const enviar = (msg) => puerto?.postMessage(msg);
// El offscreen genera las sugerencias de reunión (aunque cierres el panel), así que necesita los
// ajustes y el texto del material.
const enviarAjustes = () => enviar({ type: "ajustes", ajustes: { ...ajustes, materialIA: textoParaIA(material) } });

function manejarMensaje(msg) {
  switch (msg.type) {
    case "estado": mostrarEstado(msg.clave, msg.texto); break;
    case "error": $("aviso-reunion").textContent = msg.texto; break;
    // Reunión
    case "reunion-activa": ponerEscuchando(true); break;
    case "reunion-detenida": ponerEscuchando(false); break;
    case "parcial": $("parcial").textContent = msg.texto ? msg.texto + "…" : ""; break;
    case "final": nuevaFraseReunion(msg); break;
    case "pensando": mostrarPensando(msg); break;
    case "sugerencia": mostrarSugerencia(msg); break;
    case "sin-voz": $("parcial").textContent = "🎵 Sonido sin voz que se entienda (música o ruido)"; break;
    case "reunion-nivel": mostrarNivel(msg); break;
    // Práctica
    case "mic-grabando": ponerGrabando(true); break;
    case "mic-nivel": $("nivel-mic").style.width = Math.min(100, msg.nivel * 600) + "%"; break;
    case "mic-sin-permiso":
      ponerGrabando(false);
      chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      break;
    case "practica-transcribiendo":
      $("btn-hablar").disabled = true;
      $("txt-hablar").textContent = "Transcribiendo…";
      break;
    case "practica-texto": turnoAlumno(msg.texto); break;
  }
}

// ================================================================== MODO REUNIÓN
let escuchando = false;

function ponerEscuchando(si) {
  escuchando = si;
  const b = $("btn-escuchar");
  b.textContent = si ? "■ Dejar de escuchar" : "▶ Escuchar esta pestaña";
  b.classList.toggle("activo", si);
  $("monitor").classList.toggle("oculto", !si);
  if (!si) $("parcial").textContent = "";
}

// Medidor de audio: así se ve al instante que la pestaña suena y que la extensión la oye.
function mostrarNivel({ nivel, voz, cargando }) {
  $("medidor-reunion").style.width = Math.min(100, nivel * 800) + "%";
  const ind = $("indicador");
  ind.classList.toggle("voz", voz && !cargando);
  ind.textContent = cargando
    ? "Cargando Whisper… (el audio se guarda y se transcribe al terminar)"
    : nivel < 0.0005 ? "Silencio en la pestaña" : voz ? "Oyendo voz…" : "Escuchando…";
}

async function alternarEscucha(_evento, tabIdForzado) {
  $("aviso-reunion").textContent = "";
  if (escuchando) {
    enviar({ type: "reunion-detener" });
    return;
  }
  try {
    const tabId = tabIdForzado ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id;
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    enviar({ type: "reunion-iniciar", streamId, tabId });
    if (ajustes.cuadroFlotante) {
      // Cuadro de subtítulos sobre la propia página (como los subtítulos de Chrome).
      chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] }).catch((e) => {
        $("aviso-reunion").textContent = "No pude mostrar el cuadro flotante en esta página (" + e.message + "). " +
          "Los subtítulos siguen aquí en el panel.";
      });
    }
  } catch (e) {
    $("aviso-reunion").textContent =
      "No pude capturar esta pestaña. Ve a la pestaña de Meet, haz clic en el icono de la extensión " +
      "(o Alt+Shift+E) y vuelve a pulsar Escuchar. (" + e.message + ")";
  }
}

function nuevaFraseReunion({ id, texto }) {
  $("parcial").textContent = "";
  const item = crear("div", "item");
  item.dataset.id = id;
  item.appendChild(crear("div", "ellos", texto));
  agregarAlFeed($("feed"), item);
}

const tarjeta = (id) => $("feed").querySelector(`.item[data-id="${id}"]`);

function mostrarPensando({ id }) {
  const item = tarjeta(id);
  if (item && !item.querySelector(".sug")) item.appendChild(crear("div", "sug pensando", "pensando…"));
}

function mostrarSugerencia({ id, respuesta, traduccion, error }) {
  const item = tarjeta(id);
  if (!item) return;
  const sug = item.querySelector(".sug") || item.appendChild(crear("div", "sug"));
  if (traduccion) item.insertBefore(crear("div", "es", traduccion), sug);
  sug.className = "sug";
  sug.textContent = respuesta || error || "";
  $("feed").scrollTop = $("feed").scrollHeight;
}

// ================================================================== MODO PRÁCTICA
let historial = [];
let grabando = false;

function ponerGrabando(si) {
  grabando = si;
  const b = $("btn-hablar");
  b.disabled = false;
  b.classList.toggle("grabando", si);
  $("txt-hablar").textContent = si ? "■ Enviar" : "🎤 Hablar";
  if (!si) $("nivel-mic").style.width = "0";
}

function hablar(texto) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  const voz = speechSynthesis.getVoices().find((v) => v.name === ajustes.voz);
  if (voz) u.voice = voz;
  u.lang = voz?.lang || "en-US";
  u.rate = Number(ajustes.velocidad) || 1;
  speechSynthesis.speak(u);
}

function burbujaIA(texto) {
  const b = crear("div", "burbuja ia", texto);
  const repetir = crear("button", "repetir", "🔊");
  repetir.title = "Escuchar otra vez";
  repetir.onclick = () => hablar(texto);
  b.appendChild(repetir);
  agregarAlFeed($("chat"), b);
}

async function turnoIA() {
  if ($("escenario").value === "material" && !material) {
    agregarAlFeed($("chat"), crear("div", "escribiendo", "Primero carga tu material con 📎 Material (arriba) y vuelve a empezar."));
    $("panel-material").classList.remove("oculto");
    return;
  }
  const escribiendo = agregarAlFeed($("chat"), crear("div", "escribiendo", "…"));
  $("btn-hablar").disabled = true;
  try {
    const r = await responderPractica({
      url: ajustes.url,
      modelo: ajustes.modelo,
      escenario: $("escenario").value,
      nivel: $("nivel").value,
      historial,
      material: textoParaIA(material),
    });
    escribiendo.remove();
    if (r.correccion) {
      const c = crear("div", "correccion", "✔ " + r.correccion);
      if (r.consejo) c.appendChild(crear("small", "", r.consejo));
      agregarAlFeed($("chat"), c);
    }
    historial.push({ role: "assistant", content: r.respuesta });
    burbujaIA(r.respuesta);
    hablar(r.respuesta);
  } catch (e) {
    escribiendo.textContent = "Error: " + e.message;
  }
  $("btn-hablar").disabled = false;
}

function turnoAlumno(texto) {
  ponerGrabando(false);
  texto = (texto || "").trim();
  if (!texto) {
    $("txt-hablar").textContent = "No te escuché, intenta otra vez 🎤";
    return;
  }
  historial.push({ role: "user", content: texto });
  agregarAlFeed($("chat"), crear("div", "burbuja yo", texto));
  turnoIA();
}

function empezarPractica() {
  speechSynthesis.cancel();
  enviar({ type: "mic-cancelar" });
  historial = [];
  $("chat").replaceChildren();
  $("btn-empezar").classList.add("oculto");
  $("btn-hablar").classList.remove("oculto");
  $("form-texto").classList.remove("oculto");
  ponerGrabando(false);
  enviar({ type: "mic-abrir" }); // abrirlo ya: así al pulsar Hablar graba al instante
  turnoIA();
}

function alternarMic() {
  if (grabando) {
    enviar({ type: "mic-terminar" });
  } else {
    const iaHablando = speechSynthesis.speaking;
    speechSynthesis.cancel(); // si la IA está hablando, la callamos para que hables tú
    // El audio de justo antes del clic sirve si empezaste a hablar ya, pero no si era la voz de la IA.
    enviar({ type: "mic-iniciar", conPrevio: !iaHablando });
  }
}

// ================================================================== material
function mostrarMaterial() {
  const n = $("material-nombre");
  n.classList.toggle("activo", !!material);
  n.textContent = material
    ? `📄 ${material.nombre} · ${material.texto.length.toLocaleString("es")} caracteres${material.recortado ? " (recortado)" : ""}`
    : "Sin material";
  n.title = material ? material.texto.slice(0, 400) + "…" : "";
  $("btn-quitar-material").classList.toggle("oculto", !material);
  // Material largo (un libro, varias unidades): eliges de qué parte hablar.
  const sel = $("material-seccion");
  const secciones = material?.secciones ?? [];
  sel.classList.toggle("oculto", secciones.length < 2);
  sel.replaceChildren(
    new Option("Todo (un poco de cada)", "-1"),
    ...secciones.map((s, i) => new Option(s.titulo, String(i))),
  );
  sel.value = String(material?.seccion ?? -1);
}

async function usarMaterial(nuevo) {
  material = nuevo;
  await chrome.storage.local.set({ material });
  mostrarMaterial();
  enviarAjustes();
  $("panel-material").classList.add("oculto");
  $("aviso-material").textContent = "";
  $("escenario").value = "material"; // lo normal es querer practicar justo sobre eso
}

async function cargarArchivo(archivo) {
  $("aviso-material").textContent = "Leyendo " + archivo.name + "…";
  $("panel-material").classList.remove("oculto");
  try {
    await usarMaterial(await leerArchivo(archivo));
  } catch (e) {
    $("aviso-material").textContent = e.message;
  }
}

$("btn-material").addEventListener("click", () => $("panel-material").classList.toggle("oculto"));
$("btn-subir").addEventListener("click", () => $("input-archivo").click());
$("input-archivo").addEventListener("change", (e) => {
  if (e.target.files[0]) cargarArchivo(e.target.files[0]);
  e.target.value = "";
});
$("btn-usar-texto").addEventListener("click", () => {
  const texto = $("texto-material").value;
  if (!texto.trim()) return;
  try {
    usarMaterial(prepararMaterial("Texto pegado", texto));
  } catch (e) {
    $("aviso-material").textContent = e.message;
  }
  $("texto-material").value = "";
});
$("material-seccion").addEventListener("change", async (e) => {
  material.seccion = Number(e.target.value);
  await chrome.storage.local.set({ material });
  enviarAjustes();
});
$("btn-quitar-material").addEventListener("click", async () => {
  material = null;
  await chrome.storage.local.remove("material");
  mostrarMaterial();
});
// Arrastrar y soltar un archivo en cualquier parte del panel.
document.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("arrastrando"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("arrastrando"); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("arrastrando");
  if (e.dataTransfer.files[0]) cargarArchivo(e.dataTransfer.files[0]);
});

// ================================================================== ajustes
async function cargarAjustes() {
  const guardados = await chrome.storage.local.get("ajustes");
  ajustes = { ...AJUSTES_POR_DEFECTO, ...(guardados.ajustes || {}) };
  $("cfg-modelo").value = ajustes.modelo;
  $("cfg-url").value = ajustes.url;
  $("cfg-whisper").value = ajustes.modeloWhisper;
  $("cfg-traducir").checked = ajustes.traducir;
  $("cfg-flotante").checked = ajustes.cuadroFlotante;
  $("cfg-velocidad").value = ajustes.velocidad;
}

async function guardarAjustes() {
  ajustes = {
    ...ajustes,
    modelo: $("cfg-modelo").value.trim() || AJUSTES_POR_DEFECTO.modelo,
    url: ($("cfg-url").value.trim() || AJUSTES_POR_DEFECTO.url).replace(/\/$/, ""),
    modeloWhisper: $("cfg-whisper").value,
    traducir: $("cfg-traducir").checked,
    cuadroFlotante: $("cfg-flotante").checked,
    voz: $("cfg-voz").value,
    velocidad: Number($("cfg-velocidad").value),
  };
  await chrome.storage.local.set({ ajustes });
  enviarAjustes();
  comprobarOllama();
}

function llenarVoces() {
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const sel = $("cfg-voz");
  sel.replaceChildren(...voces.map((v) => new Option(`${v.name} (${v.lang})`, v.name)));
  const preferida = voces.find((v) => v.name === ajustes.voz) || voces.find((v) => v.lang === "en-US") || voces[0];
  if (preferida) {
    sel.value = preferida.name;
    ajustes.voz = preferida.name;
  }
}

async function comprobarOllama() {
  try {
    await verificarOllama(ajustes.url, ajustes.modelo);
    mostrarEstado("llm", ajustes.modelo);
  } catch (e) {
    mostrarEstado("llm", e.message);
  }
}

// Gancho para las pruebas automáticas (tools/e2e.mjs).
globalThis.meetCoach = { escucharPestana: (tabId) => alternarEscucha(null, tabId) };

// ================================================================== inicio
document.querySelectorAll(".pestana").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".pestana").forEach((x) => x.classList.toggle("activa", x === b));
    $("modo-reunion").classList.toggle("oculto", b.dataset.modo !== "reunion");
    $("modo-practica").classList.toggle("oculto", b.dataset.modo !== "practica");
    // El micrófono solo queda abierto mientras estás en el modo Práctica con una conversación en curso.
    if (b.dataset.modo === "practica" && historial.length) enviar({ type: "mic-abrir" });
    if (b.dataset.modo !== "practica") enviar({ type: "mic-cerrar" });
  }),
);
$("btn-escuchar").addEventListener("click", alternarEscucha);
$("btn-limpiar").addEventListener("click", () => {
  $("feed").replaceChildren();
});
$("btn-empezar").addEventListener("click", empezarPractica);
$("btn-nueva").addEventListener("click", empezarPractica);
$("btn-hablar").addEventListener("click", alternarMic);
$("form-texto").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("input-texto").value;
  $("input-texto").value = "";
  if (t.trim()) turnoAlumno(t);
});
for (const id of ["cfg-modelo", "cfg-url", "cfg-whisper", "cfg-traducir", "cfg-flotante", "cfg-voz", "cfg-velocidad"]) {
  $(id).addEventListener("change", guardarAjustes);
}
speechSynthesis.onvoiceschanged = llenarVoces;

await cargarAjustes();
material = (await chrome.storage.local.get("material")).material || null;
mostrarMaterial();
llenarVoces();
comprobarOllama();
conectar();
