// Renders a scenario file through the C++ engine:  render_cpp <scenario.txt> <out.f32> <sampleRate> [seconds]
#include "../src/dsp/ParamNames.h"
#include "../src/dsp/SaraswatiDSP.h"

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

int main (int argc, char** argv)
{
    if (argc < 4) { std::fprintf (stderr, "usage: render_cpp scenario out sr [seconds]\n"); return 1; }
    const double SR = std::atof (argv[3]);
    const double secs = argc > 4 ? std::atof (argv[4]) : 3.0;
    struct Ev { long at; std::string t, a; double b; };
    std::vector<Ev> evs;
    std::ifstream in (argv[1]);
    for (std::string line; std::getline (in, line);)
    {
        if (line.empty()) continue;
        std::istringstream ss (line); Ev e; ss >> e.at >> e.t >> e.a; if (e.t != "count") ss >> e.b; else e.b = 0;
        evs.push_back (e);
    }
    saraswati::Engine eng (SR);
    const long total = (long) (secs * SR + 0.5);
    std::vector<float> L ((size_t) total), R ((size_t) total);
    size_t e = 0;
    for (long o = 0; o < total; o += 128)
    {
        while (e < evs.size() && evs[e].at <= o)
        {
            const auto& ev = evs[e++];
            if (ev.t == "p")
            {
                saraswati::P p; int idx;
                if (! saraswati::parseParamId (ev.a, p, idx)) { std::fprintf (stderr, "unknown %s\n", ev.a.c_str()); return 2; }
                eng.setParam (p, idx, ev.b);
            }
            else if (ev.t == "key") eng.setKey (std::atoi (ev.a.c_str()), ev.b != 0);
            else eng.setCount (std::atoi (ev.a.c_str()));
        }
        const int n = (int) std::min<long> (128, total - o);
        eng.render (L.data() + o, R.data() + o, n);
    }
    std::vector<float> inter ((size_t) total * 2);
    for (long i = 0; i < total; ++i) { inter[(size_t) (2 * i)] = L[(size_t) i]; inter[(size_t) (2 * i + 1)] = R[(size_t) i]; }
    FILE* f = std::fopen (argv[2], "wb"); std::fwrite (inter.data(), 4, inter.size(), f); std::fclose (f);
    return 0;
}
