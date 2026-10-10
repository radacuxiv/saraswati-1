#include "PluginProcessor.h"

#include "PluginEditor.h"
#include "dsp/ParamNames.h"

using namespace saraswati;

namespace
{
const juce::Identifier idDynamic { "dynamicBackground" }, idEditorW { "editorWidth" }, idEditorH { "editorHeight" };
}

SaraswatiProcessor::SaraswatiProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "SARASWATI1", createLayout())
{
    for (const auto& s : paramSpecs())
    {
        EngineParam e;
        e.webId = s.webId; e.hostId = toHostId (e.webId);
        if (! parseParamId (s.webId, e.p, e.index)) continue;
        e.isInt = s.isInt;
        e.param = apvts.getParameter (e.hostId);
        e.raw = apvts.getRawParameterValue (e.hostId);
        jassert (e.param != nullptr && e.raw != nullptr);
        engineParamIndex[e.webId] = (int) engineParams.size();
        engineParams.push_back (e);
    }
    countParam = apvts.getParameter (countHostId);
    for (int i = 0; i < MAXT; ++i) keyParams[(size_t) i] = apvts.getParameter (keyHostId (i));
    lastApplied.assign (engineParams.size(), std::numeric_limits<float>::quiet_NaN());
}

bool SaraswatiProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void SaraswatiProcessor::prepareToPlay (double sampleRate, int)
{
    if (engine == nullptr || sampleRate != currentRate)
    {
        // a fresh engine: everything (count, every value, the keys) is re-sent on the next block
        engine = std::make_unique<Engine> (sampleRate);
        currentRate = sampleRate;
        std::fill (lastApplied.begin(), lastApplied.end(), std::numeric_limits<float>::quiet_NaN());
        keyApplied.fill (false);
        appliedCount = -1;
    }
    midiHeld.fill (0);
    sustained.fill (false);
    sustain = false;
    samplesToReport = 0;
}

void SaraswatiProcessor::applyMidi (const juce::MidiMessage& m)
{
    const auto osc = [] (int note) { return note - firstMidiNote; };
    if (m.isNoteOn())
    {
        const int i = osc (m.getNoteNumber());
        if (i >= 0 && i < MAXT) { ++midiHeld[(size_t) i]; sustained[(size_t) i] = false; }
    }
    else if (m.isNoteOff())
    {
        const int i = osc (m.getNoteNumber());
        if (i >= 0 && i < MAXT && midiHeld[(size_t) i] > 0)
        {
            if (sustain && midiHeld[(size_t) i] == 1) sustained[(size_t) i] = true;
            else --midiHeld[(size_t) i];
        }
    }
    else if (m.isSustainPedalOn()) sustain = true;
    else if (m.isSustainPedalOff())
    {
        sustain = false;
        for (int i = 0; i < MAXT; ++i)
            if (sustained[(size_t) i]) { sustained[(size_t) i] = false; midiHeld[(size_t) i] = std::max (0, midiHeld[(size_t) i] - 1); }
    }
    else if (m.isAllNotesOff() || m.isAllSoundOff())
    {
        midiHeld.fill (0); sustained.fill (false);
    }
}

void SaraswatiProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int numSamples = buffer.getNumSamples();
    buffer.clear();
    if (engine == nullptr || numSamples == 0) return;

    // ---- oscillator count, then every changed value (same order the browser used: count, values, keys)
    const int n = sanitizeCount (countParam->convertFrom0to1 (countParam->getValue()));
    if (n != appliedCount)
    {
        engine->setCount (n);
        for (int i = n; i < MAXT; ++i) keyApplied[(size_t) i] = false;
        appliedCount = n;
    }
    for (size_t k = 0; k < engineParams.size(); ++k)
    {
        const float v = engineParams[k].raw->load (std::memory_order_relaxed);
        if (v != lastApplied[k])   // NaN never compares equal: forces the first push
        {
            lastApplied[k] = v;
            engine->setParam (engineParams[k].p, engineParams[k].index, engineParams[k].isInt ? (double) juce::roundToInt (v) : (double) v);
        }
    }

    auto applyKeys = [this, n]
    {
        for (int i = 0; i < n; ++i)
        {
            const bool on = keyParams[(size_t) i]->getValue() >= 0.5f || midiHeld[(size_t) i] > 0;
            if (on != keyApplied[(size_t) i]) { engine->setKey (i, on); keyApplied[(size_t) i] = on; }
        }
    };
    applyKeys();

    // ---- render, splitting at MIDI events so notes land on the right sample
    float* L = buffer.getWritePointer (0);
    float* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
    int pos = 0;
    for (const auto meta : midi)
    {
        const int at = juce::jlimit (0, numSamples, meta.samplePosition);
        if (at > pos) { engine->render (L + pos, R != nullptr ? R + pos : nullptr, at - pos); pos = at; }
        applyMidi (meta.getMessage());
        applyKeys();
    }
    if (pos < numSamples) engine->render (L + pos, R != nullptr ? R + pos : nullptr, numSamples - pos);

    // ---- live values for the panel, ~30 times a second
    samplesToReport -= numSamples;
    if (samplesToReport <= 0)
    {
        samplesToReport += juce::roundToInt (currentRate / 30.0);
        engine->getReport (scratchReport);
        const juce::SpinLock::ScopedTryLockType lock (reportLock);
        if (lock.isLocked()) { sharedReport = scratchReport; reportValid = true; }
    }
}

bool SaraswatiProcessor::readReport (Report& out)
{
    const juce::SpinLock::ScopedLockType lock (reportLock);
    if (! reportValid) return false;
    out = sharedReport;
    return true;
}

//==============================================================================
bool SaraswatiProcessor::getDynamicBackground() const { return (bool) apvts.state.getProperty (idDynamic, false); }
void SaraswatiProcessor::setDynamicBackground (bool on) { apvts.state.setProperty (idDynamic, on, nullptr); }

juce::Point<int> SaraswatiProcessor::getEditorSize() const
{
    return { (int) apvts.state.getProperty (idEditorW, 1360), (int) apvts.state.getProperty (idEditorH, 860) };
}
void SaraswatiProcessor::setEditorSize (juce::Point<int> s)
{
    apvts.state.setProperty (idEditorW, s.x, nullptr);
    apvts.state.setProperty (idEditorH, s.y, nullptr);
}

void SaraswatiProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    if (auto xml = state.createXml()) copyXmlToBinary (*xml, destData);
}

void SaraswatiProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (apvts.state.getType()))
        {
            apvts.replaceState (juce::ValueTree::fromXml (*xml));
            ++stateGeneration;
        }
}

juce::AudioProcessorEditor* SaraswatiProcessor::createEditor() { return new SaraswatiEditor (*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new SaraswatiProcessor(); }
