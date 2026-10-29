# Meet English Coach

Extensión de Chrome **open source y 100% local** para ayudarte con el inglés:

- **🎧 Modo Reunión**: en Google Meet (o cualquier pestaña: Zoom web, Teams web, YouTube…) muestra un **cuadro flotante de subtítulos** sobre la página, al estilo de los subtítulos en tiempo real de Chrome: el texto en inglés aparece **mientras la persona habla** y, cuando se calla, la **traducción al español** y una **respuesta sugerida**.
- **🗣️ Modo Práctica**: conversas en voz alta con una IA que te responde hablando, mantiene la charla y **te corrige** cuando te equivocas. Situaciones: charla libre, entrevista de trabajo, reunión de trabajo, restaurante, aeropuerto/hotel; niveles básico, intermedio y avanzado.
- **🇪🇸 Subtítulos en español**: el mismo cuadro flotante, pero para audios en español (solo transcripción, sin traducción ni sugerencias).
- **📎 Material**: carga un PDF, un Word o un texto (tu CV, una oferta de trabajo, la agenda de una reunión, un artículo…) y la IA conversa sobre eso; las sugerencias de reunión también lo usan.

Nada sale de tu PC: la voz se transcribe con **Whisper** dentro del navegador ([transformers.js](https://github.com/huggingface/transformers.js), WebGPU o WASM) y las respuestas las genera un modelo local con **[Ollama](https://ollama.com)**. Sin APIs de pago.

## Cómo funciona

```
Pestaña de Meet ──audio──► documento offscreen (tabCapture + AudioWorklet 16 kHz)
                              │  segmenta frases por silencios
                              ▼
                           Whisper (transformers.js, WebGPU/WASM)
                              │  texto en inglés
                              ▼
Panel lateral ◄──────────── transcripción ──► Ollama local (llama3.2:3b)
  (sugerencia + traducción)                    │
                                               ▼
Micrófono ──► Whisper ──► Ollama (tutor) ──► voz de la IA (speechSynthesis)
```

- **Captura**: la extensión graba el audio de la pestaña (no del sistema) y lo sigue reproduciendo para que tú oigas la llamada normal. Solo capta a los demás: Meet no te devuelve tu propia voz.
- **El panel es lateral**: si compartes pantalla o una pestaña en Meet, el panel no aparece en lo que compartes.
- **Ollama** rechaza por defecto peticiones de extensiones; la extensión lo resuelve quitando la cabecera `Origin` solo en sus propias peticiones a `127.0.0.1:11434` (regla `declarativeNetRequest`). No tienes que configurar nada.

## Instalación (Windows, 5 minutos)

1. **Instala Ollama** desde <https://ollama.com/download> (o `winget install Ollama.Ollama`) y descarga el modelo:
   ```bash
   ollama pull llama3.2:3b
   ```
   Con 4 GB+ de VRAM va sobrado. Alternativas: `qwen2.5:3b`, `phi3:mini` (cámbialo en ⚙️ Ajustes).
2. **Descarga este repositorio** (botón *Code → Download ZIP* y descomprímelo, o `git clone`).
3. Abre `chrome://extensions`, activa **Modo de desarrollador** (arriba a la derecha) → **Cargar descomprimida** → elige la carpeta **`extension/`**.
4. (Opcional) Fija la extensión en la barra de Chrome con el icono 🧩.

### ⚡ Si tu laptop tiene GPU NVIDIA (muy recomendado)

En laptops con dos GPU, Chrome usa por defecto la **integrada (Intel)**. En ese caso la extensión transcribe con la CPU (4 núcleos, ≈1.5 s por pasada: el texto aparece 1–3 s después de que hablen). Con la NVIDIA va mucho más rápido. Para que Chrome la use:

1. Windows → **Configuración → Sistema → Pantalla → Gráficos**.
2. Busca **Google Chrome** (si no aparece: *Agregar aplicación* → `C:\Program Files\Google\Chrome\Application\chrome.exe`).
3. **Opciones → Alto rendimiento (NVIDIA)** → Guardar, y **reinicia Chrome por completo**.

La barra de estado del panel dice qué motor se está usando: `GPU nvidia` o `CPU ×4 (Chrome usa la GPU Intel…)`.

## Uso en Google Meet

1. Abre tu llamada en `meet.google.com`.
2. Estando en esa pestaña, haz clic en el icono **EN** de la extensión (o `Alt+Shift+E`). Se abre el panel lateral.
3. Pulsa **▶ Escuchar esta pestaña**. La primera vez descarga Whisper (~150 MB, queda en caché).
4. Aparece un **cuadro flotante** sobre la página de Meet:
   - el texto en **blanco** es lo que están diciendo ahora (se actualiza cada ~0.5 s mientras hablan); lo anterior queda en gris y se va desvaneciendo por arriba;
   - cuando la persona se calla (~0.7 s de silencio): la **traducción** en azul y 💡 la **respuesta sugerida** en amarillo;
   - **arrástralo** a donde quieras y **cambia su tamaño** desde la esquina inferior derecha (se recuerda);
   - **◱** oculta la traducción y la sugerencia (solo subtítulos); **✕** deja de escuchar.
5. En el panel lateral queda el **historial** de la conversación y un medidor de audio. Puedes cerrar el panel: el cuadro sigue funcionando.
6. Si prefieres no ver el cuadro, desactívalo en ⚙️ Ajustes → *Cuadro flotante de subtítulos*.

### Subtítulos en español

Junto al botón **Escuchar** hay un selector de idioma: **🇬🇧 Inglés** (subtítulos + traducción + respuesta sugerida) o **🇪🇸 Español** (solo subtítulos). En español usa el modelo multilingüe de Whisper (`whisper-small` con GPU, `whisper-base` en CPU); la primera vez lo descarga (~500 MB con GPU). El texto en vivo se actualiza un poco más despacio que en inglés (~1–1.5 s), porque ese modelo es más grande.

Con música de fondo también funciona: la música sola no genera texto y, si hablan encima, el texto sale igual (las frases se cierran cada 10 s como máximo).

> La sugerencia es una ayuda para orientarte, no un guion: tú decides qué decir.

## Modo Práctica

1. En el panel, pestaña **🗣️ Práctica**. Elige situación y nivel → **Empezar conversación**.
2. La IA te saluda **en voz alta**. Pulsa **🎤 Hablar**, responde en inglés y pulsa **■ Enviar**. El micrófono queda abierto mientras practicas, así que graba desde el primer instante (incluso medio segundo antes del clic) y sigue 0.6 s después de Enviar para no cortar tu última palabra. Puedes hablar todo lo que quieras: los mensajes de más de 30 s también se transcriben completos.
3. Si te equivocas verás en verde la versión corregida y una explicación corta en español.
4. 🔊 repite la frase de la IA. También puedes escribir tu respuesta en el cuadro de texto.

La primera vez Chrome abrirá una pestaña para pedir permiso de micrófono: pulsa **Permitir** y vuelve al panel.

## 📎 Material: practicar sobre un tema concreto

1. Pulsa **📎 Material** (arriba en el panel) y luego **📄 Subir archivo**, o pega el texto y pulsa **Usar este texto**. También puedes **arrastrar** el archivo al panel.
   - Formatos: **PDF** (con texto, no escaneado), **Word (.docx)**, **.txt / .md**, subtítulos **.srt / .vtt**.
   - Puede ser largo (un libro de varias unidades, hasta ~120.000 caracteres). Si detecta títulos como **Unit 1, Unit 2…** (o Unidad, Chapter, Module…), aparece un selector para elegir **qué unidad practicar**; si no hay títulos, lo divide en partes. A la IA se le pasa solo la parte elegida (~10.000 caracteres).
   - El archivo se lee en tu PC y no se sube a ningún sitio.
2. En **🗣️ Práctica** se elige sola la situación **📄 Sobre mi material**. Si es una **lección de inglés** (gramática, vocabulario), la IA no te toma examen: conversa sobre tu vida con preguntas que te obligan a usar esa gramática (p. ej. en una unidad de *simple past* te pregunta qué hiciste el verano pasado). Si es otro tipo de texto, lo comenta contigo.
   - Cada respuesta tuya la revisa un **corrector aparte** que te muestra la frase corregida y una explicación en español.
3. En las demás situaciones el material sirve de contexto. Ejemplo: carga tu **CV** y elige **Entrevista de trabajo**: el entrevistador te preguntará por *tu* experiencia real.
4. En **🎧 Reunión**, las sugerencias usan los datos del material en vez de huecos como `[your city]`. Ejemplo con tu CV: a *"Tell me about yourself"* te sugiere una respuesta con tu trabajo real.
5. El material queda guardado hasta que pulses **✕**.

## Ajustes (⚙️ al pie del panel)

| Ajuste | Para qué |
| --- | --- |
| Modelo de Ollama | `llama3.2:3b` por defecto. Cualquiera que tengas con `ollama pull`. |
| Modelo Whisper | **Automático** (por defecto): en Reunión `base.en` (subtítulos más rápidos); en Práctica `small.en` con GPU dedicada (más preciso) y `base.en` en CPU. También puedes fijar uno. |
| Cuadro flotante | Mostrar u ocultar el cuadro de subtítulos sobre la página en el modo Reunión. |
| Mostrar traducción | Activa o desactiva la traducción al español en el modo Reunión. |
| Voz / velocidad | Voz en inglés de la IA del modo Práctica. |

## Problemas frecuentes

- **"Ollama no está corriendo"** → abre Ollama desde el menú Inicio (queda como icono junto al reloj).
- **"Falta el modelo"** → `ollama pull llama3.2:3b`.
- **"No pude capturar esta pestaña"** → ve a la pestaña de Meet, haz clic en el icono de la extensión (eso da permiso para esa pestaña) y vuelve a pulsar Escuchar.
- **No detecta voz** → sube el volumen de la persona en Meet. Para cambiar la sensibilidad, edita `umbralVoz` en `extension/sidepanel.js`.
- **Va lento** → mira la sección de GPU NVIDIA de arriba.

## Desarrollo

```
extension/
  manifest.json        MV3: sidePanel, tabCapture, offscreen, declarativeNetRequest
  background.js        abre el panel, crea el offscreen, regla para Ollama
  offscreen.js         captura (pestaña y micrófono) + Whisper + sugerencias de reunión
  overlay.js           cuadro flotante de subtítulos que se inyecta en la página escuchada
  segmenter.js         separa frases por energía/silencios
  audio-processor.js   AudioWorklet que envía bloques de 100 ms
  llm.js               prompts y llamadas a Ollama
  material.js          extrae el texto de PDF (pdf.js), Word (mammoth) y TXT
  sidepanel.*          interfaz de los dos modos
  lib/                 transformers.js, onnxruntime-web, pdf.js y mammoth (empaquetados: MV3 no permite CDN)
tools/
  vendor.mjs           copia las librerías a extension/lib
  dev-test.html        banco de pruebas: segmentador + Whisper + prompts sobre un WAV
  test-llm.mjs         prueba los prompts contra Ollama desde la terminal
  e2e.mjs              instala la extensión en un Chrome aparte, reproduce un WAV en una pestaña,
                       registra lo que muestra el panel y (opcional) captura el cuadro flotante
  e2e-practica.mjs     lo mismo para el modo Práctica, con un micrófono simulado
  e2e-material.mjs     crea un PDF, lo carga como material y comprueba práctica y sugerencias
  bench.mjs            mide la velocidad de Whisper (tiny/base, 4/8 hilos) dentro de la extensión
  mezclar-musica.mjs   crea un WAV de prueba con música de fondo
```

Actualizar las librerías:

```bash
cd tools && npm install && node vendor.mjs
```

Pruebas de punta a punta (usan tu Chrome con un perfil temporal; necesitan `npm install` en `tools/`):

```bash
node tools/e2e.mjs tools/mi-audio.wav 60
```

Probar prompts: `node tools/test-llm.mjs`. Probar Whisper: sirve la raíz del repo (`python -m http.server 8765`) y abre `http://localhost:8765/tools/dev-test.html?wav=/tools/tu-audio.wav`.

## Uso responsable

El modo Reunión procesa la voz de otras personas (en tu PC, sin enviarla a ningún lado). Úsalo con criterio y, si corresponde, avisa a los demás.

## Licencia

[MIT](LICENSE)
