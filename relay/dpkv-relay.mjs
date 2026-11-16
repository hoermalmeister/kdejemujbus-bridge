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
        body: JSON.stringify({ features: features.map(f => ({ id: f.id, x: f.x, y: f.y, html: f.html })), diag })
    });
    if (!response.ok) throw new Error(`můstek ${response.status} ${await response.text().catch(() => '')}`.slice(0, 200));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
            await push(rt, { round, vehicles: rt.length, kb: Math.round(bytes / 1024), useFull, lineLayers, lastCompare, errors, version: 1 });
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
