// Společný feed Portabo (CIS, celý Ústecký kraj). Filtrujeme podle CISLineID:
// 595xxx = DPMÚL (Ústí n. L.), 585xxx = MDT (Teplice). Feed nemá názvy zastávek ani cíl.
const URL = 'https://tabule.portabo.cz/api/v1-tabule/cis/GetTraffic/0';
const STATIONS_URL = 'https://tabule.portabo.cz/api/v1-tabule/cis/GetStations';
const CACHE_MS = 5000;
const STATIONS_TTL = 12 * 3600_000;

let cache = { at: 0, data: [], inflight: null };
let stations = { at: 0, map: null, inflight: null };

// Číselník zastávek (Node → název); mění se zřídka, držíme ho dlouho
async function getStations() {
    if (stations.map && Date.now() - stations.at < STATIONS_TTL) return stations.map;
    if (stations.inflight) return stations.inflight;
    stations.inflight = (async () => {
        try {
            const response = await fetch(STATIONS_URL);
            if (!response.ok) throw new Error(`Portabo stations ${response.status}`);
            const json = await response.json();
            const map = new Map();
            for (const item of json.ItemList || []) if (item.Name && !map.has(item.Node)) map.set(item.Node, item.Name);
            stations = { at: Date.now(), map, inflight: null };
            return map;
        } catch (error) {
            stations.inflight = null;
            if (stations.map) return stations.map;
            throw error;
        }
    })();
    return stations.inflight;
}

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

const history = new Map();

export function createPortaboVehicles(prefix, calculateBearing) {
    return async function getPortaboVehicles() {
        const [list, nodes] = await Promise.all([getTraffic(), getStations().catch(() => null)]);
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
                line: String(vehicle.LineID),              // do šipky píšeme LineID
                lat,
                lng,
                heading,
                delay: vehicle.Delay || 0,
                cis,
                spoj: String(vehicle.RouteID),             // RouteID = číslo spoje (sedí na GTFS i u nočních a MDT)
                destination: nodes?.get(vehicle.FinalNode) || null,
                stop: vehicle.StationNode ? (nodes?.get(vehicle.StationNode) || null) : null
            });
        }
        if (history.size > 2000) for (const id of history.keys()) { if (!seen.has(id)) history.delete(id); }
        return result;
    };
}
