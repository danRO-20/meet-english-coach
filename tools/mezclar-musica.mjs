// Crea un WAV de prueba "video con música": 6 s solo de música y luego voz encima de la música.
//   node tools/mezclar-musica.mjs entrada_voz.wav salida.wav
import { readFileSync, writeFileSync } from "node:fs";
const [entrada, salida] = process.argv.slice(2);
const buf = readFileSync(entrada);
const fr = buf.readUInt32LE(24), canales = buf.readUInt16LE(22);
const datos = buf.indexOf("data") + 8;
const n = (buf.length - datos) / 2 / canales;
const voz = new Float32Array(n);
for (let i = 0; i < n; i++) voz[i] = buf.readInt16LE(datos + i * 2 * canales) / 32768;
const previo = fr * 6, total = previo + n;
const out = Buffer.alloc(44 + total * 2);
out.write("RIFF", 0); out.writeUInt32LE(36 + total * 2, 4); out.write("WAVEfmt ", 8);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(fr, 24);
out.writeUInt32LE(fr * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(total * 2, 40);
const acordes = [[220, 277, 330], [196, 247, 294], [174, 220, 262], [196, 247, 294]];
for (let i = 0; i < total; i++) {
  const t = i / fr, ac = acordes[Math.floor(t / 2) % 4];
  let m = 0;
  for (const f of ac) m += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
  const golpe = (t % 0.5) < 0.05 ? Math.sin(2 * Math.PI * 60 * t) * 0.8 : 0; // bombo
  const v = (m / 4) * 0.12 + golpe * 0.2 + (i >= previo ? voz[i - previo] : 0);
  out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
}
writeFileSync(salida, out);
console.log("ok", (total / fr).toFixed(1), "s");
