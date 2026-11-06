// TSMK (Kroměříž) používá stejnou platformu jako DPMP (mhdonline.cz), ale autorizuje se
// statickým klíčem v těle POST požadavku. CORS je omezený na jejich web, proto přes bridge.
const API = 'https://kromeriz.mhdonline.cz/api';
const KEY = process.env.TSMK_KEY || '09658f18-0f8c-4909-a571-0bc6b4acfbec';
const TRIP_TTL_MS = 3600_000;
const MAX_TRIPS = 50;

async function api(path) {
    const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
            'accept': '*/*',
            'content-type': 'text/plain;charset=UTF-8',
            'origin': 'https://kromeriz.mhdonline.cz',
            'referer': 'https://kromeriz.mhdonline.cz/'
        },
        body: JSON.stringify({ key: KEY })
    });
    if (!response.ok) throw new Error(`TSMK ${path}: ${response.status}`);
    return response.json();
}

// "-00:00:28" / "00:04:49" → zpoždění v minutách (záporné = náskok)
export function parseTimeDiff(value) {
    const match = /^([+-])?(\d+):(\d+):(\d+)$/.exec(value || '');
    if (!match) return null;
    const seconds = (+match[2]) * 3600 + (+match[3]) * 60 + (+match[4]);
    return Math.round((match[1] === '-' ? -seconds : seconds) / 60);
}

// "2020" → "20:20"
function formatTime(value) {
    return /^\d{3,4}$/.test(value) ? `${value.padStart(4, '0').slice(0, 2)}:${value.slice(-2)}` : null;
}

export function createTsmkVehicles(calculateBearing) {
    const history = new Map();

    return async function getTsmkVehicles() {
        const { data = [] } = await api('/buses');

        const seen = new Set();
        const result = [];
        for (const bus of data) {
            const { vid, gps_latitude: lat, gps_longitude: lng } = bus;
            if (!vid || !lat || !lng || bus.line_number == null) continue;
            seen.add(vid);

            // Zdroj směr neposílá: počítá se z pohybu, do rozjezdu vozu žádný není
            const previous = history.get(vid);
            let heading = previous?.heading ?? null;
            if (previous && (previous.lat !== lat || previous.lng !== lng)) {
                heading = calculateBearing(previous.lat, previous.lng, lat, lng);
            }
            history.set(vid, { lat, lng, heading });

            result.push({
                vehicle: vid,
                line: bus.line_number,
                run: bus.connection_no ?? null,
                destination: bus.destination_name ?? null,
                stop: bus.current_stop_name ?? null,
                stopNumber: bus.current_stop_number ?? null,
                lat,
                lng,
                heading,
                delay: parseTimeDiff(bus.time_difference)
            });
        }
        for (const vid of history.keys()) if (!seen.has(vid)) history.delete(vid);
        return result;
    };
}

async function loadTrip(line, connection) {
    const [route, detail] = await Promise.all([
        api(`/route?line=${encodeURIComponent(line)}`),
        api(`/busConnectionDetail?line=${encodeURIComponent(line)}&number=${encodeURIComponent(connection)}`)
    ]);

    // Trasa je [lat, lng], mapa chce [lng, lat]
    const shape = Array.isArray(route?.route)
        ? route.route.filter(point => Array.isArray(point) && point.length === 2).map(([lat, lng]) => [lng, lat])
        : [];

    const stops = (detail?.stops || []).map(stop => ({
        id: stop.number,
        name: stop.name,
        arr: formatTime(stop.arrivalTime),
        dep: formatTime(stop.departureTime)
    }));

    return { stops, shape };
}

const trips = new Map();

export function getTsmkTrip(line, connection) {
    const key = `${line}/${connection}`;
    const cached = trips.get(key);
    if (cached && Date.now() - cached.at < TRIP_TTL_MS) return cached.request;

    const entry = { at: Date.now(), request: loadTrip(line, connection) };
    entry.request.catch(() => { if (trips.get(key) === entry) trips.delete(key); });
    trips.delete(key);
    trips.set(key, entry);
    if (trips.size > MAX_TRIPS) trips.delete(trips.keys().next().value);
    return entry.request;
}
