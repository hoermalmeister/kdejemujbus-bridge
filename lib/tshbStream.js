import { encode, decode } from '@msgpack/msgpack';

// MHD Havlíčkův Brod běží na Blazor Server, takže polohy nejsou na žádném běžném endpointu.
// Místo prohlížeče se připojíme přímo jako jeho klient a čteme, co server posílá:
// volání addBusMarker/updateBusMarker (polohy) a první vykreslení tabulky (zpoždění, zastávka).
const BASE_URL = 'https://www.mhdhb.cz/';
const IDLE_CLOSE_MS = 60_000;
const SILENCE_LIMIT_MS = 90_000;
const RECONNECT_FOR_TABLE_MS = 120_000;
const VEHICLE_TTL_MS = 180_000;
const RETRY_DELAY_MS = 5_000;
const PING_MS = 15_000;
const FIRST_DATA_WAIT_MS = 8_000;

const vehicles = new Map();
let tableRows = [];
let lastDataAt = 0;
let lastRequestAt = 0;
let running = false;

const MSG_INVOCATION = 1;
const MSG_PING = 6;

function frame(message) {
    const body = encode(message);
    const header = [];
    let length = body.length;
    do {
        let byte = length & 0x7f;
        length >>>= 7;
        if (length) byte |= 0x80;
        header.push(byte);
    } while (length);
    return new Uint8Array([...header, ...body]);
}

function parseFrames(buffer) {
    const bytes = new Uint8Array(buffer);
    const messages = [];
    let offset = 0;
    while (offset < bytes.length) {
        let length = 0, shift = 0, byte;
        do {
            byte = bytes[offset++];
            length |= (byte & 0x7f) << shift;
            shift += 7;
        } while (byte & 0x80);
        messages.push(decode(bytes.subarray(offset, offset + length)));
        offset += length;
    }
    return messages;
}

function storeMarker(marker) {
    if (!marker?.vehiclePlate || !marker.position?.lat || !marker.position?.lng) return;
    const plate = marker.vehiclePlate.trim();
    const [title = '', finalStop = ''] = String(marker.tooltip?.content || '').split(/<br\s*\/?>/i);
    vehicles.set(plate, {
        plate,
        line: /Linka\s+(\S+)/i.exec(title)?.[1] ?? null,
        run: /\((\d+)\)/.exec(title)?.[1] ?? null,
        destination: finalStop.trim(),
        lat: marker.position.lat,
        lng: marker.position.lng,
        heading: marker.angle ?? null,
        seenAt: Date.now()
    });
    lastDataAt = Date.now();
}

// Konec RenderBatch obsahuje posuny sekcí, poslední vede na tabulku řetězců
function readBatchStrings(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tableStart = view.getInt32(data.byteLength - 4, true);
    const decoder = new TextDecoder();
    const strings = [];
    for (let position = tableStart; position < data.byteLength - 20; position += 4) {
        let offset = view.getInt32(position, true);
        let length = 0, shift = 0, byte;
        do {
            byte = data[offset++];
            length |= (byte & 0x7f) << shift;
            shift += 7;
        } while (byte & 0x80);
        strings.push(decoder.decode(data.subarray(offset, offset + length)));
    }
    return strings;
}

// Řádek tabulky: linka | směr | zastávka | plán | skutečnost | zpoždění, buňky odděluje třída
function readTableRows(strings) {
    const rows = [];
    for (let i = 1; i + 9 < strings.length; i++) {
        const isRow = strings[i] === 'text-left' && strings[i + 2] === 'text-left' && strings[i + 4] === 'text-right'
            && strings[i + 6] === 'text-right' && strings[i + 8] === 'text-center';
        if (!isRow) continue;
        const delay = parseInt(strings[i + 9], 10);
        rows.push({
            line: strings[i - 1].trim(),
            direction: strings[i + 1].trim().toLowerCase(),
            stop: strings[i + 3].trim(),
            delay: isNaN(delay) ? 0 : delay
        });
    }
    return rows;
}

function runCircuit() {
    return new Promise(async (resolve, reject) => {
        const page = await fetch(BASE_URL, { headers: { 'user-agent': 'Mozilla/5.0' } });
        if (!page.ok) return reject(new Error(`TSHB stránka: ${page.status}`));
        const components = [...(await page.text()).matchAll(/<!--Blazor:(\{.*?\})-->/g)]
            .map(match => JSON.parse(match[1]))
            .filter(component => component.type === 'server');
        if (components.length === 0) return reject(new Error('TSHB: stránka neobsahuje Blazor komponentu'));

        const negotiate = await (await fetch(`${BASE_URL}_blazor/negotiate?negotiateVersion=1`, { method: 'POST' })).json();
        const socket = new WebSocket(`wss://www.mhdhb.cz/_blazor?id=${encodeURIComponent(negotiate.connectionToken)}`);
        socket.binaryType = 'arraybuffer';

        const openedAt = Date.now();
        let handshakeDone = false;
        const timer = setInterval(() => {
            const idle = Date.now() - lastRequestAt > IDLE_CLOSE_MS;
            const silent = Date.now() - Math.max(lastDataAt, openedAt) > SILENCE_LIMIT_MS;
            const refreshTable = Date.now() - openedAt > RECONNECT_FOR_TABLE_MS;
            if (idle || silent || refreshTable) return socket.close();
            if (socket.readyState === WebSocket.OPEN) socket.send(frame([MSG_PING]));
        }, PING_MS);

        const send = (target, args) => socket.send(frame([MSG_INVOCATION, {}, null, target, args]));

        socket.onopen = () => socket.send('{"protocol":"blazorpack","version":1}\x1e');
        socket.onerror = () => {};
        socket.onclose = () => { clearInterval(timer); resolve(); };
        socket.onmessage = (event) => {
            if (!handshakeDone) {
                handshakeDone = true;
                socket.send(frame([MSG_INVOCATION, {}, '1', 'StartCircuit', [BASE_URL, BASE_URL, JSON.stringify(components)]]));
                return;
            }
            for (const message of parseFrames(event.data)) {
                if (message[0] === MSG_PING) continue;
                if (message[0] !== MSG_INVOCATION) continue;
                const [target, args] = [message[3], message[4]];
                if (target === 'JS.RenderBatch') {
                    send('OnRenderCompleted', [args[0], null]);
                    const rows = readTableRows(readBatchStrings(args[1]));
                    if (rows.length > 0) tableRows = rows;
                } else if (target === 'JS.BeginInvokeJS') {
                    const [callId, name, json] = args;
                    if (/BusMarker$/.test(name)) storeMarker(JSON.parse(json)[0]);
                    if (callId) send('EndInvokeJSFromDotNet', [callId, true, JSON.stringify([callId, true, null])]);
                }
            }
        };
    });
}

async function keepConnected() {
    if (running) return;
    running = true;
    while (Date.now() - lastRequestAt <= IDLE_CLOSE_MS) {
        try {
            await runCircuit();
        } catch (error) {
            console.error('Spojení TSHB selhalo:', error.message);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }
    running = false;
    vehicles.clear();
    tableRows = [];
}

export async function getTshbVehicles() {
    lastRequestAt = Date.now();
    keepConnected();
    for (let waited = 0; waited < FIRST_DATA_WAIT_MS && vehicles.size === 0; waited += 200) {
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    const now = Date.now();
    const result = [];
    for (const [plate, vehicle] of vehicles) {
        if (now - vehicle.seenAt > VEHICLE_TTL_MS) {
            vehicles.delete(plate);
            continue;
        }
        const row = tableRows.find(item => item.line === vehicle.line && item.direction === vehicle.destination.toLowerCase());
        const { seenAt, ...rest } = vehicle;
        result.push({ ...rest, delay: row ? row.delay : null, stop: row ? row.stop : null });
    }
    return result;
}
