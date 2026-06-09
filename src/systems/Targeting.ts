import * as THREE from 'three';
import type { Enemy } from '../entities/Enemy';
import type { PlayerShip } from '../entities/PlayerShip';
import type { Sfx } from '../core/Sfx';

const ACQUIRE_CONE = THREE.MathUtils.degToRad(28);
const DROP_CONE = THREE.MathUtils.degToRad(42);
const LOCK_CONE = THREE.MathUtils.degToRad(15);
const MAX_RANGE = 950;

/**
 * Soft lock-on targeting: a target is acquired inside the acquire cone,
 * and lock *stability* builds only while the player keeps the nose on it.
 * Bigger ships lock faster; full lock enables missile homing.
 */
export class TargetingSystem {
  target: Enemy | null = null;
  lockProgress = 0;
  private wasLocked = false;
  private tickTimer = 0;
  private sfx: Sfx;

  constructor(sfx: Sfx) {
    this.sfx = sfx;
  }

  get isLocked(): boolean {
    return this.lockProgress >= 1 && !!this.target;
  }

  update(dt: number, player: PlayerShip, enemies: Enemy[]): void {
    const fwd = player.forward;
    const pos = player.position;

    // validate current target
    if (this.target && (!this.target.alive || !this.inCone(this.target, pos, fwd, DROP_CONE, MAX_RANGE * 1.15))) {
      this.target = null;
      this.lockProgress = 0;
    }

    // acquire best candidate if none
    if (!this.target) {
      this.target = this.bestCandidate(pos, fwd, enemies);
      this.lockProgress = 0;
      this.wasLocked = false;
    }

    // build / decay lock stability
    if (this.target) {
      const lockTime = 0.6 + 1.4 / Math.sqrt(this.target.def.radius); // big ships lock faster
      if (this.inCone(this.target, pos, fwd, LOCK_CONE, MAX_RANGE)) {
        this.lockProgress = Math.min(1, this.lockProgress + dt / lockTime);
        this.tickTimer -= dt;
        if (this.lockProgress < 1 && this.tickTimer <= 0) {
          this.tickTimer = 0.25;
          this.sfx.lockTick();
        }
      } else {
        this.lockProgress = Math.max(0, this.lockProgress - dt * 0.55);
      }
      if (this.isLocked && !this.wasLocked) {
        this.sfx.lockOn();
        this.wasLocked = true;
      }
      if (!this.isLocked) this.wasLocked = false;
    }
  }

  /** Cycle to the next candidate (T key). */
  cycle(player: PlayerShip, enemies: Enemy[]): void {
    const fwd = player.forward;
    const pos = player.position;
    const candidates = enemies
      .filter((e) => e.alive && this.inCone(e, pos, fwd, ACQUIRE_CONE * 1.6, MAX_RANGE))
      .sort((a, b) => this.angleTo(a, pos, fwd) - this.angleTo(b, pos, fwd));
    if (candidates.length === 0) return;
    const idx = this.target ? candidates.indexOf(this.target) : -1;
    this.target = candidates[(idx + 1) % candidates.length];
    this.lockProgress = 0;
    this.wasLocked = false;
  }

  private bestCandidate(pos: THREE.Vector3, fwd: THREE.Vector3, enemies: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = e.position.clone().sub(pos);
      const dist = to.length();
      if (dist > MAX_RANGE) continue;
      const angle = to.normalize().angleTo(fwd);
      if (angle > ACQUIRE_CONE) continue;
      // mostly aim-angle, slightly distance, slight bias toward dangerous tiers
      const score = angle * 3 + dist / MAX_RANGE - e.def.tier * 0.04;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private inCone(e: Enemy, pos: THREE.Vector3, fwd: THREE.Vector3, cone: number, range: number): boolean {
    const to = e.position.clone().sub(pos);
    const dist = to.length();
    if (dist > range) return false;
    return to.normalize().angleTo(fwd) < cone;
  }

  private angleTo(e: Enemy, pos: THREE.Vector3, fwd: THREE.Vector3): number {
    return e.position.clone().sub(pos).normalize().angleTo(fwd);
  }
}
