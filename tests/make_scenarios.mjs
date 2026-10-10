// Writes scenario files (plain text, one event per line: "<sample> p <id> <value>" | "<sample> key <i> <0|1>" | "<sample> count <n>")
// and renders them through the original JS engine:  node make_scenarios.mjs <outdir> <sampleRate>
import fs from 'node:fs';
import path from 'node:path';
import { loadDefs, makeEngine } from './js_engine.mjs';

const [outDir = 'out', srArg = '48000'] = process.argv.slice(2);
const SR = +srArg;
fs.mkdirSync(outDir, { recursive: true });
const { V } = loadDefs();
const s = (sec) => Math.round(sec * SR);

function base() {               // what the browser does on ENTER: count 10, then every UI default
  const ev = [[0, 'count', 10]];
  for (const k of Object.keys(V)) ev.push([0, 'p', k, V[k]]);
  return ev;
}
const scenarios = {
  basic: [...base(), [s(0.01), 'key', 0, 1], [s(0.3), 'key', 2, 1], [s(0.6), 'key', 7, 1], [s(1.6), 'key', 2, 0], [s(1.2), 'p', 'tune:0', 90]],
  full: [...base(),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [s(0.02 + i * 0.05), 'key', i, 1]),
    [s(0.1), 'p', 'tmod:0', 70], [s(0.1), 'p', 'tmod:1', 50], [s(0.1), 'p', 'source:0', 0], [s(0.1), 'p', 'source:1', 0],
    [s(0.1), 'p', 'source:2', 2], [s(0.1), 'p', 'tmod:4', 90], [s(0.1), 'p', 'tmod:5', 60], [s(0.12), 'p', 'tlfo:5', 3],
    [s(0.15), 'p', 'ring:0', 100], [s(0.15), 'p', 'ring:2', 60], [s(0.15), 'p', 'sharp:1', 90], [s(0.15), 'p', 'sharp:3', 127],
    [s(0.2), 'p', 'thold:6', 80], [s(0.2), 'p', 'link:2', 1], [s(0.2), 'p', 'andor:3', 1], [s(0.2), 'p', 'fa:3', 100],
    [s(0.25), 'p', 'dmix', 84], [s(0.25), 'p', 'feedback', 82.5], [s(0.25), 'p', 'mod1', 90], [s(0.25), 'p', 'mod2', 40],
    [s(0.3), 'p', 't1:3', 0], [s(0.3), 'p', 't2:4', 0], [s(0.3), 'p', 't1:9', 0], [s(0.3), 'p', 't2:9', 0],
    [s(0.35), 'p', 'xmode:0', 1], [s(0.35), 'p', 'xspread:0', 60], [s(0.35), 'p', 'xspeed:0', 90], [s(0.35), 'p', 'xmode:1', 2],
    [s(0.4), 'p', 'xmix', 110], [s(0.4), 'p', 'drv', 100], [s(0.45), 'p', 'rvMix', 60], [s(0.45), 'p', 'rvRoom', 90],
    [s(0.45), 'p', 'rvWidth', 40], [s(0.45), 'p', 'rvPre', 120], [s(0.45), 'p', 'rvLp', 3000], [s(0.45), 'p', 'rvHp', 300],
    [s(0.5), 'p', 'soft', 40], [s(0.5), 'p', 'pitchA', 90], [s(0.6), 'p', 'dmod', 0], [s(0.9), 'p', 'dmod', 2], [s(0.9), 'p', 'dwav', 1],
    [s(1.0), 'p', 'solo:2', 1], [s(1.3), 'p', 'solo:2', 0], [s(1.4), 'p', 'fast:3', 0], [s(1.45), 'key', 6, 0],
    [s(1.5), 'count', 20], [s(1.5), 'key', 15, 1], [s(1.5), 'key', 18, 1], [s(1.55), 'p', 'tune:15', 100],
    [s(1.8), 'p', 'vol', 90], [s(2.0), 'count', 12], [s(2.2), 'p', 'soft', 0], [s(2.4), 'key', 0, 0], [s(2.4), 'key', 1, 0],
  ],
};
// 3 seconds each
for (const [name, evs] of Object.entries(scenarios)) {
  evs.sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(path.join(outDir, name + '.txt'), evs.map((e) => e.join(' ')).join('\n') + '\n');
  const { p, send } = makeEngine(SR, () => 0.5);
  const total = s(3), L = new Float32Array(total), R = new Float32Array(total);
  let e = 0;
  for (let o = 0; o < total; o += 128) {
    while (e < evs.length && evs[e][0] <= o) {            // events land on quantum boundaries, like the browser
      const [, t, a, b] = evs[e++];
      if (t === 'p') send({ t: 'p', k: a, v: b }); else if (t === 'key') send({ t: 'key', i: a, on: b }); else send({ t: 'count', n: a });
    }
    p.process([], [[L.subarray(o, o + 128), R.subarray(o, o + 128)]]);
  }
  const inter = new Float32Array(total * 2);
  for (let i = 0; i < total; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
  fs.writeFileSync(path.join(outDir, name + '.js.f32'), Buffer.from(inter.buffer));
  console.log(name, 'rendered', total, 'frames');
}
