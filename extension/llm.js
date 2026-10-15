// Llamadas a Ollama (LLM local) y los prompts de cada modo.

export const ESCENARIOS = {
  libre: "a relaxed, friendly conversation about everyday topics (hobbies, work, weekend, plans)",
  entrevista: "a job interview for a software developer position; you are the interviewer",
  restaurante: "ordering food at a restaurant; you are the waiter",
  viaje: "checking in at an airport and a hotel; you are the airline/hotel staff",
  reunion: "a work video call with a teammate about project status, deadlines and blockers",
};

export const NIVELES = {
  basico: "beginner (A2): use very simple words and short sentences, speak slowly",
  intermedio: "intermediate (B1-B2): use natural everyday English",
  avanzado: "advanced (C1): use rich, idiomatic English",
};

export async function ollamaChat({ url, modelo, mensajes, formato, temperatura = 0.5, maxTokens = 200 }) {
  const cuerpo = {
    model: modelo,
    messages: mensajes,
    stream: false,
    keep_alive: "30m",
    options: { temperature: temperatura, num_predict: maxTokens },
  };
  if (formato) cuerpo.format = formato;
  const r = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const datos = await r.json();
  return datos.message?.content?.trim() ?? "";
}

function leerJSON(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return {};
  }
}

export async function verificarOllama(url, modelo) {
  let r;
  try {
    r = await fetch(`${url}/api/tags`);
  } catch {
    throw new Error("Ollama no está corriendo. Ábrelo desde el menú Inicio.");
  }
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const nombres = (await r.json()).models?.map((m) => m.name) ?? [];
  if (!nombres.includes(modelo) && !nombres.includes(`${modelo}:latest`)) {
    throw new Error(`Falta el modelo. Ejecuta: ollama pull ${modelo}`);
  }
  // Precarga el modelo en la GPU para que la primera respuesta sea rápida.
  fetch(`${url}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: modelo, keep_alive: "30m" }),
  }).catch(() => {});
}

// ------------------------------------------------------------------ modo Reunión
const SISTEMA_REUNION =
  "You help a non-native English speaker during a live spoken conversation (a video call). " +
  "Suggest ONE short, natural reply the user could say out loud: one or two simple sentences, " +
  "at most 25 words. Do not explain and do not offer options. If you cannot know the user's " +
  "personal facts, use a short placeholder like [your city].";

const FORMATO_REUNION = {
  type: "object",
  properties: { they_said_es: { type: "string" }, reply_en: { type: "string" } },
  required: ["they_said_es", "reply_en"],
};

/** Devuelve { respuesta, traduccion } para lo que acaba de decir la otra persona. */
export async function sugerirRespuesta({ url, modelo, frase, contexto, traducir }) {
  let usuario = "";
  if (contexto.length) usuario += "Earlier, the other person said:\n" + contexto.map((c) => `- ${c}`).join("\n") + "\n\n";
  usuario += `The other person just said: "${frase}"\n\n`;
  // Con un modelo pequeño hay que separar bien las dos tareas; si no, traduce su propia respuesta.
  usuario += traducir
    ? 'Return JSON with:\n- "they_said_es": the Spanish translation of the other person\'s sentence above ' +
      "(translate it faithfully, do not answer it)\n" +
      '- "reply_en": what the user should say back to the other person, in English, first person. ' +
      "If they asked a question, ANSWER it; never repeat or rephrase their question."
    : "What the user should say back (answer their question; never repeat it):";

  const texto = await ollamaChat({
    url,
    modelo,
    mensajes: [{ role: "system", content: SISTEMA_REUNION }, { role: "user", content: usuario }],
    formato: traducir ? FORMATO_REUNION : undefined,
  });
  if (!traducir) return { respuesta: texto.replace(/^"|"$/g, ""), traduccion: "" };
  const d = leerJSON(texto);
  return { respuesta: d.reply_en ?? texto, traduccion: d.they_said_es ?? "" };
}

// ------------------------------------------------------------------ modo Práctica
const FORMATO_PRACTICA = {
  type: "object",
  properties: {
    correction: { type: "string" },
    tip_es: { type: "string" },
    reply: { type: "string" },
  },
  required: ["correction", "tip_es", "reply"],
};

function sistemaPractica(escenario, nivel) {
  return (
    "You are a friendly English speaking partner and tutor for a Spanish-speaking student. " +
    `Role-play this situation: ${ESCENARIOS[escenario]}. Student level: ${NIVELES[nivel]}. ` +
    "Stay in character. Keep each reply short (1-3 sentences) and usually end with a question so the " +
    "conversation continues. The student's messages come from speech recognition, so ignore " +
    "punctuation and capitalization. Return JSON with:\n" +
    '- "correction": a corrected, more natural version of the student\'s LAST message if it had a real ' +
    "grammar or vocabulary mistake; empty string if it was fine\n" +
    '- "tip_es": if there was a correction, a very short explanation WRITTEN IN SPANISH ' +
    "(example: \"Usa el pasado: go → went, eat → ate\"); otherwise empty string\n" +
    '- "reply": your next line in the conversation, in English'
  );
}

/**
 * historial: [{ role: "user" | "assistant", content }]
 * Devuelve { respuesta, correccion, consejo }.
 */
export async function responderPractica({ url, modelo, escenario, nivel, historial }) {
  const mensajes = [{ role: "system", content: sistemaPractica(escenario, nivel) }];
  if (historial.length === 0) {
    mensajes.push({ role: "user", content: "(Start the conversation with a short greeting and a first question. No correction needed.)" });
  } else {
    mensajes.push(...historial.slice(-12));
  }
  const texto = await ollamaChat({ url, modelo, mensajes, formato: FORMATO_PRACTICA, temperatura: 0.7 });
  const d = leerJSON(texto);
  const correccion = (d.correction ?? "").trim();
  const ultimo = historial.at(-1)?.content ?? "";
  // A veces el modelo "corrige" repitiendo lo mismo: no lo mostramos.
  const igual = correccion.toLowerCase().replace(/[^a-z ]/g, "") === ultimo.toLowerCase().replace(/[^a-z ]/g, "");
  return {
    respuesta: (d.reply ?? texto).trim(),
    correccion: igual ? "" : correccion,
    consejo: igual ? "" : (d.tip_es ?? "").trim(),
  };
}
