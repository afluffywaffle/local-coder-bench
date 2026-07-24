import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoSyncScheduler, sanitizeInterval, intervalFitsRun, MIN_INTERVAL, MAX_OVERRUNS } from "./autoSync";

const MIN = 60_000;

// A test harness that simulates the App: a sync takes `syncDurationMs` of
// virtual time, during which isBusy() is true. No files, no devices.
function makeHarness(syncDurationMs: number) {
  const events: string[] = [];
  let busy = false;
  let scheduler: AutoSyncScheduler;

  const runSync = () => {
    busy = true;
    scheduler.markStarted();
    events.push("start");
    // finish after the (virtual) duration
    setTimeout(() => {
      busy = false;
      events.push("finish");
      scheduler.finished();
    }, syncDurationMs);
  };

  scheduler = new AutoSyncScheduler({
    isBusy: () => busy,
    startSync: runSync,
    onSkip: () => events.push("skip"),
    onMeasured: (ms) => events.push(`measured:${ms}`),
    onPause: (mins) => events.push(`pause:${mins}`),
  });

  return { scheduler, events, runManual: runSync };
}

describe("sanitizeInterval", () => {
  it("0 and negatives mean off", () => {
    expect(sanitizeInterval(0)).toBe(0);
    expect(sanitizeInterval(-5)).toBe(0);
  });
  it("floors values below the minimum up to MIN_INTERVAL", () => {
    expect(sanitizeInterval(0.5)).toBe(MIN_INTERVAL);
  });
  it("floors fractional minutes and passes through valid ones", () => {
    expect(sanitizeInterval(10.9)).toBe(10);
    expect(sanitizeInterval(1)).toBe(1);
    expect(sanitizeInterval(60)).toBe(60);
  });
  it("rejects NaN/Infinity as off", () => {
    expect(sanitizeInterval(NaN)).toBe(0);
    expect(sanitizeInterval(Infinity)).toBe(0);
  });
});

describe("intervalFitsRun (calibrate-on-enable)", () => {
  it("arms when the run is comfortably under the interval", () => {
    expect(intervalFitsRun(30_000, 1)).toBe(true);   // 30s run, 1-min interval
    expect(intervalFitsRun(90_000, 5)).toBe(true);   // 90s run, 5-min interval
  });
  it("refuses when the run meets or exceeds the interval", () => {
    expect(intervalFitsRun(60_000, 1)).toBe(false);  // exactly at the limit
    expect(intervalFitsRun(95_000, 1)).toBe(false);  // over
  });
  it("is false for a disabled interval", () => {
    expect(intervalFitsRun(1_000, 0)).toBe(false);
  });
});

describe("AutoSyncScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("fires a sync each interval when runs finish quickly (no overrun)", () => {
    const h = makeHarness(2_000); // 2s sync, well under a 5-min interval
    h.scheduler.set(5);
    vi.advanceTimersByTime(5 * MIN);   // first tick → start
    vi.advanceTimersByTime(2_000);     // sync finishes
    vi.advanceTimersByTime(5 * MIN);   // second tick → start
    vi.advanceTimersByTime(2_000);
    const starts = h.events.filter((e) => e === "start").length;
    expect(starts).toBe(2);
    expect(h.events).not.toContain("skip");
    expect(h.events.some((e) => e.startsWith("pause"))).toBe(false);
  });

  it("DROPS ticks while busy instead of queuing them", () => {
    // 1-min interval, but each sync takes 3.5 min → ticks land mid-run.
    const h = makeHarness(3.5 * MIN);
    h.scheduler.set(1);
    // Advance 3 minutes: tick@1 starts a run; ticks@2 and @3 land while busy.
    vi.advanceTimersByTime(3 * MIN);
    const starts = h.events.filter((e) => e === "start").length;
    const skips = h.events.filter((e) => e === "skip").length;
    expect(starts).toBe(1);  // only ONE run, not three
    expect(skips).toBe(2);   // the two mid-run ticks were dropped, not queued
  });

  it("trips the circuit breaker after MAX_OVERRUNS consecutive overruns and turns off", () => {
    // Each sync (1.5 min) overruns the 1-min interval every time.
    const h = makeHarness(1.5 * MIN);
    h.scheduler.set(1);
    // Run long enough for several start→finish cycles.
    vi.advanceTimersByTime(20 * MIN);

    const pauses = h.events.filter((e) => e.startsWith("pause:"));
    expect(pauses.length).toBe(1);            // tripped exactly once
    expect(pauses[0]).toBe("pause:1");        // reports the offending interval
    expect(h.scheduler.interval).toBe(0);     // schedule is now OFF

    // After the breaker, exactly MAX_OVERRUNS runs should have completed.
    const finishes = h.events.filter((e) => e === "finish").length;
    expect(finishes).toBe(MAX_OVERRUNS);

    // And no further runs start once paused.
    const startsAtTrip = h.events.filter((e) => e === "start").length;
    vi.advanceTimersByTime(30 * MIN);
    const startsAfter = h.events.filter((e) => e === "start").length;
    expect(startsAfter).toBe(startsAtTrip);   // flat — nothing runs after pause
  });

  it("does NOT trip when overruns are not consecutive (streak resets)", () => {
    // Manually drive: two overruns, then a fast run, then two more overruns.
    // Streak should reset on the fast run, so the breaker never reaches 3-in-a-row.
    const events: string[] = [];
    let now = 0;
    vi.setSystemTime(0);
    const scheduler = new AutoSyncScheduler({
      isBusy: () => false,
      startSync: () => {},
      onSkip: () => events.push("skip"),
      onMeasured: (ms) => events.push(`m:${ms}`),
      onPause: (mins) => events.push(`pause:${mins}`),
    });
    scheduler.set(1); // 1-min interval = 60_000ms threshold

    const cycle = (durationMs: number) => {
      scheduler.markStarted();
      now += durationMs;
      vi.setSystemTime(now);
      scheduler.finished();
    };

    cycle(90_000);  // overrun 1
    cycle(90_000);  // overrun 2
    cycle(10_000);  // fast — resets streak
    cycle(90_000);  // overrun 1 again
    cycle(90_000);  // overrun 2 again

    expect(events.some((e) => e.startsWith("pause"))).toBe(false);
    expect(scheduler.interval).toBe(1); // still running
  });

  it("stop() halts the schedule with no further ticks", () => {
    const h = makeHarness(1_000);
    h.scheduler.set(5);
    h.scheduler.stop();
    vi.advanceTimersByTime(60 * MIN);
    expect(h.events.filter((e) => e === "start").length).toBe(0);
    expect(h.scheduler.interval).toBe(0);
  });
});
