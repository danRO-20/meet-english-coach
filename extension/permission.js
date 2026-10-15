document.getElementById("permitir").addEventListener("click", async () => {
  const resultado = document.getElementById("resultado");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    resultado.textContent = "✅ Listo. Ya puedes cerrar esta pestaña y volver al panel.";
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    resultado.textContent = "❌ No se concedió el permiso: " + e.message;
  }
});
