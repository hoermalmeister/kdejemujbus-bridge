// Dopočet spoje DPMLB z polohy, času a zpoždění. Párovací data (zastávky se souřadnicemi
// a časy odjezdů) staví denně pipeline do match/<linka>.json na GitHub Pages.
const BASE = process.env.DPMLB_ROUTES_BASE || 'https://hoermalmeister.github.io/kdejemujbus-bridge';
const DAY_MS = 86_400_000;

const cache = new Map();

// Čas v pražské zóně (GTFS jízdní řády jsou v místním čase); bere ohled na letní/zimní čas
function pragueNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const hour = get('hour') % 24;
    return { date: Date.UTC(get('year'), get('month') - 1, get('day')), sec: hour * 3600 + get('minute') * 60 + get('second') };
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

// Poloha, kde by vůz podle jízdního řádu měl být v čase t (sekundy od půlnoci), a index zastávky
function expectedAt(trip, t) {
    const { t: times, la, lo } = trip;
    if (t <= times[0]) return [la[0], lo[0], 0];
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    if (i >= times.length - 1) return [la[i], lo[i], i];
    const f = (t - times[i]) / Math.max(1, times[i + 1] - times[i]);
    return [la[i] + (la[i + 1] - la[i]) * f, lo[i] + (lo[i + 1] - lo[i]) * f, i];
}

// Vrátí { run, stopIndex } nejlépe sedícího spoje, nebo null, když dnes nic nejede.
// Vybírá se vždy nejbližší odhad: spoj ve svém čase vyhraje sám, mimo něj se poloha ořízne
// na konečnou, takže zjevně nejedoucí spoje nevyhrávají.
export async function matchDpmlb(line, lat, lng, delayMin) {
    const data = await loadLine(line);
    if (!data?.trips?.length) return null;
    const now = pragueNow();
    const base = Date.UTC(+data.base.slice(0, 4), +data.base.slice(4, 6) - 1, +data.base.slice(6, 8));
    const offset = Math.round((now.date - base) / DAY_MS);
    if (offset < 0) return null;
    const t = now.sec - delayMin * 60;

    let best = null;
    for (const trip of data.trips) {
        // Spoj z dneška porovnáme k dnešku i k času po půlnoci; spoj ze včerejška jen po půlnoci
        const targets = [];
        if ((trip.days >> offset) & 1) targets.push(t, t + 86400);
        if (offset > 0 && (trip.days >> (offset - 1)) & 1) targets.push(t + 86400);
        for (const target of targets) {
            const [el, eo, idx] = expectedAt(trip, target);
            const dist = haversine(lat, lng, el, eo);
            if (!best || dist < best.dist) best = { dist, run: trip.run, stopIndex: idx };
        }
    }
    return best && { run: best.run, stopIndex: best.stopIndex };
}
