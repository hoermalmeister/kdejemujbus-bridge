// DPMHK (Hradec Králové, qrbus.me). Polohy z getAllRtdVehicles (souřadnice ×1e5, azimut,
// zpoždění v sekundách). Spoj párujeme podle názvu trasy (rn) proti katalogu getLinesWithRoutes
// (názvy tras jsou globálně jedinečné), takže namatchujeme všechny vozy včetně těch bez čísla
// linky i přejezdů. Cíl = endName trasy, tvar trasy z getRoute, aktuální zastávka z psi
// (getAllPlatforms), jízdní řád z getPlatformsDataWithHistory (klíč ln+tn+rn+o). U přejezdu
// dáváme do šipky pomlčku. Řidiče nepřeposíláme.
const BASE = 'https://dpmhk.qrbus.me/index';
const CATALOG_TTL = 12 * 3600_000;

const headers = {
    accept: '*/*',
    referer: 'https://dpmhk.qrbus.me/',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0'
};

let catalog = { at: 0, byRoute: null, byStop: null, inflight: null };

function cleanName(name) {
    const text = String(name || '').trim();
    if (!text || /vozovn/i.test(text)) return null; // "# vozovny #" = depo
    return text;
}

// departureTime je wall-clock zakódovaný jako UTC epoch → sekundy od půlnoci = unix % 86400.
// realXInSecondsFromMidnight jsou už místní sekundy od půlnoci.
function hhmm(secondsFromMidnight) {
    if (secondsFromMidnight == null || secondsFromMidnight < 0) return null;
    const s = ((secondsFromMidnight % 86400) + 86400) % 86400;
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

// Globální index tras (podle názvu rn) + index zastávek (podle stopId z psi)
async function getCatalog() {
    if (catalog.byRoute && Date.now() - catalog.at < CATALOG_TTL) return catalog;
    if (catalog.inflight) return catalog.inflight;
    catalog.inflight = (async () => {
        try {
            const [linesResponse, stopsResponse] = await Promise.all([
                fetch(`${BASE}/getLinesWithRoutes`, { headers }),
                fetch(`${BASE}/getAllPlatforms`, { headers })
            ]);
            if (!linesResponse.ok) throw new Error(`DPMHK lines ${linesResponse.status}`);
            const lines = (await linesResponse.json()).lines || [];
            const byRoute = new Map();
            for (const line of lines) {
                const isPrejezd = line.lineNumber === 9999 || /přejezd/i.test(line.lineNumberText || '');
                const label = isPrejezd ? '-' : String(line.lineNumberText || line.lineNumber || '');
                for (const route of line.routes || []) {
                    byRoute.set(String(route.name), {
                        lineId: line.id,
                        routeId: route.id,
                        label,
                        isPrejezd,
                        destination: cleanName(route.endName || route.endName2) || cleanName(line.endName) || null
                    });
                }
            }
            const byStop = new Map();
            if (stopsResponse.ok) {
                for (const p of (await stopsResponse.json()).platforms || []) {
                    if (!byStop.has(p.stopId)) byStop.set(p.stopId, p.name);
                }
            }
            catalog = { at: Date.now(), byRoute, byStop, inflight: null };
            return catalog;
        } catch (error) {
            catalog.inflight = null;
            if (catalog.byRoute) return catalog;
            throw error;
        }
    })();
    return catalog.inflight;
}

export async function getDpmhkVehicles() {
    const [response, cat] = await Promise.all([
        fetch(`${BASE}/getAllRtdVehicles`, { headers }),
        getCatalog().catch(() => null)
    ]);
    if (!response.ok) throw new Error(`DPMHK chyba: ${response.status}`);
    const vehicles = (await response.json()).vehicles || [];
    const byRoute = cat?.byRoute;
    const byStop = cat?.byStop;

    const result = [];
    for (const v of vehicles) {
        // gpsi=0 a vp=1 = vůz s platnou polohou v provozu (odstavené mají gpsi=1/vp=0)
        if (v.gpsi !== 0 || v.vp !== 1 || !v.la || !v.lo) continue;
        // Spoj hledáme podle názvu trasy (rn) – je i u vozů bez čísla linky a u přejezdů
        const route = byRoute?.get(String(v.rn || ''));
        result.push({
            vehicle: v.vid,
            line: route?.label || (v.ln ? String(v.ln) : '?'),
            lat: v.la / 1e5,
            lng: v.lo / 1e5,
            heading: Number.isFinite(v.az) ? v.az : null,
            delay: Math.round((v.d || 0) / 60),
            destination: route?.destination || null,
            stop: (v.psi && byStop?.get(v.psi)) || null,
            lineId: route?.lineId || null,
            routeId: route?.routeId || null,
            // identifikátory spoje pro jízdní řád (jen vozy na pravidelném spoji mají tn)
            trip: v.tn || null,
            routeName: v.rn || null,
            obu: v.o || null,
            lineNum: v.ln || null
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

// Jízdní řád spoje z getPlatformsDataWithHistory: plán = departureTime (wall-clock jako UTC),
// skutečnost = realDepartureInSecondsFromMidnight. Vrací zastávky s plánem, skutečností a zpožděním.
export async function getDpmhkTimetable(lineNumber, tripNumber, routeNumber, obuNumber) {
    const body = JSON.stringify({
        lineNumber: String(lineNumber),
        tripNumber: Number(tripNumber),
        routeNumber: String(routeNumber),
        obuNumber: Number(obuNumber)
    });
    const response = await fetch(`${BASE}/getPlatformsDataWithHistory`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: 'https://dpmhk.qrbus.me' },
        body
    });
    if (!response.ok) throw new Error(`DPMHK jízdní řád ${response.status}`);
    const platforms = ((await response.json()).platforms || []).slice().sort((a, b) => a.stopOrder - b.stopOrder);
    return platforms.map((p) => {
        const plannedSec = Number.isFinite(p.departureTime) ? ((p.departureTime % 86400) + 86400) % 86400 : null;
        const actualDepSec = p.realDepartureInSecondsFromMidnight >= 0 ? p.realDepartureInSecondsFromMidnight : null;
        const actualArrSec = p.realArrivalInSecondsFromMidnight >= 0 ? p.realArrivalInSecondsFromMidnight : null;
        const delayMin = (plannedSec != null && actualDepSec != null)
            ? Math.round((actualDepSec - plannedSec) / 60)
            : null;
        return {
            station: p.stopName,
            planned: hhmm(plannedSec),
            actualDep: hhmm(actualDepSec),
            actualArr: hhmm(actualArrSec),
            delayMin
        };
    });
}
