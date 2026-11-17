// IDS JMK posílá jen krátké číslo linky (LineName) a číslo spoje (RouteID). Šestimístnou
// linku CIS JŘ dohledáme v indexu, který denně staví pipeline do match/jmk_lines.json:
//   {"base": "20261117", "lines": {"<krátké číslo>": {"<linka>": {"<spoj>": maska_dnů}}}}
// V indexu jsou jen linky se zastávkou v oblasti IDS JMK. Bit N masky = spoj jede v den base + N.
const BASE = process.env.DPMLB_ROUTES_BASE || 'https://hoermalmeister.github.io/kdejemujbus-bridge';
const DAY_MS = 86_400_000;
const REFRESH_MS = 6 * 3600_000;
const RETRY_MS = 5 * 60_000;
// Linky licencované v JMK (regionální 725–729, MHD Brno 737/738) mají přednost před linkami
// jiných krajů se stejným krátkým číslem a spojem
const JMK_PREFIXES = ['725', '726', '727', '728', '729', '737', '738'];

let index = null;
let loadedAt = 0;
let failedAt = 0;
let loading = null;

function pragueDay() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return { date: Date.UTC(get('year'), get('month') - 1, get('day')), hour: get('hour') % 24 };
}

async function loadIndex() {
    const now = Date.now();
    if (index && now - loadedAt < REFRESH_MS) return index;
    if (!index && now - failedAt < RETRY_MS) return null;
    if (!loading) {
        loading = fetch(`${BASE}/match/jmk_lines.json`)
            .then((response) => {
                if (!response.ok) throw new Error(`Pages ${response.status}`);
                return response.json();
            })
            .then((data) => {
                index = data;
                loadedAt = Date.now();
            })
            .catch((error) => {
                failedAt = Date.now();
                console.warn('Index linek IDS JMK se nepodařilo načíst:', error.message);
            })
            .finally(() => { loading = null; });
    }
    await loading;
    return index;
}

// Vrátí funkci (krátké číslo, spoj) -> šestimístná linka | null pro dnešní den
export async function getJmkLineResolver() {
    const data = await loadIndex();
    if (!data?.lines) return () => null;
    const base = Date.UTC(+data.base.slice(0, 4), +data.base.slice(4, 6) - 1, +data.base.slice(6, 8));
    const { date, hour } = pragueDay();
    const offset = Math.round((date - base) / DAY_MS);
    // Po půlnoci ještě dojíždějí spoje včerejška
    const offsets = hour < 4 && offset > 0 ? [offset, offset - 1] : [offset];

    return (lineName, routeId) => {
        const lines = data.lines[String(lineName || '').trim()];
        if (!lines || routeId == null) return null;
        const run = String(routeId);
        const candidates = Object.keys(lines).filter((line) => {
            const mask = lines[line][run];
            return mask && offsets.some((o) => o >= 0 && (mask / 2 ** o) % 2 >= 1);
        });
        if (candidates.length <= 1) return candidates[0] || null;
        const preferred = candidates.filter((line) => JMK_PREFIXES.includes(line.slice(0, 3)));
        return (preferred.length ? preferred : candidates).sort()[0];
    };
}
