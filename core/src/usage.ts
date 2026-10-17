/**
 * Counts foreground time and turns it into whole minutes for the daily limit.
 * Pure and clock-injected so the app can drive it from AppState and timers
 * and tests can drive it with fake times.
 *
 * - Time only accrues while active (app in the foreground with the chat open).
 * - Partial minutes carry over across background/foreground switches, so
 *   repeatedly opening the app for 40 s still adds up.
 * - Gaps longer than `maxGapMs` between ticks (device slept without a
 *   background event) are not counted.
 */
export class ActiveTimeTracker {
  private active = false;
  private lastAt = 0;
  private carryMs = 0;

  constructor(private readonly maxGapMs = 5 * 60_000) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Returns whole minutes completed up to `now` (credit them before switching). */
  setActive(active: boolean, now: number): number {
    const minutes = this.tick(now);
    this.active = active;
    this.lastAt = now;
    return minutes;
  }

  /** Call periodically; returns whole minutes newly completed since the last call. */
  tick(now: number): number {
    if (this.active) {
      const dt = now - this.lastAt;
      if (dt > 0 && dt <= this.maxGapMs) this.carryMs += dt;
    }
    this.lastAt = now;
    const minutes = Math.floor(this.carryMs / 60_000);
    this.carryMs -= minutes * 60_000;
    return minutes;
  }

  /** Milliseconds accrued toward the next minute (for tests/diagnostics). */
  get pendingMs(): number {
    return this.carryMs;
  }
}
