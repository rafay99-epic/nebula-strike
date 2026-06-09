/** Deterministic 2D value noise — seeded, no tables, safe to share. */
export class Noise2D {
  constructor(private seed: number) {}

  private h(ix: number, iz: number): number {
    const s = Math.sin(ix * 127.1 + iz * 311.7 + this.seed * 0.0173) * 43758.5453;
    return s - Math.floor(s);
  }

  value(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const a = this.h(ix, iz);
    const b = this.h(ix + 1, iz);
    const c = this.h(ix, iz + 1);
    const d = this.h(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x: number, z: number, octaves = 5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.value(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }

  /** Sharp mountain ridges: 1 - |2n - 1|. */
  ridged(x: number, z: number): number {
    return 1 - Math.abs(2 * this.fbm(x, z, 4) - 1);
  }
}

export function strSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 100000;
}
