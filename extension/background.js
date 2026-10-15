// Service worker: abre el panel lateral, crea el documento offscreen (audio + Whisper)
// y permite que la extensión hable con Ollama local.

const OFFSCREEN_URL = "offscreen.html";

// Ollama rechaza (403) peticiones con Origin chrome-extension://. Quitamos esa cabecera SOLO
// para peticiones hechas por esta extensión (no por páginas web) hacia el puerto de Ollama.
async function configurarReglasOllama() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
      condition: {
        regexFilter: "^http://(127\.0\.0\.1|localhost):11434/",
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest", "other"],
      },
    }],
  });
}
configurarReglasOllama();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

// Clic en el icono (o Alt+Shift+E): abre el panel. Ese clic también le da a la extensión
// permiso (activeTab) para capturar el audio de ESA pestaña.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

async function asegurarOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "Capturar el audio de la pestaña y del micrófono y transcribirlo con Whisper.",
    });
  } catch (e) {
    if (!String(e).includes("single offscreen")) throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  // El offscreen solo puede usar chrome.runtime: el background reenvía al cuadro flotante de la pestaña.
  if (msg?.type === "a-overlay") {
    chrome.tabs.sendMessage(msg.tabId, msg.msg).catch(() => {});
    return;
  }
  if (msg?.type === "asegurar-offscreen") {
    asegurarOffscreen().then(() => responder({ ok: true }), (e) => responder({ error: String(e) }));
    return true; // respuesta asíncrona
  }
});
