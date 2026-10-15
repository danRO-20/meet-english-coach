// Separa el audio continuo en frases usando la energía (RMS) y los silencios.
// El audio de una pestaña es una señal digital limpia, así que la energía basta para detectar voz.
export class Segmentador {
  constructor({
    onParcial,               // (audio | null) → null significa "borra el parcial"
    onFinal,                 // (audio)
    frecuencia = 16000,
    umbral = 0.004,          // RMS mínimo para considerar que hay voz
    silencioFin = 0.8,       // s de silencio que cierran la frase
    minVoz = 0.4,            // s mínimos de voz para que cuente como frase
    maxFrase = 15,           // s máximos antes de cortar a la fuerza
    preRoll = 0.3,           // s de audio previo para no cortar la primera sílaba
    intervaloParcial = 1.0,  // cada cuántos s se manda texto parcial (0 = nunca)
  }) {
    Object.assign(this, { onParcial, onFinal, frecuencia, umbral, silencioFin, minVoz, maxFrase, preRoll, intervaloParcial });
    this.previo = [];
    this.reiniciar();
  }

  reiniciar() {
    this.frase = [];
    this.enFrase = false;
    this.segVoz = 0;
    this.segFrase = 0;
    this.segSilencio = 0;
    this.segUltimoParcial = 0;
  }

  audioFrase() {
    const total = this.frase.reduce((n, b) => n + b.length, 0);
    const out = new Float32Array(total);
    let pos = 0;
    for (const b of this.frase) { out.set(b, pos); pos += b.length; }
    return out;
  }

  empujar(bloque) {
    const dur = bloque.length / this.frecuencia;
    let s = 0;
    for (let i = 0; i < bloque.length; i++) s += bloque[i] * bloque[i];
    const hayVoz = Math.sqrt(s / bloque.length) > this.umbral;

    if (!this.enFrase) {
      this.previo.push(bloque);
      while (this.previo.length * dur > this.preRoll + dur) this.previo.shift();
      if (hayVoz) {
        this.enFrase = true;
        this.frase = this.previo;
        this.previo = [];
        this.segFrase = this.frase.length * dur;
        this.segVoz = dur;
      }
      return;
    }

    this.frase.push(bloque);
    this.segFrase += dur;
    if (hayVoz) { this.segVoz += dur; this.segSilencio = 0; } else { this.segSilencio += dur; }

    if (this.segSilencio >= this.silencioFin || this.segFrase >= this.maxFrase) {
      if (this.segVoz >= this.minVoz) this.onFinal(this.audioFrase());
      else this.onParcial?.(null);
      this.reiniciar();
    } else if (this.intervaloParcial && this.segFrase - this.segUltimoParcial >= this.intervaloParcial) {
      this.segUltimoParcial = this.segFrase;
      this.onParcial?.(this.audioFrase());
    }
  }
}
