"""Compare JS and C++ renders:  python3 compare.py <dir> <name>..."""
import sys
import numpy as np

d = sys.argv[1]
ok = True
for name in sys.argv[2:]:
    a = np.fromfile(f"{d}/{name}.js.f32", dtype=np.float32).reshape(-1, 2).astype(np.float64)
    b = np.fromfile(f"{d}/{name}.cpp.f32", dtype=np.float32).reshape(-1, 2).astype(np.float64)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    rms = np.sqrt(np.mean(a ** 2))
    err = np.abs(a - b)
    sr = 48000
    print(f"[{name}] frames={n} rms={rms:.4f} peak={np.abs(a).max():.4f}")
    for t0 in np.arange(0, n / sr, 0.5):
        s, e = int(t0 * sr), int(min(n, (t0 + 0.5) * sr))
        seg_rms = np.sqrt(np.mean(a[s:e] ** 2)) + 1e-12
        print(f"   {t0:3.1f}-{t0+0.5:3.1f}s  max|diff|={err[s:e].max():.2e}  rel-rms-err={np.sqrt(np.mean((a[s:e]-b[s:e])**2))/seg_rms:.2e}")
    if err.max() > 1e-3:
        ok = False
print("MATCH" if ok else "DIFFERENCES ABOVE 1e-3")
