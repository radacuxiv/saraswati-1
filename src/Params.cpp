#include "Params.h"

#include "dsp/ParamNames.h"

namespace saraswati
{

const std::vector<ParamSpec>& paramSpecs()
{
    static const std::vector<ParamSpec> specs {
#include "ParamTable.inc"
    };
    return specs;
}

namespace
{
using juce::String;

double mtof (double m) { return 8.17579891564 * std::exp (0.0577622650 * m); }
double lfoHz (double v) { const double x = v / 127; return mtof (127 * x * x - 75); }
double timeMs (double v) { return 1.45125 * std::pow (2.0, 12 * v / 127); }
double xMs (double v) { return 10 * std::pow (6000.0, (127 - v) / 127); }

String fixed (double v, int d) { return String (v, d); }
String fHz (double f) { return (f < 1 ? fixed (f, 2) : f < 10 ? fixed (f, 1) : String (juce::roundToInt (f))) + " Hz"; }
String fMs (double ms) { return ms < 10 ? fixed (ms, 1) + " ms" : ms < 1000 ? String (juce::roundToInt (ms)) + " ms" : fixed (ms / 1000, 2) + " s"; }
String fKhz (double f) { return f >= 1000 ? fixed (f / 1000, f >= 10000 ? 0 : 1) + " kHz" : String (juce::roundToInt (f)) + " Hz"; }
String pct (double v) { return String (juce::roundToInt (v / 127 * 100)) + "%"; }

/** Base frequency of an oscillator's TUNE value (same table as the engine, before PITCH). */
double tuneHz (int i, double v)
{
    static const double T[8][2] = { { -16, 93 }, { -16, 93 }, { 7, 109 }, { 9, 107 }, { 20, 116.54 }, { 20, 116.54 }, { 33, 126.24 }, { 33, 131.22 } };
    const auto& r = T[i % 8];
    return mtof (r[0] + v / 127 * (r[1] - r[0]));
}

String pairName (int b) { return "Pair " + String (2 * b + 1) + "-" + String (2 * b + 2); }

String displayName (P p, int i)
{
    const String osc = "OSC " + String (i + 1) + " ";
    switch (p)
    {
        case P::tune: return osc + "Tune";
        case P::tmod: return osc + "Mod";
        case P::thold: return osc + "Hold";
        case P::tlfo: return osc + "LFO Select";
        case P::t1: return osc + "Send T1";
        case P::t2: return osc + "Send T2";
        case P::solo: return osc + "Solo";
        case P::fast: return pairName (i) + " Fast";
        case P::sharp: return pairName (i) + " Tri-Sqr";
        case P::source: return pairName (i) + " Source";
        case P::ring: return pairName (i) + " Ring";
        case P::fa: return "LFO " + String (i + 1) + " F-A";
        case P::fb: return "LFO " + String (i + 1) + " F-B";
        case P::andor: return "LFO " + String (i + 1) + " AND/OR";
        case P::link: return "LFO " + String (i + 1) + " Link";
        case P::xmode: return "TIME-" + String (i + 1) + " Mode";
        case P::xspread: return "TIME-" + String (i + 1) + " Spread";
        case P::xspeed: return "TIME-" + String (i + 1) + " Speed";
        case P::xchance: return "TIME-" + String (i + 1) + " Chance";
        case P::xlength: return "TIME-" + String (i + 1) + " Length";
        case P::pitchA: return "Pitch OSC 1-4";
        case P::pitchB: return "Pitch OSC 5-8";
        case P::time1: return "Delay Time-1";
        case P::time2: return "Delay Time-2";
        case P::mod1: return "Delay Mod-1";
        case P::mod2: return "Delay Mod-2";
        case P::feedback: return "Delay Feedback";
        case P::dmix: return "Delay Mix";
        case P::dmod: return "Delay Mod Source";
        case P::dwav: return "Delay Mod Wave";
        case P::drv: return "Distortion Drive";
        case P::xmix: return "Distortion Mix";
        case P::soft: return "Softness";
        case P::vol: return "Volume";
        case P::rvMix: return "Reverb Mix";
        case P::rvRoom: return "Reverb Room";
        case P::rvDamp: return "Reverb Damp";
        case P::rvWidth: return "Reverb Width";
        case P::rvPre: return "Reverb Pre-Delay";
        case P::rvLp: return "Reverb Low-Pass";
        case P::rvHp: return "Reverb High-Pass";
    }
    return "?";
}

/** Same read-outs as the panel. */
String formatValue (P p, int i, double v)
{
    switch (p)
    {
        case P::tune: return fixed (tuneHz (i, v), 2) + " Hz";
        case P::fa: case P::fb: return fHz (lfoHz (v));
        case P::time1: case P::time2: return fMs (timeMs (v));
        case P::mod1: case P::mod2: { const double x = v / 127; return String::fromUTF8 ("\xc2\xb1") + fixed (x * x * 10, 1) + " ms"; }
        case P::feedback: { const double x = v / 127; return String::fromUTF8 ("\xc3\x97") + fixed (x * std::pow (4.0, x), 2); }
        case P::xspeed: return fMs (xMs (v));
        case P::xspread: return String::fromUTF8 ("\xc2\xb1") + String (juce::roundToInt (v / 2));
        case P::xchance: return String (juce::roundToInt (v)) + "%";
        case P::xlength: { const double x = v / 127; return fMs (std::max (10.0, 10000 * x * x)); }
        case P::drv: return "+" + fixed (3 + std::pow (3.0, 2 * v / 127 + 1), 1) + " dB";
        case P::vol: return String (juce::roundToInt (v / 127 * 100));
        case P::soft: return String (juce::roundToInt (v));
        case P::rvMix: case P::rvRoom: case P::rvDamp: case P::rvWidth: return String (juce::roundToInt (v)) + "%";
        case P::rvPre: return String (juce::roundToInt (v)) + " ms";
        case P::rvLp: case P::rvHp: return fKhz (v);
        case P::pitchA: case P::pitchB: return String::fromUTF8 ("\xc3\x97") + fixed (v / 127 * 1.99 + 0.01, 2);
        default: return pct (v);
    }
}

juce::StringArray choiceLabels (P p)
{
    switch (p)
    {
        case P::tlfo:   return { "LFO 1", "LFO 2", "LFO 3", "LFO 4" };
        case P::source: return { "Cross", "Off", "LFO" };
        case P::dmod:   return { "Self", "Off", "LFO-1" };
        case P::dwav:   return { "Tri", "Sqr" };
        case P::xmode:  return { "Random", "Saw", "Rev" };
        case P::andor:  return { "AND", "OR" };
        default:        return {};
    }
}

juce::NormalisableRange<float> rangeFor (const ParamSpec& s)
{
    if (s.isLog)
        return { s.min, s.max,
                 [] (float a, float b, float f) { return a * std::pow (b / a, f); },
                 [] (float a, float b, float v) { return std::log (v / a) / std::log (b / a); } };
    return { s.min, s.max };
}
} // namespace

juce::AudioProcessorValueTreeState::ParameterLayout createLayout()
{
    using namespace juce;
    AudioProcessorValueTreeState::ParameterLayout layout;
    constexpr int version = 1;

    // master controls first, so hosts list them at the top
    std::vector<const ParamSpec*> order;
    for (auto& s : paramSpecs()) if (String (s.webId) == "vol" || String (s.webId) == "soft") order.push_back (&s);
    for (auto& s : paramSpecs()) if (String (s.webId) != "vol" && String (s.webId) != "soft") order.push_back (&s);

    for (auto* s : order)
    {
        P p; int idx;
        if (! parseParamId (s->webId, p, idx)) { jassertfalse; continue; }
        const ParameterID pid { toHostId (s->webId), version };
        const auto name = displayName (p, idx);
        const auto labels = choiceLabels (p);

        if (! labels.isEmpty())
            layout.add (std::make_unique<AudioParameterChoice> (pid, name, labels, roundToInt (s->def)));
        else if (s->isInt && s->min == 0 && s->max == 1)
            layout.add (std::make_unique<AudioParameterBool> (pid, name, s->def > 0.5f));
        else if (s->isInt)
            layout.add (std::make_unique<AudioParameterInt> (pid, name, (int) s->min, (int) s->max, roundToInt (s->def)));
        else
            layout.add (std::make_unique<AudioParameterFloat> (pid, name, rangeFor (*s), s->def,
                AudioParameterFloatAttributes().withStringFromValueFunction ([p, idx] (float v, int) { return formatValue (p, idx, v); })));
    }

    layout.add (std::make_unique<AudioParameterInt> (ParameterID { countHostId, version }, "Oscillators", 8, MAXT, 10));
    for (int i = 0; i < MAXT; ++i)
        layout.add (std::make_unique<AudioParameterBool> (ParameterID { keyHostId (i), version }, "OSC " + String (i + 1) + " Key", false));

    return layout;
}

} // namespace saraswati
