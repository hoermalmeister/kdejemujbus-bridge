// DSZO (Zlín–Otrokovice). Polohy jsou GeoJSON z actualise.php (souřadnice [lng,lat], azimut,
// zpoždění v sekundách, aktuální zastávka). Cíl bereme z tabs2.php, jízdní řád ze spoj.php.
// Zdroj neposílá číslo spoje ani tvar trasy — to řešíme později.
const BASE = 'https://www.dszo.cz/online';
const TRIP_TTL_MS = 10 * 60 * 1000;
const MAX_TRIPS = 60;

const headers = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'referer': `${BASE}/`,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0'
};

async function fetchText(url) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`DSZO ${url}: ${response.status}`);
    return response.text();
}

function stopName(infow) {
    return (/Zastávka: <strong>([^<]+)</.exec(infow || '') || [])[1] || null;
}

export async function getDszoVehicles() {
    const [positionsText, tableText] = await Promise.all([
        fetchText(`${BASE}/actualise.php`),
        fetchText(`${BASE}/tabs2.php?_=${Date.now()}`).catch(() => null)
    ]);

    // tabs2: [vůz, linka, zpoždění, výchozí, cílová, kurz, služba] → cíl podle vozu
    let destinations = new Map();
    try {
        const table = JSON.parse(tableText)?.data || [];
        destinations = new Map(table.map(row => [String(row[0]), row[4]]));
    } catch { /* bez cíle to jde taky */ }

    const geo = JSON.parse(positionsText);
    const result = [];
    for (const feature of geo.features || []) {
        const [lng, lat] = feature.geometry?.coordinates || [];
        const p = feature.properties || {};
        if (!p.id || !lat || !lng) continue;
        result.push({
            vehicle: String(p.id),
            line: String(p.line),
            lat,
            lng,
            heading: Number.isFinite(p.azimut) ? p.azimut : null,
            delay: Math.round((p.delay || 0) / 60),
            station: p.station != null ? String(p.station) : null,
            stop: stopName(p.infow),
            lowlevel: p.lowlevel ? 1 : 0,
            destination: destinations.get(String(p.id)) || null
        });
    }
    return result;
}

// Jízdní řád vozu ze spoj.php (HTML): zastávky s časem, aktuální má class="aktivni"
function parseTimetable(html) {
    const stops = [];
    let active = -1;
    const rowRegex = /<tr class="([^"]*)">[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/g;
    let match;
    while ((match = rowRegex.exec(html))) {
        const name = match[3].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
        if (match[1].includes('aktivni')) active = stops.length;
        stops.push({ time: match[2].trim(), name });
    }
    return { stops, active };
}

const trips = new Map();

export function getDszoTrip({ vuz, zast, zpozdeni, nizkopodlazni }) {
    const key = `${vuz}/${zast}`;
    const cached = trips.get(key);
    if (cached && Date.now() - cached.at < TRIP_TTL_MS) return cached.request;

    const url = `${BASE}/spoj.php?vuz=${encodeURIComponent(vuz)}&zast=${encodeURIComponent(zast)}&zpozdeni=${encodeURIComponent(zpozdeni || 0)}&nizkopodlazni=${encodeURIComponent(nizkopodlazni || 0)}`;
    const entry = { at: Date.now(), request: fetchText(url).then(parseTimetable) };
    entry.request.catch(() => { if (trips.get(key) === entry) trips.delete(key); });
    trips.delete(key);
    trips.set(key, entry);
    if (trips.size > MAX_TRIPS) trips.delete(trips.keys().next().value);
    return entry.request;
}
