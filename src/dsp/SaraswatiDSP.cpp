/*  Saraswati-1 — DSP engine (C++ port of js/dsp.js). See SaraswatiDSP.h. */
#include "SaraswatiDSP.h"

#include <algorithm>
#include <cmath>

namespace saraswati
{

namespace
{
constexpr double PI = 3.14159265358979323846;
constexpr double TWO_PI = 2 * PI;
constexpr double LN2 = 0.69314718055994530942;
constexpr double SQRT2 = 1.41421356237309504880;
constexpr double SQRT1_2 = 0.70710678118654752440;
constexpr double LINE_MS = 23.22;          // Pd patch default smoothing
constexpr double PW = 0.53125;             // pulse width used by os.triangle~
constexpr double GLIDE_MS = 19;            // TIME random jumps always glide
constexpr double K_TIME = 12 * LN2 / 127;  // ms = 1.45125 * 2^(12 v / 127)
constexpr double TUNE_TABLE[8][2] = { { -16, 93 }, { -16, 93 }, { 7, 109 }, { 9, 107 }, { 20, 116.54 }, { 20, 116.54 }, { 33, 126.24 }, { 33, 131.22 } };

inline double mtof (double m) { return m <= -1500 ? 0 : 8.17579891564 * std::exp (0.0577622650 * std::min (m, 1499.0)); }
inline double dbtorms (double d) { return d <= 0 ? 0 : std::exp (0.11512925464970229 * (std::min (d, 485.0) - 100)); }
inline double pade (double x) { if (x > 3) x = 3; else if (x < -3) x = -3; const double x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
inline double clampc (double c) { return c < 0 ? 0 : c > 1 ? 1 : c; }
inline double jsRound (double x) { return std::floor (x + 0.5); }   // Math.round
inline double jsFrac (double x) { return x - std::floor (x); }
inline int iv (double v) { return (int) v; }                       // JS "v | 0" for the small ranges used here
} // namespace

//==============================================================================
int Engine::msToN (double ms) const { return std::max (1, (int) jsRound (ms * SR / 1000)); }

void Engine::rset (Ramps& r, int i, double tg, double ms) const
{
    const int n = msToN (ms); auto k = (size_t) i;
    r.t[k] = tg; r.inc[k] = (tg - r.v[k]) / n; r.c[k] = n;
}

void Engine::Biquad::set (bool lowpass, double f, double SR)
{
    f = std::min (std::max (f, 10.0), SR * 0.45);
    const double w = TWO_PI * f / SR, cs = std::cos (w), al = std::sin (w) / (2 * SQRT1_2), a0 = 1 + al;
    if (lowpass) { b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0; }
    else         { b0 = (1 + cs) / 2 / a0; b1 = -(1 + cs) / a0; b2 = b0; }
    a1 = -2 * cs / a0; a2 = (1 - al) / a0;
}

double Engine::random01() noexcept
{
    // xorshift64*
    rng ^= rng >> 12; rng ^= rng << 25; rng ^= rng >> 27;
    return (double) ((rng * 2685821657736338717ull) >> 11) * (1.0 / 9007199254740992.0);
}

//==============================================================================
Engine::Engine (double sampleRate, uint32_t seed)
    : SR (sampleRate), rng (0x9E3779B97F4A7C15ull ^ ((uint64_t) seed << 1 | 1))
{
    // voices
    freq.init (MAXT); mod.init (MAXT); hold.init (MAXT); env.init (MAXT);
    lfoG.init (MAXT * 4);
    t1.fill (1); t2.fill (1);
    soloG.init (MAXT, 1);
    // blocks
    sharp.init (MAXB); ring.init (MAXB);
    fast.fill (1); source.fill (1);
    // hyper LFOs
    fa.init (4); fb.init (4);
    // TIME controllers
    xSaw.init (2); xR.init (2);
    xIv[0] = xIv[1] = msToN (750);
    xLen[0] = xLen[1] = msToN (2539.5);
    glideN = msToN (GLIDE_MS);
    // delay
    dlen = (int) std::ceil (SR * 6.3) + 8;
    dbuf[0].assign ((size_t) dlen, 0.f); dbuf[1].assign ((size_t) dlen, 0.f);
    dTime.init (2, 64); dMod.init (2); dFb.init (1); dMix.init (1);
    cA = std::exp (-4.60517 / std::max (1.0, 2.5 * SR / 1000));   // compressor~ 2.5 ms
    cThr = dbtorms (100 - 12); cInvR = 1.0 / 5;
    xBuf[0].assign (512, 0.f); xBuf[1].assign (512, 0.f);
    xGain.init (2, 1);
    hann.assign (512, 0.f);
    double hs = 0;
    for (int i = 0; i < 512; ++i) { hann[(size_t) i] = (float) (0.5 - 0.5 * std::cos (TWO_PI * i / 512)); hs += hann[(size_t) i]; }
    hannSum = hs;
    // master
    drive.init (1, 2); dstMix.init (1, 0.5); vol.init (1, 1);
    setSoft (85);
    // reverb
    const double sc = SR / 44100;
    const int CT[8] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 }, AT[4] = { 556, 441, 341, 225 };
    for (int ch = 0; ch < 2; ++ch)
    {
        for (int c = 0; c < 8; ++c) combs[(size_t) ch][(size_t) c].b.assign ((size_t) jsRound ((CT[c] + ch * 23) * sc), 0.f);
        for (int c = 0; c < 4; ++c) aps[(size_t) ch][(size_t) c].b.assign ((size_t) jsRound ((AT[c] + ch * 23) * sc), 0.f);
    }
    preBuf.assign ((size_t) std::ceil (SR * 0.52) + 2, 0.f); preN = msToN (20);
    rvWet1.init (1); rvWet2.init (1); rvDry.init (1, 1);
    rvLp.set (true, 9000, SR); rvHp.set (false, 100, SR);
    // per-sample-rate constants (Pd hip~/lop~ coefficients, envelope followers)
    auto hipC = [this] (double hz) { return clampc (1 - hz * TWO_PI / SR); };
    auto lopC = [this] (double hz) { return clampc (hz * TWO_PI / SR); };
    coef.h3c = hipC (3); coef.h3n = 0.5 * (1 + coef.h3c);
    coef.h20c = hipC (20); coef.h20n = 0.5 * (1 + coef.h20c); coef.h10c = hipC (10); coef.h10n = 0.5 * (1 + coef.h10c);
    coef.h1c = hipC (1); coef.h1n = 0.5 * (1 + coef.h1c); coef.l4k = lopC (4000); coef.l689 = lopC (689);
    coef.cAtk = 1 - std::exp (-1 / (0.01 * SR)); coef.cRel = 1 - std::exp (-1 / (0.15 * SR)); coef.cDry = 1 - std::exp (-1 / (0.06 * SR));
    coef.sfAtk = 1 - std::exp (-1 / (0.002 * SR)); coef.sfRel = 1 - std::exp (-1 / (0.12 * SR));
    coef.sfGa = 1 - std::exp (-1 / (0.002 * SR)); coef.sfGr = 1 - std::exp (-1 / (0.09 * SR));
    // misc
    updateRev();
    setCount (8);
    for (int i = 0; i < MAXT; ++i) { lfoG.jump (i * 4 + ((i >> 1) % 4), 1); updateFreq (i, true); }
    for (int k = 0; k < 4; ++k) { fa.jump (k, lfoHz (64)); fb.jump (k, lfoHz (64)); }
}

//==============================================================================
double Engine::lfoHz (double v) const { const double x = v / 127; return mtof (127 * x * x - 75); }
double Engine::pitchMul (int i) const { const double v = i < 4 ? pitch[0] : i < 8 ? pitch[1] : 64; return v / 127 * 1.99 + 0.01; }

void Engine::updateFreq (int i, bool now)
{
    const double lo = TUNE_TABLE[i % 8][0], hi = TUNE_TABLE[i % 8][1];
    const double f = mtof (lo + tuneV[(size_t) i] / 127 * (hi - lo)) * pitchMul (i);
    if (now) freq.jump (i, f); else rset (freq, i, f, LINE_MS);
}

void Engine::setKey (int i, bool on)
{
    if (i < 0 || i >= count) return;
    keys[(size_t) i] = on ? 1 : 0;
    const bool fst = fast[(size_t) (i >> 1)] != 0;
    rset (env, i, on ? 1 : 0, on ? (fst ? 100 : 200) : (fst ? 100 : 8000));
}

void Engine::updateSolo()
{
    int any = 0;
    for (int i = 0; i < count; ++i) if (solo[(size_t) i]) any = 1;
    for (int i = 0; i < MAXT; ++i) rset (soloG, i, any ? (i < count && solo[(size_t) i] ? 1 : 0) : 1, 3);
}

void Engine::updSaw (int k)
{
    static const double dir[3] = { 0, 1, -1 };
    rset (xSaw, k, dir[xMode[k]] * xSpread[k], 20);
}

void Engine::setCount (int n)
{
    n = std::max (8, std::min (MAXT, n));
    for (int i = n; i < count; ++i) { keys[(size_t) i] = 0; solo[(size_t) i] = 0; env.jump (i, 0); }
    count = n;
    updateSolo();
    const int nb = (n + 1) >> 1;
    static const int base[4] = { 1, 0, 3, 2 }, sw[4] = { 3, 0, 1, 2 };
    for (int b = 0; b < nb; ++b)
    {
        if (b < 4) { partner[(size_t) b] = base[b]; swp[(size_t) b] = sw[b]; }
        else { partner[(size_t) b] = (b ^ 1) < nb ? (b ^ 1) : b - 1; swp[(size_t) b] = b - 1; }
    }
}

void Engine::setSoft (double v)
{
    const double s = std::max (0.0, std::min (1.0, v / 100));
    sf.s = s;
    const double fc = 3200 - 1000 * s;
    const double g = std::tan (PI * fc / SR), k = SQRT2;
    sf.a1 = 1 / (1 + g * (g + k)); sf.a2 = g * sf.a1; sf.a3 = g * sf.a2;
    const double fA = std::min (SR * 0.45, 20000 * std::pow (2.0, -1.3 * s));
    sf.air = 1 - std::exp (-2 * PI * fA / SR);
}

void Engine::updateRev()
{
    rvFeed = rv.room * 0.28 + 0.7; rvDamp = rv.damp * 0.4;
    const double wet = rv.wet * 3;
    rset (rvWet1, 0, wet * (rv.width / 2 + 0.5), 30);
    rset (rvWet2, 0, wet * ((1 - rv.width) / 2), 30);
    rset (rvDry, 0, rv.dry, 30);
}

void Engine::setParam (P p, int i, double v)
{
    switch (p)
    {
        case P::tune:   if (i < 0 || i >= MAXT) return; tuneV[(size_t) i] = v; updateFreq (i, false); break;
        case P::tmod:   { const double x = v / 127; rset (mod, i, 2 * x * x * x * x, LINE_MS); break; }
        case P::thold:  { const double x = v / 127; rset (hold, i, x * x, LINE_MS); break; }
        case P::tlfo:   for (int q = 0; q < 4; ++q) rset (lfoG, i * 4 + q, q == iv (v) ? 1 : 0, 5); break;
        case P::t1:     t1[(size_t) i] = v != 0 ? 1 : 0; break;
        case P::t2:     t2[(size_t) i] = v != 0 ? 1 : 0; break;
        case P::solo:   solo[(size_t) i] = v != 0 ? 1 : 0; updateSolo(); break;
        case P::fast:
            fast[(size_t) i] = v != 0 ? 1 : 0;
            for (int t : { 2 * i, 2 * i + 1 }) if (t < count) setKey (t, keys[(size_t) t] != 0);
            break;
        case P::sharp:  { const double x = v / 127; rset (sharp, i, x * x, LINE_MS); break; }
        case P::source: source[(size_t) i] = (uint8_t) iv (v); break;
        case P::ring:   rset (ring, i, v / 127, LINE_MS); break;
        case P::fa:     rset (fa, i, lfoHz (v), LINE_MS); break;
        case P::fb:     rset (fb, i, lfoHz (v), LINE_MS); break;
        case P::andor:  andor[i] = v != 0 ? 1 : 0; break;
        case P::link:   link[i] = v != 0 ? 1 : 0; break;
        case P::pitchA: pitch[0] = v; for (int t = 0; t < 4; ++t) updateFreq (t, false); break;
        case P::pitchB: pitch[1] = v; for (int t = 4; t < 8; ++t) updateFreq (t, false); break;
        case P::time1:  rset (dTime, 0, v, LINE_MS); break;
        case P::time2:  rset (dTime, 1, v, LINE_MS); break;
        case P::mod1:   { const double x = v / 127; rset (dMod, 0, x * x * 10, LINE_MS); break; }
        case P::mod2:   { const double x = v / 127; rset (dMod, 1, x * x * 10, LINE_MS); break; }
        case P::feedback: { const double x = v / 127; rset (dFb, 0, x * std::pow (2.0, 2 * x), LINE_MS); break; }
        case P::dmix:   rset (dMix, 0, v / 127, LINE_MS); break;
        case P::dmod:   dModSrc = iv (v); break;
        case P::dwav:   dWav = iv (v); break;
        case P::xmode:
            xMode[i] = std::max (0, std::min (2, iv (v))); updSaw (i);
            if (xMode[i] != 0) { rset (xR, i, 0, GLIDE_MS); xHold[i] = 0; }
            break;
        case P::xspread: xSpread[i] = v; updSaw (i); break;
        case P::xspeed: { const double ms = 10 * std::pow (6000.0, (127 - v) / 127); xIv[i] = msToN (ms); xHz[i] = 1000 / ms; break; }
        case P::xchance: xCh[i] = v / 100; break;
        case P::xlength: { const double x = v / 127; xLen[i] = msToN (std::max (10.0, 10000 * x * x)); break; }
        case P::drv:    rset (drive, 0, dbtorms (100 + 3 + std::pow (3.0, 2 * v / 127 + 1)), LINE_MS); break;
        case P::xmix:   rset (dstMix, 0, v / 127, LINE_MS); break;
        case P::soft:   setSoft (v); break;
        case P::vol:    { const double x = v / 127; rset (vol, 0, x * x, LINE_MS); break; }
        case P::rvMix:  { const double m = v / 100; rv.wet = std::sin (m * PI / 2); rv.dry = std::cos (m * PI / 2); updateRev(); break; }
        case P::rvRoom: rv.room = v / 100; updateRev(); break;
        case P::rvDamp: rv.damp = v / 100; updateRev(); break;
        case P::rvWidth: rv.width = v / 100; updateRev(); break;
        case P::rvPre:  preN = std::max (1, std::min ((int) preBuf.size() - 2, msToN (v))); break;
        case P::rvLp:   rvLp.set (true, v, SR); break;
        case P::rvHp:   rvHp.set (false, v, SR); break;
    }
}

//==============================================================================
void Engine::render (float* L, float* R, int n)
{
    // Always runs on a fixed 128-sample grid (like the AudioWorklet), whatever the host's block size,
    // so the result does not depend on how the host slices its buffers.
    int o = 0;
    while (o < n)
    {
        if (qpos == 0) beginQuantum();
        const int k = std::min (QUANTUM - qpos, n - o);
        runSamples (L + o, R != nullptr ? R + o : nullptr, k);
        qpos += k; o += k;
        if (qpos == QUANTUM) { endQuantum(); qpos = 0; }
    }
}

void Engine::getReport (Report& r) const
{
    r.count = count;
    for (int i = 0; i < MAXT; ++i)
    {
        const auto k = (size_t) i;
        if (i < count)
        {
            r.hz[k] = (float) (freq.v[k] + hzDev[k]);
            const double Lv = env.v[k]; double e = Lv * Lv + hold.v[k];
            r.env[k] = (float) ((e > 1 ? 1 : e) * soloG.v[k]);
            r.keys[k] = keys[k];
        }
        else { r.hz[k] = 0; r.env[k] = 0; r.keys[k] = 0; }
    }
    for (int k = 0; k < 4; ++k) r.lfo[(size_t) k] = (float) lfo[k];
    r.ev = { xEv[0], xEv[1] };
    r.sweep = { (float) sweep[0], (float) sweep[1] };
}

void Engine::beginQuantum()
{
    qCount = count;
    int sounding = 0;
    for (int i = 0; i < qCount; ++i)
    {
        const auto k = (size_t) i;
        active[k] = (env.v[k] > 0 || env.c[k] > 0 || hold.v[k] > 0 || hold.c[k] > 0) ? 1 : 0;
        sounding += (env.v[k] > 0.01 || hold.v[k] > 0.01) ? 1 : 0;
        hzSum[k] = 0;
    }
    busTarget = 1 / std::sqrt (std::max (1.0, sounding / 8.0));
}

void Engine::endQuantum()
{
    // live Hz (exact base + smoothed deviation)
    const int N = QUANTUM;
    const double cHz = 1 - std::exp (-TWO_PI * 4 * N / SR);
    for (int i = 0; i < qCount; ++i) { const auto k = (size_t) i; hzDev[k] += (hzSum[k] / N - freq.v[k] - hzDev[k]) * cHz; }
}

void Engine::runSamples (float* oL, float* oR, int N)
{
    const int cnt = qCount, nb = (cnt + 1) >> 1;
    const auto& c = coef;
    const double h3c = c.h3c, h3n = c.h3n, h20c = c.h20c, h20n = c.h20n, h10c = c.h10c, h10n = c.h10n;
    const double h1c = c.h1c, h1n = c.h1n, l4k = c.l4k, l689 = c.l689;
    const double cAtk = c.cAtk, cRel = c.cRel, cDry = c.cDry;
    const double sfAtk = c.sfAtk, sfRel = c.sfRel, sfGa = c.sfGa, sfGr = c.sfGr;
    const int selfD = 64;

    for (int n = 0; n < N; ++n)
    {
        // ---- hyper LFOs
        for (int k = 0; k < 4; ++k)
        {
            const double fA = fa.tick (k), fB = fb.tick (k);
            double a = phA[k] + fA / SR; if (a >= 1) a -= std::floor (a); phA[k] = a;
            double sqA = std::cos (TWO_PI * a) * 1000; sqA = sqA > 1 ? 1 : sqA < -1 ? -1 : sqA;
            double b = phB[k] + (fB + link[k] * sqA * fB * 0.5) / SR; if (b >= 1) b -= std::floor (b); phB[k] = b;
            double sqB = std::cos (TWO_PI * b) * 1000; sqB = sqB > 1 ? 1 : sqB < -1 ? -1 : sqB;
            lfo[k] = andor[k] ? (sqA + sqB) * 0.5 : sqA * sqB;
            if (k == 0)
            {
                delTri = ((a < 1 - a ? a : 1 - a) * 4 - 1 + (b < 1 - b ? b : 1 - b) * 4 - 1) * 0.5;
                delSqr = (sqA + sqB) * 0.5;
            }
        }
        // ---- TIME-1 / TIME-2 controllers
        for (int k = 0; k < 2; ++k)
        {
            const double sa = xSaw.tick (k), ro = xR.tick (k);
            double p = xPh[k] + xHz[k] / SR; if (p >= 1) p -= std::floor (p); xPh[k] = p;
            if (xHold[k] > 0 && --xHold[k] == 0) rset (xR, k, 0, GLIDE_MS);
            if (xMode[k] == 0 && ++xTick[k] >= xIv[k])
            {
                xTick[k] = 0;
                if (xCh[k] > 0 && random01() < xCh[k])
                {
                    rset (xR, k, (random01() * 2 - 1) * xSpread[k] * 0.5, GLIDE_MS);
                    xHold[k] = glideN + xLen[k]; xEv[k]++;
                }
            }
            sweep[k] = sa * (p - 0.5) + ro;
        }
        // ---- modulation sources per block
        const double* dp = delPrev;
        for (int b = 0; b < nb; ++b)
        {
            const auto k = (size_t) b;
            cross[k] = (dp[partner[k]] + 0.001 * dp[swp[k]]) * (source[k] == 0 ? 1 : 0.001);
            g2[k] = source[k] == 2 ? 1 : 0.001;
            sharp.tick (b); ring.tick (b);
        }
        const double tfbB = 0.001 * tfb;
        // ---- voices
        for (int i = 0; i < cnt; ++i)
        {
            const auto ki = (size_t) i;
            const double f = freq.tick (i), m = mod.tick (i), h = hold.tick (i), Lv = env.tick (i), sg = soloG.tick (i);
            const int q = i * 4;
            const double lm = lfoG.tick (q) * lfo[0] + lfoG.tick (q + 1) * lfo[1] + lfoG.tick (q + 2) * lfo[2] + lfoG.tick (q + 3) * lfo[3];
            const int b = i >> 1;
            const double src = cross[(size_t) b] + (lm + tfbB) * g2[(size_t) b];
            const double fi = f + f * m * src, af = fi < 0 ? -fi : fi;
            hzSum[ki] += af;
            if (! active[ki]) { vout[ki] = 0; continue; }
            const double dt = af / SR;
            double p = ph[ki] + dt; if (p >= 1) p -= std::floor (p); ph[ki] = p;
            double p2 = p + PW; if (p2 >= 1) p2 -= 1;
            double s1 = 2 * p - 1, s2 = 2 * p2 - 1;
            if (dt > 1e-9)
            {
                if (p <= dt)      { const double x = p / dt - 1;        s1 += x * x; }
                if (p >= 1 - dt)  { const double x = (p - 1) / dt + 1;  s1 -= x * x; }
                if (p2 <= dt)     { const double x = p2 / dt - 1;       s2 += x * x; }
                if (p2 >= 1 - dt) { const double x = (p2 - 1) / dt + 1; s2 -= x * x; }
            }
            const double pulse = s1 - s2 + 2 * PW - 1;
            double fc = af * 0.25; if (fc < 100) fc = 100; else if (fc > SR * 0.5) fc = SR * 0.5;
            const double a = std::exp (-TWO_PI * fc / SR);
            const double lp = (1 - a) * pulse + a * lps[ki]; lps[ki] = lp;
            const double s = sharp.v[(size_t) b];
            const double wave = 0.59 * pulse * s + (2.65 * lp - 0.145) * (1 - s);
            double e = Lv * Lv + h; if (e > 1) e = 1;
            const double thump = (Lv > 0 && Lv < 1) ? 0.5 * std::sin (TWO_PI * Lv) : 0;
            vout[ki] = (wave + thump) * e * sg;
        }
        // ---- blocks: RING mix with progressive compression, then routing into the delay lines
        double x1 = 0, x2 = 0, xl = 0, xb = 0;
        for (int b = 0; b < nb; ++b)
        {
            const auto k = (size_t) b;
            const int ia = 2 * b, ib = ia + 1; const bool pair = ib < cnt;
            const double va = vout[(size_t) ia], vb = pair ? vout[(size_t) ib] : 0;
            const double sum = va + vb;
            double mix = sum, ca = va, cb = vb;
            const double r = ring.v[k];
            if (pair && r > 1e-4)
            {
                const double prod = va * vb;
                mix = sum + r * (2 * prod - sum);
                const double kk = std::sqrt (r), m2 = mix * mix;
                compS[k] += (sum * sum - compS[k]) * cDry;
                double ce = compE[k]; ce += (m2 - ce) * (m2 > ce ? cAtk : cRel); compE[k] = ce;
                const double over = 4.342944819 * std::log ((ce + 1e-12) / (compS[k] + 1e-12)) - 2;
                const double W = 6, slope = 1 - 1 / (1 + 9 * kk);
                double gr = 0;
                if (over >= W / 2) gr = over * slope;
                else if (over > -W / 2) { const double z = over + W / 2; gr = slope * z * z / (2 * W); }
                const double g = gr > 0 ? std::exp (-0.11512925464970229 * gr) : 1;
                mix *= g; ca = g * ((1 - r) * va + r * prod); cb = g * ((1 - r) * vb + r * prod);
            }
            else { compE[k] = 0; compS[k] = 0; }
            if (t1[(size_t) ia]) x1 += ca;
            if (t2[(size_t) ia]) x2 += ca;
            if (t1[(size_t) ia] || t2[(size_t) ia]) xl += ca; else xb += ca;
            if (pair)
            {
                if (t1[(size_t) ib]) x1 += cb;
                if (t2[(size_t) ib]) x2 += cb;
                if (t1[(size_t) ib] || t2[(size_t) ib]) xl += cb; else xb += cb;
            }
            const double nw = mix + h3c * hip3[k]; del[k] = h3n * (nw - hip3[k]); hip3[k] = nw;
        }
        std::swap (del, delPrev);
        busG += (busTarget - busG) * 0.00005;

        // ---- dual modulated delay
        const double gN = busG * 0.16;
        rnd = (int32_t) ((uint32_t) rnd * 1103515245u + 12345u);
        const double nz = rnd / 2147483648.0 * 0.001;
        const double XB = xb * gN, XL = xl * gN, X1 = x1 * gN + nz, X2 = x2 * gN + nz;
        const double lfoPart = dModSrc == 2 ? (dWav == 0 ? delTri : delSqr) : 0;
        const double fb_ = dFb.tick (0), dmix = dMix.tick (0);
        const int w = dw;
        double wet = 0;
        for (int j = 0; j < 2; ++j)
        {
            float* buf = dbuf[j].data();
            double tv = dTime.tick (j) + sweep[j]; tv = tv < 0 ? 0 : tv > 127 ? 127 : tv;
            const double depth = dMod.tick (j);
            int si = w - selfD; if (si < 0) si += dlen;
            const double selfIn = dModSrc == 0 ? buf[si] * 0.5 : 0;
            dSelf[j] += l689 * (selfIn - dSelf[j]);
            double D = (1.45125 * std::exp (K_TIME * tv) + depth * (dSelf[j] + lfoPart)) * SR / 1000;
            if (D < 1.00001) D = 1.00001; else if (D > dlen - 4) D = dlen - 4;
            const int id = (int) std::floor (D); const double fr = D - id;
            int ib = w - id; if (ib < 0) ib += dlen;
            const int ia = ib + 1 >= dlen ? ib + 1 - dlen : ib + 1;
            const int ic = ib - 1 < 0 ? ib - 1 + dlen : ib - 1;
            const int idd = ic - 1 < 0 ? ic - 1 + dlen : ic - 1;
            const double A = buf[ia], B = buf[ib], C = buf[ic], Dd = buf[idd], cmb = C - B;
            const double rd = B + fr * (cmb - 0.1666667 * (1 - fr) * ((Dd - A - 3 * cmb) * fr + (Dd + 2 * A - 3 * B)));
            // hip~ 1 -> lop~ 4000
            const double nw = rd + h1c * dHip1[j]; double y = h1n * (nw - dHip1[j]); dHip1[j] = nw;
            y = dLop[j] += l4k * (y - dLop[j]);
            // compressor~ 2.5 2.5 -12 5
            const double ay = y < 0 ? -y : y; double ce = cEnv[j];
            ce = (1 - cA) * ay + cA * ce; cEnv[j] = ce;
            double g = ce > 0 ? (cThr + (ce - cThr) * cInvR) / ce : 0; g = g < 0 ? 0 : g > 1 ? 1 : g;
            y *= pade (g);
            // expander~ -60 5
            xBuf[j][(size_t) xIdx] = (float) y;
            y *= xGain.tick (j);
            wet += y;
            buf[w] = (float) ((j == 0 ? X1 : X2) + fb_ * y);
        }
        xIdx = (xIdx + 1) & 511;
        if (++xCnt >= 256)
        {
            xCnt = 0;
            for (int j = 0; j < 2; ++j)
            {
                double pw = 0; const float* xb_ = xBuf[j].data();
                for (int t = 0; t < 512; ++t) { const double s = xb_[(xIdx + t) & 511]; pw += hann[(size_t) t] * s * s; }
                pw /= hannSum;
                const double db = pw > 1e-10 ? 10 * std::log10 (pw) : -100;
                const double gdb = std::min (0.0, (db + 60) * 0.8);
                rset (xGain, j, dbtorms (gdb + 100), 11);
            }
        }
        dw = w + 1 >= dlen ? 0 : w + 1;
        const double dOut = 0.7 * XB + 0.7 * XL * (1 - dmix) + dmix * pade (wet / (fb_ > 1.5 ? fb_ : 1.5));

        // ---- master: distortion + volume
        const double drv = drive.tick (0), dm = dstMix.tick (0), vg = vol.tick (0);
        double nw = dOut * drv + h20c * mH20; const double a20 = h20n * (nw - mH20); mH20 = nw;
        const double t = pade (a20);
        double t31 = 0;
        if (t > 0) { const double tt2 = t * t, t4 = tt2 * tt2, t8 = t4 * t4, t16 = t8 * t8; t31 = t16 * t8 * t4 * tt2 * t; }
        nw = t + t31 * 0.25 + h10c * mH10; const double s10 = h10n * (nw - mH10); mH10 = nw;
        const double cd = drv < 1 ? 1 : drv > 4 ? 4 : drv;
        const double yM = dOut * (1 - dm) + dm * (0.1 * dOut + s10 / cd);
        nw = pade (yM) + h3c * mH3; tfb = h3n * (nw - mH3); mH3 = nw;
        const double mono = yM * vg;

        // ---- reverb
        preBuf[(size_t) preW] = (float) mono;
        int pr = preW - preN; if (pr < 0) pr += (int) preBuf.size();
        preW = preW + 1 >= (int) preBuf.size() ? 0 : preW + 1;
        const double rin = preBuf[(size_t) pr] * 0.015;
        double rl = 0, rr = 0;
        const double feed = rvFeed, damp = rvDamp, d1 = 1 - damp;
        for (int ch = 0; ch < 2; ++ch)
        {
            double acc = 0;
            for (auto& cb : combs[(size_t) ch])
            {
                const double o = cb.b[(size_t) cb.i];
                cb.f = o * d1 + cb.f * damp;
                cb.b[(size_t) cb.i] = (float) (rin + cb.f * feed);
                if (++cb.i >= (int) cb.b.size()) cb.i = 0;
                acc += o;
            }
            for (auto& ap : aps[(size_t) ch])
            {
                const double bo = ap.b[(size_t) ap.i];
                ap.b[(size_t) ap.i] = (float) (acc + bo * 0.5);
                if (++ap.i >= (int) ap.b.size()) ap.i = 0;
                acc = bo - acc;
            }
            if (ch == 0) rl = acc; else rr = acc;
        }
        rl = rvLp.run (rvHp.run (rl, 0), 0);
        rr = rvLp.run (rvHp.run (rr, 1), 1);
        const double w1 = rvWet1.tick (0), w2 = rvWet2.tick (0), dr = rvDry.tick (0);
        double L = mono * dr + rl * w1 + rr * w2;
        double R = mono * dr + rr * w1 + rl * w2;

        // ---- SOFTNESS
        if (sf.s > 0.005)
        {
            const double s = sf.s;
            double hL = 0, hR = 0, lL = 0, lR = 0;
            for (int ch = 0; ch < 2; ++ch)
            {
                const double x = ch ? R : L, v3 = x - sf.ic2[ch];
                const double v1 = sf.a1 * sf.ic1[ch] + sf.a2 * v3, v2 = sf.ic2[ch] + sf.a2 * sf.ic1[ch] + sf.a3 * v3;
                sf.ic1[ch] = 2 * v1 - sf.ic1[ch]; sf.ic2[ch] = 2 * v2 - sf.ic2[ch];
                if (ch) { lR = v2; hR = x - v2; } else { lL = v2; hL = x - v2; }
            }
            const double pH = std::max (hL * hL, hR * hR), pL = std::max (lL * lL, lR * lR);
            sf.eh += (pH - sf.eh) * (pH > sf.eh ? sfAtk : sfRel);
            sf.el += (pL - sf.el) * (pL > sf.el ? sfAtk : sfRel);
            if (++sf.cnt >= 16)
            {
                sf.cnt = 0;
                const double hiDb = 4.342944819 * std::log (sf.eh + 1e-12), loDb = 4.342944819 * std::log (sf.el + 1e-12);
                auto knee = [] (double over, double slope, double W)
                {
                    return over >= W / 2 ? over * slope : over > -W / 2 ? slope * (over + W / 2) * (over + W / 2) / (2 * W) : 0.0;
                };
                const double gr1 = knee (hiDb - (-24 + 16 * (1 - s)), 1 - 1 / (1 + 5 * std::pow (s, 1.5)), 10);
                const double gr2 = knee (hiDb - loDb + 8, 0.6 * s, 8);
                const double gr = std::min (24.0, 3 * s + gr1 + gr2);
                sf.gt = std::exp (-0.11512925464970229 * gr);
            }
            sf.g += (sf.gt - sf.g) * (sf.gt < sf.g ? sfGa : sfGr);
            L = lL + hL * sf.g; R = lR + hR * sf.g;
            sf.lp[0] += sf.air * (L - sf.lp[0]); sf.lp[1] += sf.air * (R - sf.lp[1]);
            L = sf.lp[0]; R = sf.lp[1];
        }
        // safety soft limiter (transparent below 0.9)
        L = L > 0.9 ? 0.9 + 0.1 * std::tanh ((L - 0.9) * 10) : L < -0.9 ? -0.9 - 0.1 * std::tanh ((-L - 0.9) * 10) : L;
        R = R > 0.9 ? 0.9 + 0.1 * std::tanh ((R - 0.9) * 10) : R < -0.9 ? -0.9 - 0.1 * std::tanh ((-R - 0.9) * 10) : R;
        if (! std::isfinite (L)) L = 0;   // never pass NaN/Inf to a host
        if (! std::isfinite (R)) R = 0;
        oL[n] = (float) L; if (oR != nullptr) oR[n] = (float) R;
    }
}

} // namespace saraswati
