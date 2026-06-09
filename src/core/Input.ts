export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  onFirstInteraction: (() => void) | null = null;
  private interacted = false;

  // virtual (touch) controls — analog axes and held buttons
  vPitch = 0;
  vYaw = 0;
  vThrust = false;
  vBrake = false;
  vBoost = false;
  vFire = false;

  /** Touch buttons inject one-shot presses through the same path as keys. */
  pressVirtual(code: string): void {
    this.pressed.add(code);
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.interacted) {
        this.interacted = true;
        this.onFirstInteraction?.();
      }
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('pointerdown', () => {
      if (!this.interacted) {
        this.interacted = true;
        this.onFirstInteraction?.();
      }
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call once at end of each frame to clear single-press events. */
  endFrame(): void {
    this.pressed.clear();
  }
}
