import * as THREE from 'three';
import type { SectorDef, PlanetDef, PlanetType } from './Sectors';
import { Noise2D, strSeed } from './noise';

export interface AsteroidInfo {
  position: THREE.Vector3;
  radius: number;
}

export interface Planet {
  def: PlanetDef;
  position: THREE.Vector3;
  visitRadius: number;
  visited: boolean;
  group: THREE.Group;
  moons: { mesh: THREE.Mesh; orbitR: number; speed: number; phase: number }[];
}

function makeNebulaTexture(hue: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.55)`);
  grad.addColorStop(0.4, `hsla(${hue + 20}, 70%, 45%, 0.25)`);
  grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeGlowTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeRingTexture(): THREE.CanvasTexture {
  const w = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const band = 0.35 + 0.65 * Math.abs(Math.sin(t * 40) * Math.sin(t * 13));
    const alpha = t < 0.08 || t > 0.96 ? 0 : band * 0.55;
    ctx.fillStyle = `rgba(210, 200, 185, ${alpha})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  return new THREE.CanvasTexture(canvas);
}

export class Environment {
  readonly asteroids: AsteroidInfo[] = [];
  readonly planets: Planet[] = [];
  worldRadius = 2400;

  private scene: THREE.Scene;
  private root = new THREE.Group();
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private spins: { axis: THREE.Vector3; speed: number; quat: THREE.Quaternion; pos: THREE.Vector3; scale: number }[][] = [];
  private station: THREE.Group | null = null;
  private stationRing: THREE.Mesh | null = null;
  private boundary!: THREE.Mesh;
  private gate: THREE.Group | null = null;
  private gateSwirl: THREE.Sprite | null = null;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.root);
  }

  get gatePosition(): THREE.Vector3 | null {
    return this.gate ? this.gate.position : null;
  }

  /** Tear down the current sector and build a new one. */
  build(sector: SectorDef): void {
    this.disposeRoot();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    // clear in place — other systems hold references to these arrays
    this.asteroids.length = 0;
    this.planets.length = 0;
    this.instancedMeshes = [];
    this.spins = [];
    this.station = null;
    this.stationRing = null;
    this.gate = null;
    this.gateSwirl = null;
    this.worldRadius = sector.worldRadius;

    // --- lighting ---
    this.root.add(new THREE.AmbientLight(sector.ambientColor, 1.4));
    const sun = new THREE.DirectionalLight(sector.sunColor, sector.sunIntensity);
    sun.position.set(900, 500, 400);
    this.root.add(sun);
    const fill = new THREE.DirectionalLight(0x3355aa, 0.5);
    fill.position.set(-600, -300, -500);
    this.root.add(fill);

    // --- starfield ---
    for (const [count, sizePx, brightness] of [[4200, 1.4, 0.7], [600, 2.4, 1.0]] as const) {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(4200 + Math.random() * 1400);
        positions.set([v.x, v.y, v.z], i * 3);
        c.setHSL(0.55 + Math.random() * 0.15, Math.random() * 0.45, brightness * (0.45 + Math.random() * 0.55));
        colors.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: sizePx, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0.95, depthWrite: false,
      });
      this.root.add(new THREE.Points(geo, mat));
    }

    // --- nebula sprites ---
    for (let i = 0; i < sector.nebulaHues.length + 1; i++) {
      const hue = sector.nebulaHues[i % sector.nebulaHues.length];
      const tex = makeNebulaTexture(hue);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.17,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const dir = new THREE.Vector3().randomDirection();
      dir.y = THREE.MathUtils.clamp(dir.y, -0.4, 0.4);
      sprite.position.copy(dir.normalize().multiplyScalar(3800));
      const s = 2200 + Math.random() * 1800;
      sprite.scale.set(s, s, 1);
      this.root.add(sprite);
    }

    // --- planets ---
    const usedAngles: number[] = [];
    for (let pi = 0; pi < sector.planets.length; pi++) {
      const pdef = sector.planets[pi];
      // spread planets around the ring with jitter; fall back to even spacing
      let angle = (pi / sector.planets.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!usedAngles.some((a) => Math.abs(((angle - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.55)) break;
        angle = Math.random() * Math.PI * 2;
      }
      usedAngles.push(angle);
      const pos = new THREE.Vector3(
        Math.cos(angle) * pdef.distance,
        (Math.random() - 0.5) * 300,
        Math.sin(angle) * pdef.distance
      );
      this.planets.push(this.buildPlanet(pdef, pos));
    }

    // --- asteroid field ---
    const rockMat = new THREE.MeshStandardMaterial({
      color: sector.asteroidColor, roughness: 0.95, metalness: 0.08,
      emissive: sector.asteroidEmissive ?? 0x000000,
    });
    const variants: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 3; v++) {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const seen = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        let f = seen.get(key);
        if (f === undefined) {
          f = 0.65 + Math.random() * 0.65;
          seen.set(key, f);
        }
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
      }
      geo.computeVertexNormals();
      variants.push(geo);
    }

    const perVariant = Math.ceil(sector.asteroidCount / 3);
    const dummy = new THREE.Object3D();
    for (let v = 0; v < variants.length; v++) {
      const inst = new THREE.InstancedMesh(variants[v], rockMat, perVariant);
      const spinList: typeof this.spins[number] = [];
      for (let i = 0; i < perVariant; i++) {
        const r = 220 + Math.random() * (sector.worldRadius * 0.55);
        const theta = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(
          Math.cos(theta) * r,
          (Math.random() - 0.5) * 340,
          Math.sin(theta) * r
        );
        const scale = 4 + Math.random() * 18;
        dummy.position.copy(p);
        dummy.scale.setScalar(scale);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        this.asteroids.push({ position: p, radius: scale * 1.05 });
        spinList.push({
          axis: new THREE.Vector3().randomDirection(),
          speed: (Math.random() - 0.5) * 0.25,
          quat: new THREE.Quaternion().setFromEuler(dummy.rotation),
          pos: p,
          scale,
        });
      }
      inst.instanceMatrix.needsUpdate = true;
      this.root.add(inst);
      this.instancedMeshes.push(inst);
      this.spins.push(spinList);
    }

    // --- station (first sector only — home base flavor) ---
    if (sector.wrecks === 0 && sector.waves <= 3 && sector.name === 'ASTERIA BELT') {
      this.buildStation();
    }

    // --- derelict wrecks ---
    for (let i = 0; i < sector.wrecks; i++) {
      this.buildWreck();
    }

    // --- combat zone boundary ---
    this.boundary = new THREE.Mesh(
      new THREE.SphereGeometry(sector.worldRadius, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x4de8ff, wireframe: true, transparent: true, opacity: 0, depthWrite: false,
      })
    );
    this.root.add(this.boundary);
  }

  /**
   * Paint a planet sphere per-vertex so it reads like a real world from
   * orbit: continents and polar caps for terra, rusty maria for Mars-class,
   * latitude bands for Jupiter-class giants, glowing fissures for lava worlds.
   */
  private paintPlanetSphere(geo: THREE.SphereGeometry, type: PlanetType, seed: number): void {
    const noise = new Noise2D(seed);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const c2 = new THREE.Color();
    const radius = geo.parameters.radius;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).divideScalar(radius);
      const lat = v.y; // -1..1
      const lon = Math.atan2(v.z, v.x);
      const u = lon * 2.2;
      const w = Math.asin(THREE.MathUtils.clamp(lat, -1, 1)) * 2.2;
      switch (type) {
        case 'terra': {
          const cont = noise.fbm(u * 1.6 + 7, w * 1.6 + 3, 4);
          if (Math.abs(lat) > 0.82) c.setHex(0xeef6fa);                       // polar caps
          else if (cont > 0.58) c.setHex(0x3f7a36).lerp(c2.setHex(0x6e8a4a), noise.value(u * 6, w * 6)); // land
          else if (cont > 0.53) c.setHex(0xc9b98a);                            // coast
          else c.setHex(0x1d4e8e).lerp(c2.setHex(0x2a6aae), cont / 0.53);     // ocean
          break;
        }
        case 'rock': {
          const m = noise.fbm(u * 2 + 1, w * 2 + 5, 4);
          c.setHex(0xb5663a).lerp(c2.setHex(0x6e3a22), m);                    // rust + dark maria
          if (Math.abs(lat) > 0.88) c.lerp(c2.setHex(0xe8dcd0), 0.7);         // small ice caps
          break;
        }
        case 'ice': {
          const m = noise.fbm(u * 2.4, w * 2.4, 4);
          c.setHex(0xe8f2f8).lerp(c2.setHex(0x9cc4dc), m * 0.8);              // cracked shell
          break;
        }
        case 'lava': {
          const m = noise.ridged(u * 1.8, w * 1.8);
          c.setHex(0x16100e).lerp(c2.setHex(0xff5a14), Math.pow(m, 5) * 0.95); // glowing fissures
          break;
        }
        case 'gas': {
          // Jupiter-style latitude bands, warped by turbulence
          const turb = noise.fbm(u * 1.4, w * 0.7, 3) * 1.6;
          const band = Math.sin(lat * 11 + turb * 2.4) * 0.5 + 0.5;
          const palette = [0xe8d4b0, 0xc89a68, 0xb87850, 0xd8c4a0];
          const idx = Math.floor(band * (palette.length - 0.01));
          c.setHex(palette[idx]).lerp(c2.setHex(palette[(idx + 1) % palette.length]), band * palette.length - idx);
          // the great storm spot
          const spotD = Math.hypot((lat + 0.28) * 3.2, (Math.sin(lon - 1.2)) * 1.8);
          if (spotD < 1 && Math.cos(lon - 1.2) > 0) c.lerp(c2.setHex(0xb04830), 1 - spotD);
          break;
        }
      }
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  private buildPlanet(pdef: PlanetDef, pos: THREE.Vector3): Planet {
    const group = new THREE.Group();
    group.position.copy(pos);

    const matParams: Record<PlanetType, THREE.MeshStandardMaterialParameters> = {
      terra: { roughness: 0.65, metalness: 0.05 },
      rock: { roughness: 0.95, metalness: 0.05 },
      gas: { roughness: 0.75, metalness: 0.05 },
      ice: { roughness: 0.35, metalness: 0.15 },
      lava: { roughness: 0.8, metalness: 0.1, emissive: 0xff3a08, emissiveIntensity: 0.45 },
    };
    const glows: Record<PlanetType, [number, number, number]> = {
      terra: [140, 200, 255],
      rock: [255, 170, 110],
      gas: [255, 220, 170],
      ice: [180, 235, 255],
      lava: [255, 100, 40],
    };
    const glow = glows[pdef.type];
    const geo = new THREE.SphereGeometry(pdef.radius, 56, 42);
    this.paintPlanetSphere(geo, pdef.type, strSeed(pdef.name));
    const sphere = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      ...matParams[pdef.type], vertexColors: true,
    }));
    group.add(sphere);

    // atmosphere glow
    if (glow) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(glow[0], glow[1], glow[2]),
        transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sprite.scale.setScalar(pdef.radius * 3.1);
      group.add(sprite);
    }

    // rings
    if (pdef.rings) {
      const ringGeo = new THREE.RingGeometry(pdef.radius * 1.5, pdef.radius * 2.6, 96, 1);
      const ringMat = new THREE.MeshBasicMaterial({
        map: makeRingTexture(), side: THREE.DoubleSide,
        transparent: true, opacity: 0.8, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2 - 0.35;
      group.add(ring);
    }

    // moons
    const moons: Planet['moons'] = [];
    for (let i = 0; i < (pdef.moons ?? 0); i++) {
      const moonR = pdef.radius * (0.12 + Math.random() * 0.1);
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(moonR, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.95 })
      );
      group.add(moon);
      moons.push({
        mesh: moon,
        orbitR: pdef.radius * (2.2 + i * 1.1),
        speed: 0.05 + Math.random() * 0.05,
        phase: Math.random() * Math.PI * 2,
      });
    }

    this.root.add(group);
    // planets are solid — keep ships/projectiles out via the asteroid collision list
    this.asteroids.push({ position: pos.clone(), radius: pdef.radius * 1.02 });
    return {
      def: pdef,
      position: pos.clone(),
      visitRadius: pdef.radius * 1.4 + 130,
      visited: false,
      group,
      moons,
    };
  }

  private buildStation(): void {
    this.station = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.5, metalness: 0.8 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x223344, emissive: 0x4de8ff, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 60, 12), hullMat);
    this.station.add(core);
    this.stationRing = new THREE.Mesh(new THREE.TorusGeometry(38, 4, 10, 40), hullMat);
    this.stationRing.rotation.x = Math.PI / 2;
    this.station.add(this.stationRing);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 2), hullMat);
      spoke.rotation.y = (i / 4) * Math.PI;
      this.stationRing.add(spoke);
    }
    for (let i = 0; i < 8; i++) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), accentMat);
      const a = (i / 8) * Math.PI * 2;
      light.position.set(Math.cos(a) * 38, Math.sin(a) * 38, 0);
      this.stationRing.add(light);
    }
    this.station.position.set(380, 80, -520);
    this.root.add(this.station);
    this.asteroids.push({ position: this.station.position.clone(), radius: 48 });
  }

  private buildWreck(): void {
    const wreck = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9, metalness: 0.6 });
    const scorch = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 1.0, metalness: 0.3 });
    // broken capital ship: hull halves + scattered plates
    const hullLen = 60 + Math.random() * 60;
    const front = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, hullLen * 0.45, 8), mat);
    front.rotation.x = -Math.PI / 2;
    front.position.z = -hullLen * 0.3;
    front.rotation.z = (Math.random() - 0.5) * 0.5;
    wreck.add(front);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, hullLen * 0.4, 8), scorch);
    back.rotation.x = -Math.PI / 2;
    back.position.z = hullLen * 0.32;
    back.position.y = (Math.random() - 0.5) * 8;
    back.rotation.z = (Math.random() - 0.5) * 0.9;
    wreck.add(back);
    for (let i = 0; i < 5; i++) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(4 + Math.random() * 8, 0.6, 3 + Math.random() * 6), scorch);
      plate.position.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 25, (Math.random() - 0.5) * 50);
      plate.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      wreck.add(plate);
    }
    const r = 400 + Math.random() * (this.worldRadius * 0.45);
    const theta = Math.random() * Math.PI * 2;
    wreck.position.set(Math.cos(theta) * r, (Math.random() - 0.5) * 250, Math.sin(theta) * r);
    wreck.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.root.add(wreck);
    this.asteroids.push({ position: wreck.position.clone(), radius: hullLen * 0.45 });
  }

  /** Spawn the jump gate once a sector is cleared. */
  spawnGate(near: THREE.Vector3): THREE.Vector3 {
    const dir = near.lengthSq() > 1 ? near.clone().normalize().multiplyScalar(-1) : new THREE.Vector3(0, 0, -1);
    const pos = near.clone().addScaledVector(dir, 420);
    pos.y = THREE.MathUtils.clamp(pos.y, -200, 200);

    this.gate = new THREE.Group();
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x221133, emissive: 0xa05cff, emissiveIntensity: 2.6, roughness: 0.3, metalness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 2.6, 12, 48), ringMat);
    this.gate.add(ring);
    for (let i = 0; i < 6; i++) {
      const pylon = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 5), ringMat);
      const a = (i / 6) * Math.PI * 2;
      pylon.position.set(Math.cos(a) * 26, Math.sin(a) * 26, 0);
      pylon.rotation.z = a - Math.PI / 2;
      this.gate.add(pylon);
    }
    this.gateSwirl = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(170, 110, 255),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.gateSwirl.scale.setScalar(46);
    this.gate.add(this.gateSwirl);
    const light = new THREE.PointLight(0xa05cff, 220, 300);
    this.gate.add(light);
    this.gate.position.copy(pos);
    this.gate.lookAt(near);
    this.root.add(this.gate);
    return pos;
  }

  update(dt: number, playerPos?: THREE.Vector3): void {
    this.time += dt;
    const dummy = new THREE.Object3D();
    const spinQ = new THREE.Quaternion();
    for (let v = 0; v < this.instancedMeshes.length; v++) {
      const inst = this.instancedMeshes[v];
      const list = this.spins[v];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        spinQ.setFromAxisAngle(s.axis, s.speed * dt);
        s.quat.premultiply(spinQ);
        dummy.position.copy(s.pos);
        dummy.quaternion.copy(s.quat);
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
    if (this.station && this.stationRing) {
      this.station.rotation.y += dt * 0.05;
      this.stationRing.rotation.z += dt * 0.12;
    }
    if (this.gate && this.gateSwirl) {
      this.gate.rotation.z += dt * 0.5;
      const pulse = 1 + Math.sin(this.time * 3) * 0.12;
      this.gateSwirl.scale.setScalar(46 * pulse);
    }
    for (const planet of this.planets) {
      planet.group.rotation.y += dt * 0.02;
      for (const m of planet.moons) {
        const a = this.time * m.speed + m.phase;
        m.mesh.position.set(Math.cos(a) * m.orbitR, Math.sin(a * 0.3) * m.orbitR * 0.15, Math.sin(a) * m.orbitR);
      }
    }
    if (playerPos) {
      const frac = playerPos.length() / this.worldRadius;
      const mat = this.boundary.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp((frac - 0.78) / 0.22, 0, 1) * 0.12;
    }
  }

  private disposeRoot(): void {
    this.scene.remove(this.root);
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          const anyMat = m as THREE.Material & { map?: THREE.Texture | null };
          anyMat.map?.dispose();
          m.dispose();
        }
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });
  }
}
