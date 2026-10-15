// Documento offscreen (invisible): captura audio de la pestaña y del micrófono, separa frases por
// silencios, las transcribe con Whisper (transformers.js, WebGPU o WASM) y en el modo Reunión genera
// la respuesta sugerida. Manda todo al panel lateral y al cuadro flotante de la página.
import { sugerirRespuesta } from "./llm.js";
import { Segmentador } from "./segmenter.js";

const FRECUENCIA = 16000;
let panel = null;            // puerto hacia el panel lateral
let ajustes = {};            // incluye materialIA (texto del material ya recortado por el panel)
let colaTranscripcion = Promise.resolve();
let enCola = 0;              // transcripciones esperando o en curso
let motor = null;            // { device, fabricante }
const modelos = new Map();   // nombre del modelo → Promise<pipeline>
const listos = new Set();    // modelos ya cargados

const enviar = (msg) => panel?.postMessage(msg);
const estado = (texto) => enviar({ type: "estado", clave: "stt", texto });

// ------------------------------------------------------------------ Whisper
// WebGPU solo con GPU dedicada (NVIDIA/AMD). En las gráficas Intel integradas WebGPU es mucho más
// lento que la CPU y además tarda ~40 s en compilar, así que ni lo intentamos.
async function elegirMotor() {
  if (motor) return motor;
  const adaptador = navigator.gpu && (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }));
  const fabricante = adaptador?.info?.vendor || "";
  motor = { device: adaptador && fabricante !== "intel" ? "webgpu" : "wasm", fabricante };
  return motor;
}
const enCPU = () => motor?.device !== "webgpu";

// "auto": en Reunión base.en (rápido: el texto sale casi al instante); en Práctica small.en con GPU
// (más preciso con acento no nativo, y ahí no importa medio segundo más).
function modeloPara(uso) {
  const elegido = ajustes.modeloWhisper || "auto";
  if (elegido !== "auto") return elegido;
  return `onnx-community/whisper-${uso === "practica" && !enCPU() ? "small" : "base"}.en`;
}

async function cargarWhisper(uso) {
  await elegirMotor();
  const modelo = modeloPara(uso);
  if (modelos.has(modelo)) return modelos.get(modelo);
  const carga = (async () => {
    const { pipeline, env } = await import("./lib/transformers.min.js");
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
    env.backends.onnx.webgpu.powerPreference = "high-performance";
    // Varios hilos en CPU (requiere crossOriginIsolated, activado en el manifest). Más de 4 casi no
    // acelera y deja sin CPU al resto de Chrome (la llamada, el panel).
    env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));

    const nombreCorto = modelo.split("/").pop();
    estado(`Cargando ${nombreCorto} (la 1.ª vez se descarga)…`);
    const p = await pipeline("automatic-speech-recognition", modelo, {
      device: motor.device,
      dtype: enCPU() ? "q8" : { encoder_model: "fp32", decoder_model_merged: "q4" },
      progress_callback: (info) => {
        if (info.status === "progress" && info.file?.endsWith(".onnx")) {
          estado(`Descargando ${nombreCorto}: ${Math.round(info.progress)}%`);
        }
      },
    });
    await p(new Float32Array(FRECUENCIA)); // calentamiento
    listos.add(modelo);
    const hilos = self.crossOriginIsolated ? env.backends.onnx.wasm.numThreads : 1;
    estado(enCPU()
      ? `CPU ×${hilos}${motor.fabricante === "intel" ? " (Chrome usa la GPU Intel, ver README)" : ""} · ${nombreCorto}`
      : `GPU ${motor.fabricante} · ${nombreCorto}`);
    return p;
  })().catch((e) => {
    modelos.delete(modelo);
    estado("Error cargando Whisper: " + e.message);
    throw e;
  });
  modelos.set(modelo, carga);
  return carga;
}

function limpiarTexto(texto) {
  return texto
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [BLANK_AUDIO], (music), (laughs)…
    .replace(/\s+/g, " ")
    .trim();
}

async function transcribir(audio, uso) {
  const p = await cargarWhisper(uso);
  // Whisper procesa ventanas de 30 s: para audios más largos lo partimos en trozos solapados.
  const salida = await p(audio, audio.length > FRECUENCIA * 28 ? { chunk_length_s: 30, stride_length_s: 5 } : {});
  const texto = limpiarTexto(salida.text || "");
  return /thanks for watching|thank you for watching|subscribe/i.test(texto) ? "" : texto;
}

// Una transcripción a la vez, en orden (no se pierde ninguna final).
function transcribirEnCola(audio, uso) {
  enCola++;
  const r = colaTranscripcion.then(() => transcribir(audio, uso)).finally(() => enCola--);
  colaTranscripcion = r.catch(() => {});
  return r;
}

// ------------------------------------------------------------------ captura con AudioWorklet
async function crearCaptura(stream, alRecibir) {
  const ctx = new AudioContext({ sampleRate: FRECUENCIA }); // Chrome remuestrea a 16 kHz por nosotros
  await ctx.audioWorklet.addModule("audio-processor.js");
  const fuente = ctx.createMediaStreamSource(stream);
  const nodo = new AudioWorkletNode(ctx, "captura-pcm", { numberOfOutputs: 0 });
  nodo.port.onmessage = (e) => alRecibir(e.data);
  fuente.connect(nodo);
  return () => {
    fuente.disconnect();
    nodo.port.onmessage = null;
    ctx.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

// ------------------------------------------------------------------ modo Reunión (audio de la pestaña)
let detenerReunion = null;
let pestanaReunion = null;   // pestaña escuchada: ahí vive el cuadro flotante
let idFrase = 0;
const contextoReunion = [];  // frases recientes de la otra persona
let pendientes = [];         // frases que esperan sugerencia
let generando = false;

// Al panel y al cuadro flotante de la página (vía background, que es quien puede hablar con pestañas).
function difundir(msg) {
  enviar(msg);
  if (pestanaReunion != null) chrome.runtime.sendMessage({ type: "a-overlay", tabId: pestanaReunion, msg }).catch(() => {});
}

// La sugerencia se pide cuando la persona se calla (el segmentador cierra la frase tras ~0.7 s de
// silencio). Si siguió hablando mientras la IA pensaba, se responde a la última frase y las
// anteriores pasan a ser contexto (así la traducción corresponde a la frase que se ve).
async function procesarPendientes() {
  if (generando || pendientes.length === 0) return;
  generando = true;
  const lote = pendientes;
  pendientes = [];
  contextoReunion.push(...lote.slice(0, -1).map((p) => p.texto));
  const { id, texto: frase } = lote.at(-1);
  difundir({ type: "pensando", id });
  try {
    const r = await sugerirRespuesta({
      url: ajustes.url || "http://127.0.0.1:11434",
      modelo: ajustes.modelo || "llama3.2:3b",
      frase,
      contexto: contextoReunion.slice(-6),
      traducir: ajustes.traducir ?? true,
      material: ajustes.materialIA,
    });
    difundir({ type: "sugerencia", id, respuesta: r.respuesta, traduccion: r.traduccion });
  } catch (e) {
    difundir({ type: "sugerencia", id, respuesta: "", traduccion: "", error: "Sin sugerencia: " + e.message });
  }
  contextoReunion.push(frase);
  generando = false;
  procesarPendientes();
}

async function iniciarReunion(streamId, tabId) {
  pararReunion();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  });
  pestanaReunion = tabId ?? null;
  // Capturar una pestaña la silencia: la volvemos a reproducir para que sigas oyendo la llamada.
  const ctxAltavoz = new AudioContext();
  ctxAltavoz.createMediaStreamSource(stream).connect(ctxAltavoz.destination);

  const modelo = modeloPara("reunion");
  let finUltimoParcial = 0;
  const seg = new Segmentador({
    umbral: ajustes.umbralVoz ?? 0.004,
    silencioFin: 0.7,
    intervaloParcial: 0.3,
    maxFrase: 10, // frases largas o música continua: cortamos cada 10 s para que el texto vaya saliendo
    onParcial: async (audio) => {
      if (!audio) return difundir({ type: "parcial", texto: "" });
      // Solo si el modelo ya cargó y no hay nada pendiente: así nunca se acumula atraso. En CPU,
      // además, 1 s de respiro entre parciales para no saturar el procesador.
      if (!listos.has(modelo) || enCola > 0 || performance.now() - finUltimoParcial < (enCPU() ? 1000 : 0)) return;
      // Con menos de 0.8 s Whisper suele inventar ("Good evening.", "Greetings.").
      if (audio.length < FRECUENCIA * 0.8) return;
      // Para el parcial bastan los últimos segundos: mantiene cada pasada rápida.
      const ventana = audio.subarray(Math.max(0, audio.length - FRECUENCIA * (enCPU() ? 5 : 8)));
      const texto = await transcribirEnCola(ventana, "reunion").catch(() => "");
      finUltimoParcial = performance.now();
      if (texto) difundir({ type: "parcial", texto });
    },
    onFinal: async (audio) => {
      const texto = await transcribirEnCola(audio, "reunion").catch(() => "");
      if (!texto) return difundir({ type: "sin-voz" });
      const id = ++idFrase;
      difundir({ type: "final", id, texto });
      // "Yeah.", "Okay." no necesitan sugerencia.
      if (texto.split(/\s+/).length >= 2) {
        pendientes.push({ id, texto });
        procesarPendientes();
      }
    },
  });
  let ultimoNivel = 0;
  const detenerCaptura = await crearCaptura(stream, (bloque) => {
    seg.empujar(bloque);
    const ahora = performance.now();
    if (ahora - ultimoNivel > 150) {
      ultimoNivel = ahora;
      let s = 0;
      for (let i = 0; i < bloque.length; i++) s += bloque[i] * bloque[i];
      difundir({ type: "reunion-nivel", nivel: Math.sqrt(s / bloque.length), voz: seg.enFrase, cargando: !listos.has(modelo) });
    }
  });
  detenerReunion = () => {
    detenerCaptura();
    ctxAltavoz.close();
  };
  stream.getAudioTracks()[0].addEventListener("ended", () => pararReunion());
  cargarWhisper("reunion").catch(() => {});
}

function pararReunion() {
  if (!detenerReunion) return;
  detenerReunion();
  detenerReunion = null;
  difundir({ type: "reunion-detenida" });
  pestanaReunion = null;
}

// ------------------------------------------------------------------ modo Práctica (micrófono)
// El micrófono queda abierto mientras estás en el modo Práctica: así no se pierden las primeras
// palabras esperando a que abra, y guardamos ~0.5 s de antes del clic por si empezaste a hablar ya.
const BLOQUES_PREVIOS = 5;   // bloques de 100 ms
let detenerMic = null;
let abriendoMic = null;
let grabandoMic = false;
let bloquesMic = [];
let previosMic = [];

function abrirMic() {
  if (detenerMic) return Promise.resolve(true);
  if (abriendoMic) return abriendoMic;
  abriendoMic = (async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      enviar({ type: "mic-sin-permiso", error: e.message });
      return false;
    }
    detenerMic = await crearCaptura(stream, (bloque) => {
      if (!grabandoMic) {
        previosMic.push(bloque);
        if (previosMic.length > BLOQUES_PREVIOS) previosMic.shift();
        return;
      }
      bloquesMic.push(bloque);
      let s = 0;
      for (let i = 0; i < bloque.length; i++) s += bloque[i] * bloque[i];
      enviar({ type: "mic-nivel", nivel: Math.sqrt(s / bloque.length) });
    });
    return true;
  })().finally(() => { abriendoMic = null; });
  return abriendoMic;
}

async function iniciarMic({ conPrevio = true } = {}) {
  if (!(await abrirMic())) return;
  // Si la IA estaba hablando justo antes, el audio previo tendría su voz: lo descartamos.
  bloquesMic = conPrevio ? previosMic.splice(0) : [];
  previosMic = [];
  grabandoMic = true;
  enviar({ type: "mic-grabando" });
  cargarWhisper("practica").catch(() => {});
}

function cerrarMic() {
  grabandoMic = false;
  bloquesMic = [];
  previosMic = [];
  detenerMic?.();
  detenerMic = null;
}

function pararMicSinEnviar() {
  grabandoMic = false;
  bloquesMic = [];
}

async function terminarMic() {
  if (!grabandoMic) return;
  // Seguimos grabando 0.6 s más: al pulsar "Enviar" casi siempre estás terminando la última palabra.
  enviar({ type: "practica-transcribiendo" });
  await new Promise((r) => setTimeout(r, 600));
  grabandoMic = false;
  const total = bloquesMic.reduce((n, b) => n + b.length, 0);
  const audio = new Float32Array(total);
  let pos = 0;
  for (const b of bloquesMic) { audio.set(b, pos); pos += b.length; }
  bloquesMic = [];
  if (total < FRECUENCIA * 0.4) {
    enviar({ type: "practica-texto", texto: "" });
    return;
  }
  const texto = await transcribirEnCola(audio, "practica").catch(() => "");
  enviar({ type: "practica-texto", texto });
}

// ------------------------------------------------------------------ órdenes
async function manejarOrden(msg) {
  try {
    switch (msg.type) {
      case "ajustes":
        // Si cambió el modelo elegido, se carga el nuevo la próxima vez que haga falta.
        if (msg.ajustes.modeloWhisper !== ajustes.modeloWhisper) { modelos.clear(); listos.clear(); }
        ajustes = msg.ajustes;
        break;
      case "precargar": cargarWhisper(msg.uso || "reunion").catch(() => {}); break;
      case "reunion-iniciar":
        await iniciarReunion(msg.streamId, msg.tabId);
        difundir({ type: "reunion-activa" });
        break;
      case "reunion-detener": pararReunion(); break;
      case "mic-abrir": await abrirMic(); break;
      case "mic-iniciar": await iniciarMic(msg); break;
      case "mic-terminar": await terminarMic(); break;
      case "mic-cancelar": pararMicSinEnviar(); break;
      case "mic-cerrar": cerrarMic(); break;
    }
  } catch (e) {
    enviar({ type: "error", texto: e.message });
  }
}

// Panel lateral (puerto) …
chrome.runtime.onConnect.addListener((puerto) => {
  if (puerto.name !== "panel") return;
  panel = puerto;
  puerto.onMessage.addListener(manejarOrden);
  if (detenerReunion) enviar({ type: "reunion-activa" }); // el panel se reabrió con la escucha en marcha
  // Si cierras el panel se apaga el micrófono, pero la escucha de la reunión sigue: el cuadro
  // flotante tiene su propio botón para pararla.
  puerto.onDisconnect.addListener(() => {
    if (panel === puerto) panel = null;
    cerrarMic();
  });
});
// … y el cuadro flotante (mensajes sueltos con target "offscreen").
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === "offscreen") manejarOrden(msg);
});
