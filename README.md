# local-coder-bench

> ## ⚠️ Read this first — this tool executes untrusted code
>
> This harness **runs code that an LLM generates, on your machine**. Every round, whatever a model returns is written to a `.ts` file and executed by `npx vitest`, which imports and runs it with your user privileges. That is unavoidable for a *generate-code-then-run-its-tests* benchmark — it is also the entire risk. If you point it at an untrusted or compromised model/endpoint, treat its output as hostile: it could read files, use the network, or exfiltrate secrets at import time.
>
> **Run it sandboxed.** A [Dockerfile](Dockerfile) is included that does this by default — untrusted generations execute in a throwaway, unprivileged container with **no access to your host filesystem or credentials**. See **[Security & sandboxing](#security--sandboxing)** below for the exact command. Do **not** run the native (non-Docker) commands on a machine holding credentials or data you care about.
>
> The harness code itself has no shell/`eval` injection surface and commits no secrets — the danger is solely the generated code it deliberately runs.

**Can a small *local* LLM do useful delegated coding on a memory-constrained Mac — if you wrap it in a test-feedback loop?**

A tiny, reproducible harness to answer that for *your own machine and models*. It runs a set of self-contained TypeScript coding tasks through any model (local via [MLX](https://github.com/ml-explore/mlx-lm), or cloud via [OpenRouter](https://openrouter.ai)) in an **iterate loop**: generate from a prose spec, run a hidden test suite, feed back only the failures, regenerate — up to N rounds. It scores convergence per round, so you can see not just *"did it pass"* but *"did the loop rescue it, or did it plateau/oscillate."*

Built to be re-run cheaply whenever new models drop. If you're trying to figure out what actually fits and works on your box, fork it and point it at your candidates.

---

## Security & sandboxing

The harness executes untrusted model output (see the banner above). **The recommended way to run it is inside the included Docker sandbox**, which contains the cloud (OpenRouter) runner in a throwaway, unprivileged, host-isolated container:

```bash
docker build -t local-coder-bench .

# no host filesystem mounted, non-root, no added capabilities, no privilege escalation.
# the generated code runs here and CANNOT touch your host or its files.
docker run --rm \
  --cap-drop ALL --security-opt no-new-privileges \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  local-coder-bench --runner openrouter \
  --model qwen/qwen3-coder-30b-a3b-instruct --fixtures all --rounds 4
```

The score matrix prints to stdout. To pull result JSON out afterwards, drop `--rm`, give it `--name run1`, then `docker cp run1:/bench/results_iterate_<tag>.json .`.

Notes and honest limits of this sandbox:
- The container still has **network** (it must call the OpenRouter API), so generated code *could* reach the network. What it can't do is read your host filesystem, your `~/.config` keys, or anything outside the container. The only secret inside is the `OPENROUTER_API_KEY` you pass in — so **use a dedicated, rotatable key**, not a shared one.
- **Local MLX runs cannot be containerized on Apple Silicon** (MLX needs Metal, which Docker Desktop doesn't pass through). To sandbox a *local* run, use a throwaway VM instead. On a machine you trust, the native local command below plus `memguard.py` is the pragmatic path — but it is *not* a security sandbox.
- This Dockerfile was written but **not test-built in the authoring environment** (no Docker there); it's a standard `node:22-slim` + `python3` + `vitest` image and the cloud path uses only Python stdlib, but treat the first `docker build` as yours to confirm.

**Built-in guardrail (defense in depth).** Independent of Docker, the harness statically screens every candidate *before* running it and **refuses to execute** any code that reaches for a forbidden API — node builtins (`fs`, `net`, `child_process`, `os`, `vm`, …), `process.*`, `fetch`/`WebSocket`, `eval`, `Function()`, dynamic `import()`, or `Deno`/`Bun`. The fixtures are pure logic, so a correct solution never needs these; anything that does is hallucinated or hostile and is scored `0` with a `BLOCKED` note instead of being run. This catches the obvious exfiltration/destruction patterns even outside a sandbox (verified: `fs` read, network+key exfil, `rm -rf`, `eval`, and dynamic import are all blocked; clean solutions run untouched). It is a denylist, not a proof of safety — the Docker sandbox is still the real boundary.

The native commands in [Run it](#run-it) are **not sandboxed** by the OS — but the guardrail above still applies. Use them only on a machine you're willing to expose to the code your chosen model writes.

---

## The question, and why the loop matters

Handing a small model a raw failing test file tends to tank it. Handing it a **clear prose spec** lifts it a lot. So round 0 here starts from the spec (no tests shown), and each later round gets an **Option-A failure report** — *failing test name + expected-vs-received only, never the test source* — mirroring how an orchestrator (a bigger model, or you) would really drive a local executor: run the tests, relay the failures, ask for a fix.

The metric is **score-by-round**. A model that goes `7 → 9 → 12` is *usable with a loop*. One that sits at `2, 2, 2, 2, 2` or wobbles `11 → 10 → 11` is not — the feedback isn't landing.

---

## Reading the matrix

The harness prints a MODEL × fixture matrix. **No results ship with this repo — you run it on your own machine and models and produce your own.** (Bundling one author's numbers would only anchor yours; a benchmark is meant to be re-run, not quoted.)

The format looks like this — **illustrative placeholders, not real data**:

Legend: `N/T` = final pass/total, no convergence; `✓rK` = converged after K fix-rounds (`r0` = solved straight from the spec, `≥r1` = **the loop fixed it**). `loopΔ` = fixtures the loop rescued.

```
MODEL                  autoSync parseQuery mergeRanges retryWithB normalizeP  conv loopΔ    $
model-a (local)         11/12      2/12     12/12✓      0/9       11/12        1/5   0
model-b (local)         10/12      3/12     12/12✓      9/9✓r1    12/12✓r1     3/5   2
model-c (cloud)         12/12✓    12/12✓    12/12✓      9/9✓      12/12✓       5/5   0  $0.0xx
```
`–` = not run. A row that climbs across rounds (`7 → 9 → 12`) is *usable with a loop*; one stuck at `2, 2, 2` is not.

**Columns:**
- **MODEL** — the model tested, labelled `(local)` (run on-device via MLX) or a cloud model (via OpenRouter). Cheapest→priciest cloud tiers run top→bottom.
- **autoSync / parseQuery / mergeRanges / retryWithBackoff / normalizePath** — the five fixtures (one coding task each; described under [Layout](#layout)). Each cell is that model's result on that task, using the `N/T` · `✓rK` notation above — e.g. `9/9✓r1` = reached all 9 tests after 1 feedback round, `2/12` = plateaued at 2 of 12.
- **conv** — convergence count: how many of the 5 fixtures the model got *fully passing* (whether at round 0 or via the loop). The headline "how much did it solve" number.
- **loopΔ** — of those, how many were **rescued by the iterate loop** (converged at round ≥1, i.e. failed the spec alone but the test-feedback fixed it). This is the "usable *with a loop*" signal — `0` means the loop never helped, either because the model already solved it at round 0 (cloud rows) or because feedback didn't land (7B, DeepSeek-Lite).
- **$** — total OpenRouter spend for that model across its fixtures (blank for free local runs).

**What it says:**

1. **The loop is unreliable below ~14B.** The 7B and DeepSeek-Lite got **zero** loop-driven rescues — scores stayed flat or oscillated (the 7B's normalizePath even regressed `11 → 10 → 11`). Only the **14B** used the feedback productively (2 rescues).
2. **~30B is the local floor where it works.** `qwen3-coder-30b-a3b` (a 30B MoE, 3B active) solved **4/5 straight from the spec** — including tasks the 14B needed the loop for or failed outright — at **$0.004** total. Async/fake-timer logic and stateful schedulers are the hardest for small models; pure algorithms and edge-case string functions are within reach.
3. **Every frontier cloud tier solved everything at round 0.** The discriminating signal lives entirely in the local models; the cloud rows are just calibration.
4. **RAM reality on 18 GB (measured, not guessed):** even the **3-bit** (~12 GB) MLX quant of the 30B **could not load** on an 18 GB Mac — MLX's load transient briefly holds the safetensors in file cache *and* the allocated weights, spiking to ~20–24 GB and driving free RAM to **0.03 GB**. A watchdog (`memguard.py`) killed it before the machine swapped into a lockup. **Conclusion: 18 GB is under-spec to host a 30B-class coder; you need ~24–32 GB+ unified.** The 30B-is-viable finding holds — *on a bigger box.*

### What the code actually looks like

Scores alone hide whether the output is real. See [`outputs/qwen3-coder-30b-a3b/`](outputs/qwen3-coder-30b-a3b/) for verbatim generations. `normalizePath_r0.ts` is a clean, correct, first-try solve. The `autoSync_*` files show the one task the 30B *couldn't* crack, and the miss is instructive: its circuit-breaker fires but reports `pause:0` instead of `pause:1` — it reads the interval *after* `stop()` has already zeroed it, instead of capturing it first. The logic is 95% right; it flubs one statement-ordering subtlety the loop never recovered.

---

## Honest limitations (read before trusting this)

- **Synthetic fixtures, not your codebase.** These are self-contained modules with clean test oracles. A pass here is evidence a model *can* implement-to-spec; it is **not** proof it adds value on your real, context-heavy tasks. Treat this as a capability floor, not a workflow verdict.
- **`min_model` is a proxy.** Convergence on toy tasks correlates with, but doesn't equal, real delegated usefulness.
- **Numbers are machine-specific.** tok/s, RAM headroom, and what-fits are all yours to re-measure. That's the whole point of shipping the harness, not just the table.
- **The cloud tiers ace everything**, so this benchmark does not discriminate among frontier models — it's aimed squarely at the *small/local* end.

---

## Layout

```
iterate.py            # the harness: round-0-from-spec → N feedback rounds; mlx + openrouter runners
matrix.py             # consolidate results_iterate_*.json → the matrix above
memguard.py           # RAM watchdog: SIGKILL a run if free memory collapses (protects the machine)
run_local_3bit.sh     # example: guarded local run (waits for a download, runs under memguard)
<fixture>.STUB.ts     # signatures + doc comment (what the model starts from, API-wise)
<fixture>_spec.txt    # the prose spec (round-0 prompt; "return ONLY the module")
<fixture>.test.ts     # the hidden vitest suite (the oracle; never shown to the model)
<fixture>.ORIGINAL.ts # a reference implementation (cp to <fixture>.ts to verify the suite is sound)
results_iterate_*.json# raw per-model, per-round results — GENERATED when you run it (gitignored, not shipped)
outputs/              # verbatim model generations — GENERATED locally (gitignored, not shipped)
```

> Results and generations are **not** committed — you produce your own by running the harness.
> Only the machinery + the five fixtures ship, so nobody's numbers anchor yours.

Five fixtures span skill types: **autoSync** (stateful scheduler / fake timers / circuit breaker), **parseQuery** (parsing, dup-keys, decoding, malformed input), **mergeRanges** (interval algorithm), **retryWithBackoff** (async, exponential backoff, abort signal), **normalizePath** (edge-heavy pure function).

---

## Run it

> **These native commands are not sandboxed** — they execute model-generated code directly on your machine. For untrusted models use the [Docker sandbox](#security--sandboxing) instead. Run these only on a machine you're willing to expose.

Requires Node + `npx vitest` (`npm i -D vitest`), Python 3, and for local runs `pip install mlx-lm` (Apple Silicon). Cloud runs read an OpenRouter key from `$OPENROUTER_API_KEY` or `~/.config/openrouter.key`.

```bash
# verify a fixture's suite is sound (should print 12/12)
cp mergeRanges.ORIGINAL.ts mergeRanges.ts && npx vitest run mergeRanges.test.ts

# local model, all fixtures, up to 4 fix rounds
python3 iterate.py --runner mlx \
  --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit \
  --fixtures all --rounds 4

# cloud model, two fixtures, save what it actually writes
python3 iterate.py --runner openrouter \
  --model qwen/qwen3-coder-30b-a3b-instruct \
  --fixtures autoSync,normalizePath --rounds 4 --save-code

# guard a tight-on-RAM local run so it can't lock up the machine
python3 iterate.py --runner mlx --model <big-model> --fixtures normalizePath &
python3 memguard.py $! 1.2      # kill if free RAM < 1.2 GB (3 consecutive samples)

# rebuild the matrix from all result files
python3 matrix.py
```

Each run writes `results_iterate_<tag>.json`. Grading is isolated per-process (`.iso/<pid>_<fixture>`), so you can run several models concurrently without them clobbering each other's module file.

## Local run log (private telemetry)

The harness appends one JSON line per completed model run/attempt to `run_log.jsonl` at the
repo root — model, token usage, cost, latency, and per-fixture convergence info. It's written
**LOCALLY ONLY** and is **never transmitted anywhere**; you own the file. It's gitignored, so
it never gets committed. Disable it with `BENCH_NO_LOG=1`.

**Verify it's local-only** — the logger is deliberately tiny and auditable:

1. **Read the source.** `run_log.py` is stdlib-only (`json/os/sys/time`); its only I/O is
   `open(<repo>/run_log.jsonl, "a")` — a local append, no HTTP/socket import, no network call:
   `grep -nE "requests|urllib|http|socket|fetch|post|telemetry|analytics" run_log.py` → no matches.
2. **Inspect the artifact.** `cat run_log.jsonl` — plain JSONL, nothing hidden.
3. **Watch the network.** Under Little Snitch / `lsof -i` / `sudo tcpdump`, run a fixture and
   confirm the only outbound traffic is to the OpenRouter endpoint you configured; the logger
   and `npx vitest` (local subprocess) open no connections of their own.
4. **Prove it offline.** With networking off the log line still lands — disk-only by construction.
5. **Turn it off.** `BENCH_NO_LOG=1`, or delete the file.

Honest boundary: the harness calls whatever provider you configure (cloud runs); the run log
adds **no** new network destination — it only writes locally.

### Adding a fixture

Drop in four files — `<name>.STUB.ts`, `<name>_spec.txt`, `<name>.test.ts`, `<name>.ORIGINAL.ts` — add `<name>: <test_count>` to the `FIXTURES` dict in `iterate.py`, and verify the reference passes (`cp <name>.ORIGINAL.ts <name>.ts && npx vitest run <name>.test.ts`).

---

## Provenance

This harness, the fixtures, their prose specs and hidden test suites, the runs, and this README were **built by an AI agent (Claude Opus 4.8, in a Claude Code session) directed by a human** who set the goal, made the calls, and reviewed the output. Commits carry `Co-Authored-By: Claude` trailers.

Worth stating plainly because it cuts two ways: the fixtures' edge cases reflect *one model's* idea of what's tricky, so the oracle may over- or under-weight failure modes a human author would have chosen differently — read the tests before drawing strong conclusions. And every generation was graded by an automated suite, not by a human reading the code, so "passed" means "satisfied these assertions," nothing more.

---

*Cloud spend for the entire benchmark (all controls, every tier): **~$0.30**. Local runs are free.*
