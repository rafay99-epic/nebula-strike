/**
 * Procedural ambient soundtrack — deep-space pads, a sub drone, sparse
 * echoing pings, and a pulsing combat layer that crossfades in when
 * hostiles close in. Pure Web Audio, no assets.
 */
export class Music {
  started = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private combatGain: GainNode | null = null;
  private padVoices: { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode }[] = [];
  private chordTimer: number | null = null;
  private pingTimer: number | null = null;
  private chordIndex = 0;
  private intensity = 0;

  // ambient minor-ish progressions (Hz)
  private static CHORDS: number[][] = [
    [73.42, 110.0, 146.83, 174.61, 220.0],   // D minor stack
    [65.41, 98.0, 130.81, 155.56, 196.0],     // C minor-ish
    [87.31, 130.81, 174.61, 220.0, 261.63],   // F
    [61.74, 92.5, 123.47, 146.83, 185.0],     // B half-dim flavor
  ];

  start(ctx: AudioContext): void {
    if (this.started) return;
    this.started = true;
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);
    // slow fade-in so the soundtrack creeps up after launch
    this.master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 6);

    // gentle low-pass over everything for warmth
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2400;
    warmth.connect(this.master);

    // --- echoing delay bus (space!) ---
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = 0.85;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1200;
    delay.connect(feedback).connect(delayFilter).connect(delay);
    delay.connect(warmth);

    // --- sub drone ---
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 36.71; // D1
    const subGain = ctx.createGain();
    subGain.gain.value = 0.22;
    const subLfo = ctx.createOscillator();
    subLfo.frequency.value = 0.06;
    const subLfoDepth = ctx.createGain();
    subLfoDepth.gain.value = 0.08;
    subLfo.connect(subLfoDepth).connect(subGain.gain);
    sub.connect(subGain).connect(warmth);
    sub.start();
    subLfo.start();

    // --- pad voices ---
    const padBus = ctx.createGain();
    padBus.gain.value = 0.16;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 720;
    padBus.connect(padFilter).connect(warmth);
    padBus.connect(delay);

    for (let i = 0; i < 5; i++) {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc2.detune.value = 7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(padBus);
      osc1.start();
      osc2.start();
      this.padVoices.push({ osc1, osc2, gain });
    }
    this.applyChord(0, 4);

    // chord changes every ~18s
    this.chordTimer = window.setInterval(() => {
      this.chordIndex = (this.chordIndex + 1) % Music.CHORDS.length;
      this.applyChord(this.chordIndex, 6);
    }, 18000);

    // --- sparse high pings with long echoes ---
    const pingBus = ctx.createGain();
    pingBus.gain.value = 0.05;
    pingBus.connect(delay);
    pingBus.connect(warmth);
    this.pingTimer = window.setInterval(() => {
      if (!this.ctx || Math.random() > 0.55) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const base = Music.CHORDS[this.chordIndex];
      o.frequency.value = base[2 + Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? 4 : 8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g).connect(pingBus);
      o.start(t);
      o.stop(t + 1.5);
    }, 4200);

    // --- combat layer: pulsing dark bass ---
    this.combatGain = ctx.createGain();
    this.combatGain.gain.value = 0;
    const combatFilter = ctx.createBiquadFilter();
    combatFilter.type = 'lowpass';
    combatFilter.frequency.value = 420;
    this.combatGain.connect(combatFilter).connect(warmth);

    for (const freq of [55, 82.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.4;
      o.connect(g).connect(this.combatGain);
      o.start();
    }
    // rhythmic pulse on the combat layer
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = 2.1;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    const pulseOffset = ctx.createConstantSource();
    pulseOffset.offset.value = 0.5;
    const pulseSum = ctx.createGain();
    pulse.connect(pulseDepth).connect(pulseSum.gain);
    pulseOffset.connect(pulseSum.gain);
    pulseSum.gain.value = 0;
    pulse.start();
    pulseOffset.start();
    // re-route combat through the pulse vca
    this.combatGain.disconnect();
    this.combatGain.connect(pulseSum).connect(combatFilter);
  }

  private applyChord(index: number, glide: number): void {
    if (!this.ctx) return;
    const chord = Music.CHORDS[index];
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.padVoices.length; i++) {
      const v = this.padVoices[i];
      const freq = chord[i % chord.length] * (i >= chord.length ? 2 : 1);
      v.osc1.frequency.exponentialRampToValueAtTime(freq, t + glide * 0.5);
      v.osc2.frequency.exponentialRampToValueAtTime(freq, t + glide * 0.5);
      // stagger swells so the pad breathes
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0.05, t + glide * 0.3 + i * 0.4);
      v.gain.gain.linearRampToValueAtTime(0.16 + (i % 2) * 0.05, t + glide + i * 0.7);
    }
  }

  /** 0 = calm exploration, 1 = full combat. Crossfades the combat layer. */
  setIntensity(value: number): void {
    if (!this.ctx || !this.combatGain) return;
    const v = Math.max(0, Math.min(1, value));
    if (Math.abs(v - this.intensity) < 0.05) return;
    this.intensity = v;
    const t = this.ctx.currentTime;
    this.combatGain.gain.cancelScheduledValues(t);
    this.combatGain.gain.setValueAtTime(this.combatGain.gain.value, t);
    this.combatGain.gain.linearRampToValueAtTime(v * 0.16, t + 1.6);
  }

  dispose(): void {
    if (this.chordTimer !== null) clearInterval(this.chordTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
  }
}
