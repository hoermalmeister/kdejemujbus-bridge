// PMDP posílá polohy jen přes SignalR. Spojení držíme otevřené, jen dokud se někdo ptá,
// a z proudu si pamatujeme pouze poslední snímek.
const BASE_URL = 'https://jizdnirady.pmdp.cz';
const CONNECTION_DATA = encodeURIComponent(JSON.stringify([{ name: 'provozhub' }]));
const IDLE_CLOSE_MS = 60_000;
const SILENCE_LIMIT_MS = 45_000;
const STALE_LIMIT_MS = 60_000;
const RETRY_DELAY_MS = 5_000;
const SHORT_TIMEOUT_MS = 10_000;

const HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'referer': `${BASE_URL}/provoz`
};

let snapshot = null;
let snapshotAt = 0;
let lastRequestAt = 0;
let controller = null;
let running = false;
let cookie = '';

function storeCookies(response) {
    const fresh = response.headers.getSetCookie().map(value => value.split(';')[0]);
    if (fresh.length === 0) return;
    const jar = new Map(cookie.split('; ').filter(Boolean).map(value => [value.split('=')[0], value]));
    fresh.forEach(value => jar.set(value.split('=')[0], value));
    cookie = [...jar.values()].join('; ');
}

async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
        signal: AbortSignal.timeout(SHORT_TIMEOUT_MS),
        ...options,
        headers: { ...HEADERS, cookie, ...options.headers }
    });
    storeCookies(response);
    if (!response.ok) throw new Error(`PMDP ${path.split('?')[0]}: ${response.status}`);
    return response;
}

function compact(vehicle) {
    return {
        vehicle: vehicle.VehicleNumber,
        id: vehicle.ConnectionId,
        line: vehicle.Line?.Name,
        fullLine: vehicle.Line?.Number,
        traction: vehicle.Line?.TractionType,
        delay: vehicle.DelayMin,
        lastStop: vehicle.LastStopName,
        lastStopIndex: vehicle.LastStopIndex,
        destination: vehicle.DestinationName,
        lat: vehicle.Latitude,
        lng: vehicle.Longitude,
        heading: vehicle.Azimuth
    };
}

function handleLine(line, onInitialized) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === 'initialized') return onInitialized();
    let message;
    try { message = JSON.parse(data); } catch { return; }
    for (const item of message.M || []) {
        if (item.M === 'updateTraffic' && Array.isArray(item.A?.[0])) {
            snapshot = item.A[0].map(compact);
            snapshotAt = Date.now();
        }
    }
}

async function runConnection() {
    controller = new AbortController();
    const signal = controller.signal;
    cookie = '';
    await request('/provoz');
    const negotiate = await (await request(`/signalr/negotiate?clientProtocol=2.1&connectionData=${CONNECTION_DATA}`, {
        headers: { 'x-requested-with': 'XMLHttpRequest' }
    })).json();
    const query = `transport=serverSentEvents&clientProtocol=2.1&connectionToken=${encodeURIComponent(negotiate.ConnectionToken)}&connectionData=${CONNECTION_DATA}`;

    const stream = await fetch(`${BASE_URL}/signalr/connect?${query}&tid=3`, {
        signal,
        headers: { ...HEADERS, cookie, accept: 'text/event-stream' }
    });
    if (!stream.ok) throw new Error(`PMDP connect: ${stream.status}`);

    const startedAt = Date.now();
    const watchdog = setInterval(() => {
        const idle = Date.now() - lastRequestAt > IDLE_CLOSE_MS;
        const silent = Date.now() - Math.max(snapshotAt, startedAt) > SILENCE_LIMIT_MS;
        if (idle || silent) controller.abort();
    }, 5_000);
    const onInitialized = async () => {
        try {
            await request(`/signalr/start?${query}`, { headers: { 'x-requested-with': 'XMLHttpRequest' } });
            const data = JSON.stringify({ H: 'provozhub', M: 'Registrace', A: [null], I: 0 });
            await request(`/signalr/send?${query}`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
                body: new URLSearchParams({ data }).toString()
            });
        } catch (error) {
            console.error('Chyba startu PMDP:', error.message);
            controller.abort();
        }
    };

    try {
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of stream.body) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(line => handleLine(line.replace(/\r$/, ''), onInitialized));
        }
    } finally {
        clearInterval(watchdog);
    }
}

async function keepConnected() {
    if (running) return;
    running = true;
    while (Date.now() - lastRequestAt <= IDLE_CLOSE_MS) {
        try {
            await runConnection();
        } catch (error) {
            if (error.name !== 'AbortError') console.error('Spojení PMDP selhalo:', error.message);
        }
        if (Date.now() - lastRequestAt <= IDLE_CLOSE_MS) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }
    running = false;
    snapshot = null;
}

export async function getPmdpVehicles() {
    lastRequestAt = Date.now();
    keepConnected();
    // Při prvním dotazu chvíli počkáme na první snímek
    for (let waited = 0; waited < 8_000 && Date.now() - snapshotAt > STALE_LIMIT_MS; waited += 200) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!snapshot || Date.now() - snapshotAt > STALE_LIMIT_MS) throw new Error('PMDP zatím neposlalo polohy');
    return snapshot;
}

export async function getPmdpTrip(connectionId) {
    if (!cookie) await request('/provoz');
    const response = await request('/provoz/trasaspoje', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', origin: BASE_URL },
        body: JSON.stringify({ SegmentId: { ConnectionId: connectionId }, IncludeDetailedPath: true })
    });
    const trip = await response.json();
    const time = (value) => (value ? value.slice(11, 16) : null);
    return {
        run: trip.SegmentId?.ConnectionNumber ?? null,
        shape: (trip.DetailedPath || []).map(point => [point.Longitude, point.Latitude]),
        stops: (trip.Stops || []).map(stop => ({ name: stop.Name, arr: time(stop.ArrivalTime), dep: time(stop.DepartureTime) }))
    };
}
