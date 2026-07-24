#!/usr/bin/env python3
"""
Iterate-loop coding benchmark harness.

Round 0 generates a module from its PROSE SPEC (no tests shown). Each later round
feeds the prior code + an Option-A failure report (failing test name + expected/got
only, NOT the test source) and asks for a corrected full module. Up to --rounds fix
rounds; stops early on a perfect score. Grades by running that fixture's vitest suite.

Runners:
  --runner mlx         local MLX model (loaded once, all fixtures)
  --runner openrouter  cloud model via OpenRouter (per-call, cost-tracked)

Usage:
  python3 iterate.py --runner mlx --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit \
      --fixtures autoSync,parseQuery,mergeRanges,retryWithBackoff,normalizePath
  python3 iterate.py --runner openrouter --model anthropic/claude-haiku-4.5 \
      --fixtures autoSync,retryWithBackoff
"""
import argparse, io, json, os, re, subprocess, sys, time, urllib.request, urllib.error, contextlib

from run_log import log_run

W = os.path.dirname(os.path.abspath(__file__))

# fixture name -> total tests in its suite (for early-stop + convergence)
FIXTURES = {
    "autoSync":         12,
    "parseQuery":       12,
    "mergeRanges":      12,
    "retryWithBackoff":  9,
    "normalizePath":    12,
}

MAX_TOKENS = 4000
COST_CEILING_PER_FIXTURE = 0.50   # abort a cloud fixture if it exceeds this
TRANSIENT = {429, 500, 502, 503}


# ----------------------------------------------------------------------------- helpers
def spec_path(fx):    return f"{W}/{fx}_spec.txt"
def test_path(fx):    return f"{W}/{fx}.test.ts"
def module_path(fx):  return f"{W}/{fx}.ts"
def original_path(fx): return f"{W}/{fx}.ORIGINAL.ts"

def read(p): return open(p).read()

def extract_code(text):
    m = re.search(r"```(?:ts|typescript)?\s*\n(.*?)```", text, re.S)
    return (m.group(1) if m else text).strip() + "\n"


def _clean(s):
    """Strip control chars (except normal whitespace) from model-derived text
    before it hits our terminal — a hostile candidate's exception/failure text
    could otherwise smuggle ANSI/terminal-control sequences."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(s))


# --- security guardrail -------------------------------------------------------
# Every fixture is a PURE-LOGIC module (functions/classes over their own inputs).
# A correct solution NEVER needs the filesystem, network, subprocess, process,
# env, timers-as-IO, eval, or dynamic import. So any candidate that reaches for
# those is hallucinating or hostile -> we REFUSE to execute it (block before it
# ever reaches vitest). This is defense-in-depth alongside the Docker sandbox.
DANGEROUS = [
    (r"""\b(require|import)\s*\(\s*['"](node:)?(fs|child_process|net|http|https|dns|dgram|tls|os|process|vm|worker_threads|cluster|v8|inspector|module|repl|perf_hooks|readline|zlib)(/[A-Za-z0-9_-]+)*['"]""",
     "node builtin import (fs/net/child_process/os/vm/…)"),
    (r"""\bfrom\s+['"](node:)?(fs|child_process|net|http|https|dns|dgram|tls|os|process|vm|worker_threads|cluster|v8|inspector|module|repl|perf_hooks|readline|zlib)(/[A-Za-z0-9_-]+)*['"]""",
     "node builtin import (fs/net/child_process/os/vm/…)"),
    (r"\bimport\s*\(", "dynamic import()"),
    (r"\beval\s*\(", "eval()"),
    (r"\bnew\s+Function\s*\(|(?<![.\w])Function\s*\(", "Function() constructor"),
    (r"\bprocess\b", "process access (env/exit/binding)"),
    (r"\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource", "network client (fetch/XHR/WebSocket)"),
    (r"\b(Deno|Bun)\s*\.", "Deno/Bun runtime API"),
    (r"\bglobalThis\s*\[", "globalThis[...] dynamic access"),
    (r"child_process|execSync|spawnSync|\bexec\s*\(", "process execution"),
]

def scan_code(code):
    """Return a human-readable reason string if the candidate uses a forbidden
    API, else None. Conservative denylist; near-zero false positives on the
    pure-logic fixtures here."""
    import re as _re
    for pat, why in DANGEROUS:
        if _re.search(pat, code):
            return why
    return None


def grade(fx, code, scan=True):
    """Grade a candidate in a PER-PROCESS isolated dir so concurrent runs (and
    the local run using the root files) never clobber each other's module file.
    Copies the fixture's test beside the candidate; vitest resolves ./<fx> within
    the temp dir and node_modules upward from cwd=W. Returns (passed, total, report).

    SECURITY: unless scan=False, the candidate is statically screened first and
    BLOCKED (never executed) if it uses a forbidden API — the tasks are pure logic
    and legitimately never need one."""
    if scan:
        reason = scan_code(code)
        if reason:
            return 0, FIXTURES[fx], (
                f"BLOCKED (not executed) — forbidden API: {reason}. "
                f"This task is pure logic; it needs no imports, filesystem, network, "
                f"process/env, eval, or dynamic import. Rewrite using only plain "
                f"language constructs and the given inputs.")
    iso = f"{W}/.iso/{os.getpid()}_{fx}"
    os.makedirs(iso, exist_ok=True)
    open(f"{iso}/{fx}.ts", "w").write(code)
    # copy the test verbatim (its `import ... from './{fx}'` now resolves locally)
    open(f"{iso}/{fx}.test.ts", "w").write(read(test_path(fx)))
    outfile = f"{iso}/.result.json"
    passed, total, report = 0, FIXTURES[fx], ""
    try:
        try:
            # SECURITY: pass a scrubbed env — the vitest subprocess executes
            # candidate code, so it must NOT inherit OPENROUTER_API_KEY or any
            # other secret from our environment.
            safe_env = {
                "PATH": os.environ.get("PATH", ""),
                "HOME": os.environ.get("HOME", ""),
            }
            subprocess.run(
                ["npx", "vitest", "run", f"{iso}/{fx}.test.ts",
                 "--reporter=json", f"--outputFile={outfile}"],
                cwd=W, capture_output=True, text=True, timeout=180,
                env=safe_env,
            )
        except subprocess.TimeoutExpired:
            # infinite loop / hang in generated code: score 0 and keep going
            return 0, FIXTURES[fx], "TIMEOUT — test run exceeded 180s (likely an infinite loop)."
        try:
            j = json.load(open(outfile))
        except Exception:
            j = None
        if j:
            passed = j.get("numPassedTests", 0)
            total = j.get("numTotalTests") or FIXTURES[fx]
            report = _clean(failure_report(j))
        else:
            passed, report = 0, "Module failed to load or compile (0 tests ran)."
    finally:
        for f in (f"{iso}/{fx}.ts", f"{iso}/{fx}.test.ts", outfile):
            if os.path.exists(f):
                os.remove(f)
    return passed, total, report


def failure_report(j):
    """Option-A feedback: failing test name + trimmed expected/received only."""
    lines = []
    for tf in j.get("testResults", []):
        for a in tf.get("assertionResults", []):
            if a.get("status") == "failed":
                title = " > ".join(a.get("ancestorTitles", []) + [a.get("title", "")])
                msg = "\n".join(a.get("failureMessages", []))
                # keep only the expected/received/AssertionError lines, trimmed
                keep = []
                for ln in msg.splitlines():
                    s = ln.strip()
                    if re.search(r"(AssertionError|Expected|Received|expected|to (be|equal|contain))", s):
                        keep.append("    " + s)
                    if len(keep) >= 4:
                        break
                lines.append(f"  ✗ {title}\n" + "\n".join(keep))
    return "\n".join(lines) if lines else "(no per-test detail available)"


def fix_prompt(fx, prev_code, report):
    return (
        f"Your previous implementation of `{fx}.ts` failed some tests.\n\n"
        f"Your previous code:\n```ts\n{prev_code}```\n\n"
        f"The test runner reported these failures (failing test name + expected vs "
        f"received only — the test source is not shown):\n\n{report}\n\n"
        f"Fix the code so ALL tests pass. Keep every export name, signature, and type "
        f"identical. Return ONLY the full corrected contents of `{fx}.ts` in a single "
        f"```ts code block — no prose."
    )


# ----------------------------------------------------------------------------- runners
class MLXRunner:
    def __init__(self, model_id):
        from mlx_lm import load, generate
        self._generate = generate
        print(f"[{time.strftime('%H:%M:%S')}] loading {model_id} ...", flush=True)
        t0 = time.time()
        self.model, self.tok = load(model_id)
        print(f"  loaded in {time.time()-t0:.1f}s", flush=True)

    def __call__(self, prompt):
        msgs = [{"role": "user", "content": prompt}]
        p = self.tok.apply_chat_template(msgs, add_generation_prompt=True)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            text = self._generate(self.model, self.tok, prompt=p,
                                  max_tokens=MAX_TOKENS, verbose=True)
        stats = buf.getvalue()
        def num(pat):
            r = re.search(pat, stats)
            return float(r.group(1)) if r else None
        meta = {
            "gen_tps": num(r"Generation:.*?([\d.]+) tokens-per-sec"),
            "prompt_tps": num(r"Prompt:.*?([\d.]+) tokens-per-sec"),
            "peak_gb": num(r"Peak memory: ([\d.]+) GB"),
        }
        return text, meta


class OpenRouterRunner:
    def __init__(self, model_id):
        self.model = model_id
        self.key = load_key()

    def __call__(self, prompt):
        body = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": MAX_TOKENS,
            "usage": {"include": True},
        }).encode()
        last = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions", data=body,
                    headers={"Authorization": f"Bearer {self.key}",
                             "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    resp = json.load(r)
                text = (resp["choices"][0]["message"].get("content") or "")
                if not text.strip():          # empty-content guard (reasoning burn)
                    last = "empty content"
                    time.sleep(4 * (attempt + 1)); continue
                usage = resp.get("usage", {}) or {}
                return text, {"cost": usage.get("cost"),
                              "prompt_tokens": usage.get("prompt_tokens"),
                              "completion_tokens": usage.get("completion_tokens")}
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}"
                if e.code in TRANSIENT:
                    time.sleep(6 * (attempt + 1)); continue
                raise
            except Exception as e:
                last = str(e)
                time.sleep(6 * (attempt + 1))
        raise RuntimeError(f"openrouter failed after retries: {last}")


def load_key():
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"].strip()
    for p in ("~/.config/openrouter.key", "~/.claude/tools/.openrouter_key"):
        p = os.path.expanduser(p)
        if os.path.exists(p):
            return read(p).strip()
    raise RuntimeError("no OpenRouter key (env OPENROUTER_API_KEY or ~/.config/openrouter.key)")


# ----------------------------------------------------------------------------- loop
def run_fixture(runner, fx, rounds, is_cloud, save_dir=None, model_id=None):
    total = FIXTURES[fx]
    scores, metas = [], []
    fixture_cost = 0.0
    prev_code, report = None, None

    for rnd in range(rounds + 1):
        if rnd == 0:
            prompt = read(spec_path(fx))
        else:
            prompt = fix_prompt(fx, prev_code, report)
        t0 = time.time()
        try:
            text, meta = runner(prompt)
        except Exception as e:
            print(f"    round {rnd}: GEN ERROR {_clean(e)}", flush=True)
            log_run(bench="coder", model=model_id, runner=("cloud" if is_cloud else "local"),
                    prompt_tokens=None, completion_tokens=None, total_tokens=None,
                    cost_usd=None, latency_s=round(time.time() - t0, 3), images=None,
                    peak_ram_gb=None,
                    extra={"fixture": fx, "converged": False, "rounds": rnd})
            return {"fixture": fx, "error": _clean(e), "scores": scores,
                    "total": total, "cost": round(fixture_cost, 4)}
        latency_s = time.time() - t0

        code = extract_code(text)
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
            open(f"{save_dir}/{fx}_r{rnd}.ts", "w").write(code)
        passed, total, report = grade(fx, code)
        scores.append(passed)
        if is_cloud and meta.get("cost"):
            fixture_cost += meta["cost"]
        metas.append({k: v for k, v in meta.items() if v is not None})
        tag = f"${meta.get('cost')}" if is_cloud else f"{meta.get('gen_tps')} tok/s"
        print(f"    round {rnd}: {passed}/{total}  ({tag})", flush=True)

        prompt_tokens = meta.get("prompt_tokens")
        completion_tokens = meta.get("completion_tokens")
        total_tokens = (prompt_tokens + completion_tokens
                        if prompt_tokens is not None and completion_tokens is not None else None)
        log_run(bench="coder", model=model_id, runner=("cloud" if is_cloud else "local"),
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                total_tokens=total_tokens, cost_usd=(meta.get("cost") if is_cloud else None),
                latency_s=round(latency_s, 3), images=None,
                peak_ram_gb=(meta.get("peak_gb") if not is_cloud else None),
                extra={"fixture": fx, "converged": passed >= total, "rounds": rnd})

        if passed >= total:
            break
        if is_cloud and fixture_cost > COST_CEILING_PER_FIXTURE:
            print(f"    ABORT {fx}: cost ${fixture_cost:.3f} exceeded ceiling", flush=True)
            break
        prev_code = code

    converged = scores and scores[-1] >= total
    regressions = sum(1 for i in range(1, len(scores)) if scores[i] < scores[i-1])
    return {
        "fixture": fx, "total": total, "scores": scores,
        "converged": converged,
        "rounds_to_pass": (scores.index(total) if converged else None),
        "regressions": regressions,
        "metas": metas,
        "cost": round(fixture_cost, 4) if is_cloud else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runner", required=True, choices=["mlx", "openrouter"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--fixtures", required=True,
                    help="comma list, or 'all'")
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--tag", default=None, help="output file tag; default = model basename")
    ap.add_argument("--save-code", action="store_true",
                    help="persist each round's generated module to outputs/<tag>/")
    args = ap.parse_args()

    fxs = list(FIXTURES) if args.fixtures == "all" else args.fixtures.split(",")
    for fx in fxs:
        if fx not in FIXTURES:
            sys.exit(f"unknown fixture: {fx}")

    is_cloud = args.runner == "openrouter"
    runner = OpenRouterRunner(args.model) if is_cloud else MLXRunner(args.model)
    tag = args.tag or args.model.split("/")[-1]
    # sanitize before use in output paths: model ids (or a hostile --tag) must
    # never carry '/', '..', or other path-control chars into a filename.
    tag = re.sub(r"[^a-z0-9-]+", "-", tag.lower()).strip("-") or "model"

    print(f"\n===== ITERATE  {args.model}  ({args.runner})  rounds<={args.rounds} =====", flush=True)
    results = []
    save_dir = f"{W}/outputs/{tag}" if args.save_code else None
    for fx in fxs:
        print(f"\n[{fx}]", flush=True)
        results.append(run_fixture(runner, fx, args.rounds, is_cloud, save_dir, model_id=args.model))

    out = {"model": args.model, "runner": args.runner, "rounds_cap": args.rounds,
           "results": results}
    outpath = f"{W}/results_iterate_{tag}.json"
    json.dump(out, open(outpath, "w"), indent=2)

    print(f"\n===== SUMMARY  {tag} =====")
    for r in results:
        if "error" in r and not r.get("scores"):
            print(f"  {r['fixture']:18s} ERROR: {r['error']}")
        else:
            conv = "OK" if r.get("converged") else "--"
            rp = r.get("rounds_to_pass")
            print(f"  {r['fixture']:18s} {r['scores']}  conv={conv}"
                  f" r2p={rp} regr={r.get('regressions')}"
                  + (f" ${r.get('cost')}" if is_cloud else ""))
    if is_cloud:
        tot = sum((r.get("cost") or 0) for r in results)
        print(f"  TOTAL CLOUD SPEND: ${tot:.4f}")
    print(f"  -> {outpath}")


if __name__ == "__main__":
    main()
