// "Material": un archivo o texto sobre el que quieres hablar (tu CV, una oferta de trabajo,
// la agenda de una reunión, un artículo…). Se extrae el texto aquí mismo, sin subirlo a ningún lado.

// Lo que cabe cómodamente en el contexto de un modelo pequeño (~2.500 tokens) en cada conversación.
export const MAX_CARACTERES = 10000;
// Lo que se guarda: un libro de varias unidades; a la IA solo se le pasa la sección elegida.
export const MAX_TOTAL = 120000;

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

// Detecta secciones tipo "Unit 1", "Unidad 2", "Chapter 3"… Se usa la palabra más repetida
// (así "Unit 1 Lesson 2" se agrupa por unidad, no por lección) y una sección empieza cuando cambia el número.
const PALABRAS = "unit|unidad|chapter|cap[ií]tulo|module|m[oó]dulo|lesson|lecci[oó]n|tema";
function detectarSecciones(texto) {
  const coincidencias = [...texto.matchAll(new RegExp(`\\b(${PALABRAS})\\s+(\\d{1,2})\\b`, "gi"))];
  if (!coincidencias.length) return [];
  const conteo = {};
  for (const m of coincidencias) {
    const p = m[1].toLowerCase();
    if (!/^lesson|^lecci/.test(p)) conteo[p] = (conteo[p] || 0) + 1;
  }
  const palabra = Object.keys(conteo).sort((a, b) => conteo[b] - conteo[a])[0]
    ?? coincidencias[0][1].toLowerCase();
  // Un tramo empieza cada vez que cambia el número.
  let tramos = [];
  for (const m of coincidencias) {
    if (m[1].toLowerCase() !== palabra) continue;
    const n = Number(m[2]);
    if (tramos.at(-1)?.n !== n) tramos.push({ n, inicio: m.index, titulo: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${n}` });
  }
  tramos.forEach((t, i) => { t.fin = tramos[i + 1]?.inicio ?? texto.length; });
  // Los tramos muy cortos son un índice ("Unit 1 … Unit 2 … Unit 3" en pocas líneas): se descartan
  // y luego se juntan los tramos seguidos del mismo número.
  tramos = tramos.filter((t) => t.fin - t.inicio >= 400);
  const secciones = [];
  for (const t of tramos) {
    if (secciones.at(-1)?.n === t.n) secciones.at(-1).fin = t.fin;
    else secciones.push({ ...t });
  }
  if (secciones.length < 2) return [];
  // Lo que va antes de la primera (portada, índice) no se incluye: así cada sección empieza por su
  // propio título y objetivos, que es lo que usa la IA para saber qué practicar.
  return secciones.map((s, i) => ({ titulo: s.titulo, inicio: s.inicio, fin: secciones[i + 1]?.inicio ?? texto.length }));
}

// Sin títulos reconocibles: partes de tamaño parecido, cortando entre párrafos.
function partirPorTamano(texto) {
  const partes = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fin = Math.min(texto.length, inicio + MAX_CARACTERES);
    if (fin < texto.length) {
      const corte = texto.lastIndexOf("\n\n", fin);
      if (corte > inicio + MAX_CARACTERES / 2) fin = corte;
    }
    partes.push({ titulo: `Parte ${partes.length + 1}`, inicio, fin });
    inicio = fin;
  }
  return partes;
}

/** Texto que se le pasa a la IA: la sección elegida o, con "todo", un poco del principio de cada sección. */
export function textoParaIA(material) {
  if (!material) return null;
  const { texto, secciones = [], seccion = -1 } = material;
  if (secciones.length && seccion >= 0) {
    const s = secciones[seccion];
    return { nombre: `${material.nombre} - ${s.titulo}`, texto: texto.slice(s.inicio, s.fin).slice(0, MAX_CARACTERES) };
  }
  if (texto.length <= MAX_CARACTERES || !secciones.length) {
    return { nombre: material.nombre, texto: texto.slice(0, MAX_CARACTERES) };
  }
  const porSeccion = Math.floor(MAX_CARACTERES / secciones.length);
  return {
    nombre: `${material.nombre} - all sections`,
    texto: secciones.map((s) => texto.slice(s.inicio, s.fin).slice(0, porSeccion)).join("\n\n[...]\n\n"),
  };
}

/** Devuelve { nombre, texto, recortado, secciones, seccion } a partir de un File. */
export async function leerArchivo(archivo) {
  const nombre = archivo.name;
  const ext = nombre.toLowerCase().split(".").pop();
  let texto;
  if (ext === "pdf") texto = await textoDePdf(archivo);
  else if (ext === "docx") texto = await textoDeWord(archivo);
  else if (["txt", "md", "csv", "json", "html", "srt", "vtt"].includes(ext)) texto = await archivo.text();
  else throw new Error("Formato no soportado. Usa PDF, Word (.docx) o texto (.txt, .md).");

  return prepararMaterial(nombre, texto);
}

export function prepararMaterial(nombre, textoCrudo) {
  let texto = limpiar(textoCrudo);
  if (!texto) throw new Error("No encontré texto en el archivo (¿es un PDF escaneado como imagen?).");
  const recortado = texto.length > MAX_TOTAL;
  texto = texto.slice(0, MAX_TOTAL);
  let secciones = [];
  if (texto.length > MAX_CARACTERES) {
    secciones = detectarSecciones(texto);
    if (!secciones.length) secciones = partirPorTamano(texto);
  }
  // Con secciones, empezamos por la primera: es lo más útil para practicar en orden.
  return { nombre, texto, recortado, secciones, seccion: secciones.length ? 0 : -1 };
}
