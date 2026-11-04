// Dopočet spoje DPMLB z polohy, času a zpoždění. Párovací data (zastávky se souřadnicemi
// a časy odjezdů) staví denně pipeline do match/<linka>.json na GitHub Pages.
const BASE = process.env.DPMLB_ROUTES_BASE || 'https://hoermalmeister.github.io/kdejemujbus-bridge';
const DAY_MS = 86_400_000;

const cache = new Map();

function todayOffset(base) {
    const b = Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8));
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((today - b) / DAY_MS);
}

async function loadLine(line) {
    const entry = cache.get(line);
    if (entry && Date.now() - entry.at < 6 * 3600_000) return entry.data;
    try {
        const response = await fetch(`${BASE}/match/${line}.json`);
        const data = response.ok ? await response.json() : null;
        cache.set(line, { at: Date.now(), data });
        return data;
    } catch {
        return entry?.data ?? null;
    }
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Poloha, kde by vůz podle jízdního řádu měl být v čase t (sekundy od půlnoci)
function expectedAt(trip, t) {
    const { t: times, la, lo } = trip;
    if (t <= times[0]) return [la[0], lo[0], 0];
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    if (i >= times.length - 1) return [la[i], lo[i], i];
    const f = (t - times[i]) / Math.max(1, times[i + 1] - times[i]);
    return [la[i] + (la[i + 1] - la[i]) * f, lo[i] + (lo[i + 1] - lo[i]) * f, i];
}

// Vrátí { run, stopIndex } nejlépe sedícího spoje, nebo null, když dnes nic nejede
export async function matchDpmlb(line, lat, lng, delayMin, nowSec) {
    const data = await loadLine(line);
    if (!data?.trips?.length) return null;
    const offset = todayOffset(data.base);
    const targets = [nowSec - delayMin * 60, nowSec - delayMin * 60 + 86400];

    // Vždy nejbližší odhad: ze všech dnešních spojů linky vybereme ten, jehož poloha podle
    // jízdního řádu v čase (teď - zpoždění) nejlíp sedí na GPS. Spoj ve svém okně zvítězí sám,
    // mimo okno se poloha ořízne na konečnou, takže zjevně nejedoucí spoje nevyhrávají.
    let best = null;
    for (const trip of data.trips) {
        if (offset < 0 || !((trip.days >> offset) & 1)) continue;
        for (const t of targets) {
            const [el, eo, idx] = expectedAt(trip, t);
            const dist = haversine(lat, lng, el, eo);
            if (!best || dist < best.dist) best = { dist, run: trip.run, stopIndex: idx };
        }
    }
    return best && { run: best.run, stopIndex: best.stopIndex };
}
