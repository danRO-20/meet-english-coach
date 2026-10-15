// Panel lateral: interfaz de los dos modos, llamadas a Ollama y voz de la IA.
import { responderPractica, sugerirRespuesta, verificarOllama } from "./llm.js";

const $ = (id) => document.getElementById(id);

const AJUSTES_POR_DEFECTO = {
  modelo: "llama3.2:3b",
  url: "http://127.0.0.1:11434",
  modeloWhisper: "auto",
  traducir: true,
  voz: "",
  velocidad: 0.95,
  umbralVoz: 0.004,
};
let ajustes = { ...AJUSTES_POR_DEFECTO };
let puerto = null;
const estados = {};

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
  puerto.postMessage({ type: "ajustes", ajustes });
  puerto.postMessage({ type: "precargar" });
}

const enviar = (msg) => puerto?.postMessage(msg);

function manejarMensaje(msg) {
  switch (msg.type) {
    case "estado": mostrarEstado(msg.clave, msg.texto); break;
    case "error": $("aviso-reunion").textContent = msg.texto; break;
    // Reunión
    case "reunion-activa": ponerEscuchando(true); break;
    case "reunion-detenida": ponerEscuchando(false); break;
    case "parcial": $("parcial").textContent = msg.texto ? msg.texto + "…" : ""; break;
    case "final": nuevaFraseReunion(msg.texto); break;
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
const contexto = [];          // frases recientes de la otra persona
let pendientes = [];          // frases que esperan sugerencia
let generando = false;

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
    enviar({ type: "reunion-iniciar", streamId });
  } catch (e) {
    $("aviso-reunion").textContent =
      "No pude capturar esta pestaña. Ve a la pestaña de Meet, haz clic en el icono de la extensión " +
      "(o Alt+Shift+E) y vuelve a pulsar Escuchar. (" + e.message + ")";
  }
}

function nuevaFraseReunion(texto) {
  $("parcial").textContent = "";
  const item = crear("div", "item");
  item.appendChild(crear("div", "ellos", texto));
  agregarAlFeed($("feed"), item);
  if (texto.split(/\s+/).length < 2) return; // "Yeah.", "Okay." no necesitan sugerencia
  pendientes.push({ texto, item });
  procesarPendientes();
}

async function procesarPendientes() {
  if (generando || pendientes.length === 0) return;
  generando = true;
  // Si la persona dijo varias frases seguidas, respondemos a todas juntas en la última tarjeta.
  const lote = pendientes;
  pendientes = [];
  const frase = lote.map((p) => p.texto).join(" ");
  const item = lote.at(-1).item;
  const sug = item.appendChild(crear("div", "sug pensando", "pensando…"));
  try {
    const { respuesta, traduccion } = await sugerirRespuesta({
      url: ajustes.url,
      modelo: ajustes.modelo,
      frase,
      contexto: contexto.slice(-6),
      traducir: ajustes.traducir,
    });
    if (traduccion) item.insertBefore(crear("div", "es", traduccion), sug);
    sug.className = "sug";
    sug.textContent = respuesta;
    $("feed").scrollTop = $("feed").scrollHeight;
  } catch (e) {
    sug.textContent = "Sin sugerencia: " + e.message;
  }
  contexto.push(frase);
  generando = false;
  procesarPendientes();
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
  const escribiendo = agregarAlFeed($("chat"), crear("div", "escribiendo", "…"));
  $("btn-hablar").disabled = true;
  try {
    const r = await responderPractica({
      url: ajustes.url,
      modelo: ajustes.modelo,
      escenario: $("escenario").value,
      nivel: $("nivel").value,
      historial,
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

// ================================================================== ajustes
async function cargarAjustes() {
  const guardados = await chrome.storage.local.get("ajustes");
  ajustes = { ...AJUSTES_POR_DEFECTO, ...(guardados.ajustes || {}) };
  $("cfg-modelo").value = ajustes.modelo;
  $("cfg-url").value = ajustes.url;
  $("cfg-whisper").value = ajustes.modeloWhisper;
  $("cfg-traducir").checked = ajustes.traducir;
  $("cfg-velocidad").value = ajustes.velocidad;
}

async function guardarAjustes() {
  ajustes = {
    ...ajustes,
    modelo: $("cfg-modelo").value.trim() || AJUSTES_POR_DEFECTO.modelo,
    url: ($("cfg-url").value.trim() || AJUSTES_POR_DEFECTO.url).replace(/\/$/, ""),
    modeloWhisper: $("cfg-whisper").value,
    traducir: $("cfg-traducir").checked,
    voz: $("cfg-voz").value,
    velocidad: Number($("cfg-velocidad").value),
  };
  await chrome.storage.local.set({ ajustes });
  enviar({ type: "ajustes", ajustes });
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
  contexto.length = 0;
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
for (const id of ["cfg-modelo", "cfg-url", "cfg-whisper", "cfg-traducir", "cfg-voz", "cfg-velocidad"]) {
  $(id).addEventListener("change", guardarAjustes);
}
speechSynthesis.onvoiceschanged = llenarVoces;

await cargarAjustes();
llenarVoces();
comprobarOllama();
conectar();
