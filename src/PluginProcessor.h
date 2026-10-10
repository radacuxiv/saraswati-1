#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "Params.h"
#include "dsp/SaraswatiDSP.h"

class SaraswatiProcessor final : public juce::AudioProcessor
{
public:
    SaraswatiProcessor();
    ~SaraswatiProcessor() override = default;

    //==============================================================================
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    //==============================================================================
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    //==============================================================================
    // Used by the editor (message thread)
    juce::AudioProcessorValueTreeState apvts;
    std::vector<saraswati::EngineParam> engineParams;              // every engine parameter, in a fixed order
    std::map<juce::String, int> engineParamIndex;                   // web id -> index into engineParams
    juce::RangedAudioParameter* countParam = nullptr;
    std::array<juce::RangedAudioParameter*, saraswati::MAXT> keyParams {};

    /** Copies the latest live values (Hz, envelopes, keys, LFO lights ...). Returns false if none yet. */
    bool readReport (saraswati::Report& out);

    /** Bumped whenever the whole state is replaced (session recall), so the panel reloads everything. */
    std::atomic<int> stateGeneration { 0 };

    bool getDynamicBackground() const;
    void setDynamicBackground (bool on);
    juce::Point<int> getEditorSize() const;
    void setEditorSize (juce::Point<int>);

    /** First MIDI note that plays oscillator 1 (C2). Notes 36..104 play oscillators 1..69. */
    static constexpr int firstMidiNote = 36;

private:
    void applyMidi (const juce::MidiMessage&);

    std::unique_ptr<saraswati::Engine> engine;
    double currentRate = 0;
    std::vector<float> lastApplied;
    std::array<int, saraswati::MAXT> midiHeld {};
    std::array<bool, saraswati::MAXT> keyApplied {};
    int appliedCount = -1;
    bool sustain = false;
    std::array<bool, saraswati::MAXT> sustained {};

    juce::SpinLock reportLock;
    saraswati::Report sharedReport, scratchReport;
    bool reportValid = false;
    int samplesToReport = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SaraswatiProcessor)
};
