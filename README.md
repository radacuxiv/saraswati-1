# Saraswati-1 — VST3 / AU / AAX

The Saraswati-1 drone synthesizer as an instrument plugin, built with JUCE 8.

- **Sound engine**: `src/dsp/` is a sample-by-sample C++ port of `js/dsp.js`. It is tested
  bit-for-bit against the browser engine (see *Tests*), so the plugin sounds exactly like the web version.
- **Panel**: the plugin window shows the original HTML panel (`ui/`) in the system web view
  (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux). Knobs, the oscillator bar,
  CALL SARASWATI, RANDOM, LIVE BACKGROUND and the manual all work as before. The panel is
  embedded in the binary and the fonts are bundled, so nothing is loaded from the internet.
- **Formats**: VST3 + AU + AAX + Standalone on macOS (universal arm64/x86_64), VST3 + AAX + Standalone
  on Windows, VST3 + Standalone on Linux.

## How the instrument behaves in a DAW

| | |
|---|---|
| Plugin type | Instrument / synth, stereo out (mono also supported), MIDI in |
| Parameters | All ~670 panel controls, plus `Oscillators` (8–69) and `OSC n Key` (69 on/off switches). Everything is automatable and saved with the session. |
| Oscillator keys | Click the keys on the panel (latching, like the web version), automate `OSC n Key`, or play MIDI notes. |
| MIDI | Notes **36–104 (C2–G#7)** gate oscillators **1–69** while held. The sustain pedal (CC64) holds them. Velocity is ignored, as on the original instrument. |
| Automation "touch" | Grabbing a knob sends begin/end gestures to the host, so touch/latch automation works. |
| Block size | The engine runs on a fixed internal 128-sample grid, so audio is identical whatever buffer size the host uses. |
| CALL SARASWATI | The autoplay runs in the panel, so it plays only while the plugin window is open. Its moves are ordinary parameter changes, which means the host can record them as automation. |
| Manual | Opens in your default browser. |

## Building

You need CMake 3.22+ and a C++17 compiler. JUCE 8.0.15 is downloaded automatically, or you can point
`-DJUCE_DIR=/path/to/JUCE` at your own copy.

**macOS** (Xcode 15+):
```sh
cmake -S . -B build -G Xcode
cmake --build build --config Release
# -> build/Saraswati1_artefacts/Release/{VST3,AU,AAX,Standalone}
```

**Windows** (Visual Studio 2022). WebView2 is linked statically, so its NuGet package is needed at build time:
```powershell
nuget install Microsoft.Web.WebView2 -Version 1.0.3485.44 -OutputDirectory webview2
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DJUCE_WEBVIEW2_PACKAGE_LOCATION="$PWD\webview2"
cmake --build build --config Release
```

**Linux**: install the packages listed in `.github/workflows/build.yml`, then
`cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build`.

**GitHub Actions** (no Mac or PC needed): push this folder to a GitHub repository. The workflow in
`.github/workflows/build.yml` builds every format on macOS, Windows and Linux, runs `auval` and
`pluginval` on the results, and uploads zips as build artifacts. If you push a tag like `v1.0.0`,
it also attaches the zips to a GitHub release.

### Options

| CMake option | Default | |
|---|---|---|
| `SARASWATI_WEBVIEW` | ON | OFF builds without the web panel. The host's generic parameter editor is then the only interface. |
| `SARASWATI_STANDALONE` | ON | Also builds a standalone app. |
| `SARASWATI_TESTS` | OFF | Builds `render_cpp` and `host_test`. |

## Install locations

| | macOS | Windows |
|---|---|---|
| VST3 | `~/Library/Audio/Plug-Ins/VST3/` | `C:\Program Files\Common Files\VST3\` |
| AU | `~/Library/Audio/Plug-Ins/Components/` | — |
| AAX | `/Library/Application Support/Avid/Audio/Plug-Ins/` | `C:\Program Files\Common Files\Avid\Audio\Plug-Ins\` |

## Before you distribute

- **AAX signing.** The AAX SDK ships with JUCE 8, so the AAX build needs nothing extra. However,
  release versions of Pro Tools load only AAX plugins signed with PACE/iLok wraptool. Unsigned builds
  run in *Pro Tools Developer*, which you get from Avid's developer program. To sign: join the Avid
  developer program, get a PACE account, and run `wraptool sign` on the `.aaxplugin`.
- **macOS signing and notarization.** CI builds are signed ad hoc. Before you share them, sign them
  with a Developer ID Application certificate and notarize them (`codesign`, then `xcrun notarytool`).
  Until you do, anyone who downloads them has to clear the quarantine flag:
  `xattr -dr com.apple.quarantine Saraswati-1.component`.
- **Windows.** The panel needs the Microsoft Edge WebView2 Runtime. Windows 11 includes it, and on
  Windows 10 it comes with Edge updates.
- **IDs.** The manufacturer code `Rdcx`, plugin code `Srw1` and bundle id `dev.panasko.saraswati1`
  are placeholders in `CMakeLists.txt`. Pick your own before the first release, because changing
  them later breaks saved sessions.
- **Licensing.** JUCE 8 is dual-licensed (AGPLv3 or a commercial JUCE licence). For closed-source
  distribution you need a JUCE licence; JUCE has a free *Starter* tier for small revenues. The bundled
  fonts are under the SIL Open Font License (`ui/fonts/OFL-*.txt`).

## Project layout

```
src/dsp/SaraswatiDSP.*    engine: C++ port of js/dsp.js (no JUCE dependency)
src/dsp/ParamNames.h      web parameter ids -> engine
src/Params.*              host parameters (names, ranges, read-outs like "96 ms", "9.0 kHz")
src/ParamTable.inc        generated from the panel's own table: node tools/gen_param_table.mjs > src/ParamTable.inc
src/PluginProcessor.*     parameters -> engine, MIDI, state, live values for the panel
src/PluginEditor.*        web view, resource server, panel <-> plugin bridge
ui/                       the panel (index.html, manual.html, css, js, fonts); still runs as a web app too
tests/                    engine-vs-browser comparison, DAW-style host test, panel bridge test
```

The panel works both ways. Opened in a browser, `ui/index.html` is the original Web Audio
instrument. Inside the plugin, `saraswati.js` detects JUCE's `window.__JUCE__` and sends everything
to the native engine instead.

## Tests

```sh
cmake -S . -B build -DSARASWATI_TESTS=ON && cmake --build build
node tests/make_scenarios.mjs out 48000                      # renders scenarios with the browser engine
for n in basic full; do build/render_cpp out/$n.txt out/$n.cpp.f32 48000; done
python3 tests/compare.py out basic full                       # -> MATCH (bit-identical at 44.1k and 48k)
build/host_test_artefacts/Release/host_test build/Saraswati1_artefacts/Release/VST3/Saraswati-1.vst3 out
python3 tests/ui_bridge_test.py ui shot.png                   # panel bridge, in headless Chromium (Playwright)
```
