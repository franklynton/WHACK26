// All the game's sound, made live with the Web Audio API (no audio files to download):
// a slow ambient pad with wind for the background, and a short effect for each pop-up.

type Fx = "rumble" | "thunder" | "wave" | "whoosh" | "boom" | "chime" | "horn" | "toll" | "fanfare" | "sparkle" | "fire";

// Which effect each pop-up plays, by its icon.
const BY_ICON: Record<string, Fx> = {
  "🌋": "rumble", "🫨": "rumble", "⛈️": "thunder", "🌊": "wave", "🌧️": "wave", "☄️": "whoosh", "💥": "boom",
  "🏘️": "chime", "🏙️": "chime", "⛵": "chime", "🌲": "chime", "🕊️": "chime", "⚔️": "horn", "😈": "horn",
  "🏳️": "horn", "👑": "horn", "⚓": "chime", "💀": "toll", "☠️": "toll", "☀️": "toll", "📜": "fanfare", "🚀": "fanfare", "✨": "sparkle",
  "⛰️": "rumble", "🔥": "fire",
};

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  // Browsers only allow audio after a click or key press, so this is called from the first one.
  start() {
    if (this.ctx) return void this.ctx.resume();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ambient();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  forIcon(icon: string) {
    const fx = BY_ICON[icon];
    if (fx) this.play(fx);
  }

  // Background: soft chords drifting through a slow progression, over gentle wind.
  private ambient() {
    const ctx = this.ctx!, out = ctx.createGain();
    out.gain.value = 0.07;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    out.connect(lp).connect(this.master!);
    const chords = [[220, 277.2, 329.6], [196, 246.9, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]; // A, G, F, G
    const voices = [0, 1, 2].map(() => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      g.gain.value = 0.33;
      o.connect(g).connect(out);
      o.start();
      return o;
    });
    let k = 0;
    const next = () => {
      const t = ctx.currentTime;
      chords[k++ % chords.length].forEach((f, i) => voices[i].frequency.setTargetAtTime(f / 2 + (i === 0 ? 0 : f / 2), t, 1.5));
    };
    next();
    setInterval(next, 8000);
    // Wind: band-passed noise whose pitch slowly wanders.
    const wind = this.noiseSource(true), bp = ctx.createBiquadFilter(), wg = ctx.createGain();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    wg.gain.value = 0.025;
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 250;
    lfo.connect(depth).connect(bp.frequency);
    lfo.start();
    wind.connect(bp).connect(wg).connect(this.master!);
    wind.start();
  }

  private noiseSource(loop = false) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  // A burst of filtered noise with an attack/decay envelope (rumbles, thunder, waves, fire).
  private noiseHit(type: BiquadFilterType, freq: number, endFreq: number, attack: number, decay: number, vol: number, delay = 0) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const src = this.noiseSource(true), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + attack + decay + 0.1);
  }

  private tone(freq: number, type: OscillatorType, delay: number, dur: number, vol: number, endFreq = freq) {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(fx: Fx) {
    if (!this.ctx || this.muted) return;
    switch (fx) {
      case "rumble":
        this.noiseHit("lowpass", 120, 60, 0.6, 3, 0.9);
        this.tone(45, "sine", 0, 3, 0.35, 30);
        break;
      case "thunder":
        this.noiseHit("lowpass", 2500, 120, 0.02, 0.4, 0.6);
        this.noiseHit("lowpass", 300, 60, 0.2, 2.5, 0.7, 0.15);
        break;
      case "wave":
        this.noiseHit("bandpass", 300, 1400, 1.2, 1.8, 0.5);
        break;
      case "whoosh":
        this.noiseHit("bandpass", 3000, 200, 0.8, 1, 0.4);
        break;
      case "boom":
        this.tone(90, "sine", 0, 1.5, 0.8, 30);
        this.noiseHit("lowpass", 800, 50, 0.01, 2, 0.9);
        break;
      case "fire":
        this.noiseHit("highpass", 1500, 3000, 0.3, 1.5, 0.25);
        this.noiseHit("lowpass", 300, 150, 0.4, 1.4, 0.3);
        break;
      case "chime":
        [784, 988, 1175].forEach((f, i) => this.tone(f, "sine", i * 0.12, 1.4, 0.12));
        break;
      case "sparkle":
        [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, "sine", i * 0.07, 1, 0.08));
        break;
      case "fanfare":
        [[392, 0], [523, 0.18], [659, 0.36], [784, 0.54]].forEach(([f, d]) => this.tone(f, "triangle", d, d === 0.54 ? 1.4 : 0.35, 0.18));
        break;
      case "horn":
        this.tone(147, "sawtooth", 0, 1.6, 0.12, 140);
        this.tone(220, "sawtooth", 0.05, 1.5, 0.08, 210);
        break;
      case "toll":
        this.tone(110, "sine", 0, 3, 0.35);
        this.tone(220.5, "sine", 0, 2.2, 0.1);
        break;
    }
  }
}

export const sound = new Sound();
