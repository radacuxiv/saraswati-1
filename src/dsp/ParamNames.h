/*  Saraswati-1 — mapping between the web UI's parameter ids ("tune:12", "rvMix", ...) and the engine. */
#pragma once

#include "SaraswatiDSP.h"

#include <cstdlib>
#include <cstring>
#include <string>

namespace saraswati
{

struct ParamName { const char* name; P p; };

inline constexpr ParamName kParamNames[] = {
    { "tune", P::tune }, { "tmod", P::tmod }, { "thold", P::thold }, { "tlfo", P::tlfo }, { "t1", P::t1 }, { "t2", P::t2 }, { "solo", P::solo },
    { "fast", P::fast }, { "sharp", P::sharp }, { "source", P::source }, { "ring", P::ring },
    { "fa", P::fa }, { "fb", P::fb }, { "andor", P::andor }, { "link", P::link },
    { "xmode", P::xmode }, { "xspread", P::xspread }, { "xspeed", P::xspeed }, { "xchance", P::xchance }, { "xlength", P::xlength },
    { "pitchA", P::pitchA }, { "pitchB", P::pitchB },
    { "time1", P::time1 }, { "time2", P::time2 }, { "mod1", P::mod1 }, { "mod2", P::mod2 }, { "feedback", P::feedback },
    { "dmix", P::dmix }, { "dmod", P::dmod }, { "dwav", P::dwav },
    { "drv", P::drv }, { "xmix", P::xmix }, { "soft", P::soft }, { "vol", P::vol },
    { "rvMix", P::rvMix }, { "rvRoom", P::rvRoom }, { "rvDamp", P::rvDamp }, { "rvWidth", P::rvWidth },
    { "rvPre", P::rvPre }, { "rvLp", P::rvLp }, { "rvHp", P::rvHp },
};

/** Parses "name" or "name:index" (':' or '_' separator). Returns false for unknown names. */
inline bool parseParamId (const std::string& id, P& p, int& index)
{
    auto sep = id.find_first_of (":_");
    const std::string name = sep == std::string::npos ? id : id.substr (0, sep);
    index = sep == std::string::npos ? 0 : std::atoi (id.c_str() + sep + 1);
    for (const auto& pn : kParamNames)
        if (name == pn.name) { p = pn.p; return true; }
    return false;
}

} // namespace saraswati
