import type { WeaponSound } from "../shared/weapons";

// ===== Áudio sintetizado (WebAudio) — sem assets externos =====
// Toda fonte passa por um compressor-limitador para os tiros não estourarem.

class AudioFx {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private lastFootstep = 0;
  private lastGroan = 0;

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(limiter).connect(this.ctx.destination);
    // Buffer de ruído branco reutilizado (2s)
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() {
    this.ctx?.resume();
  }

  // ----- primitivas -----

  private tone(freq: number, dur: number, type: OscillatorType, vol = 1, slideTo?: number, delay = 0) {
    if (!this.ctx || !this.master || vol <= 0.01) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 1, filterFreq = 1200, type: BiquadFilterType = "lowpass", delay = 0, q = 1) {
    if (!this.ctx || !this.master || !this.noiseBuf || vol <= 0.01) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  // ----- armas -----

  shoot(sound: WeaponSound | string, vol = 1) {
    if (vol <= 0.02) return;
    switch (sound) {
      case "pistol":
        this.noise(0.08, 0.9 * vol, 2600, "bandpass", 0, 0.7);
        this.tone(320, 0.09, "square", 0.45 * vol, 90);
        break;
      case "shotgun":
        this.noise(0.28, 1.1 * vol, 700);
        this.tone(90, 0.3, "sine", 0.9 * vol, 35);
        this.noise(0.1, 0.5 * vol, 4000, "highpass");
        break;
      case "sniper":
        this.noise(0.12, 1.2 * vol, 3200, "bandpass", 0, 0.5);
        this.tone(140, 0.5, "sawtooth", 0.6 * vol, 40);
        // cauda de eco
        this.noise(0.6, 0.35 * vol, 900, "lowpass", 0.08);
        this.noise(0.5, 0.15 * vol, 600, "lowpass", 0.28);
        break;
      case "smg":
        this.noise(0.05, 0.6 * vol, 3000, "bandpass", 0, 0.8);
        this.tone(500, 0.05, "square", 0.3 * vol, 200);
        break;
      case "lmg":
        this.noise(0.1, 0.9 * vol, 1500);
        this.tone(120, 0.12, "square", 0.6 * vol, 50);
        break;
      case "knife":
        this.knife(vol);
        break;
      default: // rifle
        this.noise(0.07, 0.9 * vol, 2200, "bandpass", 0, 0.6);
        this.tone(200, 0.11, "sawtooth", 0.5 * vol, 60);
        this.tone(70, 0.14, "sine", 0.5 * vol, 40);
    }
  }

  knife(vol = 1) {
    if (vol <= 0.02) return;
    this.noise(0.12, 0.7 * vol, 2500, "highpass");
    this.tone(220, 0.12, "sawtooth", 0.4 * vol, 80);
  }

  reload() {
    this.noise(0.05, 0.5, 3500, "highpass");
    this.tone(900, 0.04, "square", 0.25, 400);
    this.noise(0.06, 0.5, 2500, "highpass", 0.35);
    this.tone(700, 0.05, "square", 0.25, 300, 0.36);
  }

  switchWeapon() {
    this.noise(0.04, 0.4, 3000, "highpass");
    this.tone(1200, 0.03, "square", 0.2, 800);
  }

  dryFire() {
    this.tone(1000, 0.03, "square", 0.2, 600);
  }

  // ----- impacto -----

  hit() {
    this.tone(900, 0.05, "square", 0.35, 600);
  }

  headshot() {
    this.tone(1500, 0.08, "square", 0.45, 1100);
    this.noise(0.1, 0.4, 3000, "highpass");
  }

  hurt() {
    this.tone(180, 0.18, "sawtooth", 0.5, 90);
    this.noise(0.12, 0.4, 500);
  }

  kill() {
    this.tone(700, 0.15, "square", 0.45, 200);
  }

  impact(vol = 1) {
    this.noise(0.05, 0.4 * vol, 2500, "bandpass", 0, 0.5);
  }

  death() {
    this.tone(150, 0.5, "sawtooth", 0.5, 40);
    this.noise(0.4, 0.5, 400);
  }

  // ----- passos e ambiente -----

  /** Passo com cadência conforme a velocidade; distância atenua. */
  footstep(speed: number, zombie: boolean, vol = 1) {
    if (!this.ctx || speed < 1 || vol < 0.03) return;
    const now = this.ctx.currentTime;
    const interval = Math.max(0.28, 0.62 - speed * 0.04);
    if (now - this.lastFootstep < interval) return;
    this.lastFootstep = now;
    if (zombie) {
      this.noise(0.12, 0.35 * vol, 350);
      this.tone(60, 0.1, "sine", 0.3 * vol, 40);
    } else {
      this.noise(0.07, 0.3 * vol, 900);
      this.tone(110, 0.05, "triangle", 0.15 * vol, 70);
    }
  }

  /** Passo de outro jogador (sem trava de cadência global — cada um manda o seu). */
  otherFootstep(zombie: boolean, vol: number) {
    if (vol < 0.03) return;
    if (zombie) this.noise(0.1, 0.3 * vol, 350);
    else this.noise(0.06, 0.25 * vol, 900);
  }

  groan(vol = 1) {
    if (!this.ctx || vol < 0.03) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGroan < 1.2) return;
    this.lastGroan = now;
    const f = 70 + Math.random() * 50;
    this.tone(f, 0.9, "sawtooth", 0.25 * vol, f * 0.6);
    this.tone(f * 1.5, 0.7, "triangle", 0.15 * vol, f);
    this.noise(0.8, 0.12 * vol, 500);
  }

  wind() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.windSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    // Rajadas lentas
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    this.windSrc = src;
  }

  // ----- eventos -----

  explosion(vol = 1) {
    this.noise(0.8, 1.2 * vol, 300);
    this.tone(55, 0.7, "sine", 0.9 * vol, 25);
    this.noise(0.2, 0.5 * vol, 2500, "highpass");
  }

  infect() {
    this.tone(300, 0.4, "sawtooth", 0.6, 60);
    this.noise(0.3, 0.5, 600);
  }

  heal() {
    this.tone(600, 0.2, "sine", 0.4, 1000);
    this.tone(900, 0.2, "sine", 0.3, 1400, 0.1);
  }

  ability() {
    this.tone(500, 0.2, "triangle", 0.4, 900);
  }

  buy() {
    this.tone(900, 0.08, "square", 0.3);
    this.tone(1400, 0.12, "square", 0.3, undefined, 0.08);
  }

  heartbeat() {
    this.tone(55, 0.12, "sine", 0.9);
    this.tone(50, 0.1, "sine", 0.6, undefined, 0.18);
  }

  roundStart() {
    this.tone(440, 0.25, "square", 0.4);
    this.tone(660, 0.3, "square", 0.4, undefined, 0.2);
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, "square", 0.4, undefined, i * 0.13));
  }

  lose() {
    [400, 300, 200].forEach((f, i) => this.tone(f, 0.3, "sawtooth", 0.4, undefined, i * 0.15));
  }
}

export const audio = new AudioFx();
