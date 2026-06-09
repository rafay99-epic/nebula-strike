import * as THREE from 'three';
import type { PlanetDef, PlanetType } from './Sectors';
import { Noise2D, strSeed } from './noise';

export interface PlanetPhysics {
  /** m/s² pulling the ship down while in atmosphere */
  gravity: number;
  /** extra velocity damping from atmospheric density (fraction/s) */
  drag: number;
  /** lateral wind force m/s² (Jupiter storms) */
  wind: number;
  label: string;
}

interface Archetype {
  physics: PlanetPhysics;
  ceiling: number;
  skyZenith: number;
  skyHorizon: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  ambient: number;
  ambientIntensity: number;
  waterLevel: number | null;
  stars: boolean;
}

const ARCHETYPES: Record<PlanetType, Archetype> = {
  // Mars-class: thin butterscotch sky, rust canyons, craters, drifting dust
  rock: {
    physics: { gravity: 3.7, drag: 0.04, wind: 0, label: 'THIN ATMOSPHERE' },
    ceiling: 520,
    skyZenith: 0x2e1810, skyHorizon: 0xd9975c,
    fogColor: 0xc9885a, fogNear: 200, fogFar: 2100,
    sunColor: 0xffe8c8, sunIntensity: 2.6, sunPos: [700, 600, 200],
    hemiSky: 0xcc9966, hemiGround: 0x70402a, ambient: 0x886655, ambientIntensity: 0.7,
    waterLevel: null, stars: true,
  },
  // Earth-class: blue sky, ocean, beaches, grass, forests, cumulus clouds
  terra: {
    physics: { gravity: 9.8, drag: 0.18, wind: 0, label: 'BREATHABLE · DENSE' },
    ceiling: 560,
    skyZenith: 0x2f6fd8, skyHorizon: 0xbfe2f7,
    fogColor: 0xcfe5f4, fogNear: 600, fogFar: 3400,
    sunColor: 0xfff6e0, sunIntensity: 3.0, sunPos: [500, 900, 350],
    hemiSky: 0x9fc8ee, hemiGround: 0x3e5a30, ambient: 0x8899aa, ambientIntensity: 0.6,
    waterLevel: 0, stars: false,
  },
  // Europa-class: glacier ridges over a frozen sea, snowfall, pale sun
  ice: {
    physics: { gravity: 1.5, drag: 0.06, wind: 0, label: 'TRACE ATMOSPHERE' },
    ceiling: 520,
    skyZenith: 0x4a7aa8, skyHorizon: 0xddeef8,
    fogColor: 0xcfe4f0, fogNear: 260, fogFar: 2200,
    sunColor: 0xeaf4ff, sunIntensity: 2.3, sunPos: [800, 500, -300],
    hemiSky: 0xaaccee, hemiGround: 0x668899, ambient: 0x7090aa, ambientIntensity: 0.8,
    waterLevel: 8, stars: false,
  },
  // Io-class: black basalt, glowing lava seas, rising embers, starry sky
  lava: {
    physics: { gravity: 2.5, drag: 0.08, wind: 0, label: 'SULFUR HAZE' },
    ceiling: 520,
    skyZenith: 0x05030a, skyHorizon: 0x6e1c0a,
    fogColor: 0x401208, fogNear: 160, fogFar: 1500,
    sunColor: 0xff7a40, sunIntensity: 1.2, sunPos: [-600, 300, 500],
    hemiSky: 0x551a08, hemiGround: 0x330800, ambient: 0x662211, ambientIntensity: 0.9,
    waterLevel: 6, stars: true,
  },
  // Jupiter-class: banded cloud canyon, crushing gravity, storms and lightning
  gas: {
    physics: { gravity: 24, drag: 0.5, wind: 7, label: 'CRUSHING GRAVITY · STORMS' },
    ceiling: 470,
    skyZenith: 0x8a6a4a, skyHorizon: 0xe8d4b0,
    fogColor: 0xd8c4a0, fogNear: 220, fogFar: 1900,
    sunColor: 0xfff0d0, sunIntensity: 2.4, sunPos: [900, 700, 0],
    hemiSky: 0xddc8a8, hemiGround: 0x8a6a4a, ambient: 0x998866, ambientIntensity: 0.8,
    waterLevel: 0, stars: false,
  },
};

/** Physics lookup without building a surface — used for space gravity wells. */
export function physicsFor(type: PlanetType): PlanetPhysics {
  return ARCHETYPES[type].physics;
}

export interface Crystal {
  mesh: THREE.Mesh;
  taken: boolean;
  bobPhase: number;
  baseY: number;
}

/** Drifting particle field (snow, dust, embers, mist) that wraps around the player. */
class Precipitation {
  private points: THREE.Points;
  private vel: THREE.Vector3;
  private half: number;

  constructor(scene: THREE.Scene, count: number, color: number, size: number,
    vel: THREE.Vector3, additive: boolean, opacity: number, half = 110) {
    this.vel = vel;
    this.half = half;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) positions[i] = (Math.random() - 0.5) * half * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color, size, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, center: THREE.Vector3): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const size = this.half * 2;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += this.vel.x * dt;
      arr[i + 1] += this.vel.y * dt;
      arr[i + 2] += this.vel.z * dt;
      for (let k = 0; k < 3; k++) {
        const rel = arr[i + k] - center.getComponent(k);
        if (rel > this.half) arr[i + k] -= size;
        else if (rel < -this.half) arr[i + k] += size;
      }
    }
    pos.needsUpdate = true;
  }
}

const TERRAIN_SIZE = 2700;

/**
 * A flyable planet surface modeled on real solar-system worlds:
 * Mars-class deserts, Earth-class garden worlds, Europa-class ice fields,
 * Io-class volcanic wastes and Jupiter-class storm canyons — each with its
 * own gravity, atmosphere, sky, weather and scatter.
 */
export class PlanetSurface {
  readonly scene = new THREE.Scene();
  readonly crystals: Crystal[] = [];
  readonly def: PlanetDef;
  readonly arch: Archetype;
  readonly physics: PlanetPhysics;
  readonly ceiling: number;
  /** set by Game to play thunder on Jupiter-class lightning */
  onLightning: (() => void) | null = null;

  private noise: Noise2D;
  private quality: number;
  private clouds: { node: THREE.Object3D; drift: number }[] = [];
  private water: THREE.Mesh | null = null;
  private waterBase: Float32Array | null = null;
  private craters: { x: number; z: number; r: number; depth: number }[] = [];
  private rafts: { x: number; z: number; y: number; r: number }[] = [];
  private precip: Precipitation | null = null;
  private sun!: THREE.DirectionalLight;
  private lightningLight: THREE.PointLight | null = null;
  private lightningTimer = 4;
  private lavaMat: THREE.MeshStandardMaterial | null = null;
  private static softTex: THREE.CanvasTexture | null = null;

  constructor(def: PlanetDef, quality = 1) {
    this.def = def;
    this.quality = quality;
    this.arch = ARCHETYPES[def.type];
    this.physics = this.arch.physics;
    this.ceiling = this.arch.ceiling;
    this.noise = new Noise2D(strSeed(def.name));
    const a = this.arch;

    this.scene.background = new THREE.Color(a.fogColor);
    this.scene.fog = new THREE.Fog(a.fogColor, a.fogNear, a.fogFar);

    // mars craters are part of the height function — precompute them
    if (def.type === 'rock') {
      for (let i = 0; i < 12; i++) {
        this.craters.push({
          x: (this.noise.value(i * 13.7, 4.2) - 0.5) * 1500,
          z: (this.noise.value(7.7, i * 17.3) - 0.5) * 1500,
          r: 50 + this.noise.value(i * 3.1, i * 5.9) * 120,
          depth: 12 + this.noise.value(i * 9.3, 1.7) * 22,
        });
      }
    }
    if (def.type === 'gas') {
      for (let i = 0; i < 9; i++) {
        this.rafts.push({
          x: (this.noise.value(i * 5.1, 0.7) - 0.5) * 1500,
          z: (this.noise.value(0.3, i * 6.9) - 0.5) * 1500,
          y: 80 + this.noise.value(i * 2.9, i * 1.3) * 220,
          r: 34 + this.noise.value(i * 4.4, 7.7) * 40,
        });
      }
    }

    this.buildSky();
    this.buildLights();
    if (def.type === 'gas') this.buildJupiter();
    else this.buildTerrain();
    this.buildWater();
    this.buildScatter();
    this.buildClouds();
    this.buildWeather();
    this.buildCrystals();
  }

  // ------------------------------------------------------------- height

  /** Terrain height at world x/z — shared by mesh build and collision. */
  heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const fall = THREE.MathUtils.smoothstep(r, 820, 1250);
    switch (this.def.type) {
      case 'terra': {
        // domain-warped continents + ridged mountain cores
        const warp = this.noise.fbm(x * 0.001 + 50, z * 0.001 + 50) * 260;
        const cont = this.noise.fbm((x + warp) * 0.00052, (z - warp) * 0.00052);
        const detail = this.noise.fbm(x * 0.0042, z * 0.0042) * 16;
        const mountains = Math.pow(this.noise.ridged(x * 0.0011 + 9, z * 0.0011 + 9), 2.6) * 200;
        let h = (cont - 0.46) * 300 + detail;
        if (cont > 0.54) h += mountains * (cont - 0.54) * 5;
        // guaranteed island under the landing point so arrival shows a coastline
        const center = Math.max(0, 1 - r / 560);
        h = h * (1 - center * 0.5) + center * center * 30; // damp peaks, lift lowlands
        return h * (1 - fall) - 55 * fall; // rim sinks into open ocean
      }
      case 'rock': {
        const ridge = Math.pow(this.noise.ridged(x * 0.0013, z * 0.0013), 1.7);
        const base = this.noise.fbm(x * 0.0006 + 20, z * 0.0006 + 20);
        let h = base * 46 + ridge * 120 * base + this.noise.fbm(x * 0.006, z * 0.006) * 6;
        for (const c of this.craters) {
          const d = Math.hypot(x - c.x, z - c.z) / c.r;
          if (d < 1.15) {
            if (d < 1) h += c.depth * (d * d * 1.35 - 1);     // bowl
            else h += c.depth * 0.35 * (1.15 - d) / 0.15;      // raised rim
          }
        }
        return h * (1 - fall) + 2 * fall; // fades to open plain, mesas beyond
      }
      case 'ice': {
        const base = Math.pow(this.noise.fbm(x * 0.001, z * 0.001), 1.3) * 100;
        const ridge = this.noise.ridged(x * 0.0028 + 5, z * 0.0028 + 5) * 14;
        return (base + ridge) * (1 - fall) - 26 * fall;
      }
      case 'lava': {
        const ridge = Math.pow(this.noise.ridged(x * 0.0017, z * 0.0017), 2.2);
        const mask = this.noise.fbm(x * 0.0006 + 3, z * 0.0006 + 3);
        const h = ridge * 165 * mask + this.noise.fbm(x * 0.005, z * 0.005) * 9;
        return h * (1 - fall) - 12 * fall;
      }
      case 'gas':
        return 0; // the cloud deck
    }
  }

  floorAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const w = this.arch.waterLevel;
    return w !== null ? Math.max(h, w) : h;
  }

  // ---------------------------------------------------------------- sky

  private buildSky(): void {
    const a = this.arch;
    const geo = new THREE.SphereGeometry(4600, 32, 24);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const zen = new THREE.Color(a.skyZenith);
    const hor = new THREE.Color(a.skyHorizon);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 4600, -0.18, 1);
      // horizon band is wide and soft, like real atmospheric scattering
      const f = Math.pow(Math.max(0, 1 - Math.abs(t)), 1.6);
      c.copy(zen).lerp(hor, t < 0 ? 1 : f);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    dome.renderOrder = -10;
    this.scene.add(dome);

    if (a.stars) {
      const count = 900;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().randomDirection();
        v.y = Math.abs(v.y) * 0.9 + 0.1; // upper hemisphere
        v.multiplyScalar(4400);
        positions.set([v.x, v.y, v.z], i * 3);
      }
      const sgeo = new THREE.BufferGeometry();
      sgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const stars = new THREE.Points(sgeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 1.6, sizeAttenuation: false,
        transparent: true, opacity: 0.7, fog: false, depthWrite: false,
      }));
      stars.renderOrder = -9;
      this.scene.add(stars);
    }

    // sun disc + halo
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: PlanetSurface.softTexture(), color: a.sunColor, transparent: true,
      opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    sun.position.set(a.sunPos[0] * 4, a.sunPos[1] * 4, a.sunPos[2] * 4);
    sun.scale.setScalar(this.def.type === 'rock' ? 600 : 1100); // Mars: small, distant sun
    this.scene.add(sun);
  }

  private buildLights(): void {
    const a = this.arch;
    this.scene.add(new THREE.AmbientLight(a.ambient, a.ambientIntensity));
    this.sun = new THREE.DirectionalLight(a.sunColor, a.sunIntensity);
    this.sun.position.set(...a.sunPos);
    this.scene.add(this.sun);
    this.scene.add(new THREE.HemisphereLight(a.hemiSky, a.hemiGround, 1.0));
  }

  private static softTexture(): THREE.CanvasTexture {
    if (this.softTex) return this.softTex;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this.softTex = new THREE.CanvasTexture(canvas);
    return this.softTex;
  }

  // ------------------------------------------------------------ terrain

  private buildTerrain(): void {
    const segs = Math.round(190 * Math.max(0.65, this.quality));
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    // color pass: height bands blended smoothly + slope-aware rock
    const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = pos.getY(i);
      const slope = 1 - normal.getY(i); // 0 flat → 1 vertical
      const tint = 0.92 + this.noise.value(x * 0.03, z * 0.03) * 0.16;
      this.terrainColor(c, h, slope, x, z);
      colors[i * 3] = c.r * tint;
      colors[i * 3 + 1] = c.g * tint;
      colors[i * 3 + 2] = c.b * tint;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.02,
    }));
    mesh.receiveShadow = false;
    this.scene.add(mesh);
  }

  private terrainColor(out: THREE.Color, h: number, slope: number, x: number, z: number): void {
    const lerp3 = (a: number, b: number, t: number) =>
      out.setHex(a).lerp(_c2.setHex(b), THREE.MathUtils.clamp(t, 0, 1));
    switch (this.def.type) {
      case 'terra': {
        if (h < -6) lerp3(0x37503c, 0x2a3f48, Math.min(1, -h / 50));      // seabed
        else if (h < 2.5) lerp3(0xd2b87e, 0xc4aa70, (h + 6) / 8.5);        // golden beach
        else if (h < 90) lerp3(0x569540, 0x3e7531, h / 90);                // grasslands
        else if (h < 170) lerp3(0x3e7531, 0x6e685c, (h - 90) / 80);        // alpine rock
        else lerp3(0xb5b5b8, 0xffffff, (h - 170) / 60);                    // snowcaps
        if (slope > 0.35 && h > 2.5) out.lerp(_c2.setHex(0x6e685c), Math.min(1, (slope - 0.35) * 2.4));
        break;
      }
      case 'rock': {
        if (h < 8) lerp3(0x6e3a22, 0x8a4a2a, h / 8);                       // crater floors
        else if (h < 60) lerp3(0xa3542c, 0xb5663a, h / 60);                // rust plains
        else lerp3(0xb5663a, 0x8a4f3a, (h - 60) / 70);                     // high ridges
        if (slope > 0.3) out.lerp(_c2.setHex(0x5e3520), Math.min(1, (slope - 0.3) * 2.2));
        break;
      }
      case 'ice': {
        if (h < 12) lerp3(0x9fc8dd, 0xc8e2ee, h / 12);                     // sea ice shore
        else if (h < 55) lerp3(0xddeef6, 0xf4fafd, (h - 12) / 43);         // snowfields
        else lerp3(0xf4fafd, 0xffffff, (h - 55) / 45);
        if (slope > 0.32) out.lerp(_c2.setHex(0x7fb2d2), Math.min(1, (slope - 0.32) * 2.6)); // blue ice cliffs
        break;
      }
      case 'lava': {
        if (h < 10) lerp3(0x6e2810, 0x38201a, h / 10);                     // heated shore
        else if (h < 70) lerp3(0x2c2226, 0x1d181e, (h - 10) / 60);         // basalt
        else lerp3(0x1d181e, 0x121016, (h - 70) / 80);
        if (slope > 0.35) out.lerp(_c2.setHex(0x0d0b10), Math.min(1, (slope - 0.35) * 2));
        break;
      }
      default:
        out.setHex(0x888888);
    }
  }

  // -------------------------------------------------------------- water

  private buildWater(): void {
    const a = this.arch;
    if (a.waterLevel === null || this.def.type === 'gas') {
      if (this.def.type === 'gas') this.buildCloudDeck();
      return;
    }
    if (this.def.type === 'terra') {
      // animated ocean with gentle swell
      const geo = new THREE.PlaneGeometry(TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5, 56, 56);
      geo.rotateX(-Math.PI / 2);
      this.waterBase = new Float32Array((geo.getAttribute('position') as THREE.BufferAttribute).array);
      this.water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x2a6cb4, roughness: 0.18, metalness: 0.25,
        transparent: true, opacity: 0.9,
      }));
      this.water.position.y = a.waterLevel;
      this.scene.add(this.water);
      return;
    }
    const isLava = this.def.type === 'lava';
    const mat = new THREE.MeshStandardMaterial(isLava
      ? { color: 0xff4a08, emissive: 0xff3800, emissiveIntensity: 1.5, roughness: 0.55 }
      : { color: 0x6fa8c8, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.92 });
    if (isLava) this.lavaMat = mat;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN_SIZE * 1.5, TERRAIN_SIZE * 1.5), mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = a.waterLevel;
    this.scene.add(this.water);
  }

  // ---------------------------------------------------- jupiter special

  private buildCloudDeck(): void {
    // dense deck below the flight zone
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(TERRAIN_SIZE * 1.8, TERRAIN_SIZE * 1.8),
      new THREE.MeshStandardMaterial({
        color: 0xe2d0ac, roughness: 1, transparent: true, opacity: 0.97,
        emissive: 0x55432a, emissiveIntensity: 0.25,
      })
    );
    deck.rotation.x = -Math.PI / 2;
    this.scene.add(deck);
  }

  private buildJupiter(): void {
    // banded cloud walls ringing the arena — the Jovian canyon
    const bandColors = [0xe8d4b0, 0xc89a68, 0xb87850, 0xd8c4a0, 0x9a6a48];
    for (let band = 0; band < 5; band++) {
      const y = 40 + band * 95;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + band * 0.3;
        const r = 1250 + this.noise.value(i * 3.3, band * 7.7) * 350;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: PlanetSurface.softTexture(), color: bandColors[band % bandColors.length],
          transparent: true, opacity: 0.5, depthWrite: false,
        }));
        sprite.position.set(Math.cos(a) * r, y + (this.noise.value(i, band) - 0.5) * 40, Math.sin(a) * r);
        sprite.scale.set(620, 240, 1);
        this.scene.add(sprite);
      }
    }
    // the Great Spot — a vast storm eye on the horizon
    const spot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: PlanetSurface.softTexture(), color: 0xb04830,
      transparent: true, opacity: 0.7, depthWrite: false,
    }));
    spot.position.set(-1700, 260, -900);
    spot.scale.set(1300, 700, 1);
    this.scene.add(spot);

    // dense cloud rafts the crystals shelter above
    const raftMat = new THREE.MeshStandardMaterial({
      color: 0xeadfc4, roughness: 1, transparent: true, opacity: 0.92,
    });
    for (const raft of this.rafts) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(raft.r, raft.r * 0.55, raft.r * 0.4, 18), raftMat);
      disc.position.set(raft.x, raft.y - raft.r * 0.2, raft.z);
      this.scene.add(disc);
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Sprite(new THREE.SpriteMaterial({
          map: PlanetSurface.softTexture(), color: 0xf2e8d2,
          transparent: true, opacity: 0.75, depthWrite: false,
        }));
        const a = (i / 5) * Math.PI * 2;
        puff.position.set(
          raft.x + Math.cos(a) * raft.r * 0.8,
          raft.y - raft.r * 0.15 + (Math.random() - 0.5) * 8,
          raft.z + Math.sin(a) * raft.r * 0.8
        );
        puff.scale.setScalar(raft.r * (1.5 + Math.random() * 0.6));
        this.scene.add(puff);
      }
    }
    this.lightningLight = new THREE.PointLight(0xcfe0ff, 0, 1600);
    this.scene.add(this.lightningLight);
  }

  // ------------------------------------------------------------ scatter

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]): void {
    if (mats.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  /** deterministic scatter position #i within `range`, or null if underwater/steep */
  private scatterSpot(i: number, range: number, minH: number, maxH: number): THREE.Vector3 | null {
    const x = (this.noise.value(i * 7.31, 2.17) - 0.5) * range;
    const z = (this.noise.value(3.11, i * 9.73) - 0.5) * range;
    const h = this.heightAt(x, z);
    if (h < minH || h > maxH) return null;
    return new THREE.Vector3(x, h, z);
  }

  private buildScatter(): void {
    const q = this.quality;
    const dummy = new THREE.Object3D();
    const collect = (count: number, range: number, minH: number, maxH: number,
      place: (spot: THREE.Vector3, i: number) => void) => {
      for (let i = 0; i < count; i++) {
        const spot = this.scatterSpot(i, range, minH, maxH);
        if (spot) place(spot, i);
      }
    };

    switch (this.def.type) {
      case 'terra': {
        // forests: instanced trunks + canopies on the grass belt
        const trunks: THREE.Matrix4[] = [];
        const canopies: THREE.Matrix4[] = [];
        collect(Math.round(170 * q), 1850, 4, 75, (s, i) => {
          const sc = 0.8 + this.noise.value(i * 1.3, 6.6) * 1.1;
          dummy.position.set(s.x, s.y + 3 * sc, s.z);
          dummy.scale.setScalar(sc);
          dummy.rotation.set(0, this.noise.value(i, 1) * 6.3, 0);
          dummy.updateMatrix();
          trunks.push(dummy.matrix.clone());
          dummy.position.y = s.y + (6.5 + this.noise.value(i, 9) * 1.5) * sc;
          dummy.scale.set(sc * (0.9 + this.noise.value(i, 3) * 0.5), sc * (0.8 + this.noise.value(i, 4) * 0.6), sc);
          dummy.updateMatrix();
          canopies.push(dummy.matrix.clone());
        });
        this.instanced(new THREE.CylinderGeometry(0.45, 0.7, 6, 5),
          new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }), trunks);
        this.instanced(new THREE.IcosahedronGeometry(4.2, 0),
          new THREE.MeshStandardMaterial({ color: 0x3e7d34, roughness: 0.85, flatShading: true }), canopies);

        // grass tufts + bushes
        const bushes: THREE.Matrix4[] = [];
        collect(Math.round(260 * q), 1850, 2.5, 60, (s, i) => {
          dummy.position.set(s.x, s.y + 0.6, s.z);
          dummy.scale.setScalar(0.6 + this.noise.value(i * 2.1, 4.4) * 1.3);
          dummy.rotation.set(0, i, 0);
          dummy.updateMatrix();
          bushes.push(dummy.matrix.clone());
        });
        this.instanced(new THREE.IcosahedronGeometry(1.5, 0),
          new THREE.MeshStandardMaterial({ color: 0x4f9340, roughness: 0.9, flatShading: true }), bushes);
        break;
      }
      case 'rock': {
        // strewn boulders + distant mesas on the horizon
        const boulders: THREE.Matrix4[] = [];
        collect(Math.round(190 * q), 1900, 1, 120, (s, i) => {
          dummy.position.set(s.x, s.y + 0.5, s.z);
          dummy.scale.set(
            1 + this.noise.value(i, 2) * 4,
            0.7 + this.noise.value(i, 3) * 2.4,
            1 + this.noise.value(i, 4) * 4);
          dummy.rotation.set(this.noise.value(i, 5) * 3, this.noise.value(i, 6) * 3, 0);
          dummy.updateMatrix();
          boulders.push(dummy.matrix.clone());
        });
        this.instanced(new THREE.DodecahedronGeometry(1.6, 0),
          new THREE.MeshStandardMaterial({ color: 0x7a4226, roughness: 0.95, flatShading: true }), boulders);

        const mesaMat = new THREE.MeshStandardMaterial({ color: 0x91492a, roughness: 0.95, flatShading: true });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + 0.4;
          const r = 1350 + this.noise.value(i * 8.8, 2.0) * 420;
          const w = 130 + this.noise.value(i * 2.2, 7.1) * 160;
          const h = 110 + this.noise.value(i * 6.6, 3.3) * 130;
          const mesa = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.62, w, h, 9), mesaMat);
          mesa.position.set(Math.cos(a) * r, h * 0.3, Math.sin(a) * r);
          this.scene.add(mesa);
        }
        break;
      }
      case 'ice': {
        const spires: THREE.Matrix4[] = [];
        collect(Math.round(140 * q), 1850, 10, 110, (s, i) => {
          dummy.position.set(s.x, s.y + 4, s.z);
          const sc = 1.5 + this.noise.value(i * 1.9, 3.2) * 5;
          dummy.scale.set(sc * 0.5, sc * (1.6 + this.noise.value(i, 8)), sc * 0.5);
          dummy.rotation.set(this.noise.value(i, 1) * 0.3, i, this.noise.value(i, 2) * 0.3);
          dummy.updateMatrix();
          spires.push(dummy.matrix.clone());
        });
        this.instanced(new THREE.OctahedronGeometry(2, 0),
          new THREE.MeshStandardMaterial({
            color: 0xbfe2f2, roughness: 0.15, metalness: 0.1,
            transparent: true, opacity: 0.85, flatShading: true,
            emissive: 0x1c3a4a, emissiveIntensity: 0.35,
          }), spires);
        // distant icebergs on the frozen sea
        const bergMat = new THREE.MeshStandardMaterial({ color: 0xe8f4fa, roughness: 0.4, flatShading: true });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 1.1;
          const r = 1300 + this.noise.value(i * 4.4, 6.0) * 400;
          const berg = new THREE.Mesh(new THREE.IcosahedronGeometry(60 + this.noise.value(i, 3) * 80, 0), bergMat);
          berg.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          berg.scale.y = 0.6;
          this.scene.add(berg);
        }
        break;
      }
      case 'lava': {
        const columns: THREE.Matrix4[] = [];
        collect(Math.round(130 * q), 1850, 9, 130, (s, i) => {
          dummy.position.set(s.x, s.y + 4, s.z);
          const sc = 1.4 + this.noise.value(i * 2.3, 1.1) * 3.4;
          dummy.scale.set(sc, sc * (2 + this.noise.value(i, 5) * 2.4), sc);
          dummy.rotation.set(0, i * 0.7, this.noise.value(i, 6) * 0.16);
          dummy.updateMatrix();
          columns.push(dummy.matrix.clone());
        });
        this.instanced(new THREE.CylinderGeometry(1.1, 1.35, 4, 6),
          new THREE.MeshStandardMaterial({ color: 0x141117, roughness: 0.4, metalness: 0.35, flatShading: true }), columns);

        // the great volcano with a glowing throat and smoke column
        const cone = new THREE.Mesh(
          new THREE.CylinderGeometry(70, 260, 330, 12),
          new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: 0.9, flatShading: true }));
        cone.position.set(-950, 80, -780);
        this.scene.add(cone);
        const throat = new THREE.Mesh(
          new THREE.CylinderGeometry(62, 62, 8, 12),
          new THREE.MeshStandardMaterial({ color: 0xff5a14, emissive: 0xff4400, emissiveIntensity: 2.2 }));
        throat.position.set(-950, 246, -780);
        this.scene.add(throat);
        for (let i = 0; i < 4; i++) {
          const smoke = new THREE.Sprite(new THREE.SpriteMaterial({
            map: PlanetSurface.softTexture(), color: 0x221a18,
            transparent: true, opacity: 0.55, depthWrite: false,
          }));
          smoke.position.set(-950 + (Math.random() - 0.5) * 60, 300 + i * 80, -780 + (Math.random() - 0.5) * 60);
          smoke.scale.setScalar(160 + i * 70);
          this.scene.add(smoke);
        }
        break;
      }
      case 'gas':
        break; // Jupiter scatter handled in buildJupiter
    }
  }

  // ------------------------------------------------------------- clouds

  private buildClouds(): void {
    const type = this.def.type;
    if (type === 'gas') return; // bands are the clouds
    const cfg = {
      terra: { count: 11, color: 0xffffff, opacity: 0.75, y: [270, 430], scale: [90, 170], puffs: 6, flat: 0.45 },
      rock: { count: 6, color: 0xe8c8a8, opacity: 0.16, y: [300, 420], scale: [260, 420], puffs: 2, flat: 0.16 },
      ice: { count: 8, color: 0xffffff, opacity: 0.5, y: [220, 360], scale: [140, 240], puffs: 4, flat: 0.3 },
      lava: { count: 7, color: 0x33201c, opacity: 0.6, y: [240, 380], scale: [160, 300], puffs: 4, flat: 0.35 },
    }[type];
    for (let i = 0; i < cfg.count; i++) {
      const group = new THREE.Group();
      const baseScale = cfg.scale[0] + Math.random() * (cfg.scale[1] - cfg.scale[0]);
      for (let p = 0; p < cfg.puffs; p++) {
        const puff = new THREE.Sprite(new THREE.SpriteMaterial({
          map: PlanetSurface.softTexture(), color: cfg.color,
          transparent: true, opacity: cfg.opacity * (0.6 + Math.random() * 0.4),
          depthWrite: false,
        }));
        puff.position.set(
          (Math.random() - 0.5) * baseScale * 0.9,
          (Math.random() - 0.5) * baseScale * 0.2,
          (Math.random() - 0.5) * baseScale * 0.5
        );
        const s = baseScale * (0.45 + Math.random() * 0.5);
        puff.scale.set(s, s * cfg.flat, 1);
        group.add(puff);
      }
      group.position.set(
        (Math.random() - 0.5) * 2400,
        cfg.y[0] + Math.random() * (cfg.y[1] - cfg.y[0]),
        (Math.random() - 0.5) * 2400
      );
      this.scene.add(group);
      this.clouds.push({ node: group, drift: 2 + Math.random() * 5 });
    }
  }

  private buildWeather(): void {
    const q = this.quality;
    switch (this.def.type) {
      case 'rock': // drifting red dust
        this.precip = new Precipitation(this.scene, Math.round(260 * q), 0xcc8855, 0.5,
          new THREE.Vector3(7, -0.5, 2), false, 0.4);
        break;
      case 'ice': // snowfall
        this.precip = new Precipitation(this.scene, Math.round(420 * q), 0xffffff, 0.6,
          new THREE.Vector3(1.5, -7, 0.5), false, 0.7);
        break;
      case 'lava': // embers rising
        this.precip = new Precipitation(this.scene, Math.round(220 * q), 0xff8830, 0.8,
          new THREE.Vector3(0.5, 5.5, 0.5), true, 0.8);
        break;
      case 'gas': // shredded mist racing past
        this.precip = new Precipitation(this.scene, Math.round(300 * q), 0xf0e4cc, 0.7,
          new THREE.Vector3(26, -2, 4), false, 0.45, 140);
        break;
      case 'terra': // pollen motes shimmering in the sun
        this.precip = new Precipitation(this.scene, Math.round(120 * q), 0xfff8d0, 0.3,
          new THREE.Vector3(1.2, -0.4, 0.8), true, 0.35);
        break;
    }
  }

  private buildCrystals(): void {
    const colorByType: Record<PlanetType, number> = {
      rock: 0x4de8ff, terra: 0xffd24d, ice: 0x66ffe0, lava: 0xffaa33, gas: 0xffd24d,
    };
    const geo = new THREE.OctahedronGeometry(2.4, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x112222, emissive: colorByType[this.def.type], emissiveIntensity: 2.6,
      roughness: 0.3, metalness: 0.2,
    });
    for (let i = 0; i < 12; i++) {
      let x: number, z: number, baseY: number;
      if (this.def.type === 'gas') {
        const raft = this.rafts[i % this.rafts.length];
        x = raft.x + (Math.random() - 0.5) * raft.r;
        z = raft.z + (Math.random() - 0.5) * raft.r;
        baseY = raft.y + 14 + Math.random() * 10;
      } else {
        x = (this.noise.value(i * 11.3, 5.5) - 0.5) * 1500;
        z = (this.noise.value(6.2, i * 13.7) - 0.5) * 1500;
        baseY = this.floorAt(x, z) + 12 + this.noise.value(i * 0.7, 1.1) * 30;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, baseY, z);
      this.scene.add(mesh);
      this.crystals.push({ mesh, taken: false, bobPhase: Math.random() * Math.PI * 2, baseY });
    }
  }

  // ------------------------------------------------------------- update

  update(dt: number, time: number, playerPos: THREE.Vector3): void {
    for (const cloud of this.clouds) {
      cloud.node.position.x += cloud.drift * dt;
      if (cloud.node.position.x > 1500) cloud.node.position.x = -1500;
    }
    for (const c of this.crystals) {
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 1.4;
      c.mesh.position.y = c.baseY + Math.sin(time * 1.2 + c.bobPhase) * 2.2;
    }
    this.precip?.update(dt, playerPos);

    // terra ocean swell
    if (this.water && this.waterBase && this.def.type === 'terra') {
      const pos = this.water.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = this.waterBase[i];
        const z = this.waterBase[i + 2];
        arr[i + 1] = Math.sin(x * 0.012 + time * 0.9) * 1.1 + Math.cos(z * 0.016 + time * 0.7) * 0.9;
      }
      pos.needsUpdate = true;
    }
    // lava breathing glow
    if (this.lavaMat) {
      this.lavaMat.emissiveIntensity = 1.3 + Math.sin(time * 1.7) * 0.35;
    }
    // Jupiter lightning
    if (this.def.type === 'gas' && this.lightningLight) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 2.5 + Math.random() * 5;
        this.lightningLight.position.set(
          playerPos.x + (Math.random() - 0.5) * 900,
          150 + Math.random() * 250,
          playerPos.z + (Math.random() - 0.5) * 900
        );
        this.lightningLight.intensity = 30000;
        this.onLightning?.();
      }
      if (this.lightningLight.intensity > 0) {
        this.lightningLight.intensity *= Math.pow(0.0001, dt); // sharp decay
        if (this.lightningLight.intensity < 1) this.lightningLight.intensity = 0;
      }
    }
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      } else if (obj instanceof THREE.Sprite) {
        obj.material.dispose();
      }
    });
  }
}

const _c2 = new THREE.Color();
