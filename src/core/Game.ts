import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Input } from './Input';
import { Sfx } from './Sfx';
import { Music } from './Music';
import { Environment, type Planet } from '../world/Environment';
import { PlanetSurface, physicsFor } from '../world/PlanetSurface';
import { SECTORS, type EncounterKind, type SectorDef } from '../world/Sectors';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import { PlayerShip, SHIPS } from '../entities/PlayerShip';
import { Enemy, TIERS, SPECIALS, type TierDef } from '../entities/Enemy';
import { Mine } from '../entities/Mine';
import { WeaponSystem } from '../combat/Weapons';
import { TargetingSystem } from '../systems/Targeting';
import { Effects, SpaceDust } from '../effects/Effects';
import { HUD } from '../ui/HUD';

type GameState = 'shipselect' | 'playing' | 'paused' | 'warping' | 'gameover';

interface Pickup {
  mesh: THREE.Mesh;
  life: number;
}

interface NavTarget {
  name: string;
  position: THREE.Vector3;
}

const BEST_KEY = 'nebula-strike-best';

/**
 * Real-world m/s² → gameplay acceleration. Tuned so a Jupiter-class world
 * (24 m/s² → ~77) exceeds every hull's main-drive thrust (38–78): no ship
 * climbs out of a gas giant without the afterburner.
 */
const GRAV_MULT = 3.2;

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
  private music = new Music();
  private env: Environment;
  private player: PlayerShip;
  private enemies: Enemy[] = [];
  private mines: Mine[] = [];
  private weapons: WeaponSystem;
  private targeting: TargetingSystem;
  private effects: Effects;
  private dust: SpaceDust;
  private hud = new HUD();
  private pickups: Pickup[] = [];
  private pickupGeo = new THREE.IcosahedronGeometry(0.9, 0);
  private pickupMat = new THREE.MeshStandardMaterial({
    color: 0x113322, emissive: 0x57ff9a, emissiveIntensity: 2.5,
  });

  private state: GameState = 'shipselect';
  /** which world is live: open space or a planet surface */
  private mode: 'space' | 'surface' = 'space';
  private surface: PlanetSurface | null = null;
  private surfaceComposer: EffectComposer | null = null;
  private surfaceEffects: Effects | null = null;
  private surfacePlanet: Planet | null = null;
  private spaceReturnPos = new THREE.Vector3();
  private crystalsCollected = 0;
  private escapeHintShown = false;
  private escapeHintTimer = 0;
  private midGameShipSwap = false;
  private readonly isTouch = isTouchDevice();
  private sectorIndex = 0;
  private loop = 0; // how many times all sectors were cleared (NG+)
  private wave = 0; // wave within current sector
  private score = 0;
  private intermission = 3;
  private waveActive = false;
  private sectorCleared = false;
  private gatePos: THREE.Vector3 | null = null;
  private warpTimer = 0;
  private navTargets: NavTarget[] = [];
  private navIndex = -1;
  private enginePosBuf = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // phones get a lighter pixel ratio + MSAA so the frame rate holds up
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isTouch ? 1.5 : 2));
    this.renderer.setClearColor(0x02030a);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 12000);

    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: this.isTouch ? 2 : 4,
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

    this.env = new Environment(this.scene);
    this.player = new PlayerShip(this.scene);
    this.effects = new Effects(this.scene);
    this.dust = new SpaceDust(this.scene);
    this.targeting = new TargetingSystem(this.sfx);
    this.weapons = new WeaponSystem({
      scene: this.scene,
      player: this.player,
      enemies: this.enemies,
      mines: this.mines,
      asteroids: this.env.asteroids,
      effects: this.effects,
      sfx: this.sfx,
      onEnemyDestroyed: (e) => this.handleEnemyDestroyed(e),
      onMineDetonated: (m) => this.detonateMine(m),
    });

    this.player.onDamaged = () => this.hud.flashDamage();
    this.input.onFirstInteraction = () => {
      this.sfx.ensure();
      if (this.sfx.context) this.music.start(this.sfx.context);
    };
    window.addEventListener('resize', () => this.onResize());

    this.loadSector(0);
    this.hud.onShipCard((index, confirm) => {
      if (this.state !== 'shipselect') return;
      this.player.applyDef(SHIPS[index]);
      if (confirm) this.confirmShip();
    });
    this.hud.onWeaponTap((i) => this.weapons.switchTo(i));
    this.hud.onPlanetPromptTap(() => this.input.pressVirtual('KeyG'));
    if (this.isTouch) {
      new TouchControls(this.input);
      this.hud.toggleHelp(); // keep the keyboard table off small screens
    }
  }

  get sector(): SectorDef {
    return SECTORS[this.sectorIndex];
  }

  private get difficultyMult(): number {
    return 1 + this.loop * 0.4;
  }

  /** Test helper: destroy every live enemy through the normal kill path. */
  debugKillAll(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.takeDamage(1e6, 1, 1);
      this.handleEnemyDestroyed(e);
    }
  }

  /** Pick hull by index and launch (also used by ship-select keys + tests). */
  selectShip(index: number): void {
    if (this.state !== 'shipselect') return;
    this.player.applyDef(SHIPS[index]);
    this.confirmShip();
  }

  private confirmShip(): void {
    this.state = 'playing';
    this.hud.hideShipSelect();
    if (this.midGameShipSwap) {
      this.midGameShipSwap = false;
      this.hud.showComms(`Vessel transfer complete — ${this.player.def.name} online.`, 3.5);
      return;
    }
    this.hud.showBanner(`SECTOR 1\n${this.sector.name}`, 3.2);
    this.hud.showComms('COMMAND: Systems green. Hostile contacts converging on your position.', 5);
    this.intermission = 3;
  }

  /** Mid-run vessel swap (V) — pauses the action and reopens the hangar. */
  private openShipSwap(): void {
    if (this.state !== 'playing' || this.mode !== 'space') return;
    this.midGameShipSwap = true;
    this.state = 'shipselect';
    this.hud.showShipSelect();
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
    this.surfaceComposer?.setSize(w, h);
  }

  // ----------------------------------------------------------------- frame

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();
    if (this.input.wasPressed('KeyP') && (this.state === 'playing' || this.state === 'paused')) {
      this.state = this.state === 'paused' ? 'playing' : 'paused';
      this.hud.setPaused(this.state === 'paused');
    }
    if (this.state === 'gameover' && this.input.wasPressed('KeyR')) {
      window.location.reload();
      return;
    }
    if (this.state === 'shipselect') {
      for (let i = 0; i < 3; i++) {
        if (this.input.wasPressed(`Digit${i + 1}`)) this.selectShip(i);
      }
      this.renderShipSelect(dt);
      this.input.endFrame();
      return;
    }

    if (this.state === 'playing') {
      if (this.mode === 'space') this.update(dt);
      else this.updateSurface(dt);
    } else if (this.state === 'warping') {
      this.updateWarp(dt);
    }

    this.render(dt);
    this.input.endFrame();
  }

  private renderShipSelect(dt: number): void {
    this.time += dt;
    // slow showcase orbit around the docked ship
    const a = this.time * 0.35;
    this.camera.position.set(
      this.player.position.x + Math.sin(a) * 16,
      this.player.position.y + 4,
      this.player.position.z + Math.cos(a) * 16
    );
    this.camera.lookAt(this.player.position);
    this.env.update(dt);
    this.effects.update(dt);
    this.composer.render();
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.time += dt;

    this.player.update(dt, this.input, this.env.worldRadius);
    this.sfx.setHum(this.player.throttle, this.player.boosting);

    for (let i = 0; i < 4; i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) this.weapons.switchTo(i);
    }
    if (this.input.wasPressed('KeyT')) this.targeting.cycle(this.player, this.enemies);
    if (this.input.wasPressed('KeyN')) this.cycleNav();
    if (this.input.wasPressed('KeyV')) {
      this.openShipSwap();
      return;
    }
    if (this.input.wasPressed('KeyX')) {
      this.player.assist = !this.player.assist;
      this.hud.setAssist(this.player.assist);
      this.hud.showComms(this.player.assist
        ? 'Flight assist engaged — dampeners online.'
        : 'Flight assist DISENGAGED — newtonian drift. Watch your vector.', 3);
    }
    if ((this.input.isDown('Space') || this.input.vFire) && this.player.alive) {
      this.weapons.fire(this.targeting.target, this.targeting.lockProgress);
    }

    // --- planetary gravity wells: every world tugs at you in space too ---
    let nearPlanet: Planet | null = null;
    let nearPull = 0;
    if (this.player.alive) {
      for (const planet of this.env.planets) {
        const d = planet.position.distanceTo(this.player.position);
        if (d > planet.visitRadius * 3) continue;
        const phys = physicsFor(planet.def.type);
        // inverse-square pull, strongest at the cloud tops
        const pull = Math.min(26,
          phys.gravity * 0.55 * Math.pow(planet.visitRadius / Math.max(d, planet.visitRadius * 0.6), 2));
        const dir = planet.position.clone().sub(this.player.position).divideScalar(Math.max(d, 1));
        this.player.velocity.addScaledVector(dir, pull * dt);
        if (d < planet.visitRadius) {
          nearPlanet = planet;
          nearPull = pull;
        }
      }
    }

    // --- planet approach: offer atmospheric entry ---
    if (nearPlanet && this.player.alive) {
      const wellNote = nearPull >= 4 ? ` · ⚠ GRAV WELL ${nearPull.toFixed(0)} m/s²` : '';
      this.hud.showPlanetPrompt(`ENTER ${nearPlanet.def.name}? [G]${wellNote}`);
      if (this.input.wasPressed('KeyG')) {
        this.enterPlanet(nearPlanet);
        return;
      }
    } else {
      this.hud.hidePlanetPrompt();
    }

    // --- engine exhaust particles ---
    if (this.player.alive && this.player.throttle > 0.25) {
      const n = this.player.getEnginePositions(this.enginePosBuf);
      const back = this.player.forward.multiplyScalar(8 + this.player.throttle * 14);
      for (let i = 0; i < n; i++) {
        if (Math.random() < this.player.throttle * 0.9) {
          this.effects.emitTrail(this.enginePosBuf[i], back, this.player.boosting ? 0x99d8ff : 0x2a9ec4, 0.4);
        }
      }
    }

    // --- enemies ---
    const droneSpawns: THREE.Vector3[] = [];
    const ctx = {
      playerPos: this.player.position,
      playerVel: this.player.velocity,
      playerAlive: this.player.alive,
      asteroids: this.env.asteroids,
      allies: this.enemies,
      time: this.time,
      hunt: this.waveActive,
    };
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const out = e.update(dt, ctx);
      for (const s of out.shots) {
        this.weapons.spawnEnemyShot(s.origin, s.direction, s.speed, s.damage, s.color);
      }
      if (out.spawnDrones && this.enemies.filter((x) => x.alive).length < 40) {
        droneSpawns.push(e.position.clone());
      }
      if (out.detonate) {
        // kamikaze self-destruct
        this.effects.explosion(e.position, 1.4, 0xffaa33);
        this.sfx.explosion(false);
        const d = e.position.distanceTo(this.player.position);
        if (d < 36 && this.player.alive) {
          this.player.takeDamage(e.def.damage * e.mult * (1 - d / 40));
          this.sfx.playerHit();
          this.effects.shake(0.9);
        }
      }
      if (out.healTarget) {
        this.effects.healBeam(e.position, out.healTarget.position);
      }
    }
    for (const pos of droneSpawns) {
      for (let i = 0; i < 2; i++) {
        const offset = new THREE.Vector3().randomDirection().multiplyScalar(18);
        this.spawnEnemy(TIERS[0], pos.clone().add(offset));
      }
      this.hud.showComms('WARNING: Dreadnought launching drones.', 3);
    }

    // --- mines ---
    for (const m of this.mines) {
      if (!m.alive) continue;
      m.update(dt, this.time);
      if (this.player.alive && m.position.distanceTo(this.player.position) < m.triggerRadius) {
        this.detonateMine(m);
      }
    }

    // --- collisions: player vs enemies / asteroids ---
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
      for (const a of this.env.asteroids) {
        const minDist = a.radius + this.player.radius;
        const d = a.position.distanceTo(this.player.position);
        if (d < minDist) {
          const normal = this.player.position.clone().sub(a.position).normalize();
          this.player.position.copy(a.position).addScaledVector(normal, minDist + 0.2);
          const vn = this.player.velocity.dot(normal);
          if (vn < 0) {
            this.player.velocity.addScaledVector(normal, -vn * 1.5);
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
    this.dust.update(this.player.position, this.player.velocity.length());
    this.env.update(dt, this.player.position);
    this.updatePickups(dt);
    this.updatePlanets();
    this.updateWaves(dt);
    this.checkGateEntry();

    // music intensity follows nearby threat
    let near = 0;
    for (const e of this.enemies) {
      if (e.alive && e.position.distanceTo(this.player.position) < 450) near++;
    }
    this.music.setIntensity(Math.min(1, near / 3));

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) {
        this.enemies[i].dispose(this.scene);
        this.enemies.splice(i, 1);
      }
    }
    for (let i = this.mines.length - 1; i >= 0; i--) {
      if (!this.mines[i].alive) {
        this.mines[i].dispose(this.scene);
        this.mines.splice(i, 1);
      }
    }

    this.outlinePass.selectedObjects = this.targeting.target?.alive ? [this.targeting.target.group] : [];
    this.outlinePass.visibleEdgeColor.set(this.targeting.isLocked ? 0xff4455 : 0x4de8ff);

    const nearBoundary = this.player.position.length() > this.env.worldRadius * 0.92;
    this.hud.radarMines = this.mines;
    this.hud.update(
      dt, this.camera, this.player, this.enemies, this.targeting,
      this.weapons, Math.max(1, this.wave), this.score, nearBoundary
    );
    this.hud.updateNav(this.camera, this.currentNav(), this.player.position);
  }

  // ------------------------------------------------------------------- nav

  private rebuildNavTargets(): void {
    this.navTargets = this.env.planets.map((p) => ({ name: p.def.name, position: p.position }));
    if (this.gatePos) this.navTargets.push({ name: 'JUMP GATE', position: this.gatePos });
    if (this.navIndex >= this.navTargets.length) this.navIndex = -1;
  }

  private cycleNav(): void {
    this.rebuildNavTargets();
    this.navIndex++;
    if (this.navIndex >= this.navTargets.length) this.navIndex = -1;
    const t = this.currentNav();
    this.hud.showComms(t ? `NAV: course plotted to ${t.name}.` : 'NAV: marker cleared.', 2.5);
  }

  private currentNav(): NavTarget | null {
    return this.navIndex >= 0 && this.navIndex < this.navTargets.length
      ? this.navTargets[this.navIndex]
      : null;
  }

  // ------------------------------------------------------ planet surfaces

  private enterPlanet(planet: Planet): void {
    // remember where to come back to — just outside the prompt radius
    const away = this.player.position.clone().sub(planet.position);
    if (away.lengthSq() < 1) away.set(0, 0, 1);
    this.spaceReturnPos.copy(planet.position).addScaledVector(away.normalize(), planet.visitRadius + 80);

    this.mode = 'surface';
    this.surfacePlanet = planet;
    this.crystalsCollected = 0;
    this.escapeHintShown = false;
    this.escapeHintTimer = 0;
    this.surface = new PlanetSurface(planet.def, this.isTouch ? 0.55 : 1);
    this.surface.onLightning = () => this.sfx.thunder();
    this.scene.remove(this.player.group);
    this.surface.scene.add(this.player.group);
    // atmospheric entry: start high in the gravity well, already plunging —
    // the heavier the world, the harder it grabs you on the way in
    const gEff = this.surface.physics.gravity * GRAV_MULT;
    this.player.position.set(0, this.surface.ceiling - 40, 0);
    this.player.velocity.set(0, -Math.min(80, 18 + gEff * 0.7), -16);
    this.player.group.quaternion.identity();
    this.effects.shake(Math.min(1.2, 0.3 + gEff * 0.012));
    this.surfaceEffects = new Effects(this.surface.scene);

    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: this.isTouch ? 2 : 4,
      type: THREE.HalfFloatType,
    });
    this.surfaceComposer = new EffectComposer(this.renderer, rt);
    this.surfaceComposer.addPass(new RenderPass(this.surface.scene, this.camera));
    // tight threshold: only genuinely emissive things (lava, crystals, engines) bloom —
    // bright daylight fog and sand must not blow out
    this.surfaceComposer.addPass(new UnrealBloomPass(size, 0.4, 0.35, 0.92));
    this.surfaceComposer.addPass(new OutputPass());

    const phys = this.surface.physics;
    this.hud.setSurfaceMode(true, planet.def.name,
      `GRAV ${phys.gravity.toFixed(1)} m/s² · ${phys.label}`);
    this.hud.showBanner(`${planet.def.name}\nATMOSPHERIC ENTRY`, 2.8);
    const heavy = phys.gravity >= 15
      ? ' ⚠ SEVERE GRAVITY WELL: the main drive cannot reach escape altitude — afterburner required.'
      : '';
    this.hud.showComms(
      `SURVEY: ${planet.def.flavor} Gravity ${phys.gravity.toFixed(1)} m/s², ${phys.label.toLowerCase()}.${heavy} Collect crystals — climb high to leave.`, 8);
    this.music.setIntensity(0);
    this.sfx.railgun();
    this.camera.position.copy(this.player.position).add(new THREE.Vector3(0, 8, 24));
  }

  private exitPlanet(): void {
    if (!this.surface || !this.surfacePlanet) return;
    this.surface.scene.remove(this.player.group);
    this.scene.add(this.player.group);
    this.player.position.copy(this.spaceReturnPos);
    this.player.velocity.set(0, 0, 0);
    this.player.group.quaternion.identity();

    this.surface.dispose();
    this.surface = null;
    this.surfaceComposer?.dispose();
    this.surfaceComposer = null;
    this.surfaceEffects = null;
    const name = this.surfacePlanet.def.name;
    this.surfacePlanet = null;
    this.mode = 'space';

    this.hud.setSurfaceMode(false);
    this.hud.showBanner('ORBIT ACHIEVED', 2.2);
    this.hud.showComms(`Leaving ${name}. Sector operations resume — the wave is where you left it.`, 5);
    this.camera.position.copy(this.player.position).add(new THREE.Vector3(0, 8, 24));
  }

  private updateSurface(dt: number): void {
    if (!this.surface || !this.surfaceEffects) return;
    this.time += dt;

    // planet physics: gravity competes with thrust inside the flight model;
    // the atmosphere drags, Jovian storms shove
    const phys = this.surface.physics;
    const gEff = phys.gravity * GRAV_MULT;
    this.player.update(dt, this.input, 1e9, gEff); // space boundary doesn't apply here
    this.sfx.setHum(this.player.throttle, this.player.boosting);
    this.player.velocity.multiplyScalar(Math.max(0, 1 - phys.drag * dt));
    if (phys.wind > 0) {
      const gust = Math.sin(this.time * 0.13) * Math.PI * 2;
      this.player.velocity.x += Math.cos(gust) * phys.wind * dt;
      this.player.velocity.z += Math.sin(gust) * phys.wind * dt;
    }

    // pilot keeps pushing up but the planet wins → point them at the afterburner
    if (!this.escapeHintShown && this.player.alive) {
      const wantsUp = (this.input.isDown('KeyW') || this.input.vThrust) && this.player.forward.y > 0.25;
      if (wantsUp && !this.player.boosting && this.player.velocity.y < 4) {
        this.escapeHintTimer += dt;
        if (this.escapeHintTimer > 2.2) {
          this.escapeHintShown = true;
          this.hud.showComms('⚠ GRAVITY EXCEEDS MAIN DRIVE OUTPUT — engage AFTERBURNER [SHIFT] to climb.', 5);
        }
      } else {
        this.escapeHintTimer = 0;
      }
    }

    const p = this.player.position;

    // soft horizontal bound — keep the ship over the generated terrain
    const rXZ = Math.hypot(p.x, p.z);
    if (rXZ > 1050) {
      const inward = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      this.player.velocity.addScaledVector(inward, (rXZ - 1050) * 1.2 * dt + 14 * dt);
    }

    // terrain / fluid collision: glide along, never crash
    const floor = this.surface.floorAt(p.x, p.z);
    if (p.y < floor + 5) {
      p.y = floor + 5;
      if (this.player.velocity.y < 0) this.player.velocity.y *= -0.25;
    }

    // crystals
    for (const c of this.surface.crystals) {
      if (c.taken) continue;
      if (c.mesh.position.distanceTo(p) < 10) {
        c.taken = true;
        c.mesh.visible = false;
        this.crystalsCollected++;
        this.score += 75;
        this.sfx.pickup();
        this.surfaceEffects.sparks(c.mesh.position, 0xffe14d, 14);
        const total = this.surface.crystals.length;
        if (this.crystalsCollected === total) {
          this.score += 400;
          this.hud.showComms(`All ${total} crystals recovered! +400 bonus.`, 4);
        } else {
          this.hud.showComms(`Energy crystal secured (${this.crystalsCollected}/${total}) +75`, 2);
        }
      }
    }

    // engine exhaust
    if (this.player.throttle > 0.25) {
      const n = this.player.getEnginePositions(this.enginePosBuf);
      const back = this.player.forward.multiplyScalar(8 + this.player.throttle * 14);
      for (let i = 0; i < n; i++) {
        if (Math.random() < this.player.throttle * 0.9) {
          this.surfaceEffects.emitTrail(this.enginePosBuf[i], back, this.player.boosting ? 0x99d8ff : 0x2a9ec4, 0.4);
        }
      }
    }

    this.surface.update(dt, this.time, p);
    this.surfaceEffects.update(dt);

    // climb out to leave
    const altitude = p.y - floor;
    if (p.y > this.surface.ceiling) {
      this.hud.showPlanetPrompt(`LEAVE ${this.surface.def.name}? [G] → OUTER SPACE`);
      if (this.input.wasPressed('KeyG')) {
        this.exitPlanet();
        return;
      }
    } else {
      this.hud.hidePlanetPrompt();
    }

    this.hud.updateSurface(dt, this.player, altitude, this.crystalsCollected, this.surface.crystals.length);
  }

  // --------------------------------------------------------------- planets

  private updatePlanets(): void {
    for (const planet of this.env.planets) {
      if (planet.visited) continue;
      if (planet.position.distanceTo(this.player.position) < planet.visitRadius) {
        planet.visited = true;
        this.score += 500;
        this.player.heal(40);
        this.sfx.pickup();
        this.hud.showBanner(`${planet.def.name} SURVEYED\n+500`, 2.6);
        this.hud.showComms(`SURVEY: ${planet.def.flavor} Field repairs complete (+40 hull).`, 6);
      }
    }
  }

  // ----------------------------------------------------------------- waves

  private updateWaves(dt: number): void {
    if (this.sectorCleared) return;
    const aliveCount = this.enemies.filter((e) => e.alive).length;
    if (this.waveActive && aliveCount === 0) {
      this.waveActive = false;
      const bonus = 200 + this.wave * 50;
      this.score += bonus;
      if (this.wave >= this.sector.waves) {
        this.clearSector();
        return;
      }
      this.intermission = 5;
      this.hud.showBanner(`WAVE ${this.wave} CLEARED\n+${bonus} BONUS`, 2.8);
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

    const sector = this.sector;
    const isBossWave = sector.boss && n === sector.waves;
    const encounter: EncounterKind = isBossWave
      ? 'standard'
      : sector.encounters[Math.floor(Math.random() * sector.encounters.length)];

    this.hud.showBanner(encounter === 'ambush' ? `WAVE ${n} — AMBUSH` : `WAVE ${n}`, 2);

    // budget spend across weighted tiers
    let budget = 2 + this.sectorIndex * 2 + n * 2 + this.loop * 3;
    if (encounter === 'minefield') budget = Math.ceil(budget * 0.6);

    const spawnTier = (def: TierDef, near?: THREE.Vector3, dist?: [number, number]) => {
      const range: [number, number] = dist ?? (encounter === 'ambush' ? [130, 200] : [320, 600]);
      const dir = new THREE.Vector3().randomDirection();
      dir.y *= 0.4;
      dir.normalize();
      const d = range[0] + Math.random() * (range[1] - range[0]);
      const pos = (near ?? this.player.position).clone().addScaledVector(dir, d);
      if (pos.length() > this.env.worldRadius * 0.9) pos.setLength(this.env.worldRadius * 0.75);
      this.spawnEnemy(def, pos);
    };

    if (encounter === 'convoy') {
      // heavy flagship with escorts in a cluster
      const flagship = this.sectorIndex >= 2 ? TIERS[3] : TIERS[2];
      const anchor = this.player.position.clone().addScaledVector(
        new THREE.Vector3().randomDirection().setY(0).normalize(), 520);
      spawnTier(flagship, anchor, [0, 40]);
      const escorts = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < escorts; i++) spawnTier(TIERS[1], anchor, [30, 90]);
      budget = Math.max(0, budget - 10);
      this.hud.showComms('COMMAND: Convoy detected. Take out the flagship.', 4);
    }

    while (budget > 0) {
      const weights = sector.tierWeights;
      let total = 0;
      for (let t = 0; t < weights.length; t++) {
        if (t + 1 <= budget) total += weights[t];
      }
      if (total <= 0) break;
      let roll = Math.random() * total;
      let tier = 1;
      for (let t = 0; t < weights.length; t++) {
        if (t + 1 > budget) continue;
        roll -= weights[t];
        if (roll <= 0) {
          tier = t + 1;
          break;
        }
      }
      budget -= tier;
      spawnTier(TIERS[tier - 1]);
    }

    // specials
    for (const sp of sector.specials) {
      if (Math.random() < sp.chance) {
        const count = 1 + Math.floor(Math.random() * sp.count);
        for (let i = 0; i < count; i++) spawnTier(SPECIALS[sp.kind]);
        if (sp.kind === 'kamikaze') this.hud.showComms('⚠ PROXIMITY ALERT: Scarab bombers inbound!', 3.5);
        if (sp.kind === 'stealth') this.hud.showComms('⚠ SENSOR GHOSTS: Cloaked contacts in the area.', 3.5);
        if (sp.kind === 'support') this.hud.showComms('TACTICAL: Warden support ship detected — prioritize it.', 3.5);
      }
    }

    if (encounter === 'minefield') {
      const count = 10 + Math.floor(Math.random() * 8);
      for (let i = 0; i < count; i++) {
        const dir = new THREE.Vector3().randomDirection();
        const pos = this.player.position.clone().addScaledVector(dir, 160 + Math.random() * 240);
        this.mines.push(new Mine(pos, this.scene));
      }
      this.hud.showComms('⚠ MINEFIELD: Proximity charges seeded through this area.', 4);
    }

    if (isBossWave) {
      spawnTier(TIERS[4], this.player.position, [500, 650]);
      this.hud.showComms('COMMAND: ⚠ DREADNOUGHT EMERGING. GOOD LUCK, PILOT.', 5);
    } else if (this.wave === 1) {
      this.hud.showComms(`COMMAND: ${this.sector.subtitle}.`, 4.5);
    }
  }

  private spawnEnemy(def: TierDef, position: THREE.Vector3): void {
    this.enemies.push(new Enemy(def, position, this.scene, this.difficultyMult));
  }

  // --------------------------------------------------------------- sectors

  private loadSector(index: number): void {
    this.sectorIndex = index;
    this.env.build(this.sector);
    this.dust.setColor(this.sector.dustColor);
    this.gatePos = null;
    this.sectorCleared = false;
    this.wave = 0;
    this.waveActive = false;
    this.intermission = 4;
    this.navIndex = -1;
    this.rebuildNavTargets();
    this.hud.setSector(index, this.sector.name + (this.loop > 0 ? ` +${this.loop}` : ''));
  }

  private clearSector(): void {
    this.sectorCleared = true;
    const bonus = 1000 + this.sectorIndex * 500;
    this.score += bonus;
    this.gatePos = this.env.spawnGate(this.player.position);
    this.rebuildNavTargets();
    this.navIndex = this.navTargets.length - 1; // auto-point at the gate
    this.hud.showBanner(`SECTOR SECURED\n+${bonus}`, 3.2);
    this.hud.showComms('COMMAND: Sector clear. Jump gate deployed — fly into it when ready. Unvisited planets still hold survey bonuses.', 7);
  }

  private checkGateEntry(): void {
    if (!this.gatePos || !this.player.alive || this.state !== 'playing') return;
    if (this.player.position.distanceTo(this.gatePos) < 30) {
      this.beginWarp();
    }
  }

  private beginWarp(): void {
    this.state = 'warping';
    this.warpTimer = 1.5;
    this.hud.setWarpFlash(true);
    this.sfx.railgun(); // doubles as a decent jump-charge sound
    this.music.setIntensity(0);
  }

  private updateWarp(dt: number): void {
    this.time += dt;
    this.warpTimer -= dt;
    // launch the ship "through" the gate with streaks
    this.player.velocity.setLength(Math.min(400, this.player.velocity.length() + 600 * dt + 40));
    this.player.position.addScaledVector(this.player.velocity, dt);
    const back = this.player.forward.multiplyScalar(-60);
    for (let i = 0; i < 6; i++) {
      const offset = new THREE.Vector3().randomDirection().multiplyScalar(6);
      this.effects.emitTrail(this.player.position.clone().add(offset), back, 0xbfdfff, 0.4);
    }
    this.effects.update(dt);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 108, 1 - Math.exp(-3 * dt));
    this.camera.updateProjectionMatrix();

    if (this.warpTimer <= 0) {
      const next = (this.sectorIndex + 1) % SECTORS.length;
      if (next === 0) {
        this.loop++;
        this.hud.showComms(`COMMAND: You cleared the entire front! Threat level rising — difficulty x${(1 + this.loop * 0.4).toFixed(1)}.`, 6);
      }
      // reset combat state for the new sector
      for (const e of this.enemies) e.dispose(this.scene);
      this.enemies.length = 0;
      for (const m of this.mines) m.dispose(this.scene);
      this.mines.length = 0;
      for (const p of this.pickups) this.scene.remove(p.mesh);
      this.pickups.length = 0;
      this.weapons.clearAll();
      this.targeting.target = null;

      this.player.position.set(0, 0, 0);
      this.player.velocity.set(0, 0, 0);
      this.player.shield = this.player.maxShield;

      this.loadSector(next);
      this.state = 'playing';
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
      this.hud.setWarpFlash(false);
      this.hud.showBanner(`SECTOR ${this.sectorIndex + 1}\n${this.sector.name}`, 3.2);
    }
  }

  // ------------------------------------------------------------- destroyed

  private handleEnemyDestroyed(enemy: Enemy): void {
    this.score += Math.round(enemy.def.score * this.difficultyMult);
    const scale = 0.7 + enemy.def.tier * 0.45;
    this.effects.explosion(enemy.position, scale);
    this.sfx.explosion(enemy.def.tier >= 4);
    enemy.group.visible = false;

    if (enemy.def.tier === 5) {
      this.hud.showComms('COMMAND: Dreadnought destroyed. Outstanding flying, pilot!', 4);
    }
    if (enemy.def.behavior === 'support') {
      this.hud.showComms('TACTICAL: Warden down — hostiles lost their repair support.', 3);
    }

    if (enemy.def.tier >= 2 && Math.random() < 0.3) {
      const mesh = new THREE.Mesh(this.pickupGeo, this.pickupMat);
      mesh.position.copy(enemy.position);
      this.scene.add(mesh);
      this.pickups.push({ mesh, life: 25 });
    }
  }

  private detonateMine(mine: Mine): void {
    if (!mine.alive) return;
    mine.alive = false;
    this.effects.explosion(mine.position, 1.6, 0xff6633);
    this.sfx.explosion(false);
    if (this.player.alive) {
      const d = mine.position.distanceTo(this.player.position);
      if (d < 42) {
        this.player.takeDamage(mine.damage * (1 - d / 48));
        this.sfx.playerHit();
        this.effects.shake(0.9);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = mine.position.distanceTo(e.position);
      if (d < 40) {
        const res = e.takeDamage(50 * (1 - d / 48), 1, 1);
        if (res.destroyed) this.handleEnemyDestroyed(e);
      }
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.rotation.x += dt * 1.3;

      const d = p.mesh.position.distanceTo(this.player.position);
      if (d < 30) {
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
    this.music.setIntensity(0);
    const best = Number(localStorage.getItem(BEST_KEY) ?? '0');
    if (this.score > best) localStorage.setItem(BEST_KEY, String(this.score));
    this.hud.showGameOver(this.score, this.sectorIndex + 1 + this.loop * SECTORS.length, Math.max(best, this.score));
  }

  // ----------------------------------------------------------------- render

  private render(dt: number): void {
    const camDist = 13.5 + this.player.radius * 0.8;
    const desired = new THREE.Vector3(0, 3.6, camDist).applyQuaternion(this.player.group.quaternion).add(this.player.position);
    const stiffness = 1 - Math.exp(-7 * dt);
    this.camera.position.lerp(desired, this.state === 'playing' || this.state === 'warping' ? stiffness : 1);

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

    if (this.state !== 'warping') {
      const speed = this.player.velocity.length();
      const targetFov = this.player.boosting && speed > 50 ? 82 : 70;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
      this.camera.updateProjectionMatrix();
    }

    if (this.mode === 'surface' && this.surfaceComposer) {
      this.surfaceComposer.render();
    } else {
      this.composer.render();
    }
  }
}
