import * as THREE from 'three';
import type { Enemy } from '../entities/Enemy';
import type { PlayerShip } from '../entities/PlayerShip';
import type { AsteroidInfo } from '../world/Environment';
import type { Effects } from '../effects/Effects';
import type { Sfx } from '../core/Sfx';

export interface WeaponDef {
  name: string;
  cooldown: number;
  energyCost: number;
  damage: number;
  shieldMult: number;
  hullMult: number;
  speed: number;
  life: number;
  color: number;
  kind: 'laser' | 'plasma' | 'missile' | 'railgun';
  splash?: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    name: 'PULSE LASER', cooldown: 0.13, energyCost: 2.2, damage: 6,
    shieldMult: 2.0, hullMult: 0.7, speed: 340, life: 2.6, color: 0x4de8ff, kind: 'laser',
  },
  {
    name: 'PLASMA CANNON', cooldown: 0.5, energyCost: 9, damage: 24,
    shieldMult: 0.6, hullMult: 1.7, speed: 150, life: 3.4, color: 0xff8830, kind: 'plasma', splash: 11,
  },
  {
    name: 'SEEKER MISSILES', cooldown: 0.85, energyCost: 15, damage: 32,
    shieldMult: 0.8, hullMult: 1.3, speed: 70, life: 6, color: 0xffe14d, kind: 'missile',
  },
  {
    name: 'RAILGUN', cooldown: 3.2, energyCost: 38, damage: 65,
    shieldMult: 1.4, hullMult: 1.4, speed: 0, life: 0, color: 0xc6f3ff, kind: 'railgun',
  },
];

interface Projectile {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  life: number;
  def: WeaponDef;
  homingTarget: Enemy | null;
  speed: number;
}

interface EnemyProjectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
}

export interface CombatWorld {
  scene: THREE.Scene;
  player: PlayerShip;
  enemies: Enemy[];
  asteroids: AsteroidInfo[];
  effects: Effects;
  sfx: Sfx;
  onEnemyDestroyed: (enemy: Enemy) => void;
}

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _toC = new THREE.Vector3();

/** Swept collision: does the segment p0→p1 pass within `radius` of `center`? */
function segmentHitsSphere(p0: THREE.Vector3, p1: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
  _seg.copy(p1).sub(p0);
  _toC.copy(center).sub(p0);
  const segLenSq = _seg.lengthSq();
  const t = segLenSq > 0 ? THREE.MathUtils.clamp(_toC.dot(_seg) / segLenSq, 0, 1) : 0;
  _toC.addScaledVector(_seg, -t); // now: center - closestPoint
  return _toC.lengthSq() < radius * radius;
}

export class WeaponSystem {
  current = 0;
  private cooldowns = [0, 0, 0, 0];
  private shots: Projectile[] = [];
  private enemyShots: EnemyProjectile[] = [];
  private muzzleToggle = false;
  private world: CombatWorld;

  // shared geometry/materials
  private boltGeo = new THREE.CapsuleGeometry(0.16, 2.6, 3, 6);
  private plasmaGeo = new THREE.SphereGeometry(0.7, 10, 8);
  private missileGeo = new THREE.ConeGeometry(0.3, 1.6, 6);
  private enemyBoltGeo = new THREE.SphereGeometry(0.45, 8, 6);
  private matCache = new Map<number, THREE.MeshBasicMaterial>();

  constructor(world: CombatWorld) {
    this.world = world;
  }

  private material(color: number): THREE.MeshBasicMaterial {
    let m = this.matCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.matCache.set(color, m);
    }
    return m;
  }

  get currentDef(): WeaponDef {
    return WEAPONS[this.current];
  }

  cooldownFraction(index: number): number {
    return Math.max(0, Math.min(1, this.cooldowns[index] / WEAPONS[index].cooldown));
  }

  switchTo(index: number): void {
    if (index >= 0 && index < WEAPONS.length) this.current = index;
  }

  /** Attempt to fire the current weapon. */
  fire(lockedTarget: Enemy | null, lockProgress: number): void {
    const def = WEAPONS[this.current];
    if (this.cooldowns[this.current] > 0) return;
    const { player, sfx, effects } = this.world;
    if (!player.spendEnergy(def.energyCost)) return;
    this.cooldowns[this.current] = def.cooldown;

    const fwd = player.forward;
    const [mL, mR] = player.getMuzzles();

    switch (def.kind) {
      case 'laser': {
        this.muzzleToggle = !this.muzzleToggle;
        const origin = this.muzzleToggle ? mL : mR;
        const dir = this.aimDir(origin, fwd, lockedTarget, lockProgress, def.speed);
        this.spawnBolt(origin, dir, def, null);
        sfx.laser();
        effects.muzzleFlash(origin, def.color);
        break;
      }
      case 'plasma': {
        const origin = player.position.clone().addScaledVector(fwd, 4);
        const dir = this.aimDir(origin, fwd, lockedTarget, lockProgress, def.speed);
        this.spawnBolt(origin, dir, def, null);
        sfx.plasma();
        effects.muzzleFlash(origin, def.color);
        break;
      }
      case 'missile': {
        this.muzzleToggle = !this.muzzleToggle;
        const origin = this.muzzleToggle ? mL : mR;
        const homing = lockProgress >= 1 ? lockedTarget : null;
        this.spawnBolt(origin, fwd.clone(), def, homing);
        sfx.missile();
        break;
      }
      case 'railgun': {
        const origin = player.position.clone().addScaledVector(fwd, 4.5);
        this.fireRailgun(origin, fwd);
        sfx.railgun();
        effects.shake(0.5);
        break;
      }
    }
  }

  /** Slight aim-assist toward a locked target if it's near the crosshair. */
  private aimDir(
    origin: THREE.Vector3, fwd: THREE.Vector3,
    target: Enemy | null, lockProgress: number, projSpeed: number
  ): THREE.Vector3 {
    if (target && target.alive && lockProgress > 0.4) {
      const predicted = target.position.clone();
      const dist = predicted.distanceTo(origin);
      predicted.addScaledVector(target.estVelocity, dist / projSpeed);
      const toTarget = predicted.sub(origin).normalize();
      const assistCone = lockProgress >= 1 ? 0.26 : 0.12;
      if (toTarget.angleTo(fwd) < assistCone) {
        return toTarget;
      }
    }
    return fwd.clone();
  }

  private spawnBolt(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef, homing: Enemy | null): void {
    let mesh: THREE.Object3D;
    if (def.kind === 'laser') {
      mesh = new THREE.Mesh(this.boltGeo, this.material(def.color));
    } else if (def.kind === 'plasma') {
      mesh = new THREE.Mesh(this.plasmaGeo, this.material(def.color));
    } else {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.missileGeo, this.material(def.color));
      body.rotation.x = -Math.PI / 2;
      g.add(body);
      mesh = g;
    }
    mesh.position.copy(origin);
    this.orient(mesh, dir);
    this.world.scene.add(mesh);
    this.shots.push({
      mesh,
      velocity: dir.clone().multiplyScalar(def.speed),
      life: def.life,
      def,
      homingTarget: homing,
      speed: def.speed,
    });
  }

  private orient(mesh: THREE.Object3D, dir: THREE.Vector3): void {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), _tmp.copy(dir).multiplyScalar(-1), new THREE.Vector3(0, 1, 0));
    mesh.quaternion.setFromRotationMatrix(m);
    if (mesh instanceof THREE.Mesh && mesh.geometry === this.boltGeo) {
      mesh.rotateX(Math.PI / 2); // capsule axis is Y; align with travel
    }
  }

  private fireRailgun(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const def = WEAPONS[3];
    const range = 1400;
    const { enemies, effects, asteroids } = this.world;

    // ray-sphere against asteroids to find max range
    let maxT = range;
    for (const a of asteroids) {
      const t = raySphere(origin, dir, a.position, a.radius);
      if (t !== null && t < maxT) maxT = t;
    }
    // penetrating hit on every enemy along the beam
    for (const e of enemies) {
      if (!e.alive) continue;
      const t = raySphere(origin, dir, e.position, e.def.radius + 0.8);
      if (t !== null && t <= maxT) {
        this.applyDamage(e, def, e.position);
      }
    }
    const end = origin.clone().addScaledVector(dir, maxT);
    effects.railBeam(origin, end, def.color);
  }

  private applyDamage(enemy: Enemy, def: WeaponDef, at: THREE.Vector3): void {
    const { effects, sfx, onEnemyDestroyed } = this.world;
    const result = enemy.takeDamage(def.damage, def.shieldMult, def.hullMult);
    if (result.hitShield) sfx.shieldHit();
    else sfx.hit();
    effects.sparks(at, def.color, 8);
    if (result.destroyed) onEnemyDestroyed(enemy);
  }

  spawnEnemyShot(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, color: number): void {
    const mesh = new THREE.Mesh(this.enemyBoltGeo, this.material(color));
    mesh.position.copy(origin);
    this.world.scene.add(mesh);
    this.enemyShots.push({
      mesh,
      velocity: dir.clone().multiplyScalar(speed),
      life: 5,
      damage,
    });
  }

  update(dt: number): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    }
    this.updatePlayerShots(dt);
    this.updateEnemyShots(dt);
  }

  private updatePlayerShots(dt: number): void {
    const { scene, enemies, asteroids, effects } = this.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i];
      p.life -= dt;

      // missile homing & acceleration
      if (p.def.kind === 'missile') {
        p.speed = Math.min(220, p.speed + 160 * dt);
        if (p.homingTarget && p.homingTarget.alive) {
          // steer toward the predicted intercept point, not the current position
          const dist = p.mesh.position.distanceTo(p.homingTarget.position);
          const timeToGo = dist / Math.max(p.speed, 1);
          const desired = _tmp.copy(p.homingTarget.position)
            .addScaledVector(p.homingTarget.estVelocity, Math.min(timeToGo, 2))
            .sub(p.mesh.position).normalize();
          const dir = _tmp2.copy(p.velocity).normalize();
          // turn rate scales with speed → constant ~28m turning radius
          const turnRate = Math.max(3.5, p.speed / 28);
          dir.lerp(desired, Math.min(1, turnRate * dt)).normalize();
          p.velocity.copy(dir).multiplyScalar(p.speed);
          this.orient(p.mesh, dir);
        } else {
          p.velocity.setLength(p.speed);
        }
        if (Math.random() < 0.5) effects.trailPuff(p.mesh.position, 0xffcc88);
      }

      _prev.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.velocity, dt);

      let dead = p.life <= 0;
      // vs enemies (swept test — fast bolts must not tunnel through small ships)
      if (!dead) {
        for (const e of enemies) {
          if (!e.alive) continue;
          const hitR = e.def.radius + (p.def.kind === 'plasma' ? 1.2 : 0.6);
          if (segmentHitsSphere(_prev, p.mesh.position, e.position, hitR)) {
            this.applyDamage(e, p.def, p.mesh.position);
            if (p.def.splash) this.splash(p.mesh.position, p.def, e);
            effects.smallExplosion(p.mesh.position, p.def.color);
            dead = true;
            break;
          }
        }
      }
      // vs asteroids
      if (!dead) {
        for (const a of asteroids) {
          if (segmentHitsSphere(_prev, p.mesh.position, a.position, a.radius)) {
            effects.sparks(p.mesh.position, 0xccaa88, 6);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        scene.remove(p.mesh);
        this.shots.splice(i, 1);
      }
    }
  }

  private splash(center: THREE.Vector3, def: WeaponDef, exclude: Enemy): void {
    const r = def.splash ?? 0;
    for (const e of this.world.enemies) {
      if (!e.alive || e === exclude) continue;
      const d = e.position.distanceTo(center);
      if (d < r + e.def.radius) {
        const falloff = 1 - Math.min(1, d / (r + e.def.radius));
        const result = e.takeDamage(def.damage * 0.6 * falloff, def.shieldMult, def.hullMult);
        if (result.destroyed) this.world.onEnemyDestroyed(e);
      }
    }
  }

  private updateEnemyShots(dt: number): void {
    const { scene, player, asteroids, effects, sfx } = this.world;
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const p = this.enemyShots[i];
      p.life -= dt;
      _prev.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.velocity, dt);

      let dead = p.life <= 0;
      if (!dead && player.alive) {
        const r = player.radius + 0.6;
        if (segmentHitsSphere(_prev, p.mesh.position, player.position, r)) {
          player.takeDamage(p.damage);
          sfx.playerHit();
          effects.shake(0.45);
          effects.sparks(p.mesh.position, 0xff6644, 10);
          dead = true;
        }
      }
      if (!dead) {
        for (const a of asteroids) {
          if (segmentHitsSphere(_prev, p.mesh.position, a.position, a.radius)) {
            effects.sparks(p.mesh.position, 0xccaa88, 4);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        scene.remove(p.mesh);
        this.enemyShots.splice(i, 1);
      }
    }
  }

  clearAll(): void {
    for (const p of this.shots) this.world.scene.remove(p.mesh);
    for (const p of this.enemyShots) this.world.scene.remove(p.mesh);
    this.shots.length = 0;
    this.enemyShots.length = 0;
  }
}

/** Ray-sphere intersection; returns distance along ray or null. */
function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  const oc = _tmp.copy(origin).sub(center);
  const b = oc.dot(dir);
  const c = oc.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
