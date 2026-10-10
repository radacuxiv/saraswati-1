/* Saraswati-1 — DSP engine (AudioWorklet).
 * Sample-by-sample port of the LIRA-8 / LYRA-8X Pure Data patch:
 * polyBLEP pulse/triangle voices, FM cross-modulation, hyper-LFOs, ring mix,
 * dual modulated delay with per-oscillator sends (T1/T2), compressor/expander,
 * distortion, TIME-1/TIME-2 controllers, solo, and a Freeverb-style reverb.
 *
 * The whole engine lives inside this function so that it can be
 *   - turned into an AudioWorklet module (Blob of its source), or
 *   - executed on the main thread with shims (ScriptProcessor fallback).
 */
function SaraswatiDSP() {
  'use strict';
  const SR = sampleRate;
  const MAXT = 69, MAXB = 35;
  const TWO_PI = 2 * Math.PI;
  const LINE_MS = 23.22;                       // Pd patch default smoothing
  const PW = 0.53125;                          // pulse width used by os.triangle~
  const GLIDE_MS = 19;                         // TIME random jumps always glide (continuous)
  const K_TIME = 12 * Math.LN2 / 127;          // ms = 1.45125 * 2^(12 v / 127)
  const TUNE_TABLE = [[-16, 93], [-16, 93], [7, 109], [9, 107], [20, 116.54], [20, 116.54], [33, 126.24], [33, 131.22]];

  const mtof = (m) => (m <= -1500 ? 0 : 8.17579891564 * Math.exp(0.0577622650 * Math.min(m, 1499)));
  const dbtorms = (d) => (d <= 0 ? 0 : Math.exp(0.11512925464970229 * (Math.min(d, 485) - 100)));
  const pade = (x) => { if (x > 3) x = 3; else if (x < -3) x = -3; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); };
  const clampc = (c) => (c < 0 ? 0 : c > 1 ? 1 : c);
  const hipC = (hz) => clampc(1 - hz * TWO_PI / SR);   // Pd hip~ coefficient
  const lopC = (hz) => clampc(hz * TWO_PI / SR);       // Pd lop~ coefficient
  const msToN = (ms) => Math.max(1, Math.round(ms * SR / 1000));

  /* Bank of Pd-style line~ ramps (structure of arrays for speed). */
  class Ramps {
    constructor(n, init = 0) {
      this.v = new Float64Array(n).fill(init); this.t = new Float64Array(n).fill(init);
      this.inc = new Float64Array(n); this.c = new Int32Array(n);
    }
    set(i, t, ms) { const n = msToN(ms); this.t[i] = t; this.inc[i] = (t - this.v[i]) / n; this.c[i] = n; }
    jump(i, t) { this.v[i] = this.t[i] = t; this.c[i] = 0; }
  }
  const tick = (r, i) => { if (r.c[i] > 0) { r.v[i] += r.inc[i]; if (--r.c[i] === 0) r.v[i] = r.t[i]; } return r.v[i]; };

  /* RBJ biquad (used by the reverb's low/high-pass) */
  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = new Float64Array(2); this.z2 = new Float64Array(2); }
    set(type, f) {
      f = Math.min(Math.max(f, 10), SR * 0.45);
      const w = TWO_PI * f / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
      if (type === 'lp') { this.b0 = (1 - cs) / 2 / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0; }
      else { this.b0 = (1 + cs) / 2 / a0; this.b1 = -(1 + cs) / a0; this.b2 = this.b0; }
      this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
    }
    run(x, ch) {
      const y = this.b0 * x + this.z1[ch];
      this.z1[ch] = this.b1 * x - this.a1 * y + this.z2[ch];
      this.z2[ch] = this.b2 * x - this.a2 * y;
      return y;
    }
  }

  class SaraswatiProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.count = 10;
      // ---------------- voices (tunes)
      this.tuneV = new Float64Array(MAXT);
      this.freq = new Ramps(MAXT); this.mod = new Ramps(MAXT); this.hold = new Ramps(MAXT);
      this.env = new Ramps(MAXT);               // the line~ inside prm.sensor (0..1)
      this.lfoG = new Ramps(MAXT * 4);          // per tune LFO selector gains (5 ms)
      this.keys = new Uint8Array(MAXT);
      this.t1 = new Uint8Array(MAXT).fill(1); this.t2 = new Uint8Array(MAXT).fill(1);   // per-tune delay sends
      this.solo = new Uint8Array(MAXT); this.soloG = new Ramps(MAXT, 1);
      this.ph = new Float64Array(MAXT); this.lps = new Float64Array(MAXT);
      this.vout = new Float64Array(MAXT); this.active = new Uint8Array(MAXT);
      this.hzSum = new Float64Array(MAXT); this.hzDev = new Float64Array(MAXT);
      this.pitch = [64, 64];
      // ---------------- blocks (pairs)
      this.sharp = new Ramps(MAXB); this.ring = new Ramps(MAXB);
      this.fast = new Uint8Array(MAXB).fill(1); this.source = new Uint8Array(MAXB).fill(1);
      this.compE = new Float64Array(MAXB); this.compS = new Float64Array(MAXB); this.hip3 = new Float64Array(MAXB);
      this.del = new Float64Array(MAXB); this.delPrev = new Float64Array(MAXB);
      this.cross = new Float64Array(MAXB); this.g2 = new Float64Array(MAXB);
      this.partner = new Int32Array(MAXB); this.swp = new Int32Array(MAXB);
      // ---------------- hyper LFOs
      this.fa = new Ramps(4); this.fb = new Ramps(4);
      this.andor = new Uint8Array(4); this.link = new Uint8Array(4);
      this.phA = new Float64Array(4); this.phB = new Float64Array(4);
      this.lfo = new Float64Array(4); this.delTri = 0; this.delSqr = 0;
      // ---------------- TIME-1 / TIME-2 controllers (modulate the delay TIME values only)
      this.xMode = new Int32Array(2);                    // 0 RANDOM, 1 SAW, 2 REV
      this.xSaw = new Ramps(2); this.xR = new Ramps(2); this.xPh = new Float64Array(2);
      this.xHz = new Float64Array(2).fill(1); this.xIv = new Int32Array(2).fill(msToN(750));
      this.xSpread = new Float64Array(2); this.xCh = new Float64Array(2);
      this.xLen = new Int32Array(2).fill(msToN(2539.5)); this.xTick = new Int32Array(2);
      this.xHold = new Int32Array(2); this.xEv = new Int32Array(2);
      this.glideN = msToN(GLIDE_MS); this.sweep = new Float64Array(2);
      // ---------------- delay
      this.dlen = Math.ceil(SR * 6.3) + 8;
      this.dbuf = [new Float32Array(this.dlen), new Float32Array(this.dlen)];
      this.dw = 0;
      this.dTime = new Ramps(2, 64); this.dMod = new Ramps(2);
      this.dFb = new Ramps(1); this.dMix = new Ramps(1);
      this.dModSrc = 2; this.dWav = 0;
      this.dHip1 = new Float64Array(2); this.dLop = new Float64Array(2); this.dSelf = new Float64Array(2);
      this.cEnv = new Float64Array(2);
      this.cA = Math.exp(-4.60517 / Math.max(1, 2.5 * SR / 1000));   // compressor~ 2.5 ms
      this.cThr = dbtorms(100 - 12); this.cInvR = 1 / 5;
      this.xBuf = [new Float32Array(512), new Float32Array(512)]; this.xIdx = 0; this.xCnt = 0;
      this.xGain = new Ramps(2, 1);
      this.hann = new Float32Array(512); let hs = 0;
      for (let i = 0; i < 512; i++) { this.hann[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / 512); hs += this.hann[i]; }
      this.hannSum = hs;
      // ---------------- master / distortion
      this.drive = new Ramps(1, 2); this.dstMix = new Ramps(1, 0.5); this.vol = new Ramps(1, 1);
      this.mH20 = 0; this.mH10 = 0; this.mH3 = 0; this.tfb = 0;
      // ---------------- SOFTNESS: gentle low-pass + compressor that acts on the harsh band only
      this.sf = { s: 0.85, a1: 0, a2: 0, a3: 0, air: 0, ic1: new Float64Array(2), ic2: new Float64Array(2), lp: new Float64Array(2),
        eh: 0, el: 0, g: 1, gt: 1, cnt: 0 };
      this.setSoft(85);
      // ---------------- reverb (Freeverb topology, ReaVerberate-style controls)
      const sc = SR / 44100;
      const CT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AT = [556, 441, 341, 225];
      this.combs = []; this.aps = [];
      for (let ch = 0; ch < 2; ch++) {
        this.combs.push(CT.map((t) => ({ b: new Float32Array(Math.round((t + ch * 23) * sc)), i: 0, f: 0 })));
        this.aps.push(AT.map((t) => ({ b: new Float32Array(Math.round((t + ch * 23) * sc)), i: 0 })));
      }
      this.preBuf = new Float32Array(Math.ceil(SR * 0.52) + 2); this.preW = 0; this.preN = msToN(20);
      this.rvLp = new Biquad(); this.rvHp = new Biquad();
      this.rv = { wet: 0.25, dry: 1, room: 0.7, damp: 0.45, width: 1 };
      this.rvWet1 = new Ramps(1); this.rvWet2 = new Ramps(1); this.rvDry = new Ramps(1, 1);
      this.rvFeed = 0.896; this.rvDamp = 0.18;
      this.rvLp.set('lp', 9000); this.rvHp.set('hp', 100);
      // ---------------- misc
      this.busG = 1; this.rnd = 22222;
      this.q = 0; this.reportEvery = Math.max(1, Math.round(SR / 128 / 30));
      this.updateRev();
      this.setCount(8);
      for (let i = 0; i < MAXT; i++) { this.lfoG.jump(i * 4 + ((i >> 1) % 4), 1); this.updateFreq(i, true); }
      for (let k = 0; k < 4; k++) { this.fa.jump(k, this.lfoHz(64)); this.fb.jump(k, this.lfoHz(64)); }
      this.port.onmessage = (e) => this.onMsg(e.data);
    }

    // ------------------------------------------------------------ messages
    onMsg(m) {
      if (m.t === 'p') this.setParam(m.k, m.v);
      else if (m.t === 'bulk') { for (const kv of m.p) this.setParam(kv[0], kv[1]); }
      else if (m.t === 'key') this.setKey(m.i, !!m.on);
      else if (m.t === 'count') this.setCount(m.n);
    }
    lfoHz(v) { const x = v / 127; return mtof(127 * x * x - 75); }
    pitchMul(i) { const v = i < 4 ? this.pitch[0] : i < 8 ? this.pitch[1] : 64; return v / 127 * 1.99 + 0.01; }
    updateFreq(i, now) {
      const [lo, hi] = TUNE_TABLE[i % 8];
      const f = mtof(lo + this.tuneV[i] / 127 * (hi - lo)) * this.pitchMul(i);
      if (now) this.freq.jump(i, f); else this.freq.set(i, f, LINE_MS);
    }
    setKey(i, on) {
      if (i < 0 || i >= this.count) return;
      this.keys[i] = on ? 1 : 0;
      const fast = this.fast[i >> 1];
      this.env.set(i, on ? 1 : 0, on ? (fast ? 100 : 200) : (fast ? 100 : 8000));
    }
    updateSolo() {
      let any = 0; for (let i = 0; i < this.count; i++) if (this.solo[i]) any = 1;
      for (let i = 0; i < MAXT; i++) this.soloG.set(i, any ? (i < this.count && this.solo[i] ? 1 : 0) : 1, 3);
    }
    updSaw(k) { this.xSaw.set(k, [0, 1, -1][this.xMode[k]] * this.xSpread[k], 20); }
    setCount(n) {
      n = Math.max(8, Math.min(MAXT, n | 0));
      for (let i = n; i < this.count; i++) { this.keys[i] = 0; this.solo[i] = 0; this.env.jump(i, 0); }
      this.count = n;
      this.updateSolo();
      const nb = (n + 1) >> 1, base = [1, 0, 3, 2], sw = [3, 0, 1, 2];
      for (let b = 0; b < nb; b++) {
        if (b < 4) { this.partner[b] = base[b]; this.swp[b] = sw[b]; }
        else { this.partner[b] = (b ^ 1) < nb ? (b ^ 1) : b - 1; this.swp[b] = b - 1; }
      }
    }
    setSoft(v) {
      const f = this.sf, s = Math.max(0, Math.min(1, v / 100));
      f.s = s;
      const fc = 3200 - 1000 * s;                                  // split: the harsh band starts ~2.3–3.2 kHz
      const g = Math.tan(Math.PI * fc / SR), k = Math.SQRT2;
      f.a1 = 1 / (1 + g * (g + k)); f.a2 = g * f.a1; f.a3 = g * f.a2;
      const fa = Math.min(SR * 0.45, 20000 * Math.pow(2, -1.3 * s));   // soft 6 dB/oct "air" low-pass
      f.air = 1 - Math.exp(-2 * Math.PI * fa / SR);
    }
    updateRev() {
      const r = this.rv;
      this.rvFeed = r.room * 0.28 + 0.7; this.rvDamp = r.damp * 0.4;
      const wet = r.wet * 3;
      this.rvWet1.set(0, wet * (r.width / 2 + 0.5), 30); this.rvWet2.set(0, wet * ((1 - r.width) / 2), 30);
      this.rvDry.set(0, r.dry, 30);
    }
    setParam(k, v) {
      const c = k.indexOf(':'); const name = c < 0 ? k : k.slice(0, c); const i = c < 0 ? 0 : +k.slice(c + 1);
      switch (name) {
        case 'tune': this.tuneV[i] = v; this.updateFreq(i, false); break;
        case 'tmod': { const x = v / 127; this.mod.set(i, 2 * x * x * x * x, LINE_MS); break; }
        case 'thold': { const x = v / 127; this.hold.set(i, x * x, LINE_MS); break; }
        case 'tlfo': for (let q = 0; q < 4; q++) this.lfoG.set(i * 4 + q, q === (v | 0) ? 1 : 0, 5); break;
        case 't1': this.t1[i] = v ? 1 : 0; break;
        case 't2': this.t2[i] = v ? 1 : 0; break;
        case 'solo': this.solo[i] = v ? 1 : 0; this.updateSolo(); break;
        case 'fast': this.fast[i] = v ? 1 : 0;
          for (const t of [2 * i, 2 * i + 1]) if (t < this.count) this.setKey(t, this.keys[t]); break;
        case 'sharp': { const x = v / 127; this.sharp.set(i, x * x, LINE_MS); break; }
        case 'source': this.source[i] = v | 0; break;
        case 'ring': this.ring.set(i, v / 127, LINE_MS); break;
        case 'fa': this.fa.set(i, this.lfoHz(v), LINE_MS); break;
        case 'fb': this.fb.set(i, this.lfoHz(v), LINE_MS); break;
        case 'andor': this.andor[i] = v ? 1 : 0; break;
        case 'link': this.link[i] = v ? 1 : 0; break;
        case 'pitchA': this.pitch[0] = v; for (let t = 0; t < 4; t++) this.updateFreq(t, false); break;
        case 'pitchB': this.pitch[1] = v; for (let t = 4; t < 8; t++) this.updateFreq(t, false); break;
        case 'time1': this.dTime.set(0, v, LINE_MS); break;
        case 'time2': this.dTime.set(1, v, LINE_MS); break;
        case 'mod1': { const x = v / 127; this.dMod.set(0, x * x * 10, LINE_MS); break; }
        case 'mod2': { const x = v / 127; this.dMod.set(1, x * x * 10, LINE_MS); break; }
        case 'feedback': { const x = v / 127; this.dFb.set(0, x * Math.pow(2, 2 * x), LINE_MS); break; }
        case 'dmix': this.dMix.set(0, v / 127, LINE_MS); break;
        case 'dmod': this.dModSrc = v | 0; break;
        case 'dwav': this.dWav = v | 0; break;
        case 'xmode': this.xMode[i] = v | 0; this.updSaw(i); if (this.xMode[i] !== 0) { this.xR.set(i, 0, GLIDE_MS); this.xHold[i] = 0; } break;
        case 'xspread': this.xSpread[i] = v; this.updSaw(i); break;
        case 'xspeed': { const ms = 10 * Math.pow(6000, (127 - v) / 127); this.xIv[i] = msToN(ms); this.xHz[i] = 1000 / ms; break; }
        case 'xchance': this.xCh[i] = v / 100; break;
        case 'xlength': { const x = v / 127; this.xLen[i] = msToN(Math.max(10, 10000 * x * x)); break; }
        case 'drv': this.drive.set(0, dbtorms(100 + 3 + Math.pow(3, 2 * v / 127 + 1)), LINE_MS); break;
        case 'xmix': this.dstMix.set(0, v / 127, LINE_MS); break;
        case 'soft': this.setSoft(v); break;
        case 'vol': { const x = v / 127; this.vol.set(0, x * x, LINE_MS); break; }
        case 'rvMix': { const m = v / 100; this.rv.wet = Math.sin(m * Math.PI / 2); this.rv.dry = Math.cos(m * Math.PI / 2); this.updateRev(); break; }
        case 'rvRoom': this.rv.room = v / 100; this.updateRev(); break;
        case 'rvDamp': this.rv.damp = v / 100; this.updateRev(); break;
        case 'rvWidth': this.rv.width = v / 100; this.updateRev(); break;
        case 'rvPre': this.preN = Math.max(1, Math.min(this.preBuf.length - 2, msToN(v))); break;
        case 'rvLp': this.rvLp.set('lp', v); break;
        case 'rvHp': this.rvHp.set('hp', v); break;
      }
    }

    // ------------------------------------------------------------ audio
    process(inputs, outputs) {
      const out = outputs[0]; if (!out || !out[0]) return true;
      const oL = out[0], oR = out.length > 1 ? out[1] : null, N = oL.length;
      const cnt = this.count, nb = (cnt + 1) >> 1;
      const freq = this.freq, mod = this.mod, hold = this.hold, env = this.env, lfoG = this.lfoG;
      const soloG = this.soloG, t1 = this.t1, t2 = this.t2;
      const sharp = this.sharp, ring = this.ring, vout = this.vout, act = this.active, ph = this.ph, lps = this.lps;
      const hzSum = this.hzSum, lfo = this.lfo, cross = this.cross, g2 = this.g2, source = this.source;
      const h3c = hipC(3), h3n = 0.5 * (1 + h3c);
      const h20c = hipC(20), h20n = 0.5 * (1 + h20c), h10c = hipC(10), h10n = 0.5 * (1 + h10c);
      const h1c = hipC(1), h1n = 0.5 * (1 + h1c), l4k = lopC(4000), l689 = lopC(689);
      const cA = this.cA, cThr = this.cThr, cInvR = this.cInvR;
      const cAtk = 1 - Math.exp(-1 / (0.01 * SR)), cRel = 1 - Math.exp(-1 / (0.15 * SR)), cDry = 1 - Math.exp(-1 / (0.06 * SR));
      const dlen = this.dlen, selfD = 64;
      const sfAtk = 1 - Math.exp(-1 / (0.002 * SR)), sfRel = 1 - Math.exp(-1 / (0.12 * SR));
      const sfGa = 1 - Math.exp(-1 / (0.002 * SR)), sfGr = 1 - Math.exp(-1 / (0.09 * SR));
      let sounding = 0;
      for (let i = 0; i < cnt; i++) {
        const a = (env.v[i] > 0 || env.c[i] > 0 || hold.v[i] > 0 || hold.c[i] > 0) ? 1 : 0;
        act[i] = a; sounding += (env.v[i] > 0.01 || hold.v[i] > 0.01) ? 1 : 0;
        hzSum[i] = 0;
      }
      const busTarget = 1 / Math.sqrt(Math.max(1, sounding / 8));

      for (let n = 0; n < N; n++) {
        // ---- hyper LFOs
        for (let k = 0; k < 4; k++) {
          const fa = tick(this.fa, k), fb = tick(this.fb, k);
          let a = this.phA[k] + fa / SR; if (a >= 1) a -= Math.floor(a); this.phA[k] = a;
          let sqA = Math.cos(TWO_PI * a) * 1000; sqA = sqA > 1 ? 1 : sqA < -1 ? -1 : sqA;
          let b = this.phB[k] + (fb + this.link[k] * sqA * fb * 0.5) / SR; if (b >= 1) b -= Math.floor(b); this.phB[k] = b;
          let sqB = Math.cos(TWO_PI * b) * 1000; sqB = sqB > 1 ? 1 : sqB < -1 ? -1 : sqB;
          lfo[k] = this.andor[k] ? (sqA + sqB) * 0.5 : sqA * sqB;
          if (k === 0) {
            this.delTri = ((a < 1 - a ? a : 1 - a) * 4 - 1 + (b < 1 - b ? b : 1 - b) * 4 - 1) * 0.5;
            this.delSqr = (sqA + sqB) * 0.5;
          }
        }
        // ---- TIME-1 / TIME-2 controllers: RANDOM (gliding jumps) or SAW / REV sweep of the TIME value
        for (let k = 0; k < 2; k++) {
          const sa = tick(this.xSaw, k), ro = tick(this.xR, k);
          let p = this.xPh[k] + this.xHz[k] / SR; if (p >= 1) p -= Math.floor(p); this.xPh[k] = p;
          if (this.xHold[k] > 0 && --this.xHold[k] === 0) this.xR.set(k, 0, GLIDE_MS);
          if (this.xMode[k] === 0 && ++this.xTick[k] >= this.xIv[k]) {
            this.xTick[k] = 0;
            if (this.xCh[k] > 0 && Math.random() < this.xCh[k]) {
              this.xR.set(k, (Math.random() * 2 - 1) * this.xSpread[k] * 0.5, GLIDE_MS);
              this.xHold[k] = this.glideN + this.xLen[k]; this.xEv[k]++;
            }
          }
          this.sweep[k] = sa * (p - 0.5) + ro;
        }
        // ---- modulation sources per block (cross FM from partner block, 0.001 analog bleeds kept)
        const dp = this.delPrev;
        for (let b = 0; b < nb; b++) {
          cross[b] = (dp[this.partner[b]] + 0.001 * dp[this.swp[b]]) * (source[b] === 0 ? 1 : 0.001);
          g2[b] = source[b] === 2 ? 1 : 0.001;
          tick(sharp, b); tick(ring, b);
        }
        const tfbB = 0.001 * this.tfb;
        // ---- voices
        for (let i = 0; i < cnt; i++) {
          const f = tick(freq, i), m = tick(mod, i), h = tick(hold, i), L = tick(env, i), sg = tick(soloG, i);
          const q = i * 4;
          const lm = tick(lfoG, q) * lfo[0] + tick(lfoG, q + 1) * lfo[1] + tick(lfoG, q + 2) * lfo[2] + tick(lfoG, q + 3) * lfo[3];
          const b = i >> 1;
          const src = cross[b] + (lm + tfbB) * g2[b];
          const fi = f + f * m * src, af = fi < 0 ? -fi : fi;
          hzSum[i] += af;
          if (!act[i]) { vout[i] = 0; continue; }
          const dt = af / SR;
          let p = ph[i] + dt; if (p >= 1) p -= Math.floor(p); ph[i] = p;
          let p2 = p + PW; if (p2 >= 1) p2 -= 1;
          let s1 = 2 * p - 1, s2 = 2 * p2 - 1;
          if (dt > 1e-9) {
            if (p <= dt) { const x = p / dt - 1; s1 += x * x; }
            if (p >= 1 - dt) { const x = (p - 1) / dt + 1; s1 -= x * x; }
            if (p2 <= dt) { const x = p2 / dt - 1; s2 += x * x; }
            if (p2 >= 1 - dt) { const x = (p2 - 1) / dt + 1; s2 -= x * x; }
          }
          const pulse = s1 - s2 + 2 * PW - 1;
          let fc = af * 0.25; if (fc < 100) fc = 100; else if (fc > SR * 0.5) fc = SR * 0.5;
          const a = Math.exp(-TWO_PI * fc / SR);
          const lp = (1 - a) * pulse + a * lps[i]; lps[i] = lp;
          const s = sharp.v[b];
          const wave = 0.59 * pulse * s + (2.65 * lp - 0.145) * (1 - s);
          let e = L * L + h; if (e > 1) e = 1;
          const thump = (L > 0 && L < 1) ? 0.5 * Math.sin(TWO_PI * L) : 0;
          vout[i] = (wave + thump) * e * sg;
        }
        // ---- blocks: RING mix with progressive compression, then per-tune routing into the delay lines
        let x1 = 0, x2 = 0, xl = 0, xb = 0;
        const del = this.del;
        for (let b = 0; b < nb; b++) {
          const ia = 2 * b, ib = ia + 1, pair = ib < cnt;
          const va = vout[ia], vb = pair ? vout[ib] : 0;
          const sum = va + vb;
          let mix = sum, ca = va, cb = vb;
          const r = ring.v[b];
          if (pair && r > 1e-4) {
            const prod = va * vb;
            mix = sum + r * (2 * prod - sum);
            // progressive compressor: threshold = the dry (un-ringed) level, ratio grows with RING
            const k = Math.sqrt(r), m2 = mix * mix;
            this.compS[b] += (sum * sum - this.compS[b]) * cDry;
            let ce = this.compE[b]; ce += (m2 - ce) * (m2 > ce ? cAtk : cRel); this.compE[b] = ce;
            const over = 4.342944819 * Math.log((ce + 1e-12) / (this.compS[b] + 1e-12)) - 2;
            const W = 6, slope = 1 - 1 / (1 + 9 * k);
            let gr = 0;
            if (over >= W / 2) gr = over * slope;
            else if (over > -W / 2) { const z = over + W / 2; gr = slope * z * z / (2 * W); }
            const g = gr > 0 ? Math.exp(-0.11512925464970229 * gr) : 1;
            mix *= g; ca = g * ((1 - r) * va + r * prod); cb = g * ((1 - r) * vb + r * prod);   // ca + cb = mix
          } else { this.compE[b] = 0; this.compS[b] = 0; }
          if (t1[ia]) x1 += ca; if (t2[ia]) x2 += ca; if (t1[ia] || t2[ia]) xl += ca; else xb += ca;
          if (pair) { if (t1[ib]) x1 += cb; if (t2[ib]) x2 += cb; if (t1[ib] || t2[ib]) xl += cb; else xb += cb; }
          const nw = mix + h3c * this.hip3[b]; del[b] = h3n * (nw - this.hip3[b]); this.hip3[b] = nw;
        }
        this.del = this.delPrev; this.delPrev = del;
        this.busG += (busTarget - this.busG) * 0.00005;
        // ---- dual modulated delay (port of [pd delay])
        const gN = this.busG * 0.16;
        this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) | 0;
        const nz = this.rnd / 2147483648 * 0.001;
        const XB = xb * gN, XL = xl * gN, X1 = x1 * gN + nz, X2 = x2 * gN + nz;   // bypass / listening / line inputs
        const lfoPart = this.dModSrc === 2 ? (this.dWav === 0 ? this.delTri : this.delSqr) : 0;
        const fb = tick(this.dFb, 0), dmix = tick(this.dMix, 0);
        const w = this.dw;
        let wet = 0;
        for (let j = 0; j < 2; j++) {
          const buf = this.dbuf[j];
          let tv = tick(this.dTime, j) + this.sweep[j]; tv = tv < 0 ? 0 : tv > 127 ? 127 : tv;
          const depth = tick(this.dMod, j);
          let si = w - selfD; if (si < 0) si += dlen;
          const selfIn = this.dModSrc === 0 ? buf[si] * 0.5 : 0;
          this.dSelf[j] += l689 * (selfIn - this.dSelf[j]);
          let D = (1.45125 * Math.exp(K_TIME * tv) + depth * (this.dSelf[j] + lfoPart)) * SR / 1000;
          if (D < 1.00001) D = 1.00001; else if (D > dlen - 4) D = dlen - 4;
          const id = Math.floor(D), fr = D - id;
          let ib = w - id; if (ib < 0) ib += dlen;
          const ia = ib + 1 >= dlen ? ib + 1 - dlen : ib + 1;
          const ic = ib - 1 < 0 ? ib - 1 + dlen : ib - 1;
          const idd = ic - 1 < 0 ? ic - 1 + dlen : ic - 1;
          const A = buf[ia], B = buf[ib], C = buf[ic], Dd = buf[idd], cmb = C - B;
          const rd = B + fr * (cmb - 0.1666667 * (1 - fr) * ((Dd - A - 3 * cmb) * fr + (Dd + 2 * A - 3 * B)));
          // hip~ 1 -> lop~ 4000
          const nw = rd + h1c * this.dHip1[j]; let y = h1n * (nw - this.dHip1[j]); this.dHip1[j] = nw;
          y = this.dLop[j] += l4k * (y - this.dLop[j]);
          // compressor~ 2.5 2.5 -12 5 (hv.envfollow + tanh-shaped gain)
          const ay = y < 0 ? -y : y; let ce = this.cEnv[j];
          ce = (1 - cA) * ay + cA * ce; this.cEnv[j] = ce;
          let g = ce > 0 ? (cThr + (ce - cThr) * cInvR) / ce : 0; g = g < 0 ? 0 : g > 1 ? 1 : g;
          y *= pade(g);
          // expander~ -60 5 (env~ 512 analysis every 256 samples)
          this.xBuf[j][this.xIdx] = y;
          y *= tick(this.xGain, j);
          wet += y;
          buf[w] = (j === 0 ? X1 : X2) + fb * y;
        }
        this.xIdx = (this.xIdx + 1) & 511;
        if (++this.xCnt >= 256) {
          this.xCnt = 0;
          for (let j = 0; j < 2; j++) {
            let pw = 0; const xb = this.xBuf[j], hn = this.hann;
            for (let t = 0; t < 512; t++) { const s = xb[(this.xIdx + t) & 511]; pw += hn[t] * s * s; }
            pw /= this.hannSum;
            const db = pw > 1e-10 ? 10 * Math.log10(pw) : -100;
            const gdb = Math.min(0, (db + 60) * 0.8);
            this.xGain.set(j, dbtorms(gdb + 100), 11);
          }
        }
        this.dw = w + 1 >= dlen ? 0 : w + 1;
        const dOut = 0.7 * XB + 0.7 * XL * (1 - dmix) + dmix * pade(wet / (fb > 1.5 ? fb : 1.5));
        // ---- master: distortion + volume (port of [pd master_output])
        const drv = tick(this.drive, 0), dm = tick(this.dstMix, 0), vg = tick(this.vol, 0);
        let nw = dOut * drv + h20c * this.mH20; const a20 = h20n * (nw - this.mH20); this.mH20 = nw;
        const t = pade(a20);
        let t31 = 0; if (t > 0) { const t2 = t * t, t4 = t2 * t2, t8 = t4 * t4, t16 = t8 * t8; t31 = t16 * t8 * t4 * t2 * t; }
        nw = t + t31 * 0.25 + h10c * this.mH10; const s10 = h10n * (nw - this.mH10); this.mH10 = nw;
        const cd = drv < 1 ? 1 : drv > 4 ? 4 : drv;
        const yM = dOut * (1 - dm) + dm * (0.1 * dOut + s10 / cd);
        nw = pade(yM) + h3c * this.mH3; this.tfb = h3n * (nw - this.mH3); this.mH3 = nw;
        const mono = yM * vg;
        // ---- reverb
        this.preBuf[this.preW] = mono;
        let pr = this.preW - this.preN; if (pr < 0) pr += this.preBuf.length;
        this.preW = this.preW + 1 >= this.preBuf.length ? 0 : this.preW + 1;
        const rin = this.preBuf[pr] * 0.015;
        let rl = 0, rr = 0;
        const feed = this.rvFeed, damp = this.rvDamp, d1 = 1 - damp;
        for (let ch = 0; ch < 2; ch++) {
          let acc = 0; const cs = this.combs[ch];
          for (let c = 0; c < 8; c++) {
            const cb = cs[c], o = cb.b[cb.i];
            cb.f = o * d1 + cb.f * damp;
            cb.b[cb.i] = rin + cb.f * feed;
            if (++cb.i >= cb.b.length) cb.i = 0;
            acc += o;
          }
          const as = this.aps[ch];
          for (let c = 0; c < 4; c++) {
            const ap = as[c], bo = ap.b[ap.i];
            ap.b[ap.i] = acc + bo * 0.5;
            if (++ap.i >= ap.b.length) ap.i = 0;
            acc = bo - acc;
          }
          if (ch === 0) rl = acc; else rr = acc;
        }
        rl = this.rvLp.run(this.rvHp.run(rl, 0), 0);
        rr = this.rvLp.run(this.rvHp.run(rr, 1), 1);
        const w1 = tick(this.rvWet1, 0), w2 = tick(this.rvWet2, 0), dr = tick(this.rvDry, 0);
        let L = mono * dr + rl * w1 + rr * w2;
        let R = mono * dr + rr * w1 + rl * w2;
        // ---- SOFTNESS
        const sf = this.sf;
        if (sf.s > 0.005) {
          const s = sf.s;
          let hL, hR, lL, lR;
          for (let ch = 0; ch < 2; ch++) {                         // TPT state-variable low-pass split (complementary)
            const x = ch ? R : L, v3 = x - sf.ic2[ch];
            const v1 = sf.a1 * sf.ic1[ch] + sf.a2 * v3, v2 = sf.ic2[ch] + sf.a2 * sf.ic1[ch] + sf.a3 * v3;
            sf.ic1[ch] = 2 * v1 - sf.ic1[ch]; sf.ic2[ch] = 2 * v2 - sf.ic2[ch];
            if (ch) { lR = v2; hR = x - v2; } else { lL = v2; hL = x - v2; }
          }
          const ph = Math.max(hL * hL, hR * hR), pl = Math.max(lL * lL, lR * lR);
          sf.eh += (ph - sf.eh) * (ph > sf.eh ? sfAtk : sfRel);
          sf.el += (pl - sf.el) * (pl > sf.el ? sfAtk : sfRel);
          if (++sf.cnt >= 16) {                                    // log-domain gain computer, every 16 samples
            sf.cnt = 0;
            const hiDb = 4.342944819 * Math.log(sf.eh + 1e-12), loDb = 4.342944819 * Math.log(sf.el + 1e-12);
            const knee = (over, slope, W) => (over >= W / 2 ? over * slope : over > -W / 2 ? slope * (over + W / 2) ** 2 / (2 * W) : 0);
            // 1) loud harsh band: threshold falls and ratio rises with SOFTNESS
            const gr1 = knee(hiDb - (-24 + 16 * (1 - s)), 1 - 1 / (1 + 5 * Math.pow(s, 1.5)), 10);
            // 2) harsh band out of proportion to the body of the sound (screech, whistle, fizz)
            const gr2 = knee(hiDb - loDb + 8, 0.6 * s, 8);
            const gr = Math.min(24, 3 * s + gr1 + gr2);
            sf.gt = Math.exp(-0.11512925464970229 * gr);
          }
          sf.g += (sf.gt - sf.g) * (sf.gt < sf.g ? sfGa : sfGr);
          L = lL + hL * sf.g; R = lR + hR * sf.g;
          sf.lp[0] += sf.air * (L - sf.lp[0]); sf.lp[1] += sf.air * (R - sf.lp[1]);
          L = sf.lp[0]; R = sf.lp[1];
        }
        // safety soft limiter (transparent below 0.9)
        L = L > 0.9 ? 0.9 + 0.1 * Math.tanh((L - 0.9) * 10) : L < -0.9 ? -0.9 - 0.1 * Math.tanh((-L - 0.9) * 10) : L;
        R = R > 0.9 ? 0.9 + 0.1 * Math.tanh((R - 0.9) * 10) : R < -0.9 ? -0.9 - 0.1 * Math.tanh((-R - 0.9) * 10) : R;
        oL[n] = L; if (oR) oR[n] = R;
      }

      // ---- per-quantum: live Hz (exact base + smoothed deviation) and UI report
      const cHz = 1 - Math.exp(-TWO_PI * 4 * N / SR);
      for (let i = 0; i < cnt; i++) this.hzDev[i] += (hzSum[i] / N - freq.v[i] - this.hzDev[i]) * cHz;
      if (++this.q >= this.reportEvery) {
        this.q = 0;
        const hz = new Float32Array(cnt), en = new Float32Array(cnt), keys = new Uint8Array(cnt);
        for (let i = 0; i < cnt; i++) {
          hz[i] = freq.v[i] + this.hzDev[i];
          const L = env.v[i]; let e = L * L + hold.v[i]; en[i] = (e > 1 ? 1 : e) * soloG.v[i];
          keys[i] = this.keys[i];
        }
        this.port.postMessage({
          t: 's', hz, env: en, keys, lfo: Float32Array.from(lfo),
          ev: [this.xEv[0], this.xEv[1]], sweep: [this.sweep[0], this.sweep[1]],
        });
      }
      return true;
    }
  }
  registerProcessor('saraswati-1', SaraswatiProcessor);
}
