// Test helpers: load the browser DSP (ui/js/dsp.js, unchanged from the web version) and the panel's
// parameter table in Node.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(new URL(import.meta.url).pathname);
export const WEB = path.resolve(here, '../ui');

/** The UI parameter table (DEF) exactly as saraswati.js defines it. */
export function loadDefs() {
  const src = fs.readFileSync(path.join(WEB, 'js/saraswati.js'), 'utf8');
  const a = src.indexOf('  // ================================================================ helpers');
  const b = src.indexOf('  const toFrac =');                  // helpers .. parameter definitions
  const body = src.slice(a, b).replace(/^.*document\..*$/gm, '');
  return new Function(body + '\nreturn { DEF, V };')();
}

/** Instantiates the AudioWorklet processor from dsp.js with tiny shims. */
export function makeEngine(sampleRate, random) {
  const code = fs.readFileSync(path.join(WEB, 'js/dsp.js'), 'utf8');
  let Proc = null;
  const posted = [];
  class AWP { constructor() { this.port = { postMessage: (m) => posted.push(m), onmessage: null }; } }
  const mathShim = Object.create(Math);
  if (random) mathShim.random = random;
  const ctx = { sampleRate, AudioWorkletProcessor: AWP, registerProcessor: (n, c) => { Proc = c; }, Math: mathShim,
    Float32Array, Float64Array, Int32Array, Uint8Array, console };
  vm.createContext(ctx);
  vm.runInContext(code + '\nSaraswatiDSP();', ctx);
  const p = new Proc();
  return { p, send: (m) => p.port.onmessage({ data: m }), posted };
}
