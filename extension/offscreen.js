// Documento offscreen (invisible): captura audio de la pestaña y del micrófono,
// separa frases por silencios y las transcribe con Whisper (transformers.js, WebGPU o WASM).
import { Segmentador } from "./segmenter.js";

const FRECUENCIA = 16000;
let panel = null;            // puerto hacia el panel lateral
let ajustes = {};
let whisper = null;          // pipeline de transformers.js
let cargandoWhisper = null;
let colaTranscripcion = Promise.resolve();
let enCola = 0;              // transcripciones esperando o en curso
let enCPU = false;

const enviar = (msg) => panel?.postMessage(msg);
const estado = (texto) => enviar({ type: "estado", clave: "stt", texto });

// ------------------------------------------------------------------ Whisper
// Elige el motor: WebGPU solo con GPU dedicada (NVIDIA/AMD). En las gráficas Intel integradas
// WebGPU es mucho más lento que la CPU y además tarda ~40 s en compilar, así que ni lo intentamos.
async function elegirMotor() {
  const adaptador = navigator.gpu && (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }));
  const fabricante = adaptador?.info?.vendor || "";
  if (adaptador && fabricante !== "intel") return { device: "webgpu", fabricante };
  return { device: "wasm", fabricante };
}

async function cargarWhisper() {
  if (whisper) return whisper;
  if (cargandoWhisper) return cargandoWhisper;
  cargandoWhisper = (async () => {
    const { pipeline, env } = await import("./lib/transformers.min.js");
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("lib/");
    env.backends.onnx.webgpu.powerPreference = "high-performance";
    // Varios hilos en CPU (requiere crossOriginIsolated, activado en el manifest). Más de 4 casi no
    // acelera y deja sin CPU al resto de Chrome (la llamada, el panel).
    env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));

    const { device, fabricante } = await elegirMotor();
    enCPU = device === "wasm";
    const modelo = ajustes.modeloWhisper || "onnx-community/whisper-base.en";
    const nombreCorto = modelo.split("/").pop();
    estado(`Cargando ${nombreCorto} (la 1.ª vez se descarga)…`);
    const p = await pipeline("automatic-speech-recognition", modelo, {
      device,
      dtype: enCPU ? "q8" : { encoder_model: "fp32", decoder_model_merged: "q4" },
      progress_callback: (info) => {
        if (info.status === "progress" && info.file?.endsWith(".onnx")) {
          estado(`Descargando ${nombreCorto}: ${Math.round(info.progress)}%`);
        }
      },
    });
    await p(new Float32Array(FRECUENCIA)); // calentamiento
    whisper = p;
    const hilos = self.crossOriginIsolated ? env.backends.onnx.wasm.numThreads : 1;
    estado(enCPU
      ? `CPU ×${hilos}${fabricante === "intel" ? " (Chrome usa la GPU Intel, ver README)" : ""} · ${nombreCorto}`
      : `GPU ${fabricante} · ${nombreCorto}`);
    enviar({ type: "whisper-listo" });
    return p;
  })().catch((e) => {
    cargandoWhisper = null;
    estado("Error cargando Whisper: " + e.message);
    throw e;
  });
  return cargandoWhisper;
}

function limpiarTexto(texto) {
  return texto
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // [BLANK_AUDIO], (music), (laughs)…
    .replace(/\s+/g, " ")
    .trim();
}

async function transcribir(audio) {
  const p = await cargarWhisper();
  const salida = await p(audio);
  const texto = limpiarTexto(salida.text || "");
  return /thanks for watching|thank you for watching|subscribe/i.test(texto) ? "" : texto;
}

// Las finales van en fila (no se pierde ninguna).
function transcribirEnCola(audio) {
  enCola++;
  const r = colaTranscripcion.then(() => transcribir(audio)).finally(() => enCola--);
  colaTranscripcion = r.catch(() => {});
  return r;
}

// Las parciales solo si Whisper ya cargó y no hay nada pendiente: así nunca se acumula atraso.
// En CPU dejamos además 1 s de respiro entre parciales para no saturar el procesador.
let finUltimoParcial = 0;
function puedeHacerParcial() {
  return whisper && enCola === 0 && performance.now() - finUltimoParcial > (enCPU ? 1000 : 0);
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

async function iniciarReunion(streamId) {
  pararReunion();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  });
  // Capturar una pestaña la silencia: la volvemos a reproducir para que sigas oyendo la llamada.
  const ctxAltavoz = new AudioContext();
  ctxAltavoz.createMediaStreamSource(stream).connect(ctxAltavoz.destination);

  const seg = new Segmentador({
    umbral: ajustes.umbralVoz ?? 0.004,
    intervaloParcial: 0.6,
    maxFrase: 10, // frases largas o música continua: cortamos cada 10 s para que el texto vaya saliendo
    onParcial: async (audio) => {
      if (!audio) return enviar({ type: "parcial", texto: "" });
      // Con menos de 1.2 s Whisper suele inventar ("Good evening.", "Greetings.").
      if (!puedeHacerParcial() || audio.length < FRECUENCIA * 1.2) return;
      // Para el parcial basta con los últimos segundos: mantiene cada pasada rápida.
      const ventana = audio.subarray(Math.max(0, audio.length - FRECUENCIA * (enCPU ? 5 : 10)));
      const texto = await transcribirEnCola(ventana).catch(() => "");
      finUltimoParcial = performance.now();
      if (texto) enviar({ type: "parcial", texto });
    },
    onFinal: async (audio) => {
      const texto = await transcribirEnCola(audio).catch(() => "");
      enviar(texto ? { type: "final", texto } : { type: "sin-voz" });
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
      enviar({ type: "reunion-nivel", nivel: Math.sqrt(s / bloque.length), voz: seg.enFrase, cargando: !whisper });
    }
  });
  detenerReunion = () => {
    detenerCaptura();
    ctxAltavoz.close();
  };
  stream.getAudioTracks()[0].addEventListener("ended", () => {
    pararReunion();
    enviar({ type: "reunion-detenida" });
  });
  cargarWhisper().catch(() => {});
}

function pararReunion() {
  detenerReunion?.();
  detenerReunion = null;
}

// ------------------------------------------------------------------ modo Práctica (micrófono)
let detenerMic = null;
let bloquesMic = [];

async function iniciarMic() {
  pararMicSinEnviar();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    enviar({ type: "mic-sin-permiso", error: e.message });
    return;
  }
  bloquesMic = [];
  detenerMic = await crearCaptura(stream, (bloque) => {
    bloquesMic.push(bloque);
    let s = 0;
    for (let i = 0; i < bloque.length; i++) s += bloque[i] * bloque[i];
    enviar({ type: "mic-nivel", nivel: Math.sqrt(s / bloque.length) });
  });
  enviar({ type: "mic-grabando" });
  cargarWhisper().catch(() => {});
}

function pararMicSinEnviar() {
  detenerMic?.();
  detenerMic = null;
}

async function terminarMic() {
  pararMicSinEnviar();
  const total = bloquesMic.reduce((n, b) => n + b.length, 0);
  const audio = new Float32Array(total);
  let pos = 0;
  for (const b of bloquesMic) { audio.set(b, pos); pos += b.length; }
  bloquesMic = [];
  if (total < FRECUENCIA * 0.4) {
    enviar({ type: "practica-texto", texto: "" });
    return;
  }
  enviar({ type: "practica-transcribiendo" });
  const texto = await transcribirEnCola(audio).catch(() => "");
  enviar({ type: "practica-texto", texto });
}

// ------------------------------------------------------------------ mensajes del panel
chrome.runtime.onConnect.addListener((puerto) => {
  if (puerto.name !== "panel") return;
  panel = puerto;
  puerto.onMessage.addListener(async (msg) => {
    try {
      switch (msg.type) {
        case "ajustes":
          if (whisper && msg.ajustes.modeloWhisper !== ajustes.modeloWhisper) {
            whisper = null;
            cargandoWhisper = null;
          }
          ajustes = msg.ajustes;
          break;
        case "precargar": cargarWhisper().catch(() => {}); break;
        case "reunion-iniciar": await iniciarReunion(msg.streamId); enviar({ type: "reunion-activa" }); break;
        case "reunion-detener": pararReunion(); enviar({ type: "reunion-detenida" }); break;
        case "mic-iniciar": await iniciarMic(); break;
        case "mic-terminar": await terminarMic(); break;
        case "mic-cancelar": pararMicSinEnviar(); break;
      }
    } catch (e) {
      enviar({ type: "error", texto: e.message });
    }
  });
  // Si cierras el panel, dejamos de escuchar.
  puerto.onDisconnect.addListener(() => {
    if (panel === puerto) panel = null;
    pararReunion();
    pararMicSinEnviar();
  });
});
