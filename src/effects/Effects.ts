import * as THREE from 'three';

interface ParticleBurst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  drag: number;
}

interface Beam {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface FlashLight {
  light: THREE.PointLight;
  life: number;
}

interface Debris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Shockwave {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  maxScale: number;
}

/**
 * Fixed-capacity particle pool for continuous emitters (engine exhaust,
 * missile trails). Per-particle color fades to black, which reads as
 * fade-out under additive blending.
 */
class TrailPool {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Float32Array;
  private lives: Float32Array;
  private maxLives: Float32Array;
  private baseColors: Float32Array;
  private cursor = 0;
  private capacity: number;

  constructor(scene: THREE.Scene, capacity: number, size: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.lives = new Float32Array(capacity);
    this.maxLives = new Float32Array(capacity);
    this.baseColors = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, life: number, jitter = 0.6): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions[i * 3] = pos.x + (Math.random() - 0.5) * jitter;
    this.positions[i * 3 + 1] = pos.y + (Math.random() - 0.5) * jitter;
    this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * jitter;
    this.velocities[i * 3] = vel.x + (Math.random() - 0.5) * 2;
    this.velocities[i * 3 + 1] = vel.y + (Math.random() - 0.5) * 2;
    this.velocities[i * 3 + 2] = vel.z + (Math.random() - 0.5) * 2;
    this.lives[i] = life;
    this.maxLives[i] = life;
    this.baseColors[i * 3] = color.r;
    this.baseColors[i * 3 + 1] = color.g;
    this.baseColors[i * 3 + 2] = color.b;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.lives[i] <= 0) {
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.lives[i] -= dt;
      const f = Math.max(0, this.lives[i] / this.maxLives[i]);
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.colors[i * 3] = this.baseColors[i * 3] * f;
      this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1] * f;
      this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2] * f;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/**
 * Local dust cloud that wraps around the player — static motes in the
 * vacuum that sell velocity and parallax.
 */
export class SpaceDust {
  private points: THREE.Points;
  private half = 90;

  constructor(scene: THREE.Scene) {
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * this.half * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * this.half * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.half * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x88ccdd, size: 0.35, transparent: true, opacity: 0.45,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setColor(color: number): void {
    (this.points.material as THREE.PointsMaterial).color.setHex(color);
  }

  update(playerPos: THREE.Vector3, playerSpeed: number): void {
    // motes are static in world space; wrap any that fall outside the
    // cube centered on the player so the cloud follows the ship
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const size = this.half * 2;
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const rel = arr[i + k] - playerPos.getComponent(k);
        if (rel > this.half) arr[i + k] -= size;
        else if (rel < -this.half) arr[i + k] += size;
      }
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity =
      0.25 + Math.min(0.5, playerSpeed / 120 * 0.5);
  }
}

export class Effects {
  private scene: THREE.Scene;
  private bursts: ParticleBurst[] = [];
  private beams: Beam[] = [];
  private flashes: FlashLight[] = [];
  private debrisList: Debris[] = [];
  private shockwaves: Shockwave[] = [];
  private trail: TrailPool;
  private shakeAmount = 0;
  private debrisGeo = new THREE.TetrahedronGeometry(0.6);
  private debrisMat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9, metalness: 0.4 });
  private ringTex: THREE.CanvasTexture;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.trail = new TrailPool(scene, 600, 0.9);
    this.ringTex = Effects.makeRingTexture();
  }

  private static makeRingTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
    ctx.stroke();
    return new THREE.CanvasTexture(canvas);
  }

  get shakeOffset(): number {
    return this.shakeAmount;
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.6, this.shakeAmount + amount);
  }

  /** Continuous emitter — engine exhaust, missile trails. */
  emitTrail(pos: THREE.Vector3, vel: THREE.Vector3, color: number, life = 0.55): void {
    this.tmpColor.setHex(color);
    this.trail.emit(pos, vel, this.tmpColor, life);
  }

  private burst(
    position: THREE.Vector3, color: number, count: number,
    speed: number, life: number, size: number, drag = 0.98
  ): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([position.x, position.y, position.z], i * 3);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      velocities.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life, maxLife: life, drag });
  }

  explosion(position: THREE.Vector3, scale = 1, color = 0xffaa55): void {
    this.burst(position, color, Math.floor(40 * scale), 26 * scale, 1.1, 1.6 * scale, 0.94);
    this.burst(position, 0xffffff, Math.floor(14 * scale), 14 * scale, 0.5, 1.2 * scale, 0.92);
    this.burst(position, 0xff5522, Math.floor(20 * scale), 8 * scale, 1.5, 2.2 * scale, 0.9);
    const light = new THREE.PointLight(color, 60 * scale, 120 * scale);
    light.position.copy(position);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.35 });
    this.shake(Math.min(0.8, 0.25 * scale));
    this.shockwave(position, scale);
    this.debris(position, Math.min(8, 2 + Math.floor(scale * 3)), scale);
  }

  shockwave(position: THREE.Vector3, scale: number): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.ringTex, color: 0xffcc99, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sprite.position.copy(position);
    sprite.scale.setScalar(1);
    this.scene.add(sprite);
    this.shockwaves.push({ sprite, life: 0.55, maxLife: 0.55, maxScale: 26 * scale });
  }

  debris(position: THREE.Vector3, count: number, scale: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      mesh.position.copy(position);
      mesh.scale.setScalar(0.5 + Math.random() * scale * 0.8);
      this.scene.add(mesh);
      this.debrisList.push({
        mesh,
        velocity: new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 16 * scale),
        angular: new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 4),
        life: 2.2 + Math.random() * 1.2,
        maxLife: 3,
      });
    }
  }

  smallExplosion(position: THREE.Vector3, color: number): void {
    this.burst(position, color, 12, 12, 0.5, 1.0, 0.9);
  }

  sparks(position: THREE.Vector3, color: number, count: number): void {
    this.burst(position, color, count, 18, 0.4, 0.7, 0.92);
  }

  muzzleFlash(position: THREE.Vector3, color: number): void {
    const light = new THREE.PointLight(color, 30, 30);
    light.position.copy(position);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.07 });
  }

  railBeam(start: THREE.Vector3, end: THREE.Vector3, color: number, radius = 0.22, life = 0.35): void {
    const len = start.distanceTo(end);
    if (len < 0.5) return;
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.lookAt(end);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.beams.push({ mesh, life, maxLife: life });
    if (radius > 0.15) this.burst(end, color, 16, 20, 0.5, 1.1);
  }

  /** Thin green tether from a support warden to the ship it's repairing. */
  healBeam(start: THREE.Vector3, end: THREE.Vector3): void {
    this.railBeam(start, end, 0x57ffd0, 0.09, 0.14);
  }

  update(dt: number): void {
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.8);
    this.trail.update(dt);

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        b.velocities[j] *= b.drag;
        b.velocities[j + 1] *= b.drag;
        b.velocities[j + 2] *= b.drag;
        arr[j] += b.velocities[j] * dt;
        arr[j + 1] += b.velocities[j + 1] * dt;
        arr[j + 2] += b.velocities[j + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, b.life / b.maxLife);
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const beam = this.beams[i];
      beam.life -= dt;
      if (beam.life <= 0) {
        this.scene.remove(beam.mesh);
        beam.mesh.geometry.dispose();
        (beam.mesh.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        continue;
      }
      (beam.mesh.material as THREE.MeshBasicMaterial).opacity = beam.life / beam.maxLife;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.light);
        this.flashes.splice(i, 1);
        continue;
      }
      f.light.intensity *= 0.82;
    }

    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debrisList.splice(i, 1);
        continue;
      }
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.angular.x * dt;
      d.mesh.rotation.y += d.angular.y * dt;
      d.mesh.rotation.z += d.angular.z * dt;
      const f = Math.min(1, d.life / 0.8);
      d.mesh.scale.setScalar(d.mesh.scale.x * (f < 1 ? 0.97 : 1));
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.sprite);
        s.sprite.material.dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.sprite.scale.setScalar(1 + t * s.maxScale);
      s.sprite.material.opacity = 0.9 * (1 - t);
    }
  }
}
