import * as THREE from 'three';
import type { Input } from '../core/Input';

const MAX_SPEED = 46;
const BOOST_SPEED = 92;
const THRUST = 55;
const BRAKE = 38;
const DAMPING = 0.55; // velocity fraction lost per second
const TURN_RATE = 1.7; // rad/s

export class PlayerShip {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly radius = 3;

  hull = 100;
  maxHull = 100;
  shield = 100;
  maxShield = 100;
  energy = 100;
  maxEnergy = 100;
  alive = true;
  boosting = false;
  throttle = 0; // 0..1 visual

  private shieldRegenDelay = 0;
  private inner = new THREE.Group();
  private engineGlows: THREE.Sprite[] = [];
  private engineLight: THREE.PointLight;
  private bank = 0;
  private muzzleL = new THREE.Vector3();
  private muzzleR = new THREE.Vector3();
  onDamaged: ((amount: number) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.buildMesh();
    this.group.add(this.inner);
    scene.add(this.group);

    this.engineLight = new THREE.PointLight(0x4de8ff, 0, 40);
    this.engineLight.position.set(0, 0, 4.2);
    this.inner.add(this.engineLight);
  }

  private buildMesh(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d4, roughness: 0.35, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.5, metalness: 0.7 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x113344, emissive: 0x4de8ff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.1,
    });

    // fuselage along -Z (forward)
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.95, 5.2, 8), hullMat);
    fuselage.rotation.x = -Math.PI / 2;
    this.inner.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 8), hullMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.5;
    this.inner.add(nose);

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), glowMat);
    cockpit.scale.set(1, 0.7, 1.6);
    cockpit.position.set(0, 0.55, -0.9);
    this.inner.add(cockpit);

    // swept wings
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.7), hullMat);
      wing.position.set(side * 2.1, -0.1, 1.0);
      wing.rotation.z = side * -0.12;
      wing.rotation.y = side * 0.35;
      this.inner.add(wing);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 1.3), darkMat);
      tip.position.set(side * 3.7, 0.15, 1.45);
      this.inner.add(tip);

      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.6, 6), darkMat);
      cannon.rotation.x = -Math.PI / 2;
      cannon.position.set(side * 3.55, -0.15, 0.4);
      this.inner.add(cannon);

      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.4, 8), darkMat);
      engine.rotation.x = -Math.PI / 2;
      engine.position.set(side * 1.1, 0, 2.9);
      this.inner.add(engine);

      const glowTex = PlayerShip.engineTexture();
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x66eaff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.position.set(side * 1.1, 0, 3.9);
      glow.scale.setScalar(0.1);
      this.inner.add(glow);
      this.engineGlows.push(glow);
    }

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 1.6), darkMat);
    fin.position.set(0, 0.85, 1.9);
    this.inner.add(fin);
  }

  private static engineTex: THREE.CanvasTexture | null = null;
  private static engineTexture(): THREE.CanvasTexture {
    if (this.engineTex) return this.engineTex;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(102,234,255,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this.engineTex = new THREE.CanvasTexture(canvas);
    return this.engineTex;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
  }

  /** World-space muzzle positions (left, right wing cannons). */
  getMuzzles(): [THREE.Vector3, THREE.Vector3] {
    this.muzzleL.set(-3.55, -0.15, -0.5).applyQuaternion(this.group.quaternion).add(this.group.position);
    this.muzzleR.set(3.55, -0.15, -0.5).applyQuaternion(this.group.quaternion).add(this.group.position);
    return [this.muzzleL, this.muzzleR];
  }

  update(dt: number, input: Input, worldRadius: number): void {
    if (!this.alive) return;

    // --- rotation input ---
    let pitch = 0, yaw = 0, roll = 0;
    if (input.isDown('ArrowUp')) pitch -= 1;
    if (input.isDown('ArrowDown')) pitch += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) yaw += 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) yaw -= 1;
    if (input.isDown('KeyQ')) roll += 1;
    if (input.isDown('KeyE')) roll -= 1;

    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      pitch * TURN_RATE * dt,
      yaw * TURN_RATE * dt,
      roll * TURN_RATE * 1.4 * dt,
      'XYZ'
    ));
    this.group.quaternion.multiply(dq).normalize();

    // visual banking on yaw
    this.bank = THREE.MathUtils.lerp(this.bank, -yaw * 0.45, 1 - Math.exp(-6 * dt));
    this.inner.rotation.z = this.bank;
    this.inner.rotation.x = THREE.MathUtils.lerp(this.inner.rotation.x, pitch * 0.12, 1 - Math.exp(-6 * dt));

    // --- thrust ---
    this.boosting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const fwd = this.forward;
    let thrustAmount = 0;
    if (input.isDown('KeyW')) thrustAmount = this.boosting ? THRUST * 2.4 : THRUST;
    if (input.isDown('KeyS')) thrustAmount = -BRAKE;
    this.velocity.addScaledVector(fwd, thrustAmount * dt);

    // damping + speed clamp
    this.velocity.multiplyScalar(Math.max(0, 1 - DAMPING * dt));
    const maxSpeed = this.boosting ? BOOST_SPEED : MAX_SPEED;
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);

    // soft world boundary push-back
    const distFromCenter = this.group.position.length();
    if (distFromCenter > worldRadius) {
      const inward = this.group.position.clone().multiplyScalar(-1 / distFromCenter);
      this.velocity.addScaledVector(inward, (distFromCenter - worldRadius) * 0.8 * dt + 12 * dt);
    }

    this.group.position.addScaledVector(this.velocity, dt);

    // --- throttle visual ---
    const target = thrustAmount > 0 ? (this.boosting ? 1 : 0.6) : this.velocity.length() / MAX_SPEED * 0.25;
    this.throttle = THREE.MathUtils.lerp(this.throttle, target, 1 - Math.exp(-8 * dt));
    const flicker = 0.9 + Math.random() * 0.2;
    for (const g of this.engineGlows) {
      const s = (0.3 + this.throttle * 2.6) * flicker;
      g.scale.setScalar(s);
      (g.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + this.throttle * 0.9);
    }
    this.engineLight.intensity = this.throttle * 14 * flicker;

    // --- regen ---
    this.shieldRegenDelay -= dt;
    if (this.shieldRegenDelay <= 0 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + 9 * dt);
    }
    this.energy = Math.min(this.maxEnergy, this.energy + 24 * dt);
  }

  spendEnergy(amount: number): boolean {
    if (this.energy < amount) return false;
    this.energy -= amount;
    return true;
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.shieldRegenDelay = 4;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount > 0) this.hull -= amount;
    this.onDamaged?.(amount);
    if (this.hull <= 0) {
      this.hull = 0;
      this.alive = false;
      this.group.visible = false;
    }
  }

  heal(amount: number): void {
    this.hull = Math.min(this.maxHull, this.hull + amount);
  }
}
