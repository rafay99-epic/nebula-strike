import * as THREE from 'three';
import type { AsteroidInfo } from '../world/Environment';

export interface TierDef {
  tier: number;
  name: string;
  hull: number;
  shield: number;
  speed: number;
  accel: number;
  turn: number;
  aggro: number;
  attackRange: number;
  fireInterval: number;
  burst: number;
  projSpeed: number;
  damage: number;
  spread: number;
  lead: boolean;
  score: number;
  radius: number;
  color: number;
  canRetreat: boolean;
}

export const TIERS: TierDef[] = [
  {
    tier: 1, name: 'WASP DRONE', hull: 16, shield: 0, speed: 36, accel: 40, turn: 2.6,
    aggro: 460, attackRange: 190, fireInterval: 1.2, burst: 1, projSpeed: 110, damage: 4,
    spread: 0.06, lead: false, score: 50, radius: 1.8, color: 0xffc24d, canRetreat: true,
  },
  {
    tier: 2, name: 'VIPER INTERCEPTOR', hull: 32, shield: 16, speed: 44, accel: 48, turn: 2.2,
    aggro: 540, attackRange: 250, fireInterval: 0.95, burst: 1, projSpeed: 140, damage: 6,
    spread: 0.045, lead: false, score: 120, radius: 2.4, color: 0xff5533, canRetreat: true,
  },
  {
    tier: 3, name: 'MAULER GUNSHIP', hull: 75, shield: 45, speed: 25, accel: 26, turn: 1.4,
    aggro: 620, attackRange: 330, fireInterval: 1.5, burst: 2, projSpeed: 130, damage: 9,
    spread: 0.035, lead: true, score: 250, radius: 3.6, color: 0xdd44ff, canRetreat: false,
  },
  {
    tier: 4, name: 'REAPER DESTROYER', hull: 170, shield: 95, speed: 15, accel: 16, turn: 0.9,
    aggro: 720, attackRange: 430, fireInterval: 1.9, burst: 3, projSpeed: 150, damage: 13,
    spread: 0.03, lead: true, score: 500, radius: 6.2, color: 0x57ff9a, canRetreat: false,
  },
  {
    tier: 5, name: 'OBLIVION DREADNOUGHT', hull: 430, shield: 220, speed: 9, accel: 9, turn: 0.5,
    aggro: 2500, attackRange: 540, fireInterval: 2.6, burst: 5, projSpeed: 160, damage: 12,
    spread: 0.05, lead: true, score: 1500, radius: 10.5, color: 0xff2244, canRetreat: false,
  },
];

type AIState = 'patrol' | 'chase' | 'attack' | 'retreat';

export interface EnemyShot {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  damage: number;
  color: number;
}

let nextId = 1;

export class Enemy {
  readonly id = nextId++;
  readonly def: TierDef;
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  hull: number;
  shield: number;
  alive = true;
  state: AIState = 'patrol';

  /** estimated velocity, exposed for lead-prediction by the player HUD */
  readonly estVelocity = new THREE.Vector3();

  private inner = new THREE.Group();
  private bobPhase = Math.random() * Math.PI * 2;
  private bobSpeed = 0.8 + Math.random() * 0.8;
  private spinPart: THREE.Object3D | null = null;
  private home: THREE.Vector3;
  private waypoint = new THREE.Vector3();
  private waypointTimer = 0;
  private fireTimer: number;
  private burstLeft = 0;
  private burstTimer = 0;
  private retreatTimer = 0;
  private shieldRegenDelay = 0;
  private orbitSign = Math.random() < 0.5 ? -1 : 1;
  private flashTimer = 0;
  private flashMats: THREE.MeshStandardMaterial[] = [];
  private shieldFx: THREE.Mesh;
  private carrierTimer = 12;
  private prevPos = new THREE.Vector3();

  constructor(def: TierDef, position: THREE.Vector3, scene: THREE.Scene) {
    this.def = def;
    this.hull = def.hull;
    this.shield = def.shield;
    this.home = position.clone();
    this.group.position.copy(position);
    this.prevPos.copy(position);
    this.fireTimer = def.fireInterval * (0.5 + Math.random());
    this.buildMesh();
    this.group.add(this.inner);

    // shield impact bubble (flashes on shield hits)
    this.shieldFx = new THREE.Mesh(
      new THREE.SphereGeometry(def.radius * 1.35, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x66aaff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.group.add(this.shieldFx);
    scene.add(this.group);
    this.pickWaypoint();
  }

  private mat(opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(opts);
    m.userData.baseEmissiveHex = m.emissive.getHex();
    m.userData.baseEmissiveIntensity = m.emissiveIntensity;
    this.flashMats.push(m);
    return m;
  }

  private buildMesh(): void {
    const c = this.def.color;
    const hullMat = this.mat({ color: 0x4a4f5a, roughness: 0.5, metalness: 0.75 });
    const darkMat = this.mat({ color: 0x23262e, roughness: 0.6, metalness: 0.6 });
    const accent = this.mat({ color: 0x111111, emissive: c, emissiveIntensity: 2.4, roughness: 0.4 });

    switch (this.def.tier) {
      case 1: { // drone: spinning core in a ring
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), accent);
        this.inner.add(core);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 8, 20), hullMat);
        this.inner.add(ring);
        this.spinPart = core;
        break;
      }
      case 2: { // interceptor: dart with swept fins
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4.2, 6), hullMat);
        body.rotation.x = -Math.PI / 2;
        this.inner.add(body);
        for (const side of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.2), darkMat);
          fin.position.set(side * 1.4, 0, 1.0);
          fin.rotation.y = side * 0.5;
          this.inner.add(fin);
        }
        const eng = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), accent);
        eng.position.z = 2.1;
        this.inner.add(eng);
        break;
      }
      case 3: { // gunship: brick with side pods
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 4.6), hullMat);
        this.inner.add(body);
        for (const side of [-1, 1]) {
          const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3.4, 8), darkMat);
          pod.rotation.x = Math.PI / 2;
          pod.position.set(side * 2.2, 0, 0.3);
          this.inner.add(pod);
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.8, 6), accent);
          barrel.rotation.x = Math.PI / 2;
          barrel.position.set(side * 2.2, 0, -2.2);
          this.inner.add(barrel);
        }
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.4), accent);
        bridge.position.set(0, 1.0, -0.8);
        this.inner.add(bridge);
        break;
      }
      case 4: { // destroyer: long hull, tower, engine block
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 11, 8), hullMat);
        body.rotation.x = -Math.PI / 2;
        this.inner.add(body);
        const prow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 8), darkMat);
        prow.rotation.x = -Math.PI / 2;
        prow.position.z = -7.2;
        this.inner.add(prow);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 3), darkMat);
        tower.position.set(0, 2.4, 1.5);
        this.inner.add(tower);
        const towerLight = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.4), accent);
        towerLight.position.set(0, 3.8, 1.5);
        this.inner.add(towerLight);
        for (const side of [-1, 1]) {
          const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 2.6, 8), accent);
          eng.rotation.x = -Math.PI / 2;
          eng.position.set(side * 1.8, -0.4, 6.4);
          this.inner.add(eng);
        }
        break;
      }
      case 5: { // dreadnought: massive hull with rotating armor ring and spikes
        const body = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.6, 18, 10), hullMat);
        body.rotation.x = -Math.PI / 2;
        this.inner.add(body);
        const prow = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6, 10), darkMat);
        prow.rotation.x = -Math.PI / 2;
        prow.position.z = -12;
        this.inner.add(prow);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 1.1, 8, 24), darkMat);
        this.inner.add(ring);
        for (let i = 0; i < 6; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 6), accent);
          const a = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 7, Math.sin(a) * 7, 0);
          spike.rotation.z = a + Math.PI / 2;
          ring.add(spike);
        }
        this.spinPart = ring;
        const eye = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), accent);
        eye.position.z = -9.5;
        this.inner.add(eye);
        break;
      }
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /**
   * @returns shots fired this frame (the game turns them into projectiles),
   *          plus spawn requests for carrier tier.
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerAlive: boolean,
    asteroids: AsteroidInfo[],
    time: number
  ): { shots: EnemyShot[]; spawnDrones: boolean } {
    const shots: EnemyShot[] = [];
    let spawnDrones = false;
    if (!this.alive) return { shots, spawnDrones };

    const def = this.def;
    const toPlayer = playerPos.clone().sub(this.group.position);
    const dist = toPlayer.length();

    // --- state transitions ---
    if (!playerAlive) {
      this.state = 'patrol';
    } else {
      switch (this.state) {
        case 'patrol':
          if (dist < def.aggro) this.state = 'chase';
          break;
        case 'chase':
          if (dist < def.attackRange) this.state = 'attack';
          else if (dist > def.aggro * 1.6) this.state = 'patrol';
          break;
        case 'attack':
          if (dist > def.attackRange * 1.5) this.state = 'chase';
          break;
        case 'retreat':
          this.retreatTimer -= dt;
          if (this.retreatTimer <= 0) this.state = 'chase';
          break;
      }
      if (def.canRetreat && this.state !== 'retreat' && this.hull < def.hull * 0.3 && Math.random() < 0.01) {
        this.state = 'retreat';
        this.retreatTimer = 5 + Math.random() * 3;
      }
    }

    // --- desired movement direction ---
    const desired = new THREE.Vector3();
    let speedScale = 1;
    switch (this.state) {
      case 'patrol': {
        this.waypointTimer -= dt;
        if (this.waypointTimer <= 0 || this.group.position.distanceTo(this.waypoint) < 15) {
          this.pickWaypoint();
        }
        desired.copy(this.waypoint).sub(this.group.position).normalize();
        speedScale = 0.4;
        break;
      }
      case 'chase':
        desired.copy(toPlayer).normalize();
        break;
      case 'attack': {
        // orbit-strafe: keep a distance band, circle tangentially
        const radial = toPlayer.clone().normalize();
        const tangent = new THREE.Vector3().crossVectors(radial, new THREE.Vector3(0, 1, 0));
        if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
        tangent.normalize().multiplyScalar(this.orbitSign);
        const band = def.attackRange * 0.65;
        const radialPush = dist > band ? 0.7 : -0.7;
        desired.copy(radial).multiplyScalar(radialPush).addScaledVector(tangent, 1).normalize();
        speedScale = 0.7;
        break;
      }
      case 'retreat':
        desired.copy(toPlayer).normalize().multiplyScalar(-1);
        break;
    }

    // light asteroid avoidance
    for (const a of asteroids) {
      const d = this.group.position.distanceTo(a.position);
      const safe = a.radius + def.radius + 14;
      if (d < safe && d > 0.01) {
        const away = this.group.position.clone().sub(a.position).normalize();
        desired.addScaledVector(away, (safe - d) / safe * 2.2);
      }
    }
    if (desired.lengthSq() > 0) desired.normalize();

    // --- integrate movement ---
    const targetVel = desired.multiplyScalar(def.speed * speedScale);
    this.velocity.lerp(targetVel, 1 - Math.exp(-def.accel / def.speed * dt));
    this.group.position.addScaledVector(this.velocity, dt);

    // face along velocity (or at the player while attacking)
    const faceDir = this.state === 'attack' || this.state === 'chase'
      ? toPlayer.clone().normalize()
      : this.velocity.lengthSq() > 0.5 ? this.velocity.clone().normalize() : null;
    if (faceDir) {
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(new THREE.Vector3(), faceDir.clone().multiplyScalar(-1), new THREE.Vector3(0, 1, 0))
      );
      this.group.quaternion.slerp(targetQuat, Math.min(1, def.turn * dt));
    }

    // floating idle animation + part spin
    this.inner.position.y = Math.sin(time * this.bobSpeed + this.bobPhase) * 0.4;
    if (this.spinPart) this.spinPart.rotation.z += dt * 1.6;

    // --- firing ---
    if (playerAlive && this.state === 'attack') {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.group.quaternion);
      const aimAngle = fwd.angleTo(toPlayer.clone().normalize());
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && aimAngle < 0.45) {
        this.fireTimer = def.fireInterval * (0.85 + Math.random() * 0.3);
        this.burstLeft = def.burst;
        this.burstTimer = 0;
      }
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer = 0.14;
        const aim = playerPos.clone();
        if (def.lead) {
          const t = dist / def.projSpeed;
          aim.addScaledVector(playerVel, t);
        }
        const dir = aim.sub(this.group.position).normalize();
        dir.x += (Math.random() - 0.5) * def.spread * 2;
        dir.y += (Math.random() - 0.5) * def.spread * 2;
        dir.z += (Math.random() - 0.5) * def.spread * 2;
        dir.normalize();
        shots.push({
          origin: this.group.position.clone().addScaledVector(dir, def.radius + 1.5),
          direction: dir,
          speed: def.projSpeed,
          damage: def.damage,
          color: def.color,
        });
      }
    }

    // --- carrier behaviour (tier 5 launches drones) ---
    if (def.tier === 5 && playerAlive) {
      this.carrierTimer -= dt;
      if (this.carrierTimer <= 0) {
        this.carrierTimer = 14;
        spawnDrones = true;
      }
    }

    // --- shield regen ---
    this.shieldRegenDelay -= dt;
    if (this.shieldRegenDelay <= 0 && this.shield < def.shield) {
      this.shield = Math.min(def.shield, this.shield + def.shield * 0.06 * dt);
    }

    // --- hit flash / shield fx decay ---
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        for (const m of this.flashMats) {
          m.emissive.setHex(m.userData.baseEmissiveHex);
          m.emissiveIntensity = m.userData.baseEmissiveIntensity;
        }
      }
    }
    const sfm = this.shieldFx.material as THREE.MeshBasicMaterial;
    if (sfm.opacity > 0) sfm.opacity = Math.max(0, sfm.opacity - dt * 2.5);

    // estimate velocity for HUD lead reticle
    this.estVelocity.copy(this.group.position).sub(this.prevPos).divideScalar(Math.max(dt, 1e-4));
    this.prevPos.copy(this.group.position);

    return { shots, spawnDrones };
  }

  private pickWaypoint(): void {
    this.waypoint.copy(this.home).add(new THREE.Vector3(
      (Math.random() - 0.5) * 240,
      (Math.random() - 0.5) * 80,
      (Math.random() - 0.5) * 240
    ));
    this.waypointTimer = 6 + Math.random() * 6;
  }

  /** @returns true if this hit destroyed the enemy */
  takeDamage(amount: number, shieldMult: number, hullMult: number): { destroyed: boolean; hitShield: boolean } {
    if (!this.alive) return { destroyed: false, hitShield: false };
    this.shieldRegenDelay = 5;
    let hitShield = false;
    if (this.shield > 0) {
      hitShield = true;
      const dmg = amount * shieldMult;
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      const overflow = (dmg - absorbed) / Math.max(shieldMult, 1e-4);
      if (overflow > 0) this.hull -= overflow * hullMult;
      (this.shieldFx.material as THREE.MeshBasicMaterial).opacity = 0.5;
    } else {
      this.hull -= amount * hullMult;
    }

    // flash
    for (const m of this.flashMats) {
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 1.1;
    }
    this.flashTimer = 0.07;

    if (this.hull <= 0) {
      this.alive = false;
      return { destroyed: true, hitShield };
    }
    return { destroyed: false, hitShield };
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}
