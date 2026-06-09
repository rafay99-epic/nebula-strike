import * as THREE from 'three';

export interface AsteroidInfo {
  position: THREE.Vector3;
  radius: number;
}

const WORLD_RADIUS = 1500;

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

function makeGlowTexture(color: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color.replace('1)', '0.4)'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Environment {
  readonly asteroids: AsteroidInfo[] = [];
  readonly worldRadius = WORLD_RADIUS;
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private spins: { axis: THREE.Vector3; speed: number; quat: THREE.Quaternion; pos: THREE.Vector3; scale: number }[][] = [];
  private station: THREE.Group;
  private stationRing: THREE.Mesh;
  private time = 0;

  constructor(scene: THREE.Scene) {
    // --- lighting ---
    scene.add(new THREE.AmbientLight(0x223347, 1.4));
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(900, 500, 400);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x3355aa, 0.5);
    fill.position.set(-600, -300, -500);
    scene.add(fill);

    // --- starfield (two depth layers) ---
    for (const [count, sizePx, brightness] of [[4200, 1.4, 0.7], [600, 2.4, 1.0]] as const) {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(2600 + Math.random() * 900);
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
      scene.add(new THREE.Points(geo, mat));
    }

    // --- nebula sprites ---
    const nebulaHues = [265, 195, 320, 230];
    for (let i = 0; i < nebulaHues.length; i++) {
      const tex = makeNebulaTexture(nebulaHues[i]);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const dir = new THREE.Vector3().randomDirection();
      dir.y = THREE.MathUtils.clamp(dir.y, -0.4, 0.4);
      sprite.position.copy(dir.normalize().multiplyScalar(2400));
      const s = 1400 + Math.random() * 1200;
      sprite.scale.set(s, s, 1);
      scene.add(sprite);
    }

    // --- distant planet with atmosphere glow ---
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(620, 48, 48),
      new THREE.MeshStandardMaterial({ color: 0x8a4a2e, roughness: 0.95, metalness: 0.05, emissive: 0x1a0a05 })
    );
    planet.position.set(-2200, 350, -2600);
    scene.add(planet);
    const atmo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,140,80,1)'),
      transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    atmo.position.copy(planet.position);
    atmo.scale.set(1700, 1700, 1);
    scene.add(atmo);

    // --- asteroid field (3 instanced variants, randomized rock geometry) ---
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6e6258, roughness: 0.95, metalness: 0.08 });
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

    const perVariant = 60;
    const dummy = new THREE.Object3D();
    for (let v = 0; v < variants.length; v++) {
      const inst = new THREE.InstancedMesh(variants[v], rockMat, perVariant);
      const spinList: typeof this.spins[number] = [];
      for (let i = 0; i < perVariant; i++) {
        // ring-ish distribution around the combat zone, keep the spawn area clear
        const r = 220 + Math.random() * 1050;
        const theta = Math.random() * Math.PI * 2;
        const p = new THREE.Vector3(
          Math.cos(theta) * r,
          (Math.random() - 0.5) * 320,
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
      scene.add(inst);
      this.instancedMeshes.push(inst);
      this.spins.push(spinList);
    }

    // --- derelict orbital station ---
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
      spoke.position.y = 0;
      this.stationRing.add(spoke);
    }
    for (let i = 0; i < 8; i++) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), accentMat);
      const a = (i / 8) * Math.PI * 2;
      light.position.set(Math.cos(a) * 38, Math.sin(a) * 38, 0);
      this.stationRing.add(light);
    }
    const dish = new THREE.Mesh(new THREE.ConeGeometry(10, 8, 16, 1, true), hullMat);
    dish.position.y = 38;
    dish.rotation.x = Math.PI;
    this.station.add(dish);
    this.station.position.set(380, 80, -520);
    scene.add(this.station);
    this.asteroids.push({ position: this.station.position.clone(), radius: 48 });

    // --- combat zone boundary (invisible until the player gets close to the edge) ---
    this.boundary = new THREE.Mesh(
      new THREE.SphereGeometry(WORLD_RADIUS, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0x4de8ff, wireframe: true, transparent: true, opacity: 0, depthWrite: false,
      })
    );
    scene.add(this.boundary);
  }

  private boundary!: THREE.Mesh;

  update(dt: number, playerPos?: THREE.Vector3): void {
    if (playerPos) {
      const frac = playerPos.length() / WORLD_RADIUS;
      const mat = this.boundary.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp((frac - 0.78) / 0.22, 0, 1) * 0.12;
    }
    this.time += dt;
    // slow tumble for each asteroid instance
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
    this.station.rotation.y += dt * 0.05;
    this.stationRing.rotation.z += dt * 0.12;
  }
}
