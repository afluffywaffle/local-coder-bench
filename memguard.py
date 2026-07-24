#!/usr/bin/env python3
"""Watchdog: kill a target process (by pid) if free RAM drops below a floor.
Prevents a too-big local model from swapping the whole machine into a lockup.
Usage: python3 memguard.py <pid> [floor_gb]"""
import subprocess, sys, time, os, signal

pid = int(sys.argv[1])
floor_gb = float(sys.argv[2]) if len(sys.argv) > 2 else 1.2
def _page_size():
    """Parse page size from vm_stat's header ("page size of N bytes").
    Apple Silicon uses 16384-byte pages; hardcoding 4096 undercounted free
    RAM 4x. Falls back to 4096 if unparseable."""
    try:
        out = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
        import re
        m = re.search(r"page size of (\d+) bytes", out)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 4096

PAGE = _page_size()

def free_gb():
    out = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    free = spec = 0
    for ln in out.splitlines():
        if "Pages free" in ln:            free = int(ln.split()[-1].rstrip("."))
        elif "Pages speculative" in ln:   spec = int(ln.split()[-1].rstrip("."))
    return (free + spec) * PAGE / 1073741824

def alive(p):
    try: os.kill(p, 0); return True
    except OSError: return False

print(f"[memguard] watching pid {pid}, floor {floor_gb}GB", flush=True)
low_streak = 0
while alive(pid):
    fg = free_gb()
    # also check swap-in activity as a thrash signal
    if fg < floor_gb:
        low_streak += 1
        print(f"[memguard] free {fg:.2f}GB < {floor_gb} (streak {low_streak})", flush=True)
        if low_streak >= 3:   # ~3 consecutive samples truly low -> kill
            print(f"[memguard] KILLING pid {pid} to protect the machine", flush=True)
            try: os.kill(pid, signal.SIGKILL)
            except OSError: pass
            break
    else:
        low_streak = 0
    time.sleep(2)
print("[memguard] done", flush=True)
