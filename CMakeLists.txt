cmake_minimum_required(VERSION 3.22)

project(SARASWATI1 VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version")
if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "" FORCE)   # universal binary
endif()

#------------------------------------------------------------------------------- options
option(SARASWATI_WEBVIEW    "Plugin window shows the HTML panel in the system web view" ON)
option(SARASWATI_STANDALONE "Also build a standalone application"                      ON)
option(SARASWATI_TESTS      "Build the DSP comparison renderer (tests/render_cpp)"      OFF)
option(SARASWATI_LINUX_MINIMAL "Linux: build without optional X11/ALSA dev headers"         OFF)
set(JUCE_DIR "" CACHE PATH "Path to a local JUCE checkout (empty = download JUCE 8.0.15)")

#------------------------------------------------------------------------------- JUCE
if(JUCE_DIR)
    add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/JUCE EXCLUDE_FROM_ALL)
else()
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG        8.0.15
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

#------------------------------------------------------------------------------- formats
set(SARASWATI_FORMATS VST3)
if(APPLE)
    list(APPEND SARASWATI_FORMATS AU AAX)
elseif(WIN32)
    list(APPEND SARASWATI_FORMATS AAX)
endif()
if(SARASWATI_STANDALONE)
    list(APPEND SARASWATI_FORMATS Standalone)
endif()
message(STATUS "Saraswati-1 formats: ${SARASWATI_FORMATS}")

set(web_args)
if(SARASWATI_WEBVIEW)
    set(web_args NEEDS_WEB_BROWSER TRUE NEEDS_WEBVIEW2 TRUE)
endif()

juce_add_plugin(Saraswati1
    PRODUCT_NAME                "Saraswati-1"
    COMPANY_NAME                "radacuxiv"
    COMPANY_WEBSITE             "https://panasko.dev"
    COMPANY_EMAIL               "mail@panasko.dev"
    BUNDLE_ID                   "dev.panasko.saraswati1"
    DESCRIPTION                 "Organismic drone synthesizer"
    PLUGIN_MANUFACTURER_CODE    Rdcx
    PLUGIN_CODE                 Srw1
    FORMATS                     ${SARASWATI_FORMATS}
    IS_SYNTH                    TRUE
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    VST3_CATEGORIES             Instrument Synth
    AU_MAIN_TYPE                kAudioUnitType_MusicDevice
    AAX_CATEGORY                AAX_ePlugInCategory_SWGenerators
    HARDENED_RUNTIME_ENABLED    TRUE
    COPY_PLUGIN_AFTER_BUILD     FALSE
    ${web_args})

juce_generate_juce_header(Saraswati1)

target_sources(Saraswati1 PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/Params.cpp
    src/dsp/SaraswatiDSP.cpp)
target_include_directories(Saraswati1 PRIVATE src)

# The HTML panel, embedded in the binary and served to the web view.
juce_add_binary_data(SaraswatiUI
    HEADER_NAME UiData.h
    NAMESPACE   UiData
    SOURCES
        ui/index.html
        ui/manual.html
        ui/css/saraswati.css
        ui/css/fonts.css
        ui/js/saraswati.js
        ui/js/dsp.js
        ui/fonts/Archivo.woff
        ui/fonts/MartianMono.woff
        ui/fonts/Orbitron.woff
        ui/fonts/RubikGlitchPop.woff
        ui/fonts/TiltNeon.woff)
set_target_properties(SaraswatiUI PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_compile_definitions(Saraswati1 PUBLIC
    JUCE_WEB_BROWSER=$<BOOL:${SARASWATI_WEBVIEW}>
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

if(SARASWATI_LINUX_MINIMAL)
    # bare Linux build machines without the Xrandr/Xinerama/Xcursor/Xcomposite/ALSA development headers
    target_compile_definitions(Saraswati1 PUBLIC JUCE_USE_XRANDR=0 JUCE_USE_XINERAMA=0 JUCE_USE_XCURSOR=0 JUCE_USE_XRENDER=0 JUCE_USE_XSHM=0 JUCE_ALSA=0)
endif()

target_link_libraries(Saraswati1
    PRIVATE
        SaraswatiUI
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags)

if(SARASWATI_TESTS)
    # renders a scenario through the bare engine (compare with the browser engine: tests/README)
    add_executable(render_cpp tests/render_cpp.cpp src/dsp/SaraswatiDSP.cpp)
    # loads the built VST3 like a DAW: host parameters, MIDI, session recall
    juce_add_console_app(host_test PRODUCT_NAME "host_test")
    target_sources(host_test PRIVATE tests/host_test.cpp)
    target_compile_definitions(host_test PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(host_test PRIVATE juce::juce_audio_processors juce::juce_recommended_config_flags)
endif()
