#!/bin/bash
# Wait for the 3-bit model, then run ONE fixture locally under the memory guard.
cd ~/Develop/local_coder_bench
echo "[launcher] waiting for download..."
until grep -q DONE dl_3bit.log 2>/dev/null; do sleep 5; done
echo "[launcher] model ready. starting local run."

# start iterate on a single fast fixture; capture its pid for the guard
python3 iterate.py --runner mlx \
  --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-3bit \
  --fixtures normalizePath --rounds 4 --tag qwen3coder30b-3bit-local \
  > run_3bit_local.log 2>&1 &
PID=$!
echo "[launcher] iterate pid $PID"

# watchdog: kill the run if free RAM collapses (floor 1.2GB, 3 low samples)
python3 memguard.py $PID 1.2 >> run_3bit_local.log 2>&1 &
GUARD=$!

wait $PID
echo "[launcher] iterate exited $?"
kill $GUARD 2>/dev/null
echo "[launcher] DONE"
