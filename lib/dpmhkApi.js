// DPMHK (Hradec Králové, qrbus.me). Polohy z getAllRtdVehicles (souřadnice ×1e5, azimut,
// zpoždění v sekundách). Cíl a trasu dobíráme z katalogu getAllLines (linka podle čísla,
// trasa podle názvu → lineId + routeId); tvar trasy pak z getRoute. Řidiče nepřeposíláme.
const BASE = 'https://dpmhk.qrbus.me/index';
const CATALOG_TTL = 12 * 3600_000;

const headers = {
    accept: '*/*',
    referer: 'https://dpmhk.qrbus.me/',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0'
};

let catalog = { at: 0, byLine: null, inflight: null };

// Index: číslo linky → { id, end, routes: název → { id, endName } }
async function getCatalog() {
    if (catalog.byLine && Date.now() - catalog.at < CATALOG_TTL) return catalog.byLine;
    if (catalog.inflight) return catalog.inflight;
    catalog.inflight = (async () => {
        try {
            const response = await fetch(`${BASE}/getAllLines`, { headers });
            if (!response.ok) throw new Error(`DPMHK lines ${response.status}`);
            const lines = (await response.json()).lines || [];
            const byLine = new Map();
            for (const line of lines) {
                const routes = new Map();
                for (const route of line.routes || []) routes.set(String(route.name), { id: route.id, endName: route.endName || route.endName2 });
                byLine.set(String(line.lineNumberText), { id: line.id, end: line.endName, routes });
            }
            catalog = { at: Date.now(), byLine, inflight: null };
            return byLine;
        } catch (error) {
            catalog.inflight = null;
            if (catalog.byLine) return catalog.byLine;
            throw error;
        }
    })();
    return catalog.inflight;
}

export async function getDpmhkVehicles() {
    const [response, byLine] = await Promise.all([
        fetch(`${BASE}/getAllRtdVehicles`, { headers }),
        getCatalog().catch(() => null)
    ]);
    if (!response.ok) throw new Error(`DPMHK chyba: ${response.status}`);
    const vehicles = (await response.json()).vehicles || [];

    const result = [];
    for (const v of vehicles) {
        // gpsi=0 a vp=1 = vůz s platnou polohou v provozu (odstavené mají gpsi=1/vp=0)
        if (v.gpsi !== 0 || v.vp !== 1 || !v.la || !v.lo || !v.ln) continue;
        const line = byLine?.get(String(v.ln));
        const route = line?.routes.get(String(v.rn));
        result.push({
            vehicle: v.vid,
            line: String(v.ln),
            lat: v.la / 1e5,
            lng: v.lo / 1e5,
            heading: Number.isFinite(v.az) ? v.az : null,
            delay: Math.round((v.d || 0) / 60),
            destination: route?.endName || line?.end || null,
            lineId: line?.id || null,
            routeId: route?.id || null
        });
    }
    return result;
}

// Tvar trasy z getRoute: segmenty v pořadí segmentOrder, body v pořadí order, jako [lng,lat]
export async function getDpmhkRoute(lineId, routeId) {
    const response = await fetch(`${BASE}/getRoute`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: 'https://dpmhk.qrbus.me' },
        body: JSON.stringify({ lineId: Number(lineId), routeId: Number(routeId) })
    });
    if (!response.ok) throw new Error(`DPMHK trasa ${response.status}`);
    const data = await response.json();
    const route = (data.lines?.[0]?.routes || []).find((r) => r.id === Number(routeId)) || data.lines?.[0]?.routes?.[0];
    const segments = (route?.segments || []).slice().sort((a, b) => a.segmentOrder - b.segmentOrder);
    const shape = [];
    for (const segment of segments) {
        const points = (segment.points || []).slice().sort((a, b) => a.order - b.order);
        for (const point of points) {
            const coord = [point.longitude / 1e5, point.latitude / 1e5];
            if (!shape.length || shape[shape.length - 1][0] !== coord[0] || shape[shape.length - 1][1] !== coord[1]) shape.push(coord);
        }
    }
    return shape;
}
