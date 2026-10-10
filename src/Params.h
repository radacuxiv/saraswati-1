/*  Saraswati-1 — plugin parameter set.
 *
 *  Every control of the web panel becomes a host parameter (automatable, saved with the session).
 *  Host ids use '_' where the web panel uses ':'  ("tune:12" <-> "tune_12").
 *  Values are stored in the panel's own units (0..127, %, Hz ...), so the engine and the
 *  panel see exactly the numbers they always did.
 */
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "dsp/SaraswatiDSP.h"

namespace saraswati
{

struct ParamSpec
{
    const char* webId;   // id used by the web panel / engine ("tune:12")
    float min, max, def;
    bool isInt, isLog;
};

/** The table generated from js/saraswati.js (see tools/gen_param_table.mjs). */
const std::vector<ParamSpec>& paramSpecs();

/** One engine parameter as the processor sees it. */
struct EngineParam
{
    juce::String webId, hostId;
    P p; int index;
    bool isInt;
    juce::RangedAudioParameter* param = nullptr;
    std::atomic<float>* raw = nullptr;
};

inline juce::String toHostId (const juce::String& webId) { return webId.replaceCharacter (':', '_'); }
inline juce::String toWebId (const juce::String& hostId)  { return hostId.replaceCharacter ('_', ':'); }

inline juce::String keyHostId (int i) { return "key_" + juce::String (i); }
inline const char* const countHostId = "count";

juce::AudioProcessorValueTreeState::ParameterLayout createLayout();

/** Oscillator count rule of the panel: 8..68 in pairs, or all 69. */
inline int sanitizeCount (float v)
{
    int n = juce::jlimit (8, MAXT, juce::roundToInt (v));
    if (n < MAXT && (n & 1) != 0) ++n;
    return n;
}

} // namespace saraswati
