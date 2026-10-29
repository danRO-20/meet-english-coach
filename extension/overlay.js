// Cuadro flotante de subtítulos (estilo "Subtítulos en tiempo real" de Chrome) que se inyecta en la
// pestaña escuchada: muestra lo que dicen mientras lo dicen y, cuando se callan, la respuesta sugerida.
// Se puede arrastrar y cambiar de tamaño. Recibe los mensajes del offscreen a través del background.
(() => {
  if (globalThis.__meetCoachOverlay) {
    globalThis.__meetCoachOverlay.mostrar();
    return;
  }

  const host = document.createElement("div");
  host.id = "meet-english-coach-overlay";
  const raiz = host.attachShadow({ mode: "closed" });
  raiz.innerHTML = `
    <style>
      :host { all: initial; }
      .caja {
        position: fixed; z-index: 2147483647; box-sizing: border-box;
        width: 640px; height: 210px; min-width: 300px; min-height: 120px;
        display: flex; flex-direction: column; gap: 6px; padding: 8px 14px 12px;
        background: rgba(20, 20, 22, 0.88); color: #fff; border-radius: 12px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
        font: 15px/1.4 "Segoe UI", system-ui, sans-serif;
        resize: both; overflow: hidden; cursor: move; user-select: none;
      }
      .barra { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #9aa0a6; }
      .punto { width: 8px; height: 8px; border-radius: 50%; background: #5f6368; transition: background .15s, transform .15s; }
      .punto.voz { background: #7ee787; }
      .estado { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      button {
        all: unset; cursor: pointer; color: #bdc1c6; padding: 0 6px; border-radius: 6px; font-size: 14px; line-height: 22px;
      }
      button:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
      .subs {
        flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
        font-size: 21px; line-height: 1.35; font-weight: 500;
        /* lo más viejo se desvanece por arriba, como en los subtítulos de Chrome */
        -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 22px);
        mask-image: linear-gradient(to bottom, transparent 0, #000 22px);
      }
      .subs .viejo { color: #bdc1c6; }
      .subs .parcial { color: #fff; }
      .es { color: #8ecbff; font-style: italic; font-size: 14px; }
      .es:empty, .sug:empty { display: none; }
      .sug { color: #ffd866; font-weight: 600; font-size: 16px; border-top: 1px solid rgba(255,255,255,.15); padding-top: 6px; cursor: text; user-select: text; }
      .sug::before { content: "💡 "; }
      .sug.pensando { color: #9aa0a6; font-weight: 400; font-size: 14px; }
      .oculto { display: none !important; }
      .chica .es, .chica .sug { display: none; }
    </style>
    <div class="caja">
      <div class="barra">
        <span class="punto"></span>
        <span class="estado">Meet English Coach · escuchando…</span>
        <button class="chico" title="Mostrar/ocultar traducción y sugerencia">◱</button>
        <button class="cerrar" title="Dejar de escuchar">✕</button>
      </div>
      <div class="subs"><div class="texto"></div></div>
      <div class="es"></div>
      <div class="sug"></div>
    </div>`;

  const $ = (s) => raiz.querySelector(s);
  const caja = $(".caja");
  const finales = [];        // [{ id, texto }]
  let parcial = "";
  let ultimoId = null;

  // ---------------------------------------------------------------- posición y tamaño (se recuerdan)
  function colocar(pos) {
    const ancho = pos?.ancho ?? 640, alto = pos?.alto ?? 210;
    caja.style.width = ancho + "px";
    caja.style.height = alto + "px";
    const x = pos?.x ?? (innerWidth - ancho) / 2;
    const y = pos?.y ?? innerHeight - alto - 110; // encima de la barra de controles de Meet
    caja.style.left = Math.max(0, Math.min(innerWidth - 80, x)) + "px";
    caja.style.top = Math.max(0, Math.min(innerHeight - 60, y)) + "px";
  }
  function guardar() {
    const r = caja.getBoundingClientRect();
    chrome.storage.local.set({ overlayPos: { x: r.left, y: r.top, ancho: r.width, alto: r.height } });
  }
  colocar();
  chrome.storage.local.get("overlayPos").then((d) => d.overlayPos && colocar(d.overlayPos));
  new ResizeObserver(() => { pintar(); }).observe(caja);

  // Arrastrar desde cualquier parte menos los botones, la sugerencia (para poder copiarla) y la
  // esquina de cambio de tamaño.
  let arrastre = null;
  caja.addEventListener("pointerdown", (e) => {
    const r = caja.getBoundingClientRect();
    if (e.target.closest("button, .sug") || (e.clientX > r.right - 18 && e.clientY > r.bottom - 18)) return;
    arrastre = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    caja.setPointerCapture(e.pointerId);
  });
  caja.addEventListener("pointermove", (e) => {
    if (!arrastre) return;
    caja.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - arrastre.dx)) + "px";
    caja.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - arrastre.dy)) + "px";
  });
  caja.addEventListener("pointerup", () => { if (arrastre) { arrastre = null; guardar(); } });
  caja.addEventListener("mouseup", guardar); // también al terminar de redimensionar

  // ---------------------------------------------------------------- contenido
  function pintar() {
    const texto = $(".texto");
    texto.replaceChildren();
    for (const f of finales.slice(-8)) {
      const s = document.createElement("span");
      s.className = "viejo";
      s.textContent = f.texto + " ";
      texto.appendChild(s);
    }
    if (parcial) {
      const s = document.createElement("span");
      s.className = "parcial";
      s.textContent = parcial;
      texto.appendChild(s);
    }
    if (!finales.length && !parcial) texto.textContent = "Esperando a que alguien hable…";
    // Como los subtítulos de Chrome: se ve siempre lo último; lo viejo se va por arriba.
    const subs = $(".subs");
    subs.scrollTop = subs.scrollHeight;
  }
  pintar();

  function quitar() {
    chrome.runtime.onMessage.removeListener(alMensaje);
    host.remove();
    globalThis.__meetCoachOverlay = null;
  }

  function alMensaje(msg) {
    switch (msg?.type) {
      case "parcial": parcial = msg.texto || ""; pintar(); break;
      case "sin-voz": parcial = ""; pintar(); break;
      case "final":
        finales.push({ id: msg.id, texto: msg.texto });
        parcial = "";
        pintar();
        break;
      case "pensando":
        ultimoId = msg.id;
        $(".sug").className = "sug pensando";
        $(".sug").textContent = "pensando una respuesta…";
        break;
      case "sugerencia":
        if (msg.id !== ultimoId) break;
        $(".sug").className = "sug";
        $(".sug").textContent = msg.respuesta || msg.error || "";
        $(".es").textContent = msg.traduccion || "";
        break;
      case "reunion-nivel":
        $(".punto").classList.toggle("voz", msg.voz && msg.nivel > 0.004);
        $(".estado").textContent = msg.cargando
          ? "Cargando el reconocimiento de voz… (lo que digan se transcribe al terminar)"
          : msg.voz ? "Oyendo voz…" : "Meet English Coach · escuchando";
        break;
      case "reunion-detenida": quitar(); break;
    }
  }
  chrome.runtime.onMessage.addListener(alMensaje);

  $(".cerrar").addEventListener("click", () => {
    chrome.runtime.sendMessage({ target: "offscreen", type: "reunion-detener" });
    quitar();
  });
  $(".chico").addEventListener("click", () => caja.classList.toggle("chica"));

  document.documentElement.appendChild(host);
  globalThis.__meetCoachOverlay = {
    mostrar: () => { if (!host.isConnected) document.documentElement.appendChild(host); },
  };
})();
