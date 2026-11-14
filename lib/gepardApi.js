// Gepard Express (úzkokolejky JHMD, vlaky.gepard.com). Feed nedává polohu vlaku, jen zastávky
// se souřadnicemi a časy (pravidelné / předvídané / skutečné). Polohu proto dopočítáváme
// interpolací mezi zastávkami podle předvídaných časů. Vlak ale nepustíme za dopravnu
// s povinným ohlášením, dokud u ní není skutečný čas (předpověď může být zastaralá).
const URL = 'https://vlaky.gepard.com/api/get_trains.php';

const headers = {
    accept: '*/*',
    referer: 'https://vlaky.gepard.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const ms = (iso) => (iso ? Date.parse(iso) : null);
const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : null); // časy jsou v místním pásmu

function bearing(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const dLng = (lng2 - lng1) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2 * toRad);
    const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLng);
    return (Math.atan2(y, x) / toRad + 360) % 360;
}

// Postup po trase jako číslo: celá část = index zastávky, desetinná = podíl úseku k další
function progress(stops, now) {
    const last = stops.length - 1;

    // Podle času (skutečný → předvídaný → pravidelný)
    let byTime = last;
    if (now <= stops[0].dep) byTime = 0;
    else {
        for (let i = 0; i < last; i++) {
            const dep = stops[i].dep;
            const arr = stops[i + 1].arr;
            if (now < dep) { byTime = i; break; }
            if (now < arr) { byTime = i + (arr > dep ? (now - dep) / (arr - dep) : 0); break; }
        }
    }

    // Pojistka: bez skutečného času nepřejede dopravnu s ohlášením (ani z ní neodjede)
    let limit = last;
    for (let i = 0; i <= last; i++) {
        const s = stops[i];
        if (!s.report) continue;
        if (i > 0 && !s.realArr) { limit = i; break; }
        if (i < last && !s.realDep) { limit = i; break; }
    }
    return Math.min(byTime, limit);
}

function buildTrain(train, now) {
    const stops = (train.lokality || [])
        .slice()
        .sort((a, b) => a.poradi - b.poradi)
        .map((l) => {
            const c = l.casy || {};
            const arrIso = c.skutecny_prijezd || c.predvidany_prijezd || c.pravidelny_prijezd;
            const depIso = c.skutecny_odjezd || c.predvidany_odjezd || c.pravidelny_odjezd;
            return {
                id: l.id,
                name: l.nazev,
                lat: Number(l.gps?.lat),
                lng: Number(l.gps?.lng),
                report: Boolean(l.vyzaduje_ohlaseni),
                realArr: Boolean(c.skutecny_prijezd),
                realDep: Boolean(c.skutecny_odjezd),
                arr: ms(arrIso || depIso),
                dep: ms(depIso || arrIso),
                planArrMs: ms(c.pravidelny_prijezd || c.pravidelny_odjezd),
                planArr: hhmm(c.pravidelny_prijezd),
                planDep: hhmm(c.pravidelny_odjezd),
                actArr: hhmm(c.skutecny_prijezd || c.predvidany_prijezd),
                actDep: hhmm(c.skutecny_odjezd || c.predvidany_odjezd)
            };
        })
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.arr && s.dep);
    if (stops.length < 2) return null;

    const last = stops.length - 1;
    const p = progress(stops, now);
    const i = Math.min(Math.floor(p), last);
    const frac = p - i;
    const a = stops[i];
    const b = stops[Math.min(i + 1, last)];
    const next = frac > 0 ? b : a;

    // NAD: úsek mezi lokalitami nad_od a nad_do
    const nadFrom = stops.findIndex((s) => s.id === train.nad_od_lokalita_id);
    const nadTo = stops.findIndex((s) => s.id === train.nad_do_lokalita_id);
    const hasNad = train.nad_od_lokalita_id != null && nadFrom >= 0 && nadTo >= 0;
    const [nadLo, nadHi] = hasNad ? [Math.min(nadFrom, nadTo), Math.max(nadFrom, nadTo)] : [-1, -1];

    return {
        vehicle: String(train.cislo_vlaku),
        category: train.kategorie || 'Os',
        number: String(train.cislo_vlaku),
        name: train.nazev_vlaku || null,
        line: train.trat || null,
        carrier: 'Gepard Express',
        lat: a.lat + (b.lat - a.lat) * frac,
        lng: a.lng + (b.lng - a.lng) * frac,
        heading: i < last ? Math.round(bearing(a.lat, a.lng, b.lat, b.lng)) : null,
        delay: next.planArrMs ? Math.round((next.arr - next.planArrMs) / 60000) : 0,
        destination: stops[last].name,
        stop: a.name,
        stops: stops.map((s, index) => ({
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            planArr: s.planArr,
            planDep: s.planDep,
            actArr: s.actArr,
            actDep: s.actDep,
            isNAD: index >= nadLo && index <= nadHi
        }))
    };
}

export async function getGepardVehicles() {
    const response = await fetch(`${URL}?t=${Date.now()}`, { headers });
    if (!response.ok) throw new Error(`Gepard chyba: ${response.status}`);
    const trains = await response.json();
    if (!Array.isArray(trains)) throw new Error('Gepard: neočekávaná odpověď');

    const now = Date.now();
    const result = [];
    for (const train of trains) {
        if (train.status_pohybu !== 'jede') continue; // jen vlaky na cestě
        const built = buildTrain(train, now);
        if (built) result.push(built);
    }
    return result;
}

export const __test = { buildTrain };
