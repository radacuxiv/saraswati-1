// Loads the built VST3 the way a DAW does and checks it end to end:
//   host_test <path/to/Saraswati-1.vst3> <outdir>
// 1. parameters set through the host API + MIDI notes -> audio, written to <outdir>/host.f32 (compared with the engine)
// 2. session state save / recall into a second instance -> must render identically
#include <juce_audio_processors/juce_audio_processors.h>

#include <cstdio>

using namespace juce;

static AudioProcessorParameter* findParam (AudioPluginInstance& p, const String& id)
{
    // VST3 exposes hashed numeric ids, so look the parameter up by its display name
    for (auto* prm : p.getParameters())
        if (prm->getName (128) == id) return prm;
    return nullptr;
}

static bool setNorm (AudioPluginInstance& p, const String& id, float norm)
{
    auto* prm = findParam (p, id);
    if (prm == nullptr) { std::printf ("  missing parameter %s\n", id.toRawUTF8()); return false; }
    prm->setValueNotifyingHost (norm);
    return true;
}

static std::unique_ptr<AudioPluginInstance> load (AudioPluginFormatManager& fm, const String& path, double sr, int bs)
{
    OwnedArray<PluginDescription> types;
    VST3PluginFormat fmt;
    fmt.findAllTypesForFile (types, path);
    if (types.isEmpty()) return nullptr;
    String err;
    auto inst = fm.createPluginInstance (*types[0], sr, bs, err);
    if (inst == nullptr) std::printf ("load error: %s\n", err.toRawUTF8());
    return inst;
}

static void render (AudioPluginInstance& p, std::vector<float>& out, int totalFrames, int bs, const std::vector<std::pair<int, MidiMessage>>& notes)
{
    AudioBuffer<float> buf (2, bs);
    out.assign ((size_t) totalFrames * 2, 0.f);
    for (int pos = 0; pos < totalFrames; pos += bs)
    {
        MidiBuffer midi;
        for (auto& [at, m] : notes)
            if (at >= pos && at < pos + bs) midi.addEvent (m, at - pos);
        buf.clear();
        p.processBlock (buf, midi);
        for (int i = 0; i < bs && pos + i < totalFrames; ++i)
        {
            out[(size_t) (2 * (pos + i))] = buf.getSample (0, i);
            out[(size_t) (2 * (pos + i) + 1)] = buf.getSample (1, i);
        }
    }
}

int main (int argc, char** argv)
{
    if (argc < 3) return 1;
    ScopedJuceInitialiser_GUI juceInit;
    const String path (argv[1]); const File outDir (argv[2]);
    const double SR = 48000; const int BS = 512, frames = 3 * 48000;
    AudioPluginFormatManager fm; fm.addFormat (std::make_unique<VST3PluginFormat>());
    int failures = 0;

    auto a = load (fm, path, SR, BS);
    if (a == nullptr) return 2;
    std::printf ("loaded: %s  params=%d  synth=%d  midiIn=%d\n", a->getName().toRawUTF8(), a->getParameters().size(),
                 (int) a->getPluginDescription().isInstrument, (int) a->acceptsMidi());
    a->setPlayConfigDetails (0, 2, SR, BS);
    a->prepareToPlay (SR, BS);

    // host-side edits (values chosen to be exact in float: 1.0 -> 127, 0.5 -> 63.5, 0.75 -> 95.25, 0.25 -> 31.75)
    bool ok = setNorm (*a, "OSC 1 Key", 1) && setNorm (*a, "OSC 3 Key", 1) && setNorm (*a, "Delay Mix", 1.0f) && setNorm (*a, "Delay Feedback", 0.5f)
           && setNorm (*a, "Distortion Mix", 0.75f) && setNorm (*a, "Delay Mod-1", 0.25f) && setNorm (*a, "Pair 1-2 Source", 0.0f)
           && setNorm (*a, "OSC 1 Mod", 0.5f) && setNorm (*a, "Pair 3-4 Ring", 1.0f);
    if (! ok) ++failures;
    if (auto* p = findParam (*a, "Delay Time-1")) std::printf ("text check: '%s' = %s\n", p->getName (64).toRawUTF8(), p->getCurrentValueAsText().toRawUTF8());
    if (auto* p = findParam (*a, "Reverb Low-Pass")) std::printf ("text check: '%s' = %s\n", p->getName (64).toRawUTF8(), p->getCurrentValueAsText().toRawUTF8());

    MemoryBlock state;
    a->getStateInformation (state);

    // MIDI: note 43 (G2) -> oscillator 8 at exactly 1.0 s, released at 2.0 s; note 37 -> oscillator 2 at ~1.5 s
    const std::vector<std::pair<int, MidiMessage>> notes {
        { 48000, MidiMessage::noteOn (1, 43, (uint8) 100) }, { 72064, MidiMessage::noteOn (1, 37, (uint8) 100) },
        { 96000, MidiMessage::noteOff (1, 43) } };
    std::vector<float> outA;
    render (*a, outA, frames, BS, notes);
    outDir.getChildFile ("host.f32").replaceWithData (outA.data(), outA.size() * 4);
    double rms = 0; for (auto v : outA) rms += (double) v * v; rms = std::sqrt (rms / (double) outA.size());
    std::printf ("instance A rendered: rms=%.4f\n", rms);
    if (rms < 0.01) { std::printf ("FAIL: silent\n"); ++failures; }

    // session recall into a fresh instance
    auto b = load (fm, path, SR, BS);
    b->setPlayConfigDetails (0, 2, SR, BS);
    b->prepareToPlay (SR, BS);
    b->setStateInformation (state.getData(), (int) state.getSize());
    std::vector<float> outB;
    render (*b, outB, frames, BS, notes);
    double maxd = 0; for (size_t i = 0; i < outA.size(); ++i) maxd = std::max (maxd, (double) std::abs (outA[i] - outB[i]));
    std::printf ("state recall: max |A-B| = %.3g  (state %d bytes)\n", maxd, (int) state.getSize());
    if (maxd > 0) { std::printf ("FAIL: recalled instance differs\n"); ++failures; }

    // a host with an odd buffer size must produce the very same audio (fixed internal 128-sample grid)
    const int oddBS = 333;
    auto c = load (fm, path, SR, oddBS);
    c->setPlayConfigDetails (0, 2, SR, oddBS);
    c->prepareToPlay (SR, oddBS);
    c->setStateInformation (state.getData(), (int) state.getSize());
    std::vector<float> outC;
    render (*c, outC, frames, oddBS, notes);
    maxd = 0; for (size_t i = 0; i < outA.size(); ++i) maxd = std::max (maxd, (double) std::abs (outA[i] - outC[i]));
    std::printf ("block size 512 vs 333: max |A-C| = %.3g\n", maxd);
    if (maxd > 0) { std::printf ("FAIL: output depends on block size\n"); ++failures; }

    a->releaseResources(); b->releaseResources(); c->releaseResources();
    std::printf (failures == 0 ? "HOST TEST PASSED\n" : "HOST TEST FAILED\n");
    return failures;
}
