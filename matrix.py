#!/usr/bin/env python3
"""Consolidate results_iterate_*.json into one matrix + readout."""
import glob, json, os

W = os.path.dirname(os.path.abspath(__file__))
FIX = ["autoSync", "parseQuery", "mergeRanges", "retryWithBackoff", "normalizePath"]
# display order: local first, then cloud tiers
ORDER = [
    "Qwen2.5-Coder-7B-Instruct-4bit", "Qwen2.5-Coder-14B-Instruct-4bit",
    "DeepSeek-Coder-V2-Lite-Instruct-4bit-mlx", "qwen3-coder-30b-a3b-instruct",
    "claude-haiku-4.5", "gpt-5.6-luna", "claude-sonnet-5", "gpt-5.6-terra",
    "claude-opus-4.8", "gpt-5.6-sol",
]

runs = {}
for p in glob.glob(f"{W}/results_iterate_*.json"):
    d = json.load(open(p))
    tag = os.path.basename(p)[len("results_iterate_"):-len(".json")]
    runs[tag] = d

def cell(r):
    """Render one fixture cell: final/total + how it got there."""
    if r is None:
        return "–"  # not run (fixture cap)
    if "error" in r and not r.get("scores"):
        return "ERR"
    sc = r["scores"]; tot = r["total"]
    fin = sc[-1]
    if r.get("converged"):
        rp = r.get("rounds_to_pass")
        # rp can legitimately be 0 (passed in round 0) — test for None, not falsy
        return f"{fin}/{tot}✓r{rp}" if rp is not None else f"{fin}/{tot}✓"
    return f"{fin}/{tot}"  # best/last, no convergence

rows = []
for tag in ORDER + [t for t in runs if t not in ORDER]:
    if tag not in runs:
        continue
    d = runs[tag]
    byfx = {r["fixture"]: r for r in d["results"]}
    cells = [cell(byfx.get(fx)) for fx in FIX]
    conv = sum(1 for fx in FIX if byfx.get(fx) and byfx[fx].get("converged"))
    loopwins = sum(1 for fx in FIX if byfx.get(fx) and byfx[fx].get("converged")
                   and (byfx[fx].get("rounds_to_pass") or 0) >= 1)
    cost = sum((byfx[fx].get("cost") or 0) for fx in FIX if byfx.get(fx))
    rows.append((tag, cells, conv, loopwins, cost, d.get("runner")))

w = max(len(t) for t, *_ in rows)
hdr = "MODEL".ljust(w) + "  " + "  ".join(f"{fx[:11]:>11s}" for fx in FIX) + "   conv loopΔ  $"
print(hdr); print("-" * len(hdr))
for tag, cells, conv, loop, cost, runner in rows:
    line = tag.ljust(w) + "  " + "  ".join(f"{c:>11s}" for c in cells)
    line += f"   {conv}/5   {loop}"
    if runner == "openrouter":
        line += f"   ${cost:.3f}"
    print(line)

print("\nLegend: N/T = final pass/total (no convergence);  ✓rK = converged, K fix-rounds used"
      " (r0 = solved from spec, ≥r1 = the iterate LOOP fixed it).  loopΔ = # fixtures the loop rescued.")
tot_cloud = sum(cost for _, _, _, _, cost, runner in rows if runner == "openrouter")
print(f"Total cloud spend: ${tot_cloud:.4f}")
