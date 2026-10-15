// Prueba rápida de los prompts contra Ollama local:  node tools/test-llm.mjs
import { sugerirRespuesta, responderPractica } from "../extension/llm.js";
const url = "http://127.0.0.1:11434", modelo = process.argv[2] || "llama3.2:3b";
const frases = [
  "Hi Daniel, thanks for joining the call today.",
  "So, how was your weekend? Did you do anything fun?",
  "Great. Let's talk about the project. When do you think you can finish the first version?",
  "Could you share your screen and walk us through the demo?",
];
for (const frase of frases) {
  const t = Date.now();
  const r = await sugerirRespuesta({ url, modelo, frase, contexto: [], traducir: true });
  console.log(`${Date.now() - t}ms | ${frase}\n   ES: ${r.traduccion}\n   💡 ${r.respuesta}`);
}
const h = [{ role: "assistant", content: "Hi! What did you do last weekend?" }, { role: "user", content: "i go to the beach with my friends and we eat ceviche" }];
console.log("PRÁCTICA:", await responderPractica({ url, modelo, escenario: "libre", nivel: "basico", historial: h }));
