// Arriva (www.arriva.cz, GraphQL busesCurrentLocations). Bereme jen MHD Kladno (type "Kladno")
// a Arriva Express (type "Express"). Zdroj dává polohu, azimut, zpoždění, cílovou a poslední
// zastávku a šestimístnou linku; číslo spoje ne – to dopočítává můstek z jízdního řádu.
const URL = 'https://www.arriva.cz/api/graphql';
const QUERY = `query busesCurrentLocation {
  busesCurrentLocations {
    angle delay destinationName lastStopName latitude longitude linkNumber state type mainType spz updated linkNumberAlias
  }
}`;
const CACHE_MS = 5000;
const STALE_MS = 15 * 60_000; // poloha starší než 15 min = vůz už nejede

const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    origin: 'https://www.arriva.cz',
    referer: 'https://www.arriva.cz/cs/dopravni-info/aktualni-poloha-autobusu-online?mainType=MHD',
    'x-enviroment': 'client',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
};

let cache = { at: 0, data: null, inflight: null };

// Jeden dotaz sdílí oba endpointy (Kladno i Express)
async function fetchAll() {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
    if (cache.inflight) return cache.inflight;
    cache.inflight = (async () => {
        try {
            const response = await fetch(URL, {
                method: 'POST',
                headers,
                body: JSON.stringify([{ query: QUERY, operationName: 'busesCurrentLocation', variables: {} }])
            });
            if (!response.ok) throw new Error(`Arriva chyba: ${response.status}`);
            const json = await response.json();
            const payload = Array.isArray(json) ? json[0] : json;
            if (payload?.errors?.length) throw new Error(`Arriva chyba: ${payload.errors[0].message}`);
            const data = payload?.data?.busesCurrentLocations || [];
            cache = { at: Date.now(), data, inflight: null };
            return data;
        } finally {
            cache.inflight = null;
        }
    })();
    return cache.inflight;
}

const clean = (value) => {
    const text = String(value ?? '').trim();
    return text || null;
};

export async function getArrivaVehicles(type) {
    const all = await fetchAll();
    const now = Date.now();
    const result = [];
    for (const v of all) {
        if (v.type !== type) continue;
        const lat = Number(v.latitude), lng = Number(v.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) continue;
        const updated = Date.parse(v.updated);
        if (Number.isFinite(updated) && now - updated > STALE_MS) continue;
        const fullLine = clean(v.linkNumber);
        if (!fullLine) continue;
        const angle = Number(v.angle);
        const delay = Number(v.delay);
        result.push({
            vehicle: clean(v.spz)?.replace(/\s+/g, '') || fullLine,
            line: type === 'Express' ? 'AEx' : (clean(v.linkNumberAlias) || fullLine.slice(-3)),
            fullLine,
            lat,
            lng,
            heading: Number.isFinite(angle) ? angle : null,
            delay: Number.isFinite(delay) ? delay : 0,
            destination: clean(v.destinationName),
            stop: clean(v.lastStopName),
            atStop: v.state === 'v zastávce'
        });
    }
    return result;
}
