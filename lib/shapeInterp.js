// Posouvání teoretické polohy po tvaru trasy (GTFS shapes) místo po přímce mezi zastávkami.
// Trasy bere z publikovaných routes/<linka>.json (stejné soubory jako frontend), zastávky spoje
// promítne na trasu (postupně, aby okružní linky nepřeskakovaly) a polohu dopočítá podle času.
const BASE = process.env.DPMLB_ROUTES_BASE || 'https://hoermalmeister.github.io/kdejemujbus-bridge';
const TTL_MS = 6 * 3600_000;
const DAY_MS = 86400000;

const routeCache = new Map();   // linka → { at, promise }
const profileCache = new Map(); // "linka|index tvaru|podpis zastávek" → { points, cum, stopDist }

function loadRoutes(line) {
    const cached = routeCache.get(line);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
    const promise = fetch(`${BASE}/routes/${encodeURIComponent(line)}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => {
            if (!data) routeCache.delete(line); // neúspěch necacheovat
            return data;
        });
    routeCache.set(line, { at: Date.now(), promise });
    return promise;
}

function decodePolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    const next = () => {
        let shift = 0, result = 0, byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += next();
        lng += next();
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

// Rovinná aproximace kolem bodu (metry) – na úrovni linky MHD bohatě stačí
function toXY(lat, lng, lat0) {
    return [lng * Math.cos(lat0 * Math.PI / 180) * 111320, lat * 110540];
}

function bearing(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLng = (lng2 - lng1) * rad;
    const y = Math.sin(dLng) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

// Vzdálenosti zastávek podél trasy. Každá zastávka se hledá od místa předchozí dál, aby
// se zastávka, kterou trasa míjí dvakrát (okruh, smyčka), nepromítla na špatný průjezd.
function buildProfile(points, stops) {
    const lat0 = points[0][0];
    const xy = points.map(([la, lo]) => toXY(la, lo, lat0));
    const cum = [0];
    for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));

    const stopDist = [];
    let fromSeg = 0;
    for (const [la, lo] of stops) {
        const [px, py] = toXY(la, lo, lat0);
        let best = { d2: Infinity, seg: fromSeg, along: cum[fromSeg] };
        for (let s = fromSeg; s < xy.length - 1; s++) {
            const [ax, ay] = xy[s], [bx, by] = xy[s + 1];
            const sx = bx - ax, sy = by - ay, len2 = sx * sx + sy * sy;
            const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / len2)) : 0;
            const qx = ax + t * sx, qy = ay + t * sy;
            const d2 = (px - qx) ** 2 + (py - qy) ** 2;
            if (d2 < best.d2) best = { d2, seg: s, along: cum[s] + Math.sqrt(len2) * t };
        }
        stopDist.push(best.along);
        fromSeg = best.seg;
    }
    return { points, cum, stopDist };
}

function pointAt(profile, dist) {
    const { points, cum } = profile;
    if (dist <= 0) return { lat: points[0][0], lng: points[0][1], seg: 0 };
    let lo = 0, hi = cum.length - 1;
    if (dist >= cum[hi]) return { lat: points[hi][0], lng: points[hi][1], seg: Math.max(0, hi - 1) };
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= dist) lo = mid; else hi = mid; }
    const f = (dist - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    return {
        lat: points[lo][0] + (points[hi][0] - points[lo][0]) * f,
        lng: points[lo][1] + (points[hi][1] - points[lo][1]) * f,
        seg: lo
    };
}

// Vrátí { lat, lng, heading } na trase spoje pro index zastávky i a podíl úseku f (0–1),
// nebo null, když trasa není (pak se použije přímka mezi zastávkami).
export async function positionOnShape(line, run, dayOffset, stops, i, f) {
    const data = await loadRoutes(line);
    const variants = data?.trips?.[run];
    if (!variants?.length || !data.shapes) return null;
    const base = Date.UTC(+data.base.slice(0, 4), +data.base.slice(4, 6) - 1, +data.base.slice(6, 8));
    const offset = dayOffset(base);
    const variant = variants.find(([, mask]) => offset >= 0 && (mask >> offset) & 1) || variants[0];
    const shapeIndex = variant[0];

    const key = `${line}|${shapeIndex}|${stops.length}|${stops[0]}|${stops[stops.length - 1]}`;
    let profile = profileCache.get(key);
    if (!profile) {
        const points = decodePolyline(data.shapes[shapeIndex] || '');
        if (points.length < 2) return null;
        profile = buildProfile(points, stops);
        profileCache.set(key, profile);
        if (profileCache.size > 500) profileCache.delete(profileCache.keys().next().value);
    }

    const j = Math.min(i + 1, stops.length - 1);
    const dist = profile.stopDist[i] + (profile.stopDist[j] - profile.stopDist[i]) * f;
    const here = pointAt(profile, dist);
    // směr podle úseku trasy kousek před vozem (na zastávce stojící vůz míří k další)
    const ahead = pointAt(profile, Math.min(dist + 25, profile.cum[profile.cum.length - 1]));
    const behind = pointAt(profile, Math.max(dist - 5, 0));
    const moved = Math.abs(ahead.lat - behind.lat) + Math.abs(ahead.lng - behind.lng) > 1e-7;
    return {
        lat: here.lat,
        lng: here.lng,
        heading: moved ? Math.round(bearing(behind.lat, behind.lng, ahead.lat, ahead.lng)) : null
    };
}

export const __test = { decodePolyline, buildProfile, pointAt };
