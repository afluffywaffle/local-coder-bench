// Pure auto-sync scheduler — no DOM, no Tauri, no file access.
// Extracted from App.svelte so the timing/safety logic is unit-testable.
//
// Guarantees:
//  - ticks are dropped (never queued) while a sync is in flight  → no pileup
//  - intervals are floored to MIN_INTERVAL                       → no silly values
//  - skipped ticks and overruns are surfaced via callbacks       → visible
//  - N consecutive overruns auto-pause the schedule              → walk-away safety

export const MIN_INTERVAL = 1; // minutes
export const MAX_OVERRUNS = 3; // consecutive overruns before auto-pause

/** Clamp a requested interval: 0 means off, anything else is floored to MIN_INTERVAL. */
export function sanitizeInterval(mins: number): number {
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  return Math.max(MIN_INTERVAL, Math.floor(mins));
}

/**
 * Does a `mins`-minute interval comfortably exceed a measured run duration?
 * Used by calibrate-on-enable: if a probe scan takes longer than the chosen
 * interval, we refuse to arm rather than guarantee back-to-back runs.
 */
export function intervalFitsRun(durationMs: number, mins: number): boolean {
  return mins > 0 && durationMs < mins * 60_000;
}

export interface AutoSyncCallbacks {
  /** true while a sync (or connection test) is running — a tick is dropped if so. */
  isBusy: () => boolean;
  /** kick off a sync run. */
  startSync: () => void;
  /** a scheduled tick was dropped because a run was still in flight. */
  onSkip: () => void;
  /** a run finished; durationMs is how long it took. */
  onMeasured: (durationMs: number) => void;
  /** the circuit breaker tripped; the schedule has been turned off. mins = the interval that kept overrunning. */
  onPause: (mins: number) => void;
}

export class AutoSyncScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private runStartedAt: number | null = null;
  private intervalMins = 0;
  private overrunStreak = 0;

  constructor(private cb: AutoSyncCallbacks) {}

  /** Set the interval (sanitized) and (re)start the timer. Returns the value actually applied. */
  set(mins: number): number {
    this.intervalMins = sanitizeInterval(mins);
    this.restart();
    return this.intervalMins;
  }

  get interval(): number {
    return this.intervalMins;
  }

  /** Call when ANY sync starts (manual or scheduled) so overrun timing is measured. */
  markStarted(): void {
    this.runStartedAt = Date.now();
  }

  /** Call when a sync finishes. Drives overrun detection + the circuit breaker. */
  finished(): void {
    if (this.runStartedAt === null) return;
    const durationMs = Date.now() - this.runStartedAt;
    this.runStartedAt = null;
    this.cb.onMeasured(durationMs);

    if (this.intervalMins <= 0) return;
    if (durationMs > this.intervalMins * 60_000) {
      this.overrunStreak += 1;
      if (this.overrunStreak >= MAX_OVERRUNS) {
        const mins = this.intervalMins;
        this.stop();           // clears timer + resets interval to 0
        this.cb.onPause(mins);
      }
    } else {
      this.overrunStreak = 0;
    }
  }

  /** Stop the schedule entirely (off). */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.intervalMins = 0;
    this.overrunStreak = 0;
    this.runStartedAt = null;
  }

  private restart(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.overrunStreak = 0;
    if (this.intervalMins > 0) {
      this.timer = setInterval(() => this.tick(), this.intervalMins * 60_000);
    }
  }

  private tick(): void {
    if (this.cb.isBusy()) {
      this.cb.onSkip();
      return; // dropped, NOT queued
    }
    this.cb.startSync();
  }
}
