// ===== Áudio sintetizado (WebAudio) — sem assets externos =====

class AudioFx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    this.ctx?.resume();
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol = 1, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noise(dur: number, vol = 1, filterFreq = 1200) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  shoot(w: string) {
    if (w === "m249") this.blip(180, 0.08, "square", 0.5, 60);
    else if (w === "shotgun") this.noise(0.25, 0.9, 800);
    else this.blip(420, 0.09, "sawtooth", 0.5, 120);
  }

  knife() {
    this.blip(220, 0.12, "sawtooth", 0.6, 80);
    this.noise(0.08, 0.4, 2000);
  }

  hit() {
    this.blip(900, 0.05, "square", 0.4, 600);
  }

  headshot() {
    this.blip(1200, 0.06, "square", 0.5, 800);
    this.noise(0.12, 0.5, 3000);
  }

  kill() {
    this.blip(700, 0.15, "square", 0.5, 200);
  }

  explosion() {
    this.noise(0.7, 1, 300);
    this.blip(60, 0.5, "sine", 0.8, 30);
  }

  infect() {
    this.blip(300, 0.4, "sawtooth", 0.7, 60);
    this.noise(0.3, 0.6, 600);
  }

  heal() {
    this.blip(600, 0.2, "sine", 0.5, 1000);
  }

  ability() {
    this.blip(500, 0.2, "triangle", 0.5, 900);
  }

  buy() {
    this.blip(900, 0.08, "square", 0.4);
    this.blip(1400, 0.12, "square", 0.4);
  }

  heartbeat() {
    this.blip(55, 0.12, "sine", 0.9);
  }

  roundStart() {
    this.blip(440, 0.25, "square", 0.5);
    this.blip(660, 0.3, "square", 0.5);
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.25, "square", 0.5), i * 130),
    );
  }

  lose() {
    [400, 300, 200].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.3, "sawtooth", 0.5), i * 150),
    );
  }
}

export const audio = new AudioFx();
