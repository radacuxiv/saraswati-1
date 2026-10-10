#include "PluginEditor.h"

#include "UiData.h"

using namespace saraswati;

namespace
{
const juce::Identifier evFromUi { "saraswati" }, evHost { "host" }, evState { "state" };

[[maybe_unused]] juce::String mimeFor (const juce::String& path)
{
    const auto ext = path.fromLastOccurrenceOf (".", false, false).toLowerCase();
    if (ext == "html") return "text/html";
    if (ext == "css")  return "text/css";
    if (ext == "js")   return "text/javascript";
    if (ext == "woff") return "font/woff";
    if (ext == "svg")  return "image/svg+xml";
    if (ext == "png")  return "image/png";
    return "application/octet-stream";
}

/** Embedded panel files, looked up by file name (the panel's files all have distinct names). */
const char* findUiFile (const juce::String& name, int& size)
{
    for (int i = 0; i < UiData::namedResourceListSize; ++i)
        if (name == UiData::getNamedResourceOriginalFilename (UiData::namedResourceList[i]))
            return UiData::getNamedResource (UiData::namedResourceList[i], size);
    size = 0;
    return nullptr;
}

bool isSafeExternalUrl (const juce::String& url)
{
    return url.startsWithIgnoreCase ("https://") || url.startsWithIgnoreCase ("http://") || url.startsWithIgnoreCase ("mailto:");
}

juce::var floatArray (const float* v, int n)
{
    juce::Array<juce::var> a; a.ensureStorageAllocated (n);
    for (int i = 0; i < n; ++i) a.add ((double) v[i]);
    return a;
}
} // namespace

//==============================================================================
#if JUCE_WEB_BROWSER
struct SaraswatiEditor::Browser final : public juce::WebBrowserComponent
{
    using WebBrowserComponent::WebBrowserComponent;

    // Links never navigate the plugin window away from the panel: they open in the system browser.
    bool pageAboutToLoad (const juce::String& url) override
    {
        if (url.startsWith (getResourceProviderRoot()) || url.startsWith ("about:") || url.startsWith ("data:"))
            return true;
        if (isSafeExternalUrl (url)) juce::URL (url).launchInDefaultBrowser();
        return false;
    }
    void newWindowAttemptingToLoad (const juce::String& url) override
    {
        if (isSafeExternalUrl (url)) juce::URL (url).launchInDefaultBrowser();
    }
};
#endif

SaraswatiEditor::SaraswatiEditor (SaraswatiProcessor& p)
    : AudioProcessorEditor (p), proc (p)
{
    uiValues.assign (proc.engineParams.size(), 0.0f);

   #if JUCE_WEB_BROWSER
    auto options = juce::WebBrowserComponent::Options {}
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}
                                     .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Saraswati-1 WebView2"))
                                     .withBackgroundColour (juce::Colour (0xff040506))
                                     .withStatusBarDisabled())
        .withNativeIntegrationEnabled()
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withEventListener (evFromUi, [this] (const juce::var& m) { onUiMessage (m); })
        .withResourceProvider ([] (const juce::String& url) -> std::optional<juce::WebBrowserComponent::Resource>
        {
            auto path = url.upToFirstOccurrenceOf ("?", false, false).upToFirstOccurrenceOf ("#", false, false);
            if (path.isEmpty() || path == "/") path = "index.html";
            const auto name = path.fromLastOccurrenceOf ("/", false, false);
            int size = 0;
            if (const auto* data = findUiFile (name, size))
            {
                std::vector<std::byte> bytes ((size_t) size);
                std::memcpy (bytes.data(), data, (size_t) size);
                return juce::WebBrowserComponent::Resource { std::move (bytes), mimeFor (name) };
            }
            return std::nullopt;
        });

    browser = std::make_unique<Browser> (options);
    addAndMakeVisible (*browser);
    browser->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
   #else
    unavailable.setText ("Saraswati-1: this build has no web view (JUCE_WEB_BROWSER=0). "
                         "The instrument still plays; use the host's generic parameter view.", juce::dontSendNotification);
    unavailable.setJustificationType (juce::Justification::centred);
    unavailable.setColour (juce::Label::textColourId, juce::Colours::white);
    addAndMakeVisible (unavailable);
   #endif

    setResizable (true, true);
    setResizeLimits (900, 600, 3200, 2200);
    const auto sz = proc.getEditorSize();
    setSize (juce::jlimit (900, 3200, sz.x), juce::jlimit (600, 2200, sz.y));
    startTimerHz (30);
}

SaraswatiEditor::~SaraswatiEditor()
{
    stopTimer();
    for (auto* p : touching) p->endChangeGesture();
    touching.clear();
}

void SaraswatiEditor::paint (juce::Graphics& g) { g.fillAll (juce::Colour (0xff040506)); }

void SaraswatiEditor::resized()
{
   #if JUCE_WEB_BROWSER
    browser->setBounds (getLocalBounds());
   #else
    unavailable.setBounds (getLocalBounds().reduced (20));
   #endif
    proc.setEditorSize ({ getWidth(), getHeight() });
}

//==============================================================================
void SaraswatiEditor::emit (const juce::Identifier& eventId, const juce::var& payload)
{
   #if JUCE_WEB_BROWSER
    if (pageReady) browser->emitEventIfBrowserIsVisible (eventId, payload);
   #else
    juce::ignoreUnused (eventId, payload);
   #endif
}

juce::RangedAudioParameter* SaraswatiEditor::findParam (const juce::String& webId) const
{
    if (webId == "count") return proc.countParam;
    if (webId.startsWith ("key:")) { const int i = webId.substring (4).getIntValue(); return i >= 0 && i < MAXT ? proc.keyParams[(size_t) i] : nullptr; }
    const auto it = proc.engineParamIndex.find (webId);
    return it != proc.engineParamIndex.end() ? proc.engineParams[(size_t) it->second].param : nullptr;
}

void SaraswatiEditor::setFromUi (juce::RangedAudioParameter* p, float rawValue)
{
    if (p == nullptr) return;
    const bool inGesture = touching.count (p) != 0;
    if (! inGesture) p->beginChangeGesture();
    p->setValueNotifyingHost (p->convertTo0to1 (rawValue));
    if (! inGesture) p->endChangeGesture();
}

void SaraswatiEditor::onUiMessage (const juce::var& m)
{
    const auto t = m["t"].toString();
    if (t == "hello")
    {
        pageReady = true;
        sendInit();
    }
    else if (t == "p")
    {
        const auto id = m["k"].toString();
        const auto it = proc.engineParamIndex.find (id);
        if (it == proc.engineParamIndex.end()) return;
        auto& e = proc.engineParams[(size_t) it->second];
        setFromUi (e.param, (float) (double) m["v"]);
        uiValues[(size_t) it->second] = e.raw->load();     // the panel already shows this value: no echo
    }
    else if (t == "g")
    {
        if (auto* p = findParam (m["k"].toString()))
        {
            const bool on = (int) m["on"] != 0;
            if (on && touching.insert (p).second) p->beginChangeGesture();
            else if (! on && touching.erase (p) != 0) p->endChangeGesture();
        }
    }
    else if (t == "key")
    {
        const int i = (int) m["i"];
        if (i >= 0 && i < MAXT) setFromUi (proc.keyParams[(size_t) i], (int) m["on"] != 0 ? 1.0f : 0.0f);
    }
    else if (t == "count")
    {
        const int n = sanitizeCount ((float) (int) m["n"]);
        setFromUi (proc.countParam, (float) n);
        uiCount = n;
    }
    else if (t == "dyn")
    {
        uiDyn = (int) m["on"] != 0;
        proc.setDynamicBackground (uiDyn);
    }
    else if (t == "open")
    {
        if (m["what"].toString() == "manual") openManual();
        else if (isSafeExternalUrl (m["url"].toString())) juce::URL (m["url"].toString()).launchInDefaultBrowser();
    }
}

void SaraswatiEditor::sendInit()
{
    auto* values = new juce::DynamicObject();
    for (size_t k = 0; k < proc.engineParams.size(); ++k)
    {
        const auto& e = proc.engineParams[k];
        uiValues[k] = e.raw->load();
        values->setProperty (e.webId, (double) uiValues[k]);
    }
    uiCount = sanitizeCount (proc.countParam->convertFrom0to1 (proc.countParam->getValue()));
    uiGeneration = proc.stateGeneration.load();
    uiDyn = proc.getDynamicBackground();

    auto* msg = new juce::DynamicObject();
    msg->setProperty ("t", "init");
    msg->setProperty ("count", uiCount);
    msg->setProperty ("values", juce::var (values));
    msg->setProperty ("dyn", uiDyn);
    emit (evHost, juce::var (msg));
}

void SaraswatiEditor::pollHostChanges()
{
    if (proc.stateGeneration.load() != uiGeneration) { sendInit(); return; }   // session / preset recall

    const int n = sanitizeCount (proc.countParam->convertFrom0to1 (proc.countParam->getValue()));
    if (n != uiCount)
    {
        uiCount = n;
        auto* msg = new juce::DynamicObject();
        msg->setProperty ("t", "count"); msg->setProperty ("n", n);
        emit (evHost, juce::var (msg));
    }

    std::vector<size_t> changed;
    for (size_t k = 0; k < proc.engineParams.size(); ++k)
        if (proc.engineParams[k].raw->load() != uiValues[k]) changed.push_back (k);

    if (changed.size() > 48) { sendInit(); return; }                          // many at once: reload the panel
    for (auto k : changed)
    {
        const auto& e = proc.engineParams[k];
        uiValues[k] = e.raw->load();
        auto* msg = new juce::DynamicObject();
        msg->setProperty ("t", "p"); msg->setProperty ("k", e.webId); msg->setProperty ("v", (double) uiValues[k]);
        emit (evHost, juce::var (msg));
    }
}

void SaraswatiEditor::sendState()
{
    if (! proc.readReport (report)) return;
    const int n = juce::jlimit (0, MAXT, report.count);
    juce::Array<juce::var> keys;
    for (int i = 0; i < n; ++i) keys.add ((int) report.keys[(size_t) i]);

    auto* s = new juce::DynamicObject();
    s->setProperty ("hz", floatArray (report.hz.data(), n));
    s->setProperty ("env", floatArray (report.env.data(), n));
    s->setProperty ("keys", keys);
    s->setProperty ("lfo", floatArray (report.lfo.data(), 4));
    s->setProperty ("ev", juce::Array<juce::var> { report.ev[0], report.ev[1] });
    s->setProperty ("sweep", floatArray (report.sweep.data(), 2));
    emit (evState, juce::var (s));
}

void SaraswatiEditor::timerCallback()
{
    if (! pageReady) return;
    pollHostChanges();
    sendState();
}

void SaraswatiEditor::openManual()
{
    int size = 0;
    const auto* data = findUiFile ("manual.html", size);
    if (data == nullptr) return;
    auto html = juce::String::fromUTF8 (data, size);
    html = html.replace ("id=\"back\"", "id=\"back\" style=\"display:none\"");   // there is no instrument tab to return to
    const auto file = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("Saraswati-1 Manual.html");
    if (file.replaceWithText (html, false, false, "\n"))
        juce::URL (file).launchInDefaultBrowser();
}
