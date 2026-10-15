// Copia transformers.js, el runtime ONNX (WASM), pdf.js y mammoth dentro de extension/lib.
// Las extensiones MV3 no pueden cargar código desde un CDN, así que todo va empaquetado.
// Uso:  cd tools && npm install && node vendor.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = join(aqui, "..", "extension", "lib");
mkdirSync(destino, { recursive: true });

const archivos = [
  ["@huggingface/transformers/dist/transformers.min.js", "transformers.min.js"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.mjs"],
  ["onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.wasm"],
  // Lectura de archivos para el "material" (PDF y Word)
  ["pdfjs-dist/build/pdf.min.mjs", "pdf.min.mjs"],
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["mammoth/mammoth.browser.min.js", "mammoth.browser.min.js"],
];
for (const [origen, nombre] of archivos) {
  copyFileSync(join(aqui, "node_modules", origen), join(destino, nombre));
  console.log("copiado", nombre);
}
