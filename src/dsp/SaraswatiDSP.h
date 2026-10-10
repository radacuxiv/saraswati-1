/*  Saraswati-1 — DSP engine (C++ port of js/dsp.js)
 *
 *  Sample-by-sample port of the LIRA-8 / LYRA-8X Pure Data patch as implemented in the
 *  Web Audio version: polyBLEP pulse/triangle voices, FM cross-modulation, hyper-LFOs,
 *  ring mix, dual modulated delay with per-oscillator sends (T1/T2), compressor/expander,
 *  distortion, TIME-1/TIME-2 controllers, solo, Freeverb-style reverb and SOFTNESS.
 *
 *  Framework-independent (no JUCE): it is driven by setParam / setKey / setCount and
 *  renders stereo float buffers. Internally it always runs on a fixed grid of 128-sample
 *  quanta, exactly like the AudioWorklet did, so per-quantum behaviour (bus gain, voice
 *  activity, frequency read-out) matches the browser version and the output does not depend
 *  on the host's block size.
 */
#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace saraswati
{

constexpr int MAXT = 69;     // oscillators ("tunes")
constexpr int MAXB = 35;     // blocks (pairs)
constexpr int QUANTUM = 128; // Web Audio render quantum

/** Every engine parameter. Indexed parameters carry an index (tune, block, LFO or TIME number). */
enum class P : int
{
    tune, tmod, thold, tlfo, t1, t2, solo,          // per oscillator  (0..68)
    fast, sharp, source, ring,                      // per block       (0..34)
    fa, fb, andor, link,                            // per hyper LFO   (0..3)
    xmode, xspread, xspeed, xchance, xlength,       // per TIME ctl    (0..1)
    pitchA, pitchB,
    time1, time2, mod1, mod2, feedback, dmix, dmod, dwav,
    drv, xmix, soft, vol,
    rvMix, rvRoom, rvDamp, rvWidth, rvPre, rvLp, rvHp,
};

/** Live values for the user interface (what the worklet posted as {t:'s', ...}). */
struct Report
{
    int count = 0;
    std::array<float, MAXT> hz {};
    std::array<float, MAXT> env {};
    std::array<uint8_t, MAXT> keys {};
    std::array<float, 4> lfo {};
    std::array<int, 2> ev {};
    std::array<float, 2> sweep {};
};

class Engine
{
public:
    explicit Engine (double sampleRate, uint32_t seed = 0x5a7a5u);

    void setParam (P p, int index, double v);
    void setKey (int i, bool on);
    void setCount (int n);
    int  getCount() const noexcept { return count; }
    bool getKey (int i) const noexcept { return i >= 0 && i < MAXT && keys[(size_t) i] != 0; }

    /** Renders n samples (any n). R may be null for mono. */
    void render (float* L, float* R, int n);

    /** Fills r with the most recent live values. Cheap; call from the audio thread. */
    void getReport (Report& r) const;

private:
    // ---- Pd-style line~ ramps (structure of arrays)
    struct Ramps
    {
        std::vector<double> v, t, inc; std::vector<int32_t> c;
        void init (int n, double init = 0) { v.assign ((size_t) n, init); t.assign ((size_t) n, init); inc.assign ((size_t) n, 0); c.assign ((size_t) n, 0); }
        inline double tick (int i) noexcept
        {
            auto k = (size_t) i;
            if (c[k] > 0) { v[k] += inc[k]; if (--c[k] == 0) v[k] = t[k]; }
            return v[k];
        }
        void jump (int i, double tg) { auto k = (size_t) i; v[k] = t[k] = tg; c[k] = 0; }
    };
    void rset (Ramps& r, int i, double tg, double ms) const;

    struct Biquad
    {
        double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1[2] {}, z2[2] {};
        void set (bool lowpass, double f, double SR);
        inline double run (double x, int ch) noexcept
        {
            const double y = b0 * x + z1[ch];
            z1[ch] = b1 * x - a1 * y + z2[ch];
            z2[ch] = b2 * x - a2 * y;
            return y;
        }
    };

    void beginQuantum();
    void runSamples (float* oL, float* oR, int N);
    void endQuantum();
    int qpos = 0, qCount = 10;
    double busTarget = 1;
    struct Coefs { double h3c, h3n, h20c, h20n, h10c, h10n, h1c, h1n, l4k, l689, cAtk, cRel, cDry, sfAtk, sfRel, sfGa, sfGr; } coef {};

    int msToN (double ms) const;
    double lfoHz (double v) const;
    double pitchMul (int i) const;
    void updateFreq (int i, bool now);
    void updateSolo();
    void updSaw (int k);
    void setSoft (double v);
    void updateRev();
    double random01() noexcept;

    const double SR;
    int count = 10;

    // voices
    std::array<double, MAXT> tuneV {};
    Ramps freq, mod, hold, env, lfoG, soloG;
    std::array<uint8_t, MAXT> keys {}, t1 {}, t2 {}, solo {}, active {};
    std::array<double, MAXT> ph {}, lps {}, vout {}, hzSum {}, hzDev {};
    double pitch[2] { 64, 64 };

    // blocks
    Ramps sharp, ring;
    std::array<uint8_t, MAXB> fast {}, source {};
    std::array<double, MAXB> compE {}, compS {}, hip3 {}, delA {}, delB {}, cross {}, g2 {};
    double* del = delA.data();
    double* delPrev = delB.data();
    std::array<int, MAXB> partner {}, swp {};

    // hyper LFOs
    Ramps fa, fb;
    uint8_t andor[4] {}, link[4] {};
    double phA[4] {}, phB[4] {}, lfo[4] {};
    double delTri = 0, delSqr = 0;

    // TIME-1 / TIME-2 controllers
    int xMode[2] {};
    Ramps xSaw, xR;
    double xPh[2] {}, xHz[2] { 1, 1 }, xSpread[2] {}, xCh[2] {};
    int xIv[2] {}, xLen[2] {}, xTick[2] {}, xHold[2] {}, xEv[2] {};
    int glideN = 1;
    double sweep[2] {};

    // delay
    int dlen = 0;
    std::vector<float> dbuf[2];
    int dw = 0;
    Ramps dTime, dMod, dFb, dMix;
    int dModSrc = 2, dWav = 0;
    double dHip1[2] {}, dLop[2] {}, dSelf[2] {}, cEnv[2] {};
    double cA = 0, cThr = 0, cInvR = 0.2;
    std::vector<float> xBuf[2];
    int xIdx = 0, xCnt = 0;
    Ramps xGain;
    std::vector<float> hann;
    double hannSum = 0;

    // master / distortion
    Ramps drive, dstMix, vol;
    double mH20 = 0, mH10 = 0, mH3 = 0, tfb = 0;

    // SOFTNESS
    struct Soft { double s = 0.85, a1 = 0, a2 = 0, a3 = 0, air = 0, ic1[2] {}, ic2[2] {}, lp[2] {}, eh = 0, el = 0, g = 1, gt = 1; int cnt = 0; } sf;

    // reverb
    struct Comb { std::vector<float> b; int i = 0; double f = 0; };
    struct AP   { std::vector<float> b; int i = 0; };
    std::array<std::array<Comb, 8>, 2> combs;
    std::array<std::array<AP, 4>, 2> aps;
    std::vector<float> preBuf; int preW = 0, preN = 1;
    Biquad rvLp, rvHp;
    struct { double wet = 0.25, dry = 1, room = 0.7, damp = 0.45, width = 1; } rv;
    Ramps rvWet1, rvWet2, rvDry;
    double rvFeed = 0.896, rvDamp = 0.18;

    // misc
    double busG = 1;
    int32_t rnd = 22222;
    uint64_t rng;
};

} // namespace saraswati
