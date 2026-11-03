import fs from 'fs';

// vdv_segments.json má přes 100 MB a po JSON.parse zabere v paměti zhruba 340 MB.
// Trasu ale chce jen málokdo, proto si držíme pouze index "klíč -> pozice v souboru"
// a souřadnice konkrétního segmentu čteme z disku, až když jsou potřeba.

const QUOTE = 0x22, BACKSLASH = 0x5c, OPEN = 0x5b, CLOSE = 0x5d;

export async function buildSegmentIndex(path) {
    const index = new Map();
    let position = 0, depth = 0, inString = false, escaped = false;
    let keyBytes = null, currentKey = null, valueStart = 0;

    for await (const chunk of fs.createReadStream(path, { highWaterMark: 1 << 20 })) {
        for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];

            if (inString) {
                if (keyBytes) keyBytes.push(byte);
                if (escaped) escaped = false;
                else if (byte === BACKSLASH) escaped = true;
                else if (byte === QUOTE) {
                    inString = false;
                    if (keyBytes) {
                        currentKey = JSON.parse(Buffer.from(keyBytes).toString('utf8'));
                        keyBytes = null;
                    }
                }
            } else if (byte === QUOTE) {
                inString = true;
                if (depth === 0) keyBytes = [QUOTE];
            } else if (byte === OPEN) {
                if (depth === 0) valueStart = position + i;
                depth++;
            } else if (byte === CLOSE) {
                depth--;
                if (depth === 0) index.set(currentKey, [valueStart, position + i + 1 - valueStart]);
            }
        }
        position += chunk.length;
    }
    return index;
}

export async function openSegmentStore(path) {
    const index = await buildSegmentIndex(path);
    const file = await fs.promises.open(path, 'r');

    return {
        size: index.size,
        async get(key) {
            const entry = index.get(key);
            if (!entry) return null;
            const buffer = Buffer.allocUnsafe(entry[1]);
            await file.read(buffer, 0, entry[1], entry[0]);
            return JSON.parse(buffer.toString('utf8'));
        }
    };
}
