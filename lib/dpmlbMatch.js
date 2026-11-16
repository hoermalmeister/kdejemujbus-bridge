// Dopočet spoje DPMLB z polohy, času a zpoždění. Párovací data (zastávky se souřadnicemi
// a časy odjezdů) staví denně pipeline do match/<linka>.json na GitHub Pages.
const BASE = process.env.DPMLB_ROUTES_BASE || 'https://hoermalmeister.github.io/kdejemujbus-bridge';
const DAY_MS = 86_400_000;

const cache = new Map();      // linka -> { at, data } (ukládáme jen úspěšné stažení)
const inFlight = new Map();   // linka -> probíhající požadavek
let queue = Promise.resolve(); // stahujeme postupně, ne naráz, ať nás Pages neodmítne

// Čas v pražské zóně (GTFS jízdní řády jsou v místním čase); bere ohled na letní/zimní čas
function pragueNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const hour = get('hour') % 24;
    return { date: Date.UTC(get('year'), get('month') - 1, get('day')), sec: hour * 3600 + get('minute') * 60 + get('second') };
}

function fresh(entry) {
    return entry && Date.now() - entry.at < 6 * 3600_000;
}

function loadLine(line) {
    const entry = cache.get(line);
    if (fresh(entry)) return Promise.resolve(entry.data);
    if (inFlight.has(line)) return inFlight.get(line);

    // Zařadíme za ostatní stažení, takže na Pages jde v jednu chvíli nejvýš jeden požadavek
    const request = queue.then(async () => {
        const current = cache.get(line);
        if (fresh(current)) return current.data;
        try {
            const response = await fetch(`${BASE}/match/${line}.json`);
            if (!response.ok) throw new Error(`Pages ${response.status}`);
            const data = await response.json();
            cache.set(line, { at: Date.now(), data });   // ukládáme jen úspěch, chybu zkusíme příště znovu
            return data;
        } catch {
            return current?.data ?? null;
        }
    }).finally(() => inFlight.delete(line));

    inFlight.set(line, request);
    queue = request.catch(() => {});
    return request;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Poloha, kde by vůz podle jízdního řádu měl být v čase t (sekundy od půlnoci), a index zastávky
function expectedAt(trip, t) {
    const { t: times, la, lo } = trip;
    if (t <= times[0]) return [la[0], lo[0], 0];
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    if (i >= times.length - 1) return [la[i], lo[i], i];
    const f = (t - times[i]) / Math.max(1, times[i + 1] - times[i]);
    return [la[i] + (la[i + 1] - la[i]) * f, lo[i] + (lo[i + 1] - lo[i]) * f, i];
}

const LAST_STOP_TOLERANCE_M = 150;   // jak blízko musí být zastávka spoje k nahlášené poslední zastávce
const FINAL_STOP_TOLERANCE_M = 400;  // totéž pro cílovou zastávku

// Porovnání názvů zastávek bez ohledu na velikost písmen, diakritiku a interpunkci
// („Kladno,Gymnasium" = „Kladno,gymnasium", „Brno, Benešova tř.,hotel GRAND" = „Brno,Benešova tř.hotel GRAND")
export function stopNameKey(name) {
    return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// Index zastávky spoje se stejným názvem jako nápověda, nebo -1. Když se název na spoji
// opakuje, vybere se výskyt, jehož čas je nejblíž t (sekundy od půlnoci).
function stopIndexByName(trip, key, t) {
    if (!key || !Array.isArray(trip.n)) return -1;
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < trip.n.length; i++) {
        if (stopNameKey(trip.n[i]) !== key) continue;
        const diff = Math.abs((trip.t[i] ?? t) - t);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

// Index zastávky spoje nejbližší některé z nápověd (do tolerance), nebo -1
function nearestStopIndex(trip, points, tolerance, onlyIndex = null) {
    let bestIndex = -1, bestDist = tolerance;
    const from = onlyIndex ?? 0, to = onlyIndex ?? trip.la.length - 1;
    for (let i = from; i <= to; i++) {
        for (const [lat, lng] of points) {
            const d = haversine(lat, lng, trip.la[i], trip.lo[i]);
            if (d <= bestDist) { bestDist = d; bestIndex = i; }
        }
    }
    return bestIndex;
}

// Vrátí { run, stopIndex } nejlépe sedícího spoje, nebo null, když dnes nic nejede.
// Vybírá se vždy nejbližší odhad: spoj ve svém čase vyhraje sám, mimo něj se poloha ořízne
// na konečnou, takže zjevně nejedoucí spoje nevyhrávají.
// Nápovědy (hints.last / hints.final = souřadnice poslední a cílové zastávky ze zdroje) mají
// přednost před vzdáleností: nejdřív spoje, které sedí na cíl i poslední zastávku, pak jen
// na cíl, pak jen na poslední zastávku, a teprve v rámci skupiny rozhoduje vzdálenost.
export async function matchDpmlb(line, lat, lng, delayMin, hints = null) {
    const data = await loadLine(line);
    if (!data?.trips?.length) return null;
    const now = pragueNow();
    const base = Date.UTC(+data.base.slice(0, 4), +data.base.slice(4, 6) - 1, +data.base.slice(6, 8));
    const offset = Math.round((now.date - base) / DAY_MS);
    if (offset < 0) return null;
    const t = now.sec - delayMin * 60;
    const lastHints = hints?.last?.length ? hints.last : null;
    const finalHints = hints?.final?.length ? hints.final : null;
    // Nápovědy podle názvu (zdroje, které posílají jen jména zastávek – Arriva)
    const lastNameKey = stopNameKey(hints?.lastName);
    const finalNameKey = stopNameKey(hints?.finalName);

    let best = null;
    for (const trip of data.trips) {
        // Spoj z dneška porovnáme k dnešku i k času po půlnoci; spoj ze včerejška jen po půlnoci
        const targets = [];
        if ((trip.days >> offset) & 1) targets.push(t, t + 86400);
        if (offset > 0 && (trip.days >> (offset - 1)) & 1) targets.push(t + 86400);
        if (!targets.length) continue;

        const lastStop = trip.la.length - 1;
        const finalOk = (finalHints && nearestStopIndex(trip, finalHints, FINAL_STOP_TOLERANCE_M, lastStop) >= 0)
            || (finalNameKey && (stopNameKey(trip.hs) === finalNameKey || (Array.isArray(trip.n) && stopNameKey(trip.n[lastStop]) === finalNameKey)));
        let lastIndex = lastHints ? nearestStopIndex(trip, lastHints, LAST_STOP_TOLERANCE_M) : -1;
        if (lastIndex < 0 && lastNameKey) lastIndex = stopIndexByName(trip, lastNameKey, targets[0]);
        const tier = finalOk && lastIndex >= 0 ? 0 : finalOk ? 1 : lastIndex >= 0 ? 2 : 3;

        for (const target of targets) {
            const [el, eo, idx] = expectedAt(trip, target);
            const dist = haversine(lat, lng, el, eo);
            if (!best || tier < best.tier || (tier === best.tier && dist < best.dist)) {
                best = { tier, dist, run: trip.run, stopIndex: lastIndex >= 0 ? lastIndex : idx, stopMatched: lastIndex >= 0, hs: trip.hs || null };
            }
        }
    }
    return best && { run: best.run, stopIndex: best.stopIndex, stopMatched: best.stopMatched, hs: best.hs };
}

// Vrátí platné číslo spoje: když RouteID odpovídá některému spoji linky, použije se; jinak se
// spoj dopočítá z polohy a času (pro zdroje s občas chybným RouteID, např. DPMÚL).
export async function resolveRun(line, routeId, lat, lng, delayMin) {
    const data = await loadLine(line);
    const rid = String(routeId);
    if (!data?.trips?.length) return rid;
    if (data.trips.some((trip) => String(trip.run) === rid)) return rid;
    const match = await matchDpmlb(line, lat, lng, delayMin);
    return match?.run ?? rid;
}

function bearing(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLng = (lng2 - lng1) * rad;
    const y = Math.sin(dLng) * Math.cos(lat2 * rad);
    const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

// Teoretické polohy podle jízdního řádu (linky bez real-time poloh): všechny spoje linky,
// které právě jedou (mezi odjezdem z první a příjezdem do poslední zastávky), s polohou
// interpolovanou mezi zastávkami. Spoj ze včerejška se počítá i po půlnoci.
export async function scheduledVehicles(line) {
    const data = await loadLine(line);
    if (!data?.trips?.length) return [];
    const now = pragueNow();
    const base = Date.UTC(+data.base.slice(0, 4), +data.base.slice(4, 6) - 1, +data.base.slice(6, 8));
    const offset = Math.round((now.date - base) / DAY_MS);
    if (offset < 0) return [];

    const result = [];
    for (const trip of data.trips) {
        const targets = [];
        if ((trip.days >> offset) & 1) targets.push(now.sec);
        if (offset > 0 && (trip.days >> (offset - 1)) & 1) targets.push(now.sec + 86400);
        const times = trip.t;
        const t = targets.find((x) => x >= times[0] && x <= times[times.length - 1]);
        if (t === undefined) continue;

        const [lat, lng, i] = expectedAt(trip, t);
        const j = Math.min(i + 1, trip.la.length - 1);
        result.push({
            run: trip.run,
            lat,
            lng,
            heading: j > i ? Math.round(bearing(trip.la[i], trip.lo[i], trip.la[j], trip.lo[j])) : null,
            stopIndex: i,
            stop: Array.isArray(trip.n) ? trip.n[i] || null : null,
            destination: trip.hs || (Array.isArray(trip.n) ? trip.n[trip.n.length - 1] : null) || null
        });
    }
    return result;
}
