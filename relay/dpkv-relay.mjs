// DPKV relay pro telefon (Termux). Stahuje polohy vozů z dopravniportal.dpkv.cz (portál pouští
// jen české adresy, ne datacentra) a posílá je na můstek. Spouští ho relay/run.sh, který ho
// po pádu i po plánovaném ukončení (kvůli aktualizaci) znovu spustí.
import fs from 'fs';
import os from 'os';
import path from 'path';

const PORTAL = process.env.DPKV_PORTAL || 'https://dopravniportal.dpkv.cz/dic/';
const PUSH_URL = process.env.DPKV_PUSH_URL || 'https://grapp-bridge-production.up.railway.app/dpkv/push';
const DIR = process.env.DPKV_DIR || path.join(os.homedir(), 'dpkv');
const KEY = fs.readFileSync(path.join(DIR, 'key'), 'utf8').trim();
const LOG = path.join(DIR, 'relay.log');

const DAY_INTERVAL_MS = Number(process.env.DPKV_INTERVAL_MS) || 10_000;     // přes den každých 10 s
const NIGHT_INTERVAL_MS = 60_000;   // 0:30–4:00 jezdí jen noční linky, stačí jednou za minutu
const RESTART_AFTER_MS = Number(process.env.DPKV_RESTART_MS) || 6 * 3600_000; // po 6 h skončit, run.sh stáhne případnou novou verzi
const COMPARE_EVERY = 180;          // jednou za ~30 min ověřit, jestli úsporný dotaz nevynechává vozy

// Oblast kolem Karlových Varů (S-JTSK) – i s příměstskými linkami
const EXTENT = { xmin: -880000, xmax: -820000, ymin: -1040000, ymax: -980000 };
const RT_LAYER = 'RT spoje point';
const FALLBACK_LINE_LAYERS = ['Denni linky polyline', 'Nocni linky polyline', 'Primestske linky polyline',
    'Zvlastni linky polyline', 'Specialni linky polyline', 'Skolni linky polyline'];

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36';
let cookies = '';
let lineLayers = FALLBACK_LINE_LAYERS;
let useFull = false;      // true = dotaz i s vrstvami linek (portál bez nich některé vozy nevrací)
let lastCompare = null;
let errors = 0;

function log(message) {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
        if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG + '.1');
        fs.appendFileSync(LOG, line);
    } catch { /* log je jen pomocný */ }
    process.stdout.write(line);
}

function pragueHourMinute() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}

function storeCookies(response) {
    const list = response.headers.getSetCookie?.() || [];
    if (!list.length) return;
    const jar = new Map(cookies.split('; ').filter(Boolean).map(c => [c.split('=')[0], c]));
    for (const c of list) { const pair = c.split(';')[0]; jar.set(pair.split('=')[0], pair); }
    cookies = [...jar.values()].join('; ');
}

// Načte stránku portálu (cookies jako prohlížeč) a v ní i ve skriptech najde id vrstev linek
async function discover() {
    try {
        const response = await fetch(PORTAL, { headers: { 'user-agent': UA, accept: 'text/html' } });
        storeCookies(response);
        const html = await response.text();
        const sources = [html];
        for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
            const url = new URL(m[1], PORTAL);
            if (url.host !== new URL(PORTAL).host) continue;
            try { sources.push(await (await fetch(url, { headers: { 'user-agent': UA, cookie: cookies } })).text()); } catch { }
        }
        const found = new Set();
        for (const text of sources) {
            for (const m of text.matchAll(/["']([A-Za-zÀ-ſ ]*linky polyline)["']/gi)) found.add(m[1]);
        }
        if (found.size) lineLayers = [...found];
        log(`portál načten, vrstvy linek: ${lineLayers.join(', ')}`);
    } catch (error) {
        log(`načtení portálu selhalo: ${error.message}`);
    }
}

async function getFeatures(layers) {
    const body = {
        scale: 20000,
        resolution: 5.291677250021167,
        extent: EXTENT,
        layerFilterList: layers.map(id => ({ id }))
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch(PORTAL + 'FeatureService/GetFeatures', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                accept: 'application/json, text/javascript, */*; q=0.01',
                'content-type': 'application/json; charset=UTF-8',
                origin: 'https://dopravniportal.dpkv.cz',
                referer: PORTAL,
                'x-requested-with': 'XMLHttpRequest',
                'user-agent': UA,
                ...(cookies ? { cookie: cookies } : {})
            },
            body: JSON.stringify(body)
        });
        storeCookies(response);
        if (!response.ok) throw new Error(`portál ${response.status}`);
        const text = await response.text();
        const data = JSON.parse(text);
        const rt = (data.layers || []).find(l => l.id === RT_LAYER)?.featureList || [];
        return { rt, bytes: text.length };
    } finally {
        clearTimeout(timer);
    }
}

async function push(features, diag) {
    const response = await fetch(PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dpkv-key': KEY },
        body: JSON.stringify({ features: features.map(f => ({ id: f.id, x: f.x, y: f.y, html: f.html, delay: f.delay, dest: f.dest })), diag })
    });
    if (!response.ok) throw new Error(`můstek ${response.status} ${await response.text().catch(() => '')}`.slice(0, 200));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- Zpoždění a směr z tooltipu vozu (Map/RTConnTooltip) ---
// Jeden dotaz na vůz, proto v každém kole jen pár vozů: nejdřív ty, u kterých zpoždění ještě
// neznáme, pak ty s nejstarší hodnotou. Zpoždění každého vozu se tak obnoví zhruba každou minutu.
const TOOLTIPS_PER_ROUND = 6;
const TOOLTIP_MAX_AGE_MS = 5 * 60_000;
const tooltipCache = new Map(); // id → { at, delay, dest }

function decodeHtml(text) {
    return text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function parseTooltip(html) {
    const text = decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const delayMatch = /Zpo\u017ed\u011bn\u00ed\s*:\s*(-?\d+(?:[.,]\d+)?)\s*min/i.exec(text);
    const destMatch = /Sm\u011br\s*:\s*(.+?)\s*(?:Zpo\u017ed\u011bn\u00ed\s*:|$)/i.exec(text);
    return {
        delay: delayMatch ? Number(delayMatch[1].replace(',', '.')) : null,
        dest: destMatch ? destMatch[1].trim() : null
    };
}

async function fetchTooltip(id) {
    const headers = { accept: '*/*', referer: PORTAL, 'x-requested-with': 'XMLHttpRequest', 'user-agent': UA, ...(cookies ? { cookie: cookies } : {}) };
    const url = `${PORTAL}Map/RTConnTooltip?context=${encodeURIComponent(JSON.stringify({ id }))}`;
    let response = await fetch(url, { headers });
    if (!response.ok) {
        // prohlížeč volá nejdřív GetTooltip – zkusíme to stejně
        await fetch(`${PORTAL}FeatureService/GetTooltip?layerId=${encodeURIComponent(RT_LAYER)}&featureId=${encodeURIComponent(id)}`, { headers }).catch(() => {});
        response = await fetch(url, { headers });
    }
    storeCookies(response);
    if (!response.ok) throw new Error(`tooltip ${response.status}`);
    return parseTooltip(await response.text());
}

async function refreshTooltips(features) {
    const now = Date.now();
    const ids = features.map(f => f.id);
    for (const id of tooltipCache.keys()) if (!ids.includes(id)) tooltipCache.delete(id);
    const queue = ids
        .map(id => ({ id, at: tooltipCache.get(id)?.at ?? 0 }))
        .sort((a, b) => a.at - b.at)
        .slice(0, TOOLTIPS_PER_ROUND);
    let ok = 0;
    for (const { id } of queue) {
        try {
            const info = await fetchTooltip(id);
            if (info.delay !== null || info.dest) { tooltipCache.set(id, { at: Date.now(), ...info }); ok++; }
        } catch { /* zkusíme v dalším kole */ }
    }
    return ok;
}

function withTooltips(features) {
    const now = Date.now();
    return features.map(f => {
        const info = tooltipCache.get(f.id);
        const fresh = info && now - info.at < TOOLTIP_MAX_AGE_MS;
        return { ...f, delay: fresh ? info.delay : null, dest: fresh ? info.dest : null };
    });
}

async function main() {
    log('DPKV relay startuje');
    await discover();
    const started = Date.now();
    let round = 0;
    while (Date.now() - started < RESTART_AFTER_MS) {
        const t0 = Date.now();
        try {
            // Občas porovnáme úsporný dotaz (jen vozy) s plným (i vrstvy linek)
            if (round % COMPARE_EVERY === 0) {
                const [light, full] = [await getFeatures([RT_LAYER]), await getFeatures([RT_LAYER, ...lineLayers])];
                useFull = full.rt.length > light.rt.length;
                lastCompare = { at: new Date().toISOString(), light: light.rt.length, full: full.rt.length, lightKB: Math.round(light.bytes / 1024), fullKB: Math.round(full.bytes / 1024), useFull };
                log(`porovnání dotazů: ${JSON.stringify(lastCompare)}`);
            }
            const { rt, bytes } = await getFeatures(useFull ? [RT_LAYER, ...lineLayers] : [RT_LAYER]);
            const tooltipsOk = await refreshTooltips(rt);
            const withDelay = withTooltips(rt);
            const known = withDelay.filter(f => f.delay !== null).length;
            await push(withDelay, { round, vehicles: rt.length, delayKnown: known, tooltipsOk, kb: Math.round(bytes / 1024), useFull, lineLayers, lastCompare, errors, version: 2 });
            if (round % 30 === 0) log(`ok: ${rt.length} vozů, ${Math.round(bytes / 1024)} kB`);
            errors = 0;
        } catch (error) {
            errors++;
            log(`chyba (${errors}×): ${error.message}`);
            if (errors % 10 === 0) await discover(); // po sérii chyb obnovit cookies
        }
        round++;
        const minute = pragueHourMinute();
        const interval = minute >= 30 && minute < 240 ? NIGHT_INTERVAL_MS : DAY_INTERVAL_MS;
        const backoff = errors ? Math.min(errors * 15_000, 300_000) : 0;
        await sleep(Math.max(1000, interval + backoff - (Date.now() - t0)));
    }
    log('plánovaný restart (kvůli aktualizaci)');
}

main().catch(error => { log(`pád: ${error.stack || error.message}`); process.exit(1); });
