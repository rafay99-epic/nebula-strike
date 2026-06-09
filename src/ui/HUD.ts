import * as THREE from 'three';
import type { PlayerShip } from '../entities/PlayerShip';
import type { Enemy } from '../entities/Enemy';
import type { TargetingSystem } from '../systems/Targeting';
import type { WeaponSystem } from '../combat/Weapons';
import { WEAPONS } from '../combat/Weapons';

const LOCK_RING_CIRC = 276.5;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export class HUD {
  private bracket = el<HTMLDivElement>('target-bracket');
  private lockRing = document.getElementById('lock-ring') as unknown as SVGCircleElement;
  private lockLabel = el<HTMLDivElement>('lock-label');
  private leadReticle = el<HTMLDivElement>('lead-reticle');
  private targetPanel = el<HTMLDivElement>('target-panel');
  private tpName = el<HTMLDivElement>('tp-name');
  private tpTier = el<HTMLDivElement>('tp-tier');
  private tpDist = el<HTMLDivElement>('tp-dist');
  private tpShield = el<HTMLDivElement>('tp-shield');
  private tpHull = el<HTMLDivElement>('tp-hull');
  private barHull = el<HTMLDivElement>('bar-hull');
  private barShield = el<HTMLDivElement>('bar-shield');
  private barEnergy = el<HTMLDivElement>('bar-energy');
  private valHull = el<HTMLSpanElement>('val-hull');
  private valShield = el<HTMLSpanElement>('val-shield');
  private valEnergy = el<HTMLSpanElement>('val-energy');
  private valSpeed = el<HTMLSpanElement>('val-speed');
  private waveNum = el<HTMLDivElement>('wave-num');
  private hostiles = el<HTMLDivElement>('hostiles');
  private scoreEl = el<HTMLDivElement>('score');
  private comms = el<HTMLDivElement>('comms');
  private banner = el<HTMLDivElement>('banner');
  private boundaryWarning = el<HTMLDivElement>('boundary-warning');
  private damageVignette = el<HTMLDivElement>('damage-vignette');
  private radar = el<HTMLCanvasElement>('radar');
  private radarCtx = this.radar.getContext('2d')!;
  private helpPanel = el<HTMLDivElement>('help');
  private pauseOverlay = el<HTMLDivElement>('pause-overlay');
  private gameoverOverlay = el<HTMLDivElement>('gameover-overlay');
  private goScore = el<HTMLDivElement>('go-score');
  private wslots: HTMLDivElement[] = [0, 1, 2, 3].map((i) => el<HTMLDivElement>(`wslot-${i}`));

  private commsTimer = 0;
  private bannerTimer = 0;
  private damageFlash = 0;
  private projected = new THREE.Vector3();

  constructor() {
    el<HTMLButtonElement>('go-restart').addEventListener('click', () => window.location.reload());
  }

  toggleHelp(): void {
    this.helpPanel.classList.toggle('hidden');
  }

  setPaused(paused: boolean): void {
    this.pauseOverlay.classList.toggle('hidden', !paused);
  }

  showGameOver(score: number, wave: number): void {
    this.goScore.textContent = `FINAL SCORE ${score} — REACHED WAVE ${wave}`;
    this.gameoverOverlay.classList.remove('hidden');
  }

  showComms(message: string, duration = 4): void {
    this.comms.textContent = message;
    this.comms.style.opacity = '1';
    this.commsTimer = duration;
  }

  showBanner(message: string, duration = 2.6): void {
    this.banner.textContent = message;
    this.banner.classList.remove('hidden');
    this.bannerTimer = duration;
  }

  flashDamage(): void {
    this.damageFlash = 1;
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    player: PlayerShip,
    enemies: Enemy[],
    targeting: TargetingSystem,
    weapons: WeaponSystem,
    wave: number,
    score: number,
    nearBoundary: boolean
  ): void {
    // --- status bars ---
    this.barHull.style.width = `${(player.hull / player.maxHull) * 100}%`;
    this.barHull.classList.toggle('low', player.hull < 35);
    this.barShield.style.width = `${(player.shield / player.maxShield) * 100}%`;
    this.barEnergy.style.width = `${(player.energy / player.maxEnergy) * 100}%`;
    this.valHull.textContent = `${Math.ceil(player.hull)}`;
    this.valShield.textContent = `${Math.ceil(player.shield)}`;
    this.valEnergy.textContent = `${Math.floor(player.energy)}`;
    this.valSpeed.textContent = `${Math.round(player.velocity.length())}`;

    // --- weapons ---
    for (let i = 0; i < this.wslots.length; i++) {
      this.wslots[i].classList.toggle('active', weapons.current === i);
      const cool = this.wslots[i].querySelector<HTMLDivElement>('.wcool')!;
      cool.style.width = `${weapons.cooldownFraction(i) * 100}%`;
    }

    // --- wave / score ---
    this.waveNum.textContent = `WAVE ${wave}`;
    this.hostiles.textContent = `HOSTILES: ${enemies.filter((e) => e.alive).length}`;
    this.scoreEl.textContent = `SCORE ${score}`;

    // --- target bracket / lock ring / panel ---
    const target = targeting.target;
    if (target && target.alive) {
      this.projected.copy(target.position).project(camera);
      const behind = this.projected.z > 1;
      if (!behind && Math.abs(this.projected.x) < 1.15 && Math.abs(this.projected.y) < 1.15) {
        const x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;
        // bracket scales loosely with apparent size
        const dist = target.position.distanceTo(player.position);
        const size = THREE.MathUtils.clamp(target.def.radius * 2200 / dist, 46, 170);
        this.bracket.style.opacity = '1';
        this.bracket.style.left = `${x}px`;
        this.bracket.style.top = `${y}px`;
        this.bracket.style.width = `${size}px`;
        this.bracket.style.height = `${size}px`;
        this.bracket.classList.toggle('locked', targeting.isLocked);
        this.lockRing.style.strokeDashoffset = `${LOCK_RING_CIRC * (1 - targeting.lockProgress)}`;
        this.lockLabel.textContent = targeting.isLocked
          ? 'LOCKED'
          : targeting.lockProgress > 0.02 ? `LOCKING ${Math.floor(targeting.lockProgress * 100)}%` : 'SCANNING';

        // lead reticle: where to shoot with the current weapon to hit the moving target
        const def = weapons.currentDef;
        if (def.speed > 0 && target.estVelocity.lengthSq() > 1) {
          const t = dist / def.speed;
          const lead = target.position.clone().addScaledVector(target.estVelocity, t).project(camera);
          if (lead.z < 1) {
            this.leadReticle.style.opacity = '0.85';
            this.leadReticle.style.left = `${(lead.x * 0.5 + 0.5) * window.innerWidth}px`;
            this.leadReticle.style.top = `${(-lead.y * 0.5 + 0.5) * window.innerHeight}px`;
          } else {
            this.leadReticle.style.opacity = '0';
          }
        } else {
          this.leadReticle.style.opacity = '0';
        }
      } else {
        this.bracket.style.opacity = '0';
        this.leadReticle.style.opacity = '0';
      }

      this.targetPanel.classList.remove('hidden');
      this.tpName.textContent = target.def.name;
      this.tpTier.textContent = `THREAT TIER ${target.def.tier} / 5`;
      this.tpDist.textContent = `RANGE ${Math.round(target.position.distanceTo(player.position))} m`;
      this.tpShield.style.width = `${target.def.shield > 0 ? (target.shield / target.def.shield) * 100 : 0}%`;
      this.tpHull.style.width = `${(Math.max(0, target.hull) / target.def.hull) * 100}%`;
    } else {
      this.bracket.style.opacity = '0';
      this.leadReticle.style.opacity = '0';
      this.targetPanel.classList.add('hidden');
    }

    // --- boundary warning ---
    this.boundaryWarning.classList.toggle('hidden', !nearBoundary);

    // --- damage vignette decay ---
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.damageVignette.style.boxShadow = `inset 0 0 140px rgba(255, 30, 40, ${this.damageFlash * 0.55})`;

    // --- comms fade ---
    if (this.commsTimer > 0) {
      this.commsTimer -= dt;
      if (this.commsTimer <= 0) this.comms.style.opacity = '0';
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }

    this.drawRadar(player, enemies);
  }

  private drawRadar(player: PlayerShip, enemies: Enemy[]): void {
    const ctx = this.radarCtx;
    const w = this.radar.width;
    const c = w / 2;
    const range = 700;
    ctx.clearRect(0, 0, w, w);

    // rings + sweep
    ctx.strokeStyle = 'rgba(77,232,255,0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 0.98]) {
      ctx.beginPath();
      ctx.arc(c, c, c * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, 0); ctx.lineTo(c, w);
    ctx.moveTo(0, c); ctx.lineTo(w, c);
    ctx.strokeStyle = 'rgba(77,232,255,0.12)';
    ctx.stroke();

    // player heading basis (projected to XZ)
    const fwd = player.forward;
    const heading = Math.atan2(fwd.x, -fwd.z);
    const cos = Math.cos(-heading);
    const sin = Math.sin(-heading);

    for (const e of enemies) {
      if (!e.alive) continue;
      const rel = e.position.clone().sub(player.position);
      const rx = rel.x * cos - rel.z * sin;
      const rz = rel.x * sin + rel.z * cos;
      const d = Math.hypot(rx, rz);
      if (d > range) continue;
      const px = c + (rx / range) * c * 0.95;
      const py = c + (rz / range) * c * 0.95;
      const colors = ['#ffc24d', '#ff5533', '#dd44ff', '#57ff9a', '#ff2244'];
      ctx.fillStyle = colors[e.def.tier - 1] ?? '#fff';
      const dotSize = 1.5 + e.def.tier * 0.7;
      ctx.beginPath();
      ctx.arc(px, py, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // player marker
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, c - 5);
    ctx.lineTo(c - 4, c + 4);
    ctx.lineTo(c + 4, c + 4);
    ctx.closePath();
    ctx.fill();
  }
}
