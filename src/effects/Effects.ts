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

export class Effects {
  private scene: THREE.Scene;
  private bursts: ParticleBurst[] = [];
  private beams: Beam[] = [];
  private flashes: FlashLight[] = [];
  private shakeAmount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Current screen-shake offset magnitude; decays each frame. */
  get shakeOffset(): number {
    return this.shakeAmount;
  }

  shake(amount: number): void {
    this.shakeAmount = Math.min(1.6, this.shakeAmount + amount);
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
  }

  smallExplosion(position: THREE.Vector3, color: number): void {
    this.burst(position, color, 12, 12, 0.5, 1.0, 0.9);
  }

  sparks(position: THREE.Vector3, color: number, count: number): void {
    this.burst(position, color, count, 18, 0.4, 0.7, 0.92);
  }

  trailPuff(position: THREE.Vector3, color: number): void {
    this.burst(position, color, 2, 1.5, 0.45, 0.8, 0.95);
  }

  muzzleFlash(position: THREE.Vector3, color: number): void {
    const light = new THREE.PointLight(color, 30, 30);
    light.position.copy(position);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.07 });
  }

  railBeam(start: THREE.Vector3, end: THREE.Vector3, color: number): void {
    const len = start.distanceTo(end);
    const geo = new THREE.CylinderGeometry(0.22, 0.22, len, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.lookAt(end);
    mesh.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    this.beams.push({ mesh, life: 0.35, maxLife: 0.35 });
    this.burst(end, color, 16, 20, 0.5, 1.1);
  }

  update(dt: number): void {
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.8);

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
  }
}
