#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

/** The plugin window: the original Saraswati-1 HTML panel running in the system web view
    (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), wired to the native engine. */
class SaraswatiEditor final : public juce::AudioProcessorEditor,
                              private juce::Timer
{
public:
    explicit SaraswatiEditor (SaraswatiProcessor&);
    ~SaraswatiEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void onUiMessage (const juce::var& message);
    void sendInit();
    void sendState();
    void pollHostChanges();
    void setFromUi (juce::RangedAudioParameter* p, float rawValue);
    juce::RangedAudioParameter* findParam (const juce::String& webId) const;
    void emit (const juce::Identifier& eventId, const juce::var& payload);
    void openManual();

    SaraswatiProcessor& proc;
    std::vector<float> uiValues;          // what the panel currently shows, per engine parameter
    int uiCount = -1, uiGeneration = -1;
    bool pageReady = false, uiDyn = false;
    std::set<juce::RangedAudioParameter*> touching;
    saraswati::Report report;

   #if JUCE_WEB_BROWSER
    struct Browser;
    std::unique_ptr<Browser> browser;
   #else
    juce::Label unavailable;
   #endif

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SaraswatiEditor)
};
