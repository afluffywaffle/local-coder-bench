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
  throw new Error("not implemented");
}

/**
 * Does a `mins`-minute interval comfortably exceed a measured run duration?
 * Used by calibrate-on-enable: if a probe scan takes longer than the chosen
 * interval, we refuse to arm rather than guarantee back-to-back runs.
 */
export function intervalFitsRun(durationMs: number, mins: number): boolean {
  throw new Error("not implemented");
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
  constructor(private cb: AutoSyncCallbacks) {}

  /** Set the interval (sanitized) and (re)start the timer. Returns the value actually applied. */
  set(mins: number): number {
    throw new Error("not implemented");
  }

  get interval(): number {
    throw new Error("not implemented");
  }

  /** Call when ANY sync starts (manual or scheduled) so overrun timing is measured. */
  markStarted(): void {
    throw new Error("not implemented");
  }

  /** Call when a sync finishes. Drives overrun detection + the circuit breaker. */
  finished(): void {
    throw new Error("not implemented");
  }

  /** Stop the schedule entirely (off). */
  stop(): void {
    throw new Error("not implemented");
  }
}
