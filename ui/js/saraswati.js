/* Saraswati-1 — UI, engine bridge, autoplay and liquid-light visuals */
(() => {
  'use strict';

  // ================================================================ helpers
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rand = (a, b) => a + Math.random() * (b - a);
  const MAXT = 69;
  const mtof = (m) => 8.17579891564 * Math.exp(0.0577622650 * m);
  const dbtorms = (d) => (d <= 0 ? 0 : Math.exp(0.11512925464970229 * (Math.min(d, 485) - 100)));
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const lfoHz = (v) => { const x = v / 127; return mtof(127 * x * x - 75); };
  const timeMs = (v) => 1.45125 * Math.pow(2, 12 * v / 127);
  const fHz = (f) => (f < 1 ? f.toFixed(2) : f < 10 ? f.toFixed(1) : Math.round(f)) + ' Hz';
  const fMs = (ms) => (ms < 10 ? ms.toFixed(1) + ' ms' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s');
  const pct = (v) => Math.round(v / 127 * 100) + '%';
  const fDb = (g) => (g <= 1e-6 ? '−∞ dB' : (20 * Math.log10(g)).toFixed(1) + ' dB');
  const fKhz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz');
  function noteOf(f) {
    if (!(f > 0.01)) return '—';
    const m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), c = Math.round((m - n) * 100);
    return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1) + ' ' + (c >= 0 ? '+' : '') + c;
  }
  function hzText(f) { return f >= 10000 ? f.toFixed(1) : f.toFixed(2); }
  function hueOf(f) {                                   // pitch -> colour (low = magenta/red ... high = violet)
    const t = clamp((Math.log2(Math.max(f, 1)) - 4.32) / (11.97 - 4.32), 0, 1);
    return (300 + t * 330) % 360;
  }

  // ================================================================ parameters
  const DEF = {}, V = {}, binds = {}, ctrlEl = {};
  function P(id, o) { DEF[id] = Object.assign({ id, min: 0, max: 127, def: 0, int: false, fmt: pct, w: 0 }, o); V[id] = DEF[id].def; }
  const LFO_DEF = [[64, 64], [52, 76], [74, 58], [44, 90]];
  for (let k = 0; k < 4; k++) {
    P(`fa:${k}`, { def: LFO_DEF[k][0], fmt: (v) => fHz(lfoHz(v)), w: 1 });
    P(`fb:${k}`, { def: LFO_DEF[k][1], fmt: (v) => fHz(lfoHz(v)), w: 1 });
    P(`andor:${k}`, { max: 1, int: true, w: 0.3 });
    P(`link:${k}`, { max: 1, int: true, w: 0.3 });
  }
  P('time1', { def: 64, fmt: (v) => fMs(timeMs(v)), w: 1.1 });
  P('time2', { def: 64, fmt: (v) => fMs(timeMs(v)), w: 1.1 });
  P('mod1', { fmt: (v) => '±' + ((v / 127) ** 2 * 10).toFixed(1) + ' ms', w: 0.7 });
  P('mod2', { fmt: (v) => '±' + ((v / 127) ** 2 * 10).toFixed(1) + ' ms', w: 0.7 });
  P('feedback', { def: 0, fmt: (v) => { const x = v / 127; return '×' + (x * Math.pow(4, x)).toFixed(2); }, w: 0.7, ar: [0, 112] });
  P('dmix', { w: 1 });
  P('dmod', { max: 2, int: true, def: 2, w: 0.35 });
  P('dwav', { max: 1, int: true, w: 0.3 });
  const xMs = (v) => 10 * Math.pow(6000, (127 - v) / 127);              // TIME controller SPEED (ms)
  for (let k = 0; k < 2; k++) {
    P(`xmode:${k}`, { max: 2, int: true, w: 0.6 });                     // 0 RANDOM, 1 SAW, 2 REV
    P(`xspeed:${k}`, { def: k ? 40 : 64, fmt: (v) => fMs(xMs(v)), w: 0.7 });
    P(`xspread:${k}`, { def: 32, fmt: (v) => '±' + Math.round(v / 2), w: 0.7 });
    P(`xchance:${k}`, { max: 100, fmt: (v) => Math.round(v) + '%', w: 0.6, ar: [0, 90] });
    P(`xlength:${k}`, { def: 64, fmt: (v) => fMs(Math.max(10, 10000 * (v / 127) ** 2)), w: 0.5 });
  }
  P('drv', { def: 64, fmt: (v) => '+' + (3 + Math.pow(3, 2 * v / 127 + 1)).toFixed(1) + ' dB', w: 0.7, ar: [0, 105] });
  P('xmix', { def: 64, w: 0.7 });
  P('vol', { def: 127, fmt: (v) => String(Math.round(v / 127 * 100)) });
  P('soft', { max: 100, def: 85, fmt: (v) => String(Math.round(v)) });   // master SOFTNESS (never moved by Saraswati)
  P('rvMix', { max: 100, def: 20, fmt: (v) => Math.round(v) + '%', w: 0.6, ar: [15, 90] });
  P('rvRoom', { max: 100, def: 70, fmt: (v) => Math.round(v) + '%', w: 0.5 });
  P('rvDamp', { max: 100, def: 45, fmt: (v) => Math.round(v) + '%', w: 0.4 });
  P('rvWidth', { max: 100, def: 100, fmt: (v) => Math.round(v) + '%', w: 0.3 });
  P('rvPre', { max: 500, def: 20, fmt: (v) => Math.round(v) + ' ms', w: 0.3, ar: [0, 250] });
  P('rvLp', { min: 200, max: 20000, def: 9000, log: true, fmt: fKhz, w: 0.3, ar: [1500, 18000] });
  P('rvHp', { min: 20, max: 2000, def: 100, log: true, fmt: fKhz, w: 0.3, ar: [20, 500] });
  P('pitchA', { def: 64, fmt: (v) => '×' + (v / 127 * 1.99 + 0.01).toFixed(2), w: 0.8 });
  P('pitchB', { def: 64, fmt: (v) => '×' + (v / 127 * 1.99 + 0.01).toFixed(2), w: 0.8 });
  for (let i = 0; i < MAXT; i++) {
    P(`tune:${i}`, { def: i % 2 ? 64 : 32, fmt: () => '', w: 3 });
    P(`tmod:${i}`, { w: 1.6, bias: 1.6 });
    P(`thold:${i}`, { w: 0.9, bias: 1.4 });
    P(`tlfo:${i}`, { max: 3, int: true, def: (i >> 1) % 4, w: 0.6 });
    P(`t1:${i}`, { max: 1, int: true, def: 1, w: 0.45 });               // send to delay line 1 (TIME-1)
    P(`t2:${i}`, { max: 1, int: true, def: 1, w: 0.45 });               // send to delay line 2 (TIME-2)
    P(`solo:${i}`, { max: 1, int: true });
  }
  for (let b = 0; b < 35; b++) {
    P(`fast:${b}`, { max: 1, int: true, def: 1, w: 0.3 });
    P(`sharp:${b}`, { w: 0.8 });
    P(`source:${b}`, { max: 2, int: true, def: 1, w: 1 });
    P(`ring:${b}`, { w: 1.1 });
  }
  const toFrac = (d, v) => (d.log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min));
  const fromFrac = (d, f) => (d.log ? d.min * Math.pow(d.max / d.min, f) : d.min + f * (d.max - d.min));

  function bind(id, fn, scope) { (binds[id] = binds[id] || new Set()).add(fn); if (scope) scope.push(() => binds[id].delete(fn)); fn(V[id]); }
  function setP(id, v, src = 'user', force = false) {
    const d = DEF[id]; if (!d) return;
    v = clamp(+v, d.min, d.max); if (d.int) v = Math.round(v);
    if (src === 'user' || src === 'host') auto.cancel(id);       // a hand (or host automation) on a control takes it over
    if (V[id] === v && !force) return;
    V[id] = v;
    if (binds[id]) binds[id].forEach((f) => f(v));
    if (src !== 'host') engine.send(id, v);                      // values coming from the plugin host are not echoed back
  }

  // ================================================================ plugin host bridge (VST3 / AU / AAX)
  // Inside the plugin, the page runs in the host's web view and the audio engine is native C++.
  // JUCE injects window.__JUCE__.backend; in a normal browser it is absent and the Web Audio engine is used.
  const JB = (window.__JUCE__ && window.__JUCE__.backend) || null;
  const PLUGIN = !!JB;
  if (PLUGIN) document.documentElement.classList.add('plugin');
  const host = {
    onMsg(m) {
      if (!m) return;
      if (m.t === 'init') {
        syncCount(m.count);
        for (const k in m.values) if (DEF[k]) setP(k, m.values[k], 'host', true);
        if (typeof m.dyn === 'boolean' && typeof setDynamic === 'function') setDynamic(m.dyn, true);
      } else if (m.t === 'p') setP(m.k, m.v, 'host');
      else if (m.t === 'count') syncCount(m.n);
    },
  };

  // ================================================================ audio engine bridge
  const engine = {
    ctx: null, port: null, ready: false, state: null,
    async start() {
      if (PLUGIN) {                                                // native engine: talk to the plugin processor
        this.port = { postMessage: (m) => JB.emitEvent('saraswati', m) };
        JB.addEventListener('state', (s) => { s.t = 's'; this.onState(s); });
        JB.addEventListener('host', (m) => host.onMsg(m));
        this.ready = true;
        this.port.postMessage({ t: 'hello' });                     // the processor answers with {t:'init', ...}
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not supported in this browser.');
      this.ctx = new AC({ latencyHint: 'interactive' });
      const code = '(' + SaraswatiDSP.toString() + ')();';
      let node;
      try {
        if (!this.ctx.audioWorklet) throw new Error('no AudioWorklet');
        const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        node = new AudioWorkletNode(this.ctx, 'saraswati-1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.port = node.port;
        this.port.onmessage = (e) => this.onState(e.data);
      } catch (err) {                                              // fallback: same DSP on the main thread
        let Proc = null;
        const shim = { postMessage: (m) => this.onState(m), onmessage: null };
        class AWP { constructor() { this.port = shim; } }
        new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', code)(this.ctx.sampleRate, AWP, (n, c) => { Proc = c; });
        const proc = new Proc();
        this.port = { postMessage: (m) => shim.onmessage && shim.onmessage({ data: m }) };
        node = this.ctx.createScriptProcessor(2048, 0, 2);
        node.onaudioprocess = (e) => {
          const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
          for (let o = 0; o < L.length; o += 128) proc.process([], [[L.subarray(o, o + 128), R.subarray(o, o + 128)]]);
        };
      }
      node.connect(this.ctx.destination);
      this.ready = true;
      this.port.postMessage({ t: 'count', n: tunes.count });
      this.port.postMessage({ t: 'bulk', p: Object.keys(V).map((k) => [k, V[k]]) });
      await this.ctx.resume();
    },
    send(k, v) { if (this.ready) this.port.postMessage({ t: 'p', k, v }); },
    key(i, on) { if (this.ready) this.port.postMessage({ t: 'key', i, on: on ? 1 : 0 }); keyUI(i, on); },
    count(n) { if (this.ready) this.port.postMessage({ t: 'count', n }); },
    gesture(k, on) { if (this.ready && PLUGIN) this.port.postMessage({ t: 'g', k, on: on ? 1 : 0 }); },   // host automation touch
    native(m) { if (this.ready && PLUGIN) this.port.postMessage(m); },
    onState(s) { if (s.t === 's') { this.state = s; ui.onState(s); } },
  };
  document.addEventListener('pointerdown', () => { if (engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume(); });
  // tell the host when a knob is grabbed / released, so automation "touch" recording works
  window.addEventListener('blur', () => { if (gestures.size) { gestures.forEach((k) => engine.gesture(k, false)); gestures.clear(); } });
  const gestures = new Set();

  // ================================================================ UI components
  const ARC0 = -135, ARC1 = 135, R = 40;
  const pt = (deg, r = R) => { const a = deg * Math.PI / 180; return [50 + r * Math.sin(a), 50 - r * Math.cos(a)]; };
  function arcPath(f) {
    if (f <= 0.002) return '';
    const a1 = ARC0 + (ARC1 - ARC0) * f, [x0, y0] = pt(ARC0), [x1, y1] = pt(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${a1 - ARC0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const TRACK = (() => { const [x0, y0] = pt(ARC0), [x1, y1] = pt(ARC1); return `M${x0} ${y0}A${R} ${R} 0 1 1 ${x1} ${y1}`; })();

  function dragify(svg, id, wrap) {
    const d = DEF[id]; let y0 = 0, f0 = 0, pid = null;
    svg.addEventListener('pointerdown', (e) => {
      pid = e.pointerId; svg.setPointerCapture(pid); y0 = e.clientY; f0 = toFrac(d, V[id]); wrap.classList.add('drag'); e.preventDefault(); svg.focus({ preventScroll: true });
      if (!gestures.has(id)) { gestures.add(id); engine.gesture(id, true); }
    });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      setP(id, fromFrac(d, clamp(f0 + (y0 - e.clientY) / (e.shiftKey ? 900 : 180), 0, 1)));
    });
    const end = (e) => {
      if (e.pointerId === pid) { pid = null; wrap.classList.remove('drag'); }
      if (gestures.delete(id)) engine.gesture(id, false);
    };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', () => setP(id, d.def));
    svg.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.002 : 0.02, f = toFrac(d, V[id]);
      const m = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 }[e.key];
      if (m != null) { setP(id, fromFrac(d, clamp(f + m, 0, 1))); e.preventDefault(); }
      else if (e.key === 'Home') setP(id, d.min); else if (e.key === 'End') setP(id, d.max);
    });
  }
  function knob(id, label, size = 'm', scope, extra = '') {
    const d = DEF[id], w = h('div', 'knob ' + size + (extra ? ' ' + extra : ''));
    const plain = label.replace(/<[^>]+>/g, '');
    w.innerHTML = `<svg viewBox="0 0 100 100" tabindex="0" role="slider" aria-label="${plain}">
      <path class="trk" d="${TRACK}"/><path class="arc" stroke="url(#kgrad)" d=""/>
      <circle class="cap" cx="50" cy="50" r="27" fill="url(#${extra.includes('mix') ? 'kcapMix' : 'kcap'})"/>
      <line class="ptr" x1="50" y1="50" x2="50" y2="29"/><circle class="ghost" r="5.5" cx="50" cy="10"/></svg>
      <div class="lab">${label}</div><div class="val"></div>`;
    const svg = w.firstElementChild, arc = svg.querySelector('.arc'), ptr = svg.querySelector('.ptr'), val = w.querySelector('.val');
    w.ghost = svg.querySelector('.ghost');
    bind(id, (v) => {
      const f = clamp(toFrac(d, v), 0, 1);
      arc.setAttribute('d', arcPath(f));
      ptr.setAttribute('transform', `rotate(${ARC0 + (ARC1 - ARC0) * f} 50 50)`);
      svg.setAttribute('aria-valuenow', Math.round(v)); svg.setAttribute('aria-valuetext', d.fmt(v));
      val.textContent = d.fmt(v);
    }, scope);
    dragify(svg, id, w);
    ctrlEl[id] = w;
    return w;
  }
  // big header dial: wide ring, value inside, title underneath
  function bigDial(id, label) {
    const d = DEF[id], w = h('div', 'vdial');
    const RR = 46, A0 = -150, A1 = 150;
    const p = (deg) => { const a = deg * Math.PI / 180; return [60 + RR * Math.sin(a), 60 - RR * Math.cos(a)]; };
    const arc = (f) => { if (f <= 0.002) return ''; const a1 = A0 + (A1 - A0) * f, [x0, y0] = p(A0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${RR} ${RR} 0 ${a1 - A0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    const [tx0, ty0] = p(A0), [tx1, ty1] = p(A1);
    w.innerHTML = `<div class="vd-ring"><svg viewBox="0 0 120 120" tabindex="0" role="slider" aria-label="${label}">
      <path class="vd-trk" d="M${tx0} ${ty0}A${RR} ${RR} 0 1 1 ${tx1} ${ty1}"/><path class="vd-arc" stroke="url(#vgrad)" d=""/></svg>
      <div class="vd-val"></div></div><div class="vd-lab">${label}</div>`;
    const svg = w.querySelector('svg'), a = w.querySelector('.vd-arc'), val = w.querySelector('.vd-val');
    bind(id, (v) => { a.setAttribute('d', arc(clamp(toFrac(d, v), 0, 1))); val.textContent = d.fmt(v); svg.setAttribute('aria-valuenow', Math.round(v)); });
    dragify(svg, id, w);
    return w;
  }
  function seg(id, labels, cls = '', scope) {
    const w = h('div', 'seg ' + cls); const btns = labels.map((l, i) => {
      const b = h('button', '', l); b.type = 'button'; b.addEventListener('click', () => setP(id, i)); w.append(b); return b;
    });
    bind(id, (v) => btns.forEach((b, i) => b.classList.toggle('on', i === v)), scope);
    w.btns = btns; ctrlEl[id] = w; return w;
  }
  function toggle(id, label, cls = '', scope) {
    const b = h('button', 'tg ' + cls, label); b.type = 'button';
    b.addEventListener('click', () => setP(id, V[id] ? 0 : 1));
    bind(id, (v) => { b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', !!v); }, scope);
    ctrlEl[id] = b; return b;
  }
  function panel(cls, title) {
    const p = h('section', 'panel ' + cls); p.append(h('h2', '', title)); return p;
  }
  function fx(main, mixKnob, cls = '') {   // FX layout: controls left, MIX always on the right
    const w = h('div', 'fx'), m = h('div', 'main ' + cls), c = h('div', 'mixcol');
    m.append(...main); c.append(mixKnob); w.append(m, c); return w;
  }
  const row = (...kids) => { const r = h('div', 'row'); r.append(...kids); return r; };

  // ================================================================ rack
  const leds = [], evLeds = [], timeKnobs = [], idleKnobs = [[], []];
  function buildRack() {
    const rack = $('#rack');
    const pl = panel('p-lfo', 'Hyper LFO');
    const grid = h('div', 'lfo-grid');
    for (let k = 0; k < 4; k++) {
      const col = h('div', 'lfo-col');
      const tag = h('div', 'tag', `<span class="led"></span>LFO ${k + 1}`); leds.push(tag.firstChild);
      col.append(tag, knob(`fa:${k}`, 'F-A', 's'), knob(`fb:${k}`, 'F-B', 's'), seg(`andor:${k}`, ['AND', 'OR']), toggle(`link:${k}`, 'LINK', 'acid'));
      grid.append(col);
    }
    pl.append(grid);
    const pd = panel('p-delay', 'Mod Delay');
    const t1 = knob('time1', 'TIME-1'), t2 = knob('time2', 'TIME-2'); timeKnobs.push(t1, t2);
    const segs = h('div', 'segrow');
    segs.append(h('span', 'cap-l', 'SOURCE'), seg('dmod', ['SELF', 'OFF', 'LFO-1']), h('span', 'cap-l', 'WAVE'), seg('dwav', ['TRI', 'SQR']));
    pd.append(fx([t1, t2, knob('mod1', 'MOD-1', 's'), knob('mod2', 'MOD-2', 's'), knob('feedback', 'FEEDBACK', 's'), segs], knob('dmix', 'MIX', 'm', null, 'mix')));
    const pp = panel('p-pitch', 'Pitch');
    pp.append(h('div', 'row')); pp.lastChild.append(knob('pitchA', 'OSC 1–4'), knob('pitchB', 'OSC 5–8'));
    rack.append(pl, pd, pp);
    const pr = panel('p-reverb', 'Reverb');
    pr.append(fx([knob('rvRoom', 'ROOM', 's'), knob('rvDamp', 'DAMP', 's'), knob('rvWidth', 'WIDTH', 's'),
      knob('rvPre', 'PRE-DELAY', 's'), knob('rvLp', 'LOW-PASS', 's'), knob('rvHp', 'HIGH-PASS', 's')], knob('rvMix', 'MIX', 'm', null, 'mix'), 'grid3'));
    const pdist = panel('p-dist', 'Distortion');
    pdist.append(fx([knob('drv', 'DRIVE', 'l')], knob('xmix', 'MIX', 'm', null, 'mix')));
    rack.append(pr, pdist);
    for (let k = 0; k < 2; k++) {
      const pt_ = panel('p-times', `TIME-${k + 1}`);
      const led = h('span', 'led pink'); evLeds.push(led);
      const head = h('div', 'segrow'); head.append(seg(`xmode:${k}`, ['RANDOM', 'SAW', 'REV']), led);
      const ch = knob(`xchance:${k}`, 'CHANCE', 's'), ln = knob(`xlength:${k}`, 'LENGTH', 's');
      idleKnobs[k].push(ch, ln);
      bind(`xmode:${k}`, (v) => idleKnobs[k].forEach((e) => e.classList.toggle('idle', v !== 0)));
      const r = h('div', 'row'); r.append(knob(`xspeed:${k}`, 'SPEED', 's'), knob(`xspread:${k}`, 'SPREAD', 's'), ch, ln);
      pt_.append(head, r);
      rack.append(pt_);
    }
  }

  // ================================================================ tune bar (8 ... 69 tunes)
  const keyEls = [], hzEls = [], noteEls = [], keyState = new Uint8Array(MAXT);
  const blocks = [];                          // { el, scope, srcSeg }
  const START_BLOCKS = 5, tunes = { count: 2 * START_BLOCKS };      // starts with 10 oscillators
  const blockName = (b) => (2 * b + 1 < tunes.count ? `${2 * b + 1}·${2 * b + 2}` : `${2 * b + 1}`);
  const partnerOf = (b, nb) => (b < 4 ? [1, 0, 3, 2][b] : ((b ^ 1) < nb ? (b ^ 1) : b - 1));
  function keyUI(i, on) { keyState[i] = on ? 1 : 0; if (keyEls[i]) keyEls[i].classList.toggle('on', !!on); }
  function tuneEl(i, scope) {
    const t = h('div', 'tune');
    const hz = h('div', 'hz', '—'), nt = h('div', 'note', '');
    hzEls[i] = hz; noteEls[i] = nt;
    const lsn = h('div', 'lsn'); lsn.append(toggle(`t1:${i}`, 'T1', 'send', scope), toggle(`t2:${i}`, 'T2', 'send', scope), toggle(`solo:${i}`, 'S', 'solo', scope));
    lsn.children[0].title = 'Send to delay TIME-1'; lsn.children[1].title = 'Send to delay TIME-2'; lsn.children[2].title = 'Solo';
    const duo = h('div', 'duo'); duo.append(knob(`tmod:${i}`, 'MOD', 's', scope), knob(`thold:${i}`, 'HOLD', 's', scope));
    const k = h('button', 'key', String(i + 1)); k.type = 'button';
    k.addEventListener('click', () => engine.key(i, !keyState[i]));
    keyEls[i] = k; keyUI(i, keyState[i]);
    t.append(hz, nt, knob(`tune:${i}`, `OSC ${i + 1}`, 'l', scope), duo, seg(`tlfo:${i}`, ['1', '2', '3', '4'], 'tiny', scope), lsn, k);
    t.querySelector('.seg').title = 'LFO used when SOURCE = LFO';
    return t;
  }
  function blockEl(b) {
    const scope = [], single = 2 * b + 1 >= tunes.count;
    const el = h('section', 'panel block' + (single ? ' single' : ''));
    const head = h('div', 'block-head'); head.append(h('div', 'name', blockName(b)));
    if (b >= 4 && b === Math.ceil(tunes.count / 2) - 1) {
      const rm = h('button', 'rm', '×'); rm.type = 'button'; rm.title = 'Remove'; rm.addEventListener('click', () => removeBlock()); head.append(rm);
    }
    const srcSeg = seg(`source:${b}`, ['⇄', 'OFF', 'LFO'], '', scope);
    const ctl = h('div', 'block-ctl'); ctl.append(srcSeg, toggle(`fast:${b}`, 'FAST', 'acid', scope));
    const bk = h('div', 'block-knobs'); bk.append(knob(`sharp:${b}`, '<b>TRI ➔ SQR</b>', 's', scope));
    if (!single) bk.append(knob(`ring:${b}`, 'RING', 's', scope));
    const tw = h('div', 'tunes'); tw.append(tuneEl(2 * b, scope)); if (!single) tw.append(tuneEl(2 * b + 1, scope));
    el.append(head, ctl, bk, tw);
    return { el, scope, srcSeg };
  }
  const addCard = h('button', 'add-card', '<span class="plus">+</span><span class="lbl"></span>');
  addCard.type = 'button';
  function refreshBar() {
    const nb = Math.ceil(tunes.count / 2);
    blocks.forEach((bl, b) => { bl.srcSeg.btns[0].textContent = '⇄ ' + blockName(partnerOf(b, nb)); });
    addCard.querySelector('.lbl').textContent = tunes.count < 68 ? 'ADD 2 OSC' : tunes.count === 68 ? 'ADD OSC 69' : 'ALL 69 OSC';
    addCard.disabled = tunes.count >= MAXT;
    blocks.forEach((bl, b) => { const rm = bl.el.querySelector('.rm'); if (rm) rm.style.display = b === nb - 1 ? '' : 'none'; });
  }
  // fromHost: the plugin host already holds the oscillator count and every value (session recall / automation),
  // so only the panel is rebuilt; nothing is reset and nothing is sent back.
  function addBlock(fromHost = false) {
    if (tunes.count >= MAXT) return;
    const from = tunes.count; tunes.count = from < 68 ? from + 2 : 69;
    const b = blocks.length;
    if (!fromHost) {
      for (let i = from; i < tunes.count; i++) {
        keyState[i] = 0;
        for (const p of ['tune', 'tmod', 'thold', 'tlfo', 't1', 't2', 'solo']) setP(`${p}:${i}`, DEF[`${p}:${i}`].def, 'sys', true);
      }
      for (const p of ['fast', 'sharp', 'source', 'ring']) setP(`${p}:${b}`, DEF[`${p}:${b}`].def, 'sys', true);
      engine.count(tunes.count);
    }
    const bl = blockEl(b); blocks.push(bl);
    $('#scroller').insertBefore(bl.el, addCard);
    refreshBar();
    if (!fromHost) bl.el.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
  }
  function removeBlock(fromHost = false) {
    if (blocks.length <= 4) return;
    const bl = blocks.pop(), first = blocks.length * 2;
    for (let i = first; i < tunes.count; i++) {
      auto.cancelPrefix(`:${i}`);
      if (!fromHost) { engine.key(i, false); if (V[`solo:${i}`]) setP(`solo:${i}`, 0, 'sys'); } else keyUI(i, false);
    }
    bl.scope.forEach((f) => f()); bl.el.remove();
    tunes.count = first; if (!fromHost) engine.count(tunes.count);
    refreshBar();
  }
  function syncCount(n) {                                        // match the panel to an oscillator count set by the host
    n = clamp(Math.round(+n || 10), 8, MAXT); if (n < MAXT && n % 2) n += 1;
    while (tunes.count < n) addBlock(true);
    while (tunes.count > n && blocks.length > 4) removeBlock(true);
  }
  function buildBar() {
    const sc = $('#scroller');
    for (let b = 0; b < START_BLOCKS; b++) { const bl = blockEl(b); blocks.push(bl); sc.append(bl.el); }
    sc.append(addCard); addCard.addEventListener('click', () => addBlock());
    refreshBar();
  }

  // ================================================================ live state from the engine
  const evSeen = [0, 0], evT = [0, 0];
  const ui = {
    onState(s) {
      for (let i = 0; i < tunes.count && i < s.hz.length; i++) {
        if (keyEls[i] && keyState[i] !== s.keys[i]) keyUI(i, s.keys[i]);
        const f = s.hz[i], txt = hzText(f);
        if (hzEls[i] && hzEls[i].dataset.t !== txt) {
          hzEls[i].dataset.t = txt; hzEls[i].innerHTML = `${txt}<small>Hz</small>`;
          noteEls[i].textContent = noteOf(f);
          keyEls[i].style.setProperty('--kc', `hsl(${hueOf(f).toFixed(0)} 100% 60%)`);
        }
      }
      for (let k = 0; k < 4; k++) leds[k].classList.toggle('on', s.lfo[k] > 0.2);
      for (let k = 0; k < 2; k++) {
        if (s.ev[k] !== evSeen[k]) { evSeen[k] = s.ev[k]; evLeds[k].classList.add('on'); clearTimeout(evT[k]); evT[k] = setTimeout(() => evLeds[k].classList.remove('on'), 90); }
        const tk = timeKnobs[k], on = V[`xmode:${k}`] !== 0 || Math.abs(s.sweep[k]) > 0.05;
        tk.classList.toggle('mod', on);
        if (on) {
          const f = clamp((V[k ? 'time2' : 'time1'] + s.sweep[k]) / 127, 0, 1), [x, y] = pt(ARC0 + (ARC1 - ARC0) * f);
          tk.ghost.setAttribute('cx', x.toFixed(1)); tk.ghost.setAttribute('cy', y.toFixed(1));
        }
      }
      visuals.feed(s);
    },
  };

  // ================================================================ CALL SARASWATI (autoplay)
  const isOn = (i) => i < tunes.count && !!keyState[i];
  const blockOn = (b) => isOn(2 * b) || isOn(2 * b + 1);
  const listens = (line) => { for (let i = 0; i < tunes.count; i++) if (isOn(i) && V[`t${line}:${i}`]) return true; return false; };
  const delayHeard = () => V.dmix > 0 && (listens(1) || listens(2));
  const delayModOn = () => V.mod1 > 0 || V.mod2 > 0;
  function lfoUsed(k) {
    for (let i = 0; i < tunes.count; i++) if (isOn(i) && V[`source:${i >> 1}`] === 2 && V[`tlfo:${i}`] === k && V[`tmod:${i}`] > 0) return true;
    return k === 0 && delayHeard() && V.dmod === 2 && delayModOn();
  }
  // is changing this parameter audible right now?  (pointless actions are never picked)
  function relevant(id) {
    const c = id.indexOf(':'), name = c < 0 ? id : id.slice(0, c), i = c < 0 ? -1 : +id.slice(c + 1);
    switch (name) {
      case 'tune': case 'thold': return isOn(i);
      case 'tmod': return isOn(i) && V[`source:${i >> 1}`] !== 1;
      case 'tlfo': return isOn(i) && V[`source:${i >> 1}`] === 2 && V[`tmod:${i}`] > 0;
      case 't1': case 't2': return isOn(i) && V.dmix > 0;
      case 'sharp': case 'source': case 'fast': return blockOn(i);
      case 'ring': return 2 * i + 1 < tunes.count && isOn(2 * i) && isOn(2 * i + 1);
      case 'fa': case 'fb': case 'andor': case 'link': return lfoUsed(i);
      case 'dmix': return listens(1) || listens(2);
      case 'time1': case 'mod1': return V.dmix > 0 && listens(1);
      case 'time2': case 'mod2': return V.dmix > 0 && listens(2);
      case 'feedback': return delayHeard();
      case 'dmod': return delayHeard() && delayModOn();
      case 'dwav': return delayHeard() && delayModOn() && V.dmod === 2;
      case 'xmode': case 'xspeed': case 'xspread': return V.dmix > 0 && listens(i + 1);
      case 'xchance': case 'xlength': return V.dmix > 0 && listens(i + 1) && V[`xmode:${i}`] === 0;
      case 'drv': return V.xmix > 0;
      case 'rvRoom': case 'rvDamp': case 'rvWidth': case 'rvPre': case 'rvLp': case 'rvHp': return V.rvMix > 0;
      case 'pitchA': return [0, 1, 2, 3].some(isOn);
      case 'pitchB': return [4, 5, 6, 7].some(isOn);
      default: return true;                                   // xmix, rvMix: the mix itself is how an FX comes alive
    }
  }
  const callBtn = $('#callBtn');
  const auto = {
    on: false, calling: false, first: true, n: 0, timers: [], iv: 0, callT: 0, glides: new Map(), soloed: -1, pressing: new Set(),
    text(t) { callBtn.querySelector('.txt').textContent = t; },
    click() { if (this.calling) this.cancelCall(); else if (this.on) this.stop(); else this.call(); },
    call() {
      this.calling = true; callBtn.classList.remove('fail'); callBtn.classList.add('calling'); this.text('CALLING DEITY');
      const refused = Math.random() < 0.1;
      this.callT = setTimeout(() => {
        this.calling = false; callBtn.classList.remove('calling');
        if (!refused) return this.start();
        callBtn.classList.add('fail'); this.text('DEITY DIDN’T WANT TO PLAY');
        this.callT = setTimeout(() => { callBtn.classList.remove('fail'); this.text('CALL SARASWATI'); }, 3800);
      }, rand(3000, 7000));
    },
    cancelCall() { clearTimeout(this.callT); this.calling = false; callBtn.classList.remove('calling', 'fail'); this.text('CALL SARASWATI'); },
    start() {
      this.on = true; callBtn.classList.add('on'); callBtn.setAttribute('aria-pressed', 'true'); this.text('SARASWATI IS HERE');
      this.later(3000, () => {                       // she arrives, then takes 3 s before the first command
        this.iv = setInterval(() => this.step(), 33);
        if (this.first) { this.first = false; this.firstVisit(); } else { this.n = 0; this.next(350); }
      });
    },
    stop() {
      this.on = false; this.timers.forEach(clearTimeout); this.timers = []; clearInterval(this.iv);
      if (this.soloed >= 0) { setP(`solo:${this.soloed}`, 0, 'auto'); this.soloed = -1; }
      this.pressing.forEach((i) => engine.key(i, false)); this.pressing.clear();
      this.glides.forEach((g) => this.mark(g.id, false)); this.glides.clear();
      callBtn.classList.remove('on'); callBtn.setAttribute('aria-pressed', 'false'); this.text('CALL SARASWATI');
    },
    later(ms, fn) { this.timers.push(setTimeout(() => { if (this.on) fn(); }, ms)); },
    next(ms) { this.later(ms, () => { this.act(); this.next(rand(3000, 10000)); }); },
    firstVisit() {                                     // the very first appearance is always the same ritual
      this.glide('rvPre', 108, 2500); this.glide('rvLp', 1800, 2500); this.glide('rvHp', 108, 2500); this.glide('rvMix', 73, 2500);
      this.n = 4;
      this.keyOn(0); this.later(600, () => this.keyOn(2)); this.later(1200, () => this.keyOn(7));
      this.later(1800, () => this.glideRandom('pitchA'));
      this.later(2400, () => this.glide('feedback', 82.537, 2200));        // FEEDBACK → ×1.60
      this.later(3000, () => this.glide('dmix', 83.82, 2500));            // delay MIX → 66 %
      [3600, 3950, 4300, 4650, 5000].forEach((t) => this.later(t, () => this.randomAction()));
      this.later(5000, () => this.next(rand(3000, 10000)));
    },
    mark(id, on) { const e = ctrlEl[id]; if (e) e.classList.toggle('auto-touch', on); },
    flash(id) { this.mark(id, true); setTimeout(() => { if (!this.glides.has(id)) this.mark(id, false); }, 900); },
    glide(id, to, dur) { const d = DEF[id]; this.glides.set(id, { id, d, from: toFrac(d, V[id]), to: toFrac(d, clamp(to, d.min, d.max)), t0: performance.now(), dur }); this.mark(id, true); },
    glideRandom(id) {
      const d = DEF[id], [lo, hi] = d.ar || [d.min, d.max];
      let f = Math.random(); if (d.bias) f = Math.pow(f, d.bias);
      this.glide(id, d.log ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo), rand(1000, 12000));
    },
    cancel(id) { if (this.glides.delete(id)) this.mark(id, false); },
    cancelPrefix(sfx) { for (const id of [...this.glides.keys()]) if (id.endsWith(sfx)) this.cancel(id); },
    step() {
      const now = performance.now();
      this.glides.forEach((g) => {
        const t = clamp((now - g.t0) / g.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        setP(g.id, fromFrac(g.d, g.from + (g.to - g.from) * e), 'auto');
        if (t >= 1) { this.glides.delete(g.id); this.mark(g.id, false); }
      });
    },
    keyOn(i) { if (i < tunes.count) { engine.key(i, true); this.flashKey(i); } },
    tuneOn() {
      const off = []; for (let i = 0; i < tunes.count; i++) if (!keyState[i]) off.push(i);
      if (!off.length) return this.randomAction();
      this.keyOn(off[Math.floor(Math.random() * off.length)]);
    },
    // oscillators that are off and whose block has FAST off can be "pressed" (slow swell, long release)
    pressable() {
      const r = []; for (let i = 0; i < tunes.count; i++) if (!keyState[i] && V[`fast:${i >> 1}`] === 0 && !this.pressing.has(i)) r.push(i);
      return r;
    },
    pressSequence() {                               // 3..10 presses, each held 50 ms..2 s, 1..4 s apart
      let left = 3 + Math.floor(Math.random() * 8);
      const press = () => {
        const pool = this.pressable(); if (left-- <= 0 || !pool.length) return;
        const i = pool[Math.floor(Math.random() * pool.length)];
        this.pressing.add(i); engine.key(i, true); this.flashKey(i);
        this.later(rand(50, 2000), () => { engine.key(i, false); this.pressing.delete(i); this.later(rand(1000, 4000), press); });
      };
      press();
    },
    flashKey(i) { const k = keyEls[i]; if (k) { k.classList.add('auto-touch'); setTimeout(() => k.classList.remove('auto-touch'), 900); } },
    act() { if (this.n < 4) this.tuneOn(); else this.randomAction(); this.n++; },
    randomAction() {
      const n = tunes.count, nb = Math.ceil(n / 2), cand = [];
      const on = []; for (let i = 0; i < n; i++) if (keyState[i]) on.push(i);
      for (const id in DEF) {
        const d = DEF[id]; if (!d.w || !relevant(id)) continue;
        const c = id.indexOf(':'), name = c < 0 ? id : id.slice(0, c);
        let w = d.w;
        if (['tune', 'tmod', 'thold', 'tlfo', 't1', 't2'].includes(name)) w *= 8 / Math.max(8, on.length * 2);
        if (['fast', 'sharp', 'source', 'ring'].includes(name)) w *= 4 / Math.max(4, nb);
        cand.push([id, w]);
      }
      cand.push(['#key', 3.2]);
      if (on.length >= 2 && this.soloed < 0) cand.push(['#solo', 0.5]);
      if (this.pressable().length) cand.push(['#press', 1.3]);
      let r = Math.random() * cand.reduce((t, c) => t + c[1], 0), pick = cand[0][0];
      for (const [id, w] of cand) { r -= w; if (r <= 0) { pick = id; break; } }
      if (pick === '#key') {
        if (on.length < 2 || (on.length < 7 && Math.random() < 0.55)) return this.tuneOn();
        const pool = on.filter((i) => i !== this.soloed); const i = pool[Math.floor(Math.random() * pool.length)];
        engine.key(i, false); this.flashKey(i); return;
      }
      if (pick === '#press') return this.pressSequence();
      if (pick === '#solo') {                         // a short solo moment, then everybody is back
        const i = on[Math.floor(Math.random() * on.length)]; this.soloed = i;
        setP(`solo:${i}`, 1, 'auto'); this.flash(`solo:${i}`);
        this.later(rand(2000, 7000), () => { setP(`solo:${i}`, 0, 'auto'); this.soloed = -1; });
        return;
      }
      const d = DEF[pick];
      if (d.int) {
        let v; do { v = Math.floor(Math.random() * (d.max - d.min + 1)) + d.min; } while (v === V[pick] && d.max > d.min);
        setP(pick, v, 'auto'); this.flash(pick); return;
      }
      this.glideRandom(pick);
    },
  };

  // ================================================================ LIQUID LIGHT visuals (WebGL)
  const visuals = (() => {
    const cv = $('#lights');
    let gl = null, ok = false, running = false, MAXL = 69, progScene, progPost, quad, fbo = [], tex = [], cur = 0, W = 0, H = 0, sw = 0, sh = 0;
    const pres = new Float32Array(MAXT), hz = new Float32Array(MAXT).fill(100), lfoVis = new Float32Array(4);
    let evs = [0, 0], glitch = 0, last = performance.now(), t = 0, latest = null;
    const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const FS_SCENE = (n) => `precision highp float;varying vec2 v;uniform vec4 L[${n}];uniform vec3 C[${n}];uniform int N;
      uniform sampler2D prev;uniform float decay,asp,echo;
      void main(){vec2 q=vec2(v.x*asp,v.y);vec3 c=vec3(0.);
        for(int i=0;i<${n};i++){if(i>=N)break;vec2 d=q-vec2(L[i].x*asp,L[i].y);c+=C[i]*L[i].w*exp(-dot(d,d)/(L[i].z*L[i].z));}
        vec2 u=v-.5;float a=.006*echo;u=mat2(cos(a),-sin(a),sin(a),cos(a))*u*(1.-.012*echo);
        vec3 pr=texture2D(prev,u+.5).rgb;
        vec3 o=mix(c,max(pr,c),decay);o=max(o-vec3(1.6/255.),0.);gl_FragColor=vec4(o,1.);}`;
    const FS_POST = `precision highp float;varying vec2 v;uniform sampler2D tex;uniform vec2 res;
      uniform float time,dist,glitch,wave,wspd,rev;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec2 uv=v;
        uv.x+=wave*.03*sin(uv.y*14.+time*wspd)+wave*.012*sin(uv.y*41.-time*wspd*1.7);
        float band=floor(uv.y*38.);float hh=hash(vec2(band,floor(time*22.)));
        if(hh<glitch*.55){uv.x+=(hash(vec2(band,floor(time*31.)))-.5)*.3*glitch;uv.y+=(hash(vec2(band,2.))-.5)*.02*glitch;}
        float bl=mix(700.,48.,dist*dist);vec2 buv=mix(uv,(floor(uv*bl)+.5)/bl,smoothstep(.3,1.,dist));
        float ca=.014*dist+.006*glitch;
        vec3 c=vec3(texture2D(tex,buv+vec2(ca,0.)).r,texture2D(tex,buv).g,texture2D(tex,buv-vec2(ca,ca*.4)).b);
        c+=texture2D(tex,uv+vec2(.035*rev,-.01*rev)).rgb*.32*rev+texture2D(tex,uv-vec2(.06*rev,0.)).rgb*.18*rev;
        float lum=dot(c,vec3(.299,.587,.114));
        c+=(hash(uv*res+time*61.)-.5)*(.05+.3*dist+.2*glitch)*lum;
        c*=1.-(.18*dist)*step(.5,fract(uv.y*res.y*.5));
        c=1.-exp(-c*1.7);gl_FragColor=vec4(c,1.);}`;
    function sh_(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function prog(fs) {
      const p = gl.createProgram(); gl.attachShader(p, sh_(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh_(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, nm); }
      return { p, u };
    }
    function init() {
      try {
        gl = cv.getContext('webgl', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
        if (!gl) return;
        const mu = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
        MAXL = clamp(Math.floor((mu - 24) / 2), 8, 69);
        progScene = prog(FS_SCENE(MAXL)); progPost = prog(FS_POST);
        quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        ok = true; resize(); window.addEventListener('resize', resize);
      } catch (e) { ok = false; console.warn('LIQUID LIGHT disabled:', e); }
    }
    function resize() {
      if (!ok) return;
      W = cv.width = Math.max(2, Math.round(innerWidth)); H = cv.height = Math.max(2, Math.round(innerHeight));
      sw = Math.max(2, W >> 1); sh = Math.max(2, H >> 1);
      for (let i = 0; i < 2; i++) {
        if (tex[i]) { gl.deleteTexture(tex[i]); gl.deleteFramebuffer(fbo[i]); }
        tex[i] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        fbo[i] = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i], 0);
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    const G = 1.32471795724474602596;
    function lightPos(i, tt) {
      const x = (0.5 + (i + 1) / G) % 1, y = (0.5 + (i + 1) / (G * G)) % 1;
      return [0.1 + 0.8 * x + 0.035 * Math.sin(tt * (0.05 + 0.013 * (i % 5)) + i * 1.7),
        0.12 + 0.76 * y + 0.03 * Math.cos(tt * (0.04 + 0.011 * (i % 7)) + i * 2.3)];
    }
    const hsl = (hh, s, l) => {                       // -> rgb 0..1
      const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)];
    };
    const Lbuf = new Float32Array(69 * 4), Cbuf = new Float32Array(69 * 3);
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
      const s = latest; const n = tunes.count;
      const a = 1 - Math.exp(-dt / 0.06), al = 1 - Math.exp(-dt / 0.035);
      if (s) {
        for (let i = 0; i < n && i < s.env.length; i++) { pres[i] += ((engine.ready ? s.env[i] : 0) - pres[i]) * a; hz[i] = s.hz[i] || hz[i]; }
        for (let k = 0; k < 4; k++) lfoVis[k] += (s.lfo[k] - lfoVis[k]) * al;
        for (let k = 0; k < 2; k++) { if (s.ev[k] !== evs[k]) { evs[k] = s.ev[k]; glitch = Math.max(glitch, 0.75); } }
      }
      glitch *= Math.exp(-dt / 0.22);
      // collect lights (brightest first if the GPU limits their number)
      const list = [];
      let sounding = 0;
      for (let i = 0; i < n; i++) if (pres[i] > 0.002) { list.push(i); sounding++; }
      if (list.length > MAXL) list.sort((x, y) => pres[y] - pres[x]).length = MAXL;
      const scale = Math.pow(8 / Math.max(8, sounding), 0.3);
      list.forEach((i, j) => {
        const b = i >> 1; let I = Math.pow(pres[i], 0.8) * 1.1, rad = (0.13 + 0.13 * pres[i]) * scale;
        if (V[`source:${b}`] === 2 && V[`tmod:${i}`] > 0) {            // LFO'ed tune pulses with its LFO
          const depth = Math.min(1, V[`tmod:${i}`] / 127 * 2.4), lv = lfoVis[V[`tlfo:${i}`]];
          const k = 1 - depth * 0.7 * (0.5 - 0.5 * lv); I *= k; rad *= 0.85 + 0.15 * k;
        }
        const [x, y] = lightPos(i, t), [r, g, bb] = hsl(hueOf(hz[i]), 1, 0.55);
        Lbuf.set([x, y, rad, I], j * 4); Cbuf.set([r, g, bb], j * 3);
      });
      // glitch drivers: distortion amount, TIMES (notes + sweeps), reverb
      const dist = clamp(Math.pow(V.drv / 127, 1.3) * (V.xmix / 127) * 1.5, 0, 1);
      let wave = 0, wspd = 0;
      for (let k = 0; k < 2; k++) if (V[`xmode:${k}`]) {
        wave = Math.max(wave, V[`xspread:${k}`] / 127);
        wspd = Math.max(wspd, Math.min(8, 1000 / xMs(V[`xspeed:${k}`])) * 6.283);
      }
      const rev = V.rvMix / 100, decay = rev > 0 ? clamp(0.55 + 0.42 * rev * Math.sqrt(V.rvRoom / 100), 0, 0.97) : 0;
      // pass 1: lights + reverb trails into the feedback buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const nx = 1 - cur;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[nx]); gl.viewport(0, 0, sw, sh);
      gl.useProgram(progScene.p); const u = progScene.u;
      gl.uniform4fv(u.L, Lbuf.subarray(0, MAXL * 4)); gl.uniform3fv(u.C, Cbuf.subarray(0, MAXL * 3));
      gl.uniform1i(u.N, list.length); gl.uniform1f(u.decay, decay); gl.uniform1f(u.asp, W / H); gl.uniform1f(u.echo, rev);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(u.prev, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // pass 2: glitch post to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(progPost.p); const q = progPost.u;
      gl.bindTexture(gl.TEXTURE_2D, tex[nx]); gl.uniform1i(q.tex, 0);
      gl.uniform2f(q.res, W, H); gl.uniform1f(q.time, t); gl.uniform1f(q.dist, dist); gl.uniform1f(q.glitch, glitch);
      gl.uniform1f(q.wave, wave); gl.uniform1f(q.wspd, wspd); gl.uniform1f(q.rev, rev);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      cur = nx;
    }
    return {
      init,
      get ok() { return ok; },
      feed(s) { latest = s; },
      setRunning(on) {
        if (on && !ok) init();
        if (!ok) return false;
        if (on && !running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
        if (!on) running = false;
        return true;
      },
    };
  })();

  // ================================================================ boot
  buildRack();
  buildBar();
  callBtn.addEventListener('click', () => auto.click());
  // RANDOM: every knob gets a random value, every switch a 50/50 chance (volume is the only exception)
  function randomizeAll() {
    for (const id in DEF) {
      const d = DEF[id]; if (id === 'vol') continue;
      let v;
      if (d.int) v = d.max === 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.floor(Math.random() * (d.max - d.min + 1)) + d.min;
      else v = fromFrac(d, Math.random());
      setP(id, v, 'user');
    }
    let any = false;
    for (let i = 0; i < tunes.count; i++) { const on = Math.random() < 0.5; engine.key(i, on); if (on) any = true; }
    if (!any) engine.key(Math.floor(Math.random() * tunes.count), true);
    // never end up silent: a soloed oscillator must be sounding, and at least one must be
    const soloed = []; for (let i = 0; i < tunes.count; i++) if (V[`solo:${i}`]) soloed.push(i);
    if (soloed.length && !soloed.some((i) => keyState[i])) engine.key(soloed[Math.floor(Math.random() * soloed.length)], true);
  }
  // RANDOM button: a glass bubble seen through a fisheye lens. At rest the letters spell RANDOM;
  // every press pushes them, and from then on they float freely inside the bubble.
  const randBubble = (() => {
    const btn = $('#randBtn'), cv = btn.querySelector('canvas'), ctx = cv.getContext('2d');
    const K = 1.0, FS = 0.3, RC = 0.11, RMAX = 0.84;          // lens strength, letter size, letter radius, wall (world units, bubble radius = 1)
    const fe = (r) => r * (1 + K) / (1 + K * r);                   // fisheye: magnified centre, compressed rim
    const COL = ['#c8ff2e', '#2ef2ff', '#8b5cff', '#ff3fd8', '#c8ff2e', '#2ef2ff'];
    const L = 'RANDOM'.split('').map((ch, i) => ({ ch, col: COL[i], x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0 }));
    const font = (px) => `${px}px "Tilt Neon", "Martian Mono", system-ui, sans-serif`;
    let S = 1, dpr = 1, floating = false, last = 0, lastFrame = 0;
    const fi = (d) => d / ((1 + K) - K * d);                      // inverse of the lens
    function layout() {                                          // the word at rest, evenly spaced as it is SEEN through the lens
      ctx.font = font(100);
      const ws = L.map((l) => ctx.measureText(l.ch).width / 100 * FS), gap = FS * 0.1;
      let xs = L.map(() => 0);
      for (let it = 0; it < 8; it++) {
        const dw = ws.map((w, i) => w * (1 + K) / (1 + K * Math.abs(xs[i])) ** 2);   // width on screen = width × radial magnification
        const tot = dw.reduce((t, w) => t + w, 0) + gap * (L.length - 1);
        let x = -tot / 2;
        xs = dw.map((w) => { const c = x + w / 2; x += w + gap; return Math.sign(c) * fi(Math.min(0.97, Math.abs(c))); });
      }
      L.forEach((l, i) => { l.x = xs[i]; l.y = 0.02; });
    }
    function resize() {
      const w = btn.clientWidth || 66; dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = cv.height = Math.round(w * dpr); S = cv.width / 2; draw();
    }
    function draw() {
      const c = ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(1, 0, 0, 1, S, S);
      c.save(); c.beginPath(); c.arc(0, 0, S, 0, Math.PI * 2); c.clip();
      let g = c.createRadialGradient(-S * .2, -S * .25, 0, 0, 0, S);
      g.addColorStop(0, '#141c22'); g.addColorStop(.6, '#080b0e'); g.addColorStop(1, '#020304'); c.fillStyle = g; c.fillRect(-S, -S, 2 * S, 2 * S);
      for (let gy = -1; gy <= 1.001; gy += 0.2) for (let gx = -1; gx <= 1.001; gx += 0.2) {      // a dot grid, bent by the lens
        const r = Math.hypot(gx, gy); if (r >= 1) continue;
        const d = r > 1e-6 ? fe(r) / r : 1 + K, sr = (1 + K) / (1 + K * r) ** 2;
        c.fillStyle = `rgba(46,242,255,${(0.2 * (1 - r)).toFixed(3)})`;
        c.beginPath(); c.arc(gx * d * S, gy * d * S, 0.014 * S * sr, 0, Math.PI * 2); c.fill();
      }
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = font(FS * S);
      for (const l of L) {                                          // each letter is mapped through the same lens (radial squeeze + tangential stretch)
        const r = Math.hypot(l.x, l.y), ang = Math.atan2(l.y, l.x), d = r > 1e-6 ? fe(r) / r : 1 + K;
        const sr = (1 + K) / (1 + K * r) ** 2, st = (1 + K) / (1 + K * r);
        c.save(); c.translate(l.x * d * S, l.y * d * S); c.rotate(ang); c.scale(sr, st); c.rotate(-ang); c.rotate(l.a);
        c.shadowColor = l.col; c.shadowBlur = 7 * dpr; c.fillStyle = l.col; c.fillText(l.ch, 0, 0);
        c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.35)'; c.fillText(l.ch, 0, 0);
        c.restore();
      }
      g = c.createRadialGradient(0, 0, S * .55, 0, 0, S);              // glass: darker, thicker rim
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.8, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,.8)'); c.fillStyle = g; c.fillRect(-S, -S, 2 * S, 2 * S);
      c.save(); c.translate(-S * .3, -S * .52); c.rotate(-0.42); c.scale(1, .45);                // highlight
      g = c.createRadialGradient(0, 0, 0, 0, 0, S * .42); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, S * .42, 0, Math.PI * 2); c.fill(); c.restore();
      g = c.createRadialGradient(S * .25, S * .62, 0, S * .25, S * .62, S * .38);                 // bounce light at the bottom
      g.addColorStop(0, 'rgba(255,63,216,.22)'); g.addColorStop(1, 'rgba(255,63,216,0)'); c.fillStyle = g; c.fillRect(-S, -S, 2 * S, 2 * S);
      c.restore();
      c.lineWidth = Math.max(1, 1.2 * dpr); g = c.createLinearGradient(-S, -S, S, S);
      g.addColorStop(0, 'rgba(200,255,46,.55)'); g.addColorStop(.5, 'rgba(46,242,255,.35)'); g.addColorStop(1, 'rgba(255,63,216,.6)');
      c.strokeStyle = g; c.beginPath(); c.arc(0, 0, S - c.lineWidth / 2, 0, Math.PI * 2); c.stroke();
    }
    function step(dt) {
      const drag = Math.exp(-0.55 * dt), spin = Math.exp(-0.9 * dt), kick = 0.42 * Math.sqrt(dt);
      for (const l of L) {                                             // drift like something suspended in water
        l.vx = l.vx * drag + (Math.random() - 0.5) * kick; l.vy = l.vy * drag + (Math.random() - 0.5) * kick;
        l.va = l.va * spin + (Math.random() - 0.5) * 1.2 * Math.sqrt(dt);
        const sp = Math.hypot(l.vx, l.vy); if (sp > 3) { l.vx *= 3 / sp; l.vy *= 3 / sp; }
        l.x += l.vx * dt; l.y += l.vy * dt; l.a += l.va * dt;
        const r = Math.hypot(l.x, l.y);
        if (r > RMAX) {                                                // bounce off the inside of the glass
          const nx = l.x / r, ny = l.y / r, vn = l.vx * nx + l.vy * ny;
          l.x = nx * RMAX; l.y = ny * RMAX;
          if (vn > 0) { l.vx -= 1.75 * vn * nx; l.vy -= 1.75 * vn * ny; l.va += vn * (Math.random() - 0.5) * 6; }
        }
      }
      for (const l of L) {                                             // never let a letter stay still: keep a gentle drift alive
        if (Math.hypot(l.vx, l.vy) < 0.08) { const th = Math.random() * Math.PI * 2; l.vx += Math.cos(th) * 0.25; l.vy += Math.sin(th) * 0.25; }
      }
      for (let i = 0; i < L.length; i++) for (let k = i + 1; k < L.length; k++) {   // letters knock into each other
        const p = L[i], q = L[k];
        let dx = q.x - p.x, dy = q.y - p.y, dd = Math.hypot(dx, dy); const m = 2 * RC;
        if (dd < 1e-6) { const th = Math.random() * Math.PI * 2; dx = Math.cos(th); dy = Math.sin(th); dd = 1; }   // exactly on top: split them
        if (dd >= m) continue;
        const nx = dx / dd, ny = dy / dd, o = (m - dd) / 2;
        p.x -= nx * o; p.y -= ny * o; q.x += nx * o; q.y += ny * o;
        const rv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rv < 0) { const j = -0.9 * rv; p.vx -= j * nx; p.vy -= j * ny; q.vx += j * nx; q.vy += j * ny; }
      }
    }
    function sanitize() {
      for (const l of L) if (!isFinite(l.x + l.y + l.vx + l.vy + l.a + l.va)) { l.x = 0; l.y = 0; l.vx = 0.4; l.vy = 0.3; l.a = 0; l.va = 0; }
    }
    function frame(now) {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; lastFrame = performance.now();
      step(dt); sanitize(); draw(); requestAnimationFrame(frame);
    }
    function push() {                                                  // every press: a fresh shove in a random direction
      for (const l of L) {
        const th = Math.random() * Math.PI * 2, sp = 1.1 + Math.random() * 1.3;
        l.vx += Math.cos(th) * sp + l.x * 1.5; l.vy += Math.sin(th) * sp + l.y * 1.5; l.va += (Math.random() - 0.5) * 12;
      }
      const now = performance.now();
      if (!floating || now - lastFrame > 400) { floating = true; last = now; lastFrame = now; requestAnimationFrame(frame); }
    }
    layout(); resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(btn); else window.addEventListener('resize', resize);
    if (document.fonts && document.fonts.load) document.fonts.load(font(20)).then(() => { if (!floating) layout(); draw(); }).catch(() => {});
    return { push, L, get floating() { return floating; }, get S() { return S; }, layout, draw };
  })();
  $('#randBtn').addEventListener('click', () => { randomizeAll(); randBubble.push(); });
  $('#volSlot').append(bigDial('vol', 'VOLUME'), bigDial('soft', 'SOFTNESS'));
  const bgBtn = $('#bgBtn');
  function setDynamic(on, fromHost = false) {
    if (on && !visuals.setRunning(true)) on = false;
    if (!on) visuals.setRunning(false);
    document.body.classList.toggle('dynamic', on);
    bgBtn.classList.toggle('on', on); bgBtn.setAttribute('aria-pressed', on);
    if (PLUGIN) { if (!fromHost) engine.native({ t: 'dyn', on: on ? 1 : 0 }); return; }   // saved with the plugin session
    try { localStorage.setItem('saraswati1.dynamic', on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  }
  bgBtn.addEventListener('click', () => setDynamic(!document.body.classList.contains('dynamic')));
  if (!PLUGIN) { try { if (localStorage.getItem('saraswati1.dynamic') === '1') setDynamic(true); } catch (e) { /* storage unavailable */ } }
  const modal = $('#modal');
  $('#logoBtn').addEventListener('click', () => { modal.classList.add('open'); $('#closeInfo').focus(); });
  // the manual always opens in its own tab (one tab, reused), never on top of the instrument
  $('#manualBtn').addEventListener('click', (e) => {
    if (PLUGIN) { e.preventDefault(); engine.native({ t: 'open', what: 'manual' }); return; }   // opens in the system browser
    const w = window.open('manual.html', 'saraswati-manual');
    if (w) { e.preventDefault(); try { w.focus(); } catch (err) { /* ignore */ } }   // else: the link's own new-tab target applies
  });
  $('#closeInfo').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
  $('#enterBtn').addEventListener('click', async () => {
    const msg = $('#startMsg');
    try { await engine.start(); $('#overlay').classList.add('gone'); }
    catch (err) { msg.textContent = 'Audio could not start: ' + (err && err.message ? err.message : err); }
  });
  if (PLUGIN) {                                                  // no audio unlock needed inside a plugin
    document.querySelectorAll('.modal a[href^="http"], .modal a[href^="mailto"]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); engine.native({ t: 'open', url: a.href });
    }));
    $('#overlay').classList.add('gone');
    engine.start();
  }
  window.Saraswati = { setP, V, engine, auto, tunes, addBlock, removeBlock, visuals, randBubble };   // handy for debugging
})();
