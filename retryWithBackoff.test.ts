import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff } from "./retryWithBackoff";

describe("retryWithBackoff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("resolves immediately on first success (no delay, one call)", async () => {
    const fn = vi.fn(async () => "ok");
    const p = retryWithBackoff(fn, { attempts: 3, baseMs: 100 });
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("retries after a backoff and resolves on the 2nd attempt", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n < 2) throw new Error("fail" + n);
      return "second";
    });
    const p = retryWithBackoff(fn, { attempts: 3, baseMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  it("does not fire the retry before the delay elapses", async () => {
    const fn = vi.fn(async () => { throw new Error("boom"); });
    const p = retryWithBackoff(fn, { attempts: 3, baseMs: 100 });
    p.catch(() => {}); // swallow eventual rejection
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1); // second attempt not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
  });

  it("exponential schedule: 100, 200, 400 before attempts 2,3,4", async () => {
    const fn = vi.fn(async () => { throw new Error("no"); });
    const p = retryWithBackoff(fn, { attempts: 4, baseMs: 100, factor: 2 });
    const rej = expect(p).rejects.toThrow("no");
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(fn).toHaveBeenCalledTimes(4);
    await rej;
  });

  it("rejects with the LAST error after exhausting attempts", async () => {
    let n = 0;
    const fn = vi.fn(async () => { n++; throw new Error("err" + n); });
    const p = retryWithBackoff(fn, { attempts: 3, baseMs: 10 });
    const rej = expect(p).rejects.toThrow("err3");
    await vi.advanceTimersByTimeAsync(1000);
    await rej;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("attempts=1 makes a single call and rejects immediately", async () => {
    const fn = vi.fn(async () => { throw new Error("once"); });
    const p = retryWithBackoff(fn, { attempts: 1, baseMs: 100 });
    await expect(p).rejects.toThrow("once");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("caps each delay at capMs", async () => {
    const fn = vi.fn(async () => { throw new Error("cap"); });
    const p = retryWithBackoff(fn, { attempts: 4, baseMs: 1000, factor: 10, capMs: 1500 });
    const rej = expect(p).rejects.toThrow("cap");
    // delays would be 1000, 10000, 100000 but are clamped to 1000, 1500, 1500
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn).toHaveBeenCalledTimes(4);
    await rej;
  });

  it("an already-aborted signal rejects without calling fn", async () => {
    const fn = vi.fn(async () => "never");
    const ctrl = new AbortController();
    ctrl.abort(new Error("stop"));
    const p = retryWithBackoff(fn, { attempts: 3, baseMs: 100, signal: ctrl.signal });
    await expect(p).rejects.toThrow("stop");
    expect(fn).not.toHaveBeenCalled();
  });

  it("aborting during a backoff wait cancels the next attempt", async () => {
    const fn = vi.fn(async () => { throw new Error("fail"); });
    const ctrl = new AbortController();
    const p = retryWithBackoff(fn, { attempts: 5, baseMs: 1000, signal: ctrl.signal });
    const rej = expect(p).rejects.toThrow("gone");
    expect(fn).toHaveBeenCalledTimes(1); // first attempt ran and failed
    await vi.advanceTimersByTimeAsync(500); // mid-wait
    ctrl.abort(new Error("gone"));
    await rej;
    expect(fn).toHaveBeenCalledTimes(1); // no second attempt
  });
});
