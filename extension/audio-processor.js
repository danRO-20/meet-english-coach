// AudioWorklet: junta bloques de 128 muestras y los manda en trozos de ~100 ms.
class CapturaPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tam = Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.tam);
    this.n = 0;
  }
  process(inputs) {
    const canales = inputs[0];
    if (!canales || canales.length === 0) return true;
    const largo = canales[0].length;
    for (let i = 0; i < largo; i++) {
      let s = 0;
      for (let c = 0; c < canales.length; c++) s += canales[c][i];
      this.buf[this.n++] = s / canales.length; // mezcla a mono
      if (this.n === this.tam) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("captura-pcm", CapturaPCM);
