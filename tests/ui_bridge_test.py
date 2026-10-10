"""Exercises the HTML panel's plugin bridge in Chromium with a mock of JUCE's native backend.
   python3 ui_bridge_test.py <ui-dir> <screenshot.png>
The mock behaves like PluginEditor.cpp: answers 'hello' with an 'init', streams 'state', and records
every message the panel sends."""
import functools, http.server, json, sys, threading
from playwright.sync_api import sync_playwright

ui_dir, shot = sys.argv[1], sys.argv[2]
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ui_dir))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

MOCK = """
window.__sent = [];
window.__JUCE__ = { backend: {
  listeners: {},
  addEventListener(id, fn) { (this.listeners[id] = this.listeners[id] || []).push(fn); return [id, fn]; },
  emitEvent(id, m) {
    window.__sent.push(JSON.parse(JSON.stringify(m)));
    if (m.t === 'hello') setTimeout(() => this.fire('host', { t: 'init', count: 20, values: { vol: 100, dmix: 50, 'tune:15': 99, 'xmode:0': 1 }, dyn: false }), 10);
  },
  fire(id, m) { (this.listeners[id] || []).forEach((f) => f(m)); },
}};
setInterval(() => { const n = 20; window.__JUCE__.backend.fire('state', {
  hz: Array.from({length: n}, (_, i) => 55 * (i + 1)), env: Array.from({length: n}, (_, i) => i < 3 ? 1 : 0),
  keys: Array.from({length: n}, (_, i) => i < 3 ? 1 : 0), lfo: [1, -1, 1, -1], ev: [0, 0], sweep: [0.1, 0] }); }, 33);
"""

errors, results = [], []
def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1360, "height": 860})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.add_init_script(MOCK)
    pg.goto(url)
    pg.wait_for_timeout(800)

    sent = lambda: pg.evaluate("window.__sent")
    check("panel says hello on load", any(m.get("t") == "hello" for m in sent()))
    check("start overlay hidden in plugin", "gone" in pg.get_attribute("#overlay", "class"))
    check("init count=20 builds 10 oscillator blocks", pg.locator(".block").count() == 10, pg.locator(".block").count())
    check("init values applied (VOLUME dial shows 79)", pg.inner_text(".vdial .vd-val") == "79", pg.inner_text(".vdial .vd-val"))
    check("init does not echo values back", not any(m.get("t") == "p" for m in sent()))
    check("state stream shows Hz read-out", "55.00" in pg.inner_text(".tune .hz"), pg.inner_text(".tune .hz"))
    check("state stream lights keys", pg.locator(".key.on").count() == 3, pg.locator(".key.on").count())

    pg.evaluate("window.__sent = []")
    pg.locator(".key").nth(5).click()
    check("key click -> {t:'key', i:5, on:1}", {"t": "key", "i": 5, "on": 1} in sent(), sent())

    pg.evaluate("window.__sent = []")
    knob = pg.locator(".p-delay .knob svg").first
    knob.scroll_into_view_if_needed()
    bb = knob.bounding_box()
    pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    pg.mouse.down(); pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] - 40, steps=5); pg.mouse.up()
    s = sent()
    check("knob drag -> gesture begin, values, gesture end",
          s and s[0] == {"t": "g", "k": "time1", "on": 1} and s[-1] == {"t": "g", "k": "time1", "on": 0}
          and any(m.get("t") == "p" and m.get("k") == "time1" for m in s), s or "nothing sent")

    pg.evaluate("window.__sent = []")
    pg.evaluate("window.__JUCE__.backend.fire('host', {t:'p', k:'dmix', v:127})")
    pg.wait_for_timeout(50)
    check("host automation updates the knob", pg.evaluate("Saraswati.V.dmix") == 127)
    check("host automation is not echoed", not any(m.get("t") == "p" for m in sent()), sent())

    pg.evaluate("window.__JUCE__.backend.fire('host', {t:'count', n:12})")
    pg.wait_for_timeout(50)
    check("host count=12 -> 6 blocks", pg.locator(".block").count() == 6, pg.locator(".block").count())
    check("host count change sends nothing back", not any(m.get("t") in ("count", "key") for m in sent()), sent())

    pg.evaluate("window.__sent = []")
    pg.click(".add-card")
    s = sent()
    check("ADD 2 OSC -> count 14 + new oscillator defaults", {"t": "count", "n": 14} in s and any(m.get("k") == "tune:13" for m in s))

    pg.evaluate("window.__sent = []")
    pg.click("#bgBtn")
    check("LIVE BACKGROUND -> saved through host", any(m.get("t") == "dyn" for m in sent()), sent())
    pg.click("#bgBtn")

    pg.evaluate("window.__sent = []")
    pg.click("#logoBtn"); pg.click("#manualBtn")
    check("MANUAL -> open request to host", {"t": "open", "what": "manual"} in sent(), sent())
    pg.click("#closeInfo")

    pg.evaluate("window.__sent = []")
    pg.click("#randBtn")
    n = sum(1 for m in sent() if m.get("t") == "p")
    check("RANDOM sends every control", n > 300, n)

    pg.evaluate("window.__JUCE__.backend.fire('host', {t:'count', n:20})")
    pg.wait_for_timeout(600)
    fonts = pg.evaluate("Promise.all(['Archivo','Martian Mono','Orbitron','Rubik Glitch Pop','Tilt Neon'].map(f => document.fonts.load('20px \"'+f+'\"').then(r => r.length > 0)))")
    check("embedded fonts load offline", all(fonts), fonts)
    pg.screenshot(path=shot)
    check("no JavaScript errors", not errors, errors[:3])
    b.close()

srv.shutdown()
bad = [n for n, ok in results if not ok]
print("UI BRIDGE TEST " + ("PASSED" if not bad else f"FAILED: {bad}"))
sys.exit(1 if bad else 0)
