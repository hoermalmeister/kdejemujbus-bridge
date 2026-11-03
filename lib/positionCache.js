import { createHash } from 'crypto';
import { gzip as gzipCallback, gunzipSync } from 'zlib';
import { promisify } from 'util';

const gzip = promisify(gzipCallback);

const CACHE_TTL_MS = 10_000;     // Jak dlouho sdílíme jednu odpověď mezi všemi klienty
const STALE_LIMIT_MS = 120_000;  // Jak dlouho smíme při výpadku zdroje vracet poslední dobrá data

// Polohy se pro každého klienta stahovaly a znovu serializovaly zvlášť. Takhle jde na
// zdroj nejvýš jeden dotaz za 10 s a všichni dostanou tentýž předem zkomprimovaný výsledek.
export function createPositionCache() {
    const entries = new Map();

    async function refresh(key, entry, producer) {
        try {
            const body = Buffer.from(JSON.stringify(await producer()));
            entry.gzipped = await gzip(body);
            entry.etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
            entry.lastGoodAt = Date.now();
            entry.error = null;
        } catch (error) {
            console.error(`Chyba zdroje ${key}:`, error.message);
            entry.error = error;
        } finally {
            entry.checkedAt = Date.now();
            entry.inFlight = null;
        }
    }

    return function positionRoute(key, producer) {
        const entry = { gzipped: null, etag: null, lastGoodAt: 0, checkedAt: 0, inFlight: null, error: null };
        entries.set(key, entry);

        return async (req, res) => {
            if (Date.now() - entry.checkedAt >= CACHE_TTL_MS) {
                entry.inFlight ??= refresh(key, entry, producer);
                await entry.inFlight;
            }

            if (!entry.gzipped || Date.now() - entry.lastGoodAt > STALE_LIMIT_MS) {
                return res.status(502).json({ error: entry.error?.message || 'Zdroj není dostupný' });
            }

            res.set({
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache',
                'ETag': entry.etag,
                'Vary': 'Accept-Encoding'
            });
            if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();

            if (req.acceptsEncodings('gzip')) {
                res.set('Content-Encoding', 'gzip');
                return res.end(entry.gzipped);
            }
            res.end(gunzipSync(entry.gzipped));
        };
    };
}
