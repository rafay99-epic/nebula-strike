import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './Input';
import { Sfx } from './Sfx';
import { Environment } from '../world/Environment';
import { PlayerShip } from '../entities/PlayerShip';
import { Enemy, TIERS } from '../entities/Enemy';
import { WeaponSystem } from '../combat/Weapons';
import { TargetingSystem } from '../systems/Targeting';
import { Effects } from '../effects/Effects';
import { HUD } from '../ui/HUD';

type GameState = 'playing' | 'paused' | 'gameover';

interface Pickup {
  mesh: THREE.Mesh;
  life: number;
}

const COMMS_LINES: Record<number, string> = {
  1: 'COMMAND: Hostile drones inbound. Weapons free.',
  2: 'COMMAND: Interceptors on scope — watch your six.',
  3: 'COMMAND: Gunships detected. Switch fire modes to crack their shields.',
  4: 'COMMAND: Destroyer-class signature. Recommend missiles on full lock.',
  5: 'COMMAND: ⚠ DREADNOUGHT EMERGING FROM THE BELT. GOOD LUCK, PILOT.',
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private outlinePass: OutlinePass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private time = 0;

  private input = new Input();
  private sfx = new Sfx();
  private env: Environment;
  private player: PlayerShip;
  private enemies: Enemy[] = [];
  private weapons: WeaponSystem;
  private targeting: TargetingSystem;
  private effects: Effects;
  private hud = new HUD();
  private pickups: Pickup[] = [];
  private pickupGeo = new THREE.IcosahedronGeometry(0.9, 0);
  private pickupMat = new THREE.MeshStandardMaterial({
    color: 0x113322, emissive: 0x57ff9a, emissiveIntensity: 2.5,
  });

  private state: GameState = 'playing';
  private wave = 0;
  private score = 0;
  private intermission = 3; // seconds until first wave
  private waveActive = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x02030a);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 8000);

    // post-processing chain: render → outline (target highlight) → bloom → output
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.outlinePass = new OutlinePass(new THREE.Vector2(size.x, size.y), this.scene, this.camera);
    this.outlinePass.edgeStrength = 4.5;
    this.outlinePass.edgeGlow = 0.6;
    this.outlinePass.edgeThickness = 1.5;
    this.outlinePass.pulsePeriod = 2.5;
    this.outlinePass.visibleEdgeColor.set(0x4de8ff);
    this.outlinePass.hiddenEdgeColor.set(0x123a44);
    this.composer.addPass(this.outlinePass);

    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.45, 0.55);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    // world + entities
    this.env = new Environment(this.scene);
    this.player = new PlayerShip(this.scene);
    this.effects = new Effects(this.scene);
    this.targeting = new TargetingSystem(this.sfx);
    this.weapons = new WeaponSystem({
      scene: this.scene,
      player: this.player,
      enemies: this.enemies,
      asteroids: this.env.asteroids,
      effects: this.effects,
      sfx: this.sfx,
      onEnemyDestroyed: (e) => this.handleEnemyDestroyed(e),
    });

    this.player.onDamaged = () => this.hud.flashDamage();

    this.input.onFirstInteraction = () => this.sfx.ensure();
    window.addEventListener('resize', () => this.onResize());

    this.hud.showBanner('SECTOR 7\nCLEAR ALL HOSTILE WAVES', 3.5);
    this.hud.showComms('COMMAND: Systems green. Hostile contacts converging on your position.', 5);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // global toggles work in every state
    if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();
    if (this.input.wasPressed('KeyP') && this.state !== 'gameover') {
      this.state = this.state === 'paused' ? 'playing' : 'paused';
      this.hud.setPaused(this.state === 'paused');
    }
    if (this.state === 'gameover' && this.input.wasPressed('KeyR')) {
      window.location.reload();
      return;
    }

    if (this.state === 'playing') {
      this.update(dt);
    }

    this.render(dt);
    this.input.endFrame();
  }

  private update(dt: number): void {
    this.time += dt;

    // --- player ---
    this.player.update(dt, this.input, this.env.worldRadius);

    // weapon switching
    for (let i = 0; i < 4; i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) this.weapons.switchTo(i);
    }
    if (this.input.wasPressed('KeyT')) this.targeting.cycle(this.player, this.enemies);
    if (this.input.isDown('Space') && this.player.alive) {
      this.weapons.fire(this.targeting.target, this.targeting.lockProgress);
    }

    // --- enemies ---
    const drones: THREE.Vector3[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const out = e.update(dt, this.player.position, this.player.velocity, this.player.alive, this.env.asteroids, this.time);
      for (const s of out.shots) {
        this.weapons.spawnEnemyShot(s.origin, s.direction, s.speed, s.damage, s.color);
      }
      if (out.spawnDrones && this.enemies.filter((x) => x.alive).length < 40) {
        drones.push(e.position.clone());
      }
    }
    for (const pos of drones) {
      for (let i = 0; i < 2; i++) {
        const offset = new THREE.Vector3().randomDirection().multiplyScalar(18);
        this.spawnEnemy(1, pos.clone().add(offset));
      }
      this.hud.showComms('WARNING: Dreadnought launching drones.', 3);
    }

    // ramming damage: player vs enemies
    if (this.player.alive) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const minDist = e.def.radius + this.player.radius;
        const d = e.position.distanceTo(this.player.position);
        if (d < minDist) {
          const push = this.player.position.clone().sub(e.position).normalize();
          this.player.position.addScaledVector(push, minDist - d + 0.5);
          this.player.velocity.addScaledVector(push, 18);
          this.player.takeDamage(8 + e.def.tier * 3);
          const res = e.takeDamage(20, 1, 1);
          if (res.destroyed) this.handleEnemyDestroyed(e);
          this.effects.shake(0.7);
          this.sfx.playerHit();
        }
      }

      // player vs asteroids: bounce + scrape damage
      for (const a of this.env.asteroids) {
        const minDist = a.radius + this.player.radius;
        const d = a.position.distanceTo(this.player.position);
        if (d < minDist) {
          const normal = this.player.position.clone().sub(a.position).normalize();
          this.player.position.copy(a.position).addScaledVector(normal, minDist + 0.2);
          const vn = this.player.velocity.dot(normal);
          if (vn < 0) {
            this.player.velocity.addScaledVector(normal, -vn * 1.5); // reflect with damping
            const impact = Math.abs(vn);
            if (impact > 12) {
              this.player.takeDamage(Math.min(30, impact * 0.5));
              this.effects.shake(0.8);
              this.effects.sparks(this.player.position, 0xccaa88, 12);
              this.sfx.playerHit();
            }
          }
        }
      }
    }

    if (!this.player.alive && this.state === 'playing') {
      this.gameOver();
    }

    // --- systems ---
    this.weapons.update(dt);
    this.targeting.update(dt, this.player, this.enemies);
    this.effects.update(dt);
    this.env.update(dt, this.player.position);
    this.updatePickups(dt);
    this.updateWaves(dt);

    // remove dead enemies' corpses (kept one frame for outline safety)
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) {
        this.enemies[i].dispose(this.scene);
        this.enemies.splice(i, 1);
      }
    }

    // --- outline pass tracks current target ---
    this.outlinePass.selectedObjects = this.targeting.target?.alive ? [this.targeting.target.group] : [];
    this.outlinePass.visibleEdgeColor.set(this.targeting.isLocked ? 0xff4455 : 0x4de8ff);

    // --- HUD ---
    const nearBoundary = this.player.position.length() > this.env.worldRadius * 0.92;
    this.hud.update(
      dt, this.camera, this.player, this.enemies, this.targeting,
      this.weapons, Math.max(1, this.wave), this.score, nearBoundary
    );
  }

  // ------------------------------------------------------------------ waves

  private updateWaves(dt: number): void {
    const aliveCount = this.enemies.filter((e) => e.alive).length;
    if (this.waveActive && aliveCount === 0) {
      this.waveActive = false;
      this.intermission = 5;
      this.score += 200 + this.wave * 50;
      this.hud.showBanner(`WAVE ${this.wave} CLEARED\n+${200 + this.wave * 50} BONUS`, 2.8);
    }
    if (!this.waveActive) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.startWave(this.wave + 1);
      }
    }
  }

  private startWave(n: number): void {
    this.wave = n;
    this.waveActive = true;
    this.sfx.waveStart();
    this.hud.showBanner(`WAVE ${n}`, 2);
    const maxTier = Math.min(4, 1 + Math.floor(n / 2));
    this.hud.showComms(COMMS_LINES[Math.min(n, 5)] ?? `COMMAND: Wave ${n} inbound. They keep coming.`, 4.5);

    // spend a budget on a random mix of tiers (cost == tier)
    let budget = 3 + n * 2;
    while (budget > 0) {
      const tier = 1 + Math.floor(Math.random() * Math.min(maxTier, budget));
      budget -= tier;
      this.spawnEnemyNearPlayer(tier);
    }
    // boss every 5 waves
    if (n % 5 === 0) {
      this.spawnEnemyNearPlayer(5);
    }
  }

  private spawnEnemyNearPlayer(tier: number): void {
    const dir = new THREE.Vector3().randomDirection();
    dir.y *= 0.4;
    dir.normalize();
    const dist = 320 + Math.random() * 280;
    const pos = this.player.position.clone().addScaledVector(dir, dist);
    // keep inside the combat zone
    if (pos.length() > this.env.worldRadius * 0.9) {
      pos.setLength(this.env.worldRadius * 0.75);
    }
    this.spawnEnemy(tier, pos);
  }

  private spawnEnemy(tier: number, position: THREE.Vector3): void {
    const def = TIERS[tier - 1];
    this.enemies.push(new Enemy(def, position, this.scene));
  }

  private handleEnemyDestroyed(enemy: Enemy): void {
    this.score += enemy.def.score;
    const scale = 0.7 + enemy.def.tier * 0.45;
    this.effects.explosion(enemy.position, scale);
    this.sfx.explosion(enemy.def.tier >= 4);
    enemy.group.visible = false;

    if (enemy.def.tier === 5) {
      this.hud.showComms('COMMAND: Dreadnought destroyed. Outstanding flying, pilot!', 4);
    }

    // chance to drop a repair pickup
    if (enemy.def.tier >= 2 && Math.random() < 0.3) {
      const mesh = new THREE.Mesh(this.pickupGeo, this.pickupMat);
      mesh.position.copy(enemy.position);
      this.scene.add(mesh);
      this.pickups.push({ mesh, life: 25 });
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.rotation.x += dt * 1.3;
      p.mesh.position.y += Math.sin(this.time * 2 + i) * dt * 0.6;

      const d = p.mesh.position.distanceTo(this.player.position);
      if (d < 30) {
        // magnet toward player
        const pull = this.player.position.clone().sub(p.mesh.position).normalize();
        p.mesh.position.addScaledVector(pull, (30 - d) * 2.2 * dt + 10 * dt);
      }
      if (d < this.player.radius + 2 && this.player.alive) {
        this.player.heal(22);
        this.sfx.pickup();
        this.hud.showComms('Repair nanites acquired. +22 HULL', 2);
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        continue;
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  private gameOver(): void {
    this.state = 'gameover';
    this.effects.explosion(this.player.position, 2.2);
    this.sfx.explosion(true);
    this.hud.showGameOver(this.score, this.wave);
  }

  // ----------------------------------------------------------------- render

  private render(dt: number): void {
    // chase camera with spring follow + screen shake
    const desired = new THREE.Vector3(0, 3.6, 13.5).applyQuaternion(this.player.group.quaternion).add(this.player.position);
    const stiffness = 1 - Math.exp(-7 * dt);
    this.camera.position.lerp(desired, this.state === 'playing' ? stiffness : 1);

    const lookTarget = this.player.position.clone().addScaledVector(this.player.forward, 30);
    const lookMatrix = new THREE.Matrix4().lookAt(this.camera.position, lookTarget, new THREE.Vector3(0, 1, 0).applyQuaternion(this.player.group.quaternion));
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
    this.camera.quaternion.slerp(targetQuat, 1 - Math.exp(-10 * dt));

    const shake = this.effects.shakeOffset;
    if (shake > 0.001) {
      this.camera.position.add(new THREE.Vector3(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake
      ));
    }

    // widen FOV slightly while boosting for a sense of speed
    const targetFov = this.player.boosting && this.player.velocity.length() > 50 ? 82 : 70;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();

    this.composer.render();
  }
}
