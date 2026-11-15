// DPMJ (Jihlava) – polohy z městského GIS (ArcGIS REST). Zdroj dává linku, zpoždění, azimut
// a id poslední a cílové zastávky; číslo spoje ne. Linka v CIS = 765000 + lineid − 100
// (104 → 765004, 205 → 765105). Souřadnice zastávek z číselníku (elp_id/elp_post) předáváme
// jako nápovědu pro dopočet spoje z jízdního řádu.
const BASE = 'https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer';
const VEHICLES_URL = `${BASE}/50/query?where=1%3D1&outFields=*&returnGeometry=false&f=json`;
const STOPS_URL = `${BASE}/3/query?where=1%3D1&outFields=elp_id,elp_post,nazev&outSR=4326&f=json`;
const STOPS_TTL = 12 * 3600_000;

let stops = { at: 0, byId: null, inflight: null };

// elp_id → { name, posts: Map(elp_post → [lat, lng]) }
async function getStops() {
    if (stops.byId && Date.now() - stops.at < STOPS_TTL) return stops.byId;
    if (stops.inflight) return stops.inflight;
    stops.inflight = (async () => {
        try {
            const response = await fetch(STOPS_URL);
            if (!response.ok) throw new Error(`DPMJ zastávky ${response.status}`);
            const byId = new Map();
            for (const feature of (await response.json()).features || []) {
                const a = feature.attributes || {};
                const g = feature.geometry;
                if (a.elp_id == null || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
                if (!byId.has(a.elp_id)) byId.set(a.elp_id, { name: a.nazev || null, posts: new Map() });
                byId.get(a.elp_id).posts.set(a.elp_post, [g.y, g.x]);
            }
            stops = { at: Date.now(), byId, inflight: null };
            return byId;
        } catch (error) {
            stops.inflight = null;
            if (stops.byId) return stops.byId;
            throw error;
        }
    })();
    return stops.inflight;
}

export async function getDpmjVehicles() {
    const [response, byId] = await Promise.all([fetch(VEHICLES_URL), getStops().catch(() => null)]);
    if (!response.ok) throw new Error(`DPMJ chyba: ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`DPMJ chyba: ${data.error.message || data.error.code}`);

    const result = [];
    for (const feature of data.features || []) {
        const a = feature.attributes || {};
        if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || !a.latitude || !a.longitude) continue;
        if (!Number.isFinite(a.lineid) || a.lineid < 100) continue;

        const lastStop = byId?.get(a.laststopid);
        const finalStop = byId?.get(a.finalstopid);
        // U poslední zastávky dáme přednost přesnému stanovišti, ostatní stanoviště jako záloha
        const lastCoords = lastStop
            ? [lastStop.posts.get(a.lastpostid), ...lastStop.posts.values()].filter(Boolean)
            : [];
        result.push({
            vehicle: a.carnum,
            line: String(a.linka || '').trim() || String(a.lineid),
            fullLine: String(765000 + a.lineid - 100),
            lat: a.latitude,
            lng: a.longitude,
            heading: Number.isFinite(a.azimut) ? a.azimut : null,
            delay: Number.isFinite(a.delayinmins) ? a.delayinmins : 0,
            destination: a.konecna || finalStop?.name || null,
            stop: a.posledni || lastStop?.name || null,
            type: a.typ || null,
            hints: {
                last: lastCoords,
                final: finalStop ? [...finalStop.posts.values()] : []
            }
        });
    }
    return result;
}
