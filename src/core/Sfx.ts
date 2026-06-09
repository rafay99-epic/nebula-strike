/**
 * Procedural sound effects via the Web Audio API — no audio assets needed.
 * The AudioContext is created lazily on first user interaction (autoplay policy).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  ensure(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, filterEnd?: number): void {
    if (!this.ready || !this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(filterEnd ?? filterFreq * 0.1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  laser(): void {
    this.osc('sawtooth', 1400, 220, 0.12, 0.12);
    this.osc('square', 2800, 440, 0.08, 0.05);
  }

  plasma(): void {
    this.osc('sine', 180, 60, 0.35, 0.25);
    this.osc('sawtooth', 700, 90, 0.3, 0.1);
    this.noise(0.18, 0.1, 3000);
  }

  missile(): void {
    this.noise(0.7, 0.18, 1800, 400);
    this.osc('sine', 300, 700, 0.5, 0.08);
  }

  railgun(): void {
    this.osc('square', 60, 1800, 0.08, 0.2);
    this.osc('sawtooth', 2400, 100, 0.45, 0.2);
    this.noise(0.5, 0.3, 6000, 200);
  }

  explosion(big = false): void {
    this.noise(big ? 1.2 : 0.55, big ? 0.5 : 0.3, big ? 900 : 1400, 60);
    this.osc('sine', big ? 110 : 160, 30, big ? 0.9 : 0.45, big ? 0.4 : 0.22);
  }

  hit(): void {
    this.noise(0.12, 0.14, 2600);
  }

  shieldHit(): void {
    this.osc('sine', 880, 320, 0.2, 0.12);
  }

  lockTick(): void {
    this.osc('square', 1200, 1200, 0.04, 0.05);
  }

  lockOn(): void {
    this.osc('square', 880, 880, 0.07, 0.09);
    this.osc('square', 1320, 1320, 0.09, 0.09, 0.09);
  }

  pickup(): void {
    this.osc('sine', 520, 1040, 0.18, 0.14);
    this.osc('sine', 780, 1560, 0.22, 0.1, 0.06);
  }

  waveStart(): void {
    this.osc('sawtooth', 220, 440, 0.3, 0.1);
    this.osc('sawtooth', 330, 660, 0.3, 0.08, 0.18);
  }

  playerHit(): void {
    this.noise(0.3, 0.3, 1100, 100);
    this.osc('sawtooth', 240, 60, 0.3, 0.18);
  }
}
