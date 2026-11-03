// DPMP (Pardubice) používá stejné API jako web online.dpmp.cz. Bez hlavičky X-App-Protocol vrací 403.
// Hodnotu má web natvrdo ve svém kódu, takže se může změnit s novou verzí webu.
const API = 'https://api.mhdonline.cz/pardubice';
const APP_PROTOCOL = process.env.DPMP_APP_PROTOCOL || '86c5845a99d3edd493a3475dbcb628bab487fa1b7c4f0576aab041079d37b1a5';
const REFERENCE_TTL_MS = 6 * 3600_000;
const TRIP_TTL_MS = 3600_000;
const MAX_TRIPS = 50;

async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            'accept': 'application/json',
            'origin': 'https://online.dpmp.cz',
            'referer': 'https://online.dpmp.cz/',
            'x-app-protocol': APP_PROTOCOL,
            ...options.headers
        }
    });
    if (!response.ok) throw new Error(`DPMP ${path}: ${response.status}`);
    return response.json();
}

// Číselníky se mění zřídka. Když se je nepodaří obnovit, platí dál ty poslední.
function referenceData(path, build) {
    let value = null, loadedAt = 0, inFlight = null;
    return async () => {
        if (value && Date.now() - loadedAt < REFERENCE_TTL_MS) return value;
        inFlight ??= api(path)
            .then(data => { value = build(data); loadedAt = Date.now(); })
            .catch(error => { if (!value) throw error; console.error('Chyba číselníku DPMP:', error.message); })
            .finally(() => { inFlight = null; });
        await inFlight;
        return value;
    };
}

const getLines = referenceData('/lines', lines => new Map(lines.map(line => [line.id, line.jdfId])));
const getStops = referenceData('/stops', stops => new Map(stops.map(stop => [stop.id, stop])));

export function parseIsoDelay(value) {
    const match = /^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || '');
    if (!match) return null;
    const seconds = (+match[2] || 0) * 3600 + (+match[3] || 0) * 60 + (+match[4] || 0);
    return Math.round((match[1] ? -seconds : seconds) / 60) + 0;
}

// Polyline s přesností na šest desetinných míst, výsledek jako [lng, lat]
export function decodePolyline6(encoded) {
    const coordinates = [];
    let index = 0, lat = 0, lng = 0;
    const next = () => {
        let shift = 0, result = 0, byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20 && index < encoded.length);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += next();
        lng += next();
        coordinates.push([lng / 1e6, lat / 1e6]);
    }
    return coordinates;
}

export function createDpmpVehicles(calculateBearing) {
    const history = new Map();

    return async function getDpmpVehicles() {
        const [{ vehicles = [] }, lines, stops] = await Promise.all([
            api('/vehicles'),
            getLines().catch(() => null),
            getStops().catch(() => null)
        ]);

        const seen = new Set();
        const result = [];
        for (const vehicle of vehicles) {
            const { vid, gpsLat: lat, gpsLon: lng } = vehicle;
            if (!vid || !lat || !lng || !vehicle.lineId) continue;
            seen.add(vid);

            // Zdroj směr neposílá: počítá se z pohybu, dokud se vůz nerozjede, tak k další zastávce
            const previous = history.get(vid);
            let heading = previous?.heading ?? null;
            if (previous && (previous.lat !== lat || previous.lng !== lng)) {
                heading = calculateBearing(previous.lat, previous.lng, lat, lng);
            } else if (heading === null) {
                const next = stops?.get(vehicle.nextStopId);
                if (next) heading = calculateBearing(lat, lng, next.gpsLat, next.gpsLon);
            }
            history.set(vid, { lat, lng, heading });

            result.push({
                vehicle: vid,
                line: vehicle.lineId,
                fullLine: lines?.get(vehicle.lineId) ?? null,
                run: vehicle.connectionId ?? null,
                destination: vehicle.destinationName ?? null,
                lastStop: vehicle.lastStopName ?? null,
                nextStopId: vehicle.nextStopId ?? null,
                nextStopTime: vehicle.nextStopScheduledDepartureTime?.slice(0, 5) ?? null,
                lat,
                lng,
                heading,
                delay: parseIsoDelay(vehicle.currentDelay),
                waiting: Boolean(vehicle.isWaiting)
            });
        }
        for (const vid of history.keys()) if (!seen.has(vid)) history.delete(vid);
        return result;
    };
}

async function loadTrip(line, connection) {
    const [trip, stops] = await Promise.all([
        api(`/connections/${encodeURIComponent(line)}/${encodeURIComponent(connection)}`),
        getStops()
    ]);

    const tripStops = trip.stops || [];
    const pathIds = tripStops.slice(1).map((stop, index) => ({
        fromStopId: tripStops[index].stopId,
        toStopId: stop.stopId
    }));

    // Bez trasy jsou zastávky pořád užitečné
    let shape = [];
    try {
        const paths = await api('/paths', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pathIds })
        });
        const byPair = new Map(paths.map(path => [`${path.fromStopId}/${path.toStopId}`, path.shape]));
        for (const { fromStopId, toStopId } of pathIds) {
            const part = decodePolyline6(byPair.get(`${fromStopId}/${toStopId}`) || '');
            shape.push(...(shape.length ? part.slice(1) : part));
        }
    } catch (error) {
        console.error('Chyba trasy DPMP:', error.message);
    }

    return {
        stops: tripStops.map(stop => ({
            id: stop.stopId,
            name: stops.get(stop.stopId)?.name ?? String(stop.stopId),
            arr: stop.arrivalTime?.slice(0, 5) ?? null,
            dep: stop.departureTime?.slice(0, 5) ?? null
        })),
        shape
    };
}

const trips = new Map();

export function getDpmpTrip(line, connection) {
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
