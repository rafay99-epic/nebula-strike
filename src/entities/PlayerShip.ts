import * as THREE from 'three';
import type { Input } from '../core/Input';

export interface ShipDef {
  id: number;
  name: string;
  role: string;
  desc: string;
  hull: number;
  shield: number;
  energy: number;
  energyRegen: number;
  maxSpeed: number;
  boostSpeed: number;
  thrust: number;
  turnRate: number;
  radius: number;
  muzzleX: number;
}

export const SHIPS: ShipDef[] = [
  {
    id: 0, name: 'SR-7 STRIKER', role: 'MULTIROLE FIGHTER',
    desc: 'Balanced hull. Reliable in any engagement.',
    hull: 100, shield: 100, energy: 100, energyRegen: 24,
    maxSpeed: 46, boostSpeed: 92, thrust: 55, turnRate: 1.7, radius: 3, muzzleX: 3.55,
  },
  {
    id: 1, name: 'KV-2 WRAITH', role: 'LIGHT INTERCEPTOR',
    desc: 'Fragile, fast, razor agile. Never stop moving.',
    hull: 70, shield: 80, energy: 90, energyRegen: 30,
    maxSpeed: 60, boostSpeed: 120, thrust: 78, turnRate: 2.1, radius: 2.4, muzzleX: 1.7,
  },
  {
    id: 2, name: 'HK-9 BASTION', role: 'HEAVY GUNBOAT',
    desc: 'Slow twin-hull brawler. Massive shields and capacitors.',
    hull: 160, shield: 145, energy: 135, energyRegen: 26,
    maxSpeed: 34, boostSpeed: 66, thrust: 38, turnRate: 1.25, radius: 3.9, muzzleX: 4.6,
  },
];

const DAMPING = 0.55; // velocity fraction lost per second (flight assist on)
const HARD_CAP = 150; // absolute speed limit even in newtonian mode

export class PlayerShip {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  def: ShipDef = SHIPS[0];
  hull = 100;
  maxHull = 100;
  shield = 100;
  maxShield = 100;
  energy = 100;
  maxEnergy = 100;
  alive = true;
  boosting = false;
  assist = true; // flight assist: damping + speed clamp; off = newtonian drift
  throttle = 0;

  private shieldRegenDelay = 0;
  private inner = new THREE.Group();
  private engineGlows: THREE.Sprite[] = [];
  private engineLight: THREE.PointLight;
  private bank = 0;
  private muzzleL = new THREE.Vector3();
  private muzzleR = new THREE.Vector3();
  onDamaged: ((amount: number) => void) | null = null;

  get radius(): number {
    return this.def.radius;
  }

  constructor(scene: THREE.Scene) {
    this.group.add(this.inner);
    scene.add(this.group);
    this.engineLight = new THREE.PointLight(0x4de8ff, 0, 40);
    this.inner.add(this.engineLight);
    this.applyDef(SHIPS[0]);
  }

  /** Switch hull (ship select screen) — rebuilds the mesh and resets stats. */
  applyDef(def: ShipDef): void {
    this.def = def;
    this.maxHull = def.hull;
    this.hull = def.hull;
    this.maxShield = def.shield;
    this.shield = def.shield;
    this.maxEnergy = def.energy;
    this.energy = def.energy;

    // clear previous mesh (keep the engine light)
    for (let i = this.inner.children.length - 1; i >= 0; i--) {
      const child = this.inner.children[i];
      if (child === this.engineLight) continue;
      this.inner.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
    }
    this.engineGlows = [];
    this.buildMesh(def.id);
    this.engineLight.position.set(0, 0, def.id === 2 ? 5.2 : 4.2);
  }

  private buildMesh(shipId: number): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d4, roughness: 0.35, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.5, metalness: 0.7 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x113344, emissive: 0x4de8ff, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.1,
    });

    const addEngineGlow = (x: number, y: number, z: number, scale = 1) => {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: PlayerShip.engineTexture(), color: 0x66eaff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.position.set(x, y, z);
      glow.scale.setScalar(0.1 * scale);
      glow.userData.baseScale = scale;
      this.inner.add(glow);
      this.engineGlows.push(glow);
    };

    if (shipId === 0) {
      // STRIKER — classic swept-wing fighter
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
        addEngineGlow(side * 1.1, 0, 3.9);
      }
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 1.6), darkMat);
      fin.position.set(0, 0.85, 1.9);
      this.inner.add(fin);
    } else if (shipId === 1) {
      // WRAITH — slim needle dart with forward canards
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.7, 6.4, 6), hullMat);
      body.rotation.x = -Math.PI / 2;
      this.inner.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.4, 6), darkMat);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -4.4;
      this.inner.add(nose);
      const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), glowMat);
      cockpit.scale.set(1, 0.6, 2.0);
      cockpit.position.set(0, 0.42, -1.4);
      this.inner.add(cockpit);
      for (const side of [-1, 1]) {
        const canard = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.8), darkMat);
        canard.position.set(side * 0.95, 0, -2.6);
        canard.rotation.y = side * 0.45;
        this.inner.add(canard);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.4), hullMat);
        blade.position.set(side * 1.2, 0.1, 1.6);
        blade.rotation.z = side * 0.5;
        blade.rotation.y = side * 0.2;
        this.inner.add(blade);
        const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), darkMat);
        cannon.rotation.x = -Math.PI / 2;
        cannon.position.set(side * 1.7, -0.05, -0.2);
        this.inner.add(cannon);
      }
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 1.6, 8), darkMat);
      engine.rotation.x = -Math.PI / 2;
      engine.position.set(0, 0, 3.6);
      this.inner.add(engine);
      addEngineGlow(0, 0, 4.6, 1.3);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 1.3), darkMat);
      fin.position.set(0, 0.9, 2.6);
      fin.rotation.x = 0.25;
      this.inner.add(fin);
    } else {
      // BASTION — wide twin-hull gunboat
      for (const side of [-1, 1]) {
        const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 6.4, 8), hullMat);
        pontoon.rotation.x = -Math.PI / 2;
        pontoon.position.set(side * 2.6, 0, 0.4);
        this.inner.add(pontoon);
        const prow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.0, 8), darkMat);
        prow.rotation.x = -Math.PI / 2;
        prow.position.set(side * 2.6, 0, -3.2);
        this.inner.add(prow);
        const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 6), darkMat);
        cannon.rotation.x = -Math.PI / 2;
        cannon.position.set(side * 4.6, -0.2, -0.6);
        this.inner.add(cannon);
        const sponson = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.4), darkMat);
        sponson.position.set(side * 4.2, -0.1, 0.6);
        this.inner.add(sponson);
        for (const dy of [-0.6, 0.6]) {
          addEngineGlow(side * 2.6, dy * 0.4, 3.9, 0.9);
        }
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 1.6, 8), darkMat);
        engine.rotation.x = -Math.PI / 2;
        engine.position.set(side * 2.6, 0, 3.4);
        this.inner.add(engine);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 3.6), hullMat);
      bridge.position.set(0, 0.4, 0.4);
      this.inner.add(bridge);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.4, 2.4), darkMat);
      deck.position.set(0, -0.1, 0.6);
      this.inner.add(deck);
      const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), glowMat);
      cockpit.scale.set(1.4, 0.6, 1.2);
      cockpit.position.set(0, 1.05, -0.6);
      this.inner.add(cockpit);
    }
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

  /** World-space positions of the engine nozzles (for exhaust particles). */
  getEnginePositions(out: THREE.Vector3[]): number {
    let n = 0;
    for (const g of this.engineGlows) {
      if (n >= out.length) break;
      out[n].copy(g.position).applyQuaternion(this.group.quaternion).add(this.group.position);
      n++;
    }
    return n;
  }

  getMuzzles(): [THREE.Vector3, THREE.Vector3] {
    const x = this.def.muzzleX;
    this.muzzleL.set(-x, -0.15, -0.5).applyQuaternion(this.group.quaternion).add(this.group.position);
    this.muzzleR.set(x, -0.15, -0.5).applyQuaternion(this.group.quaternion).add(this.group.position);
    return [this.muzzleL, this.muzzleR];
  }

  /**
   * @param gravity downward acceleration (m/s²) applied INSIDE the flight
   * integration, before the assist governor — so it competes with engine
   * thrust instead of being clamped away. On heavy worlds thrust loses.
   */
  update(dt: number, input: Input, worldRadius: number, gravity = 0): void {
    if (!this.alive) return;
    const def = this.def;

    // --- rotation input (keyboard + virtual joystick) ---
    let pitch = 0, yaw = 0, roll = 0;
    if (input.isDown('ArrowUp')) pitch -= 1;
    if (input.isDown('ArrowDown')) pitch += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) yaw += 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) yaw -= 1;
    if (input.isDown('KeyQ')) roll += 1;
    if (input.isDown('KeyE')) roll -= 1;
    pitch = THREE.MathUtils.clamp(pitch + input.vPitch, -1, 1);
    yaw = THREE.MathUtils.clamp(yaw + input.vYaw, -1, 1);

    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      pitch * def.turnRate * dt,
      yaw * def.turnRate * dt,
      roll * def.turnRate * 1.4 * dt,
      'XYZ'
    ));
    this.group.quaternion.multiply(dq).normalize();

    this.bank = THREE.MathUtils.lerp(this.bank, -yaw * 0.45, 1 - Math.exp(-6 * dt));
    this.inner.rotation.z = this.bank;
    this.inner.rotation.x = THREE.MathUtils.lerp(this.inner.rotation.x, pitch * 0.12, 1 - Math.exp(-6 * dt));

    // --- thrust ---
    this.boosting = input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.vBoost;
    const fwd = this.forward;
    let thrustAmount = 0;
    if (input.isDown('KeyW') || input.vThrust || input.vBoost) {
      thrustAmount = this.boosting ? def.thrust * 2.4 : def.thrust;
    }
    if (input.isDown('KeyS') || input.vBrake) thrustAmount = -def.thrust * 0.7;
    this.velocity.addScaledVector(fwd, thrustAmount * dt);
    if (gravity > 0) this.velocity.y -= gravity * dt;

    if (this.assist) {
      // flight assist: drag + speed governor
      this.velocity.multiplyScalar(Math.max(0, 1 - DAMPING * dt));
      const maxSpeed = this.boosting ? def.boostSpeed : def.maxSpeed;
      if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);
    } else {
      // newtonian: pure vacuum drift, only a sanity cap
      if (this.velocity.length() > HARD_CAP) this.velocity.setLength(HARD_CAP);
    }

    // soft world boundary push-back
    const distFromCenter = this.group.position.length();
    if (distFromCenter > worldRadius) {
      const inward = this.group.position.clone().multiplyScalar(-1 / distFromCenter);
      this.velocity.addScaledVector(inward, (distFromCenter - worldRadius) * 0.8 * dt + 12 * dt);
    }

    this.group.position.addScaledVector(this.velocity, dt);

    // --- engine visuals ---
    const target = thrustAmount > 0 ? (this.boosting ? 1 : 0.6) : this.velocity.length() / def.maxSpeed * 0.25;
    this.throttle = THREE.MathUtils.lerp(this.throttle, Math.min(1, target), 1 - Math.exp(-8 * dt));
    const flicker = 0.9 + Math.random() * 0.2;
    for (const g of this.engineGlows) {
      const base = (g.userData.baseScale as number) ?? 1;
      g.scale.setScalar((0.3 + this.throttle * 2.6) * flicker * base);
      (g.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + this.throttle * 0.9);
    }
    this.engineLight.intensity = this.throttle * 14 * flicker;

    // --- regen ---
    this.shieldRegenDelay -= dt;
    if (this.shieldRegenDelay <= 0 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + 9 * dt);
    }
    this.energy = Math.min(this.maxEnergy, this.energy + def.energyRegen * dt);
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
