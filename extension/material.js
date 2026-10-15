// "Material": un archivo o texto sobre el que quieres hablar (tu CV, una oferta de trabajo,
// la agenda de una reunión, un artículo…). Se extrae el texto aquí mismo, sin subirlo a ningún lado.

// Lo que cabe cómodamente en el contexto de un modelo pequeño (~2.500 tokens).
export const MAX_CARACTERES = 10000;

async function textoDePdf(archivo) {
  const pdfjs = await import("./lib/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.mjs");
  const doc = await pdfjs.getDocument({ data: await archivo.arrayBuffer() }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const contenido = await (await doc.getPage(i)).getTextContent();
    paginas.push(contenido.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return paginas.join("\n\n");
}

function cargarMammoth() {
  if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
  return new Promise((ok, error) => {
    const s = document.createElement("script");
    s.src = "lib/mammoth.browser.min.js";
    s.onload = () => ok(globalThis.mammoth);
    s.onerror = () => error(new Error("No se pudo cargar el lector de Word"));
    document.head.appendChild(s);
  });
}

async function textoDeWord(archivo) {
  const mammoth = await cargarMammoth();
  const r = await mammoth.extractRawText({ arrayBuffer: await archivo.arrayBuffer() });
  return r.value;
}

export function limpiar(texto) {
  return texto
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Devuelve { nombre, texto, recortado } a partir de un File. */
export async function leerArchivo(archivo) {
  const nombre = archivo.name;
  const ext = nombre.toLowerCase().split(".").pop();
  let texto;
  if (ext === "pdf") texto = await textoDePdf(archivo);
  else if (ext === "docx") texto = await textoDeWord(archivo);
  else if (["txt", "md", "csv", "json", "html", "srt", "vtt"].includes(ext)) texto = await archivo.text();
  else throw new Error("Formato no soportado. Usa PDF, Word (.docx) o texto (.txt, .md).");

  texto = limpiar(texto);
  if (!texto) throw new Error("No encontré texto en el archivo (¿es un PDF escaneado como imagen?).");
  const recortado = texto.length > MAX_CARACTERES;
  return { nombre, texto: texto.slice(0, MAX_CARACTERES), recortado };
}
