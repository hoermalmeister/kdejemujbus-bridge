// Společný feed Portabo (CIS, celý Ústecký kraj). Filtrujeme podle CISLineID:
// 595xxx = DPMÚL (Ústí n. L.), 585xxx = MDT (Teplice). Feed nemá názvy zastávek ani cíl.
const URL = 'https://tabule.portabo.cz/api/v1-tabule/cis/GetTraffic/0';
const CACHE_MS = 5000;

let cache = { at: 0, data: [], inflight: null };

async function getTraffic() {
    if (cache.data.length && Date.now() - cache.at < CACHE_MS) return cache.data;
    if (cache.inflight) return cache.inflight;
    cache.inflight = (async () => {
        try {
            const response = await fetch(URL);
            if (!response.ok) throw new Error(`Portabo ${response.status}`);
            const json = await response.json();
            cache = { at: Date.now(), data: json.VehicleList || [], inflight: null };
            return cache.data;
        } catch (error) {
            cache.inflight = null;
            throw error;
        }
    })();
    return cache.inflight;
}

// Spoj = poslední část qride_tripID (595088 → "CIST-595088-1-4030" → 4030; MDT → číslo spoje)
function spojOf(vehicle) {
    const parts = String(vehicle.qride_tripID || '').split('-');
    return parts[parts.length - 1] || null;
}

const history = new Map();

export function createPortaboVehicles(prefix, calculateBearing) {
    return async function getPortaboVehicles() {
        const list = await getTraffic();
        const seen = new Set();
        const result = [];
        for (const vehicle of list) {
            const cis = String(vehicle.CISLineID);
            if (!cis.startsWith(prefix)) continue;
            const { Latitude: lat, Longitude: lng, ID: id } = vehicle;
            if (lat == null || lng == null || seen.has(id)) continue; // MDT může vůz v odpovědi opakovat
            seen.add(id);

            // Azimut posílá jen MDT; u DPMÚL (0/null) se směr počítá z pohybu
            const previous = history.get(id);
            let heading = previous?.heading ?? null;
            if (Number.isFinite(vehicle.Azimut) && vehicle.Azimut !== 0) heading = vehicle.Azimut;
            else if (previous && (previous.lat !== lat || previous.lng !== lng)) {
                heading = calculateBearing(previous.lat, previous.lng, lat, lng);
            }
            history.set(id, { lat, lng, heading });

            result.push({
                vehicle: id,
                line: String(vehicle.qride_linename ?? vehicle.LineID),
                lat,
                lng,
                heading,
                delay: vehicle.Delay || 0,
                cis,
                spoj: spojOf(vehicle)
            });
        }
        if (history.size > 2000) for (const id of history.keys()) { if (!seen.has(id)) history.delete(id); }
        return result;
    };
}
