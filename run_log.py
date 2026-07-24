"""Local-only run-log telemetry. Stdlib only. Appends one JSON line per completed
model run/attempt to run_log.jsonl at the repo root. Never transmitted anywhere.

Disable with BENCH_NO_LOG=1.
"""
import datetime, json, os, sys

_DISCLOSED = False


def _log_path():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "run_log.jsonl")


def log_run(**fields):
    if os.environ.get("BENCH_NO_LOG") == "1":
        return
    global _DISCLOSED
    if not _DISCLOSED:
        print("[run_log] Appending run telemetry to ./run_log.jsonl (model, tokens, cost, latency) "
              "- LOCAL ONLY, nothing is transmitted. Set BENCH_NO_LOG=1 to disable.", file=sys.stderr)
        _DISCLOSED = True
    fields.setdefault("ts", datetime.datetime.now(datetime.timezone.utc).isoformat())
    with open(_log_path(), "a", encoding="utf-8") as f:
        f.write(json.dumps(fields, ensure_ascii=False) + "\n")
