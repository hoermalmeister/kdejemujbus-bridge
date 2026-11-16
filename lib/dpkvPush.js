// DPKV (Karlovy Vary). Portál dopravniportal.dpkv.cz neodpovídá adresám datacenter, proto data
// stahuje telefon v ČR (relay/dpkv-relay.mjs v Termuxu) a posílá je sem. Telefon posílá vrstvu
// „RT spoje point": id "linka_spoj", souřadnice S-JTSK a HTML značky s barvou linky.
import crypto from 'crypto';
import { sjtskToWgs84 } from './sjtsk.js';

// SHA-256 klíče, kterým se telefon prokazuje (samotný klíč v repozitáři není)
const KEY_HASH = process.env.DPKV_PUSH_KEY_HASH || 'c9c1aa833d5e96f0645ded99d684ec71cdfef75acac7250cf78892c0cb508a72';
const STALE_MS = 90_000;          // když telefon 90 s nic nepošle, vozy DPKV nezobrazujeme
const MOVE_FOR_HEADING_M = 15;    // směr počítáme až z pohybu o víc než 15 m

let state = { at: 0, vehicles: [], diag: null, pushes: 0 };
const lastPositions = new Map();  // id → { lat, lng, heading }

export function checkKey(key) {
    if (!key || typeof key !== 'string') return false;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(KEY_HASH));
}

function distance(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const kx = Math.cos(lat1 * rad) * 111320, ky = 110540;
    return Math.hypot((lng2 - lng1) * kx, (lat2 - lat1) * ky);
}

function bearing(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLng = (lng2 - lng1) * rad;
    const y = Math.sin(dLng) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

// Krátké číslo linky MHD Karlovy Vary → šestimístná linka v GTFS (1 → 425001, A → 425044)
export function dpkvFullLine(line) {
    if (/^\d{1,3}$/.test(line)) return `425${line.padStart(3, '0')}`;
    if (line === 'A') return '425044';
    return null;
}

export function acceptPush(body) {
    const features = Array.isArray(body?.features) ? body.features : null;
    if (!features) throw new Error('chybí features');
    const vehicles = [];
    const seen = new Set();
    for (const f of features.slice(0, 500)) {
        const id = String(f?.id ?? '');
        const match = /^([^_]+)_(\d+)$/.exec(id);
        if (!match || !Number.isFinite(f.x) || !Number.isFinite(f.y) || seen.has(id)) continue;
        seen.add(id);
        const { lat, lng } = sjtskToWgs84(f.x, f.y);
        if (lat < 49.9 || lat > 50.6 || lng < 12.3 || lng > 13.4) continue; // mimo Karlovarsko = nesmysl
        const html = String(f.html || '');
        const text = /rtconn-text[^>]*>([^<]*)</.exec(html)?.[1]?.trim() || match[1];

        const previous = lastPositions.get(id);
        let heading = previous?.heading ?? null;
        if (previous && distance(previous.lat, previous.lng, lat, lng) > MOVE_FOR_HEADING_M) {
            heading = Math.round(bearing(previous.lat, previous.lng, lat, lng));
        }
        if (!previous || heading !== previous.heading || distance(previous.lat, previous.lng, lat, lng) > MOVE_FOR_HEADING_M) {
            lastPositions.set(id, { lat, lng, heading });
        }

        const delay = Number.isFinite(f.delay) ? Math.round(f.delay) : null;
        vehicles.push({
            vehicle: id,
            line: text,
            run: match[2],
            fullLine: dpkvFullLine(match[1]),
            lat,
            lng,
            heading,
            // zpoždění a směr z tooltipu portálu (telefon je obnovuje postupně, může chybět)
            delay,
            delayKnown: delay !== null,
            destination: typeof f.dest === 'string' && f.dest.trim() ? f.dest.trim().slice(0, 100) : null
        });
    }
    // úklid paměti směrů pro vozy, které už nejedou
    for (const id of lastPositions.keys()) if (!seen.has(id)) lastPositions.delete(id);

    state = {
        at: Date.now(),
        vehicles,
        pushes: state.pushes + 1,
        diag: body.diag && typeof body.diag === 'object' ? JSON.parse(JSON.stringify(body.diag).slice(0, 4000) || 'null') : null
    };
    return vehicles.length;
}

export function getPushedVehicles() {
    if (Date.now() - state.at > STALE_MS) return [];
    return state.vehicles.map((v) => ({ ...v }));
}

export function pushStatus() {
    return {
        lastPushSecondsAgo: state.at ? Math.round((Date.now() - state.at) / 1000) : null,
        vehicles: state.vehicles.length,
        pushesSinceStart: state.pushes,
        diag: state.diag
    };
}
