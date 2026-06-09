import type { Input } from '../core/Input';

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

/**
 * Mobile control layer: a floating virtual joystick on the left half of the
 * screen (pitch/yaw) and hold/tap buttons on the right. Writes into the
 * shared Input's virtual fields so the flight model treats touch and
 * keyboard identically.
 */
export class TouchControls {
  private input: Input;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private zone = document.getElementById('joy-zone') as HTMLDivElement;
  private base = document.getElementById('joy-base') as HTMLDivElement;
  private nub = document.getElementById('joy-nub') as HTMLDivElement;
  private static RADIUS = 52;

  constructor(input: Input) {
    this.input = input;
    document.getElementById('touch-ui')!.classList.remove('hidden');

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      this.joyId = e.pointerId;
      try {
        this.zone.setPointerCapture(e.pointerId);
      } catch {
        // pointer may already be released (fast taps) — tracking still works
      }
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('active');
      this.moveNub(0, 0);
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      const R = TouchControls.RADIUS;
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.moveNub(dx, dy);
      // stick right → yaw right (keyboard D = -1); stick up (dy<0) → nose up (+pitch)
      this.input.vYaw = -(dx / R);
      this.input.vPitch = -dy / R;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.base.classList.remove('active');
      this.input.vYaw = 0;
      this.input.vPitch = 0;
    };
    this.zone.addEventListener('pointerup', release);
    this.zone.addEventListener('pointercancel', release);

    // hold buttons
    this.bindHold('tb-fire', (v) => (this.input.vFire = v));
    this.bindHold('tb-thrust', (v) => (this.input.vThrust = v));
    this.bindHold('tb-boost', (v) => (this.input.vBoost = v));
    this.bindHold('tb-brake', (v) => (this.input.vBrake = v));

    // tap buttons → virtual key presses
    this.bindTap('tb-target', 'KeyT');
    this.bindTap('tb-nav', 'KeyN');
    this.bindTap('tb-action', 'KeyG');
    this.bindTap('tb-pause', 'KeyP');
    this.bindTap('tb-ship', 'KeyV');
  }

  private moveNub(dx: number, dy: number): void {
    this.nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private bindHold(id: string, set: (v: boolean) => void): void {
    const btn = document.getElementById(id)!;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('held');
      set(true);
    });
    const off = () => {
      btn.classList.remove('held');
      set(false);
    };
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  }

  private bindTap(id: string, code: string): void {
    const btn = document.getElementById(id)!;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.pressVirtual(code);
    });
  }
}
