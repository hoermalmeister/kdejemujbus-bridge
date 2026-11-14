import { getGepardVehicles } from '../lib/gepardApi.js';
(async () => {
  try {
    const raw = await (await fetch('https://vlaky.gepard.com/api/get_trains.php?t=' + Date.now(), { headers: { referer: 'https://vlaky.gepard.com/', 'user-agent': 'Mozilla/5.0' } })).json();
    const st = {}; for (const t of raw) st[t.status_pohybu] = (st[t.status_pohybu] || 0) + 1;
    console.log('PG raw=' + raw.length + ' statuses=' + JSON.stringify(st));
    const vs = await getGepardVehicles();
    console.log('PG active=' + vs.length);
    for (const v of vs) console.log(`PG ${v.category} ${v.number} ${v.lat.toFixed(4)},${v.lng.toFixed(4)} h=${v.heading} delay=${v.delay} stop=${v.stop} -> ${v.destination} stops=${v.stops.length}`);
    const g = await (await fetch('https://grapp-bridge-production.up.railway.app/grapp')).json();
    const trains = g?.Data?.Trains || [];
    console.log('PG grapp trains=' + trains.length);
    const nums = new Set(raw.map(t => String(t.cislo_vlaku)));
    for (const t of trains) { const m = /(\d{3,6})/.exec(t.Title || ''); if (m && nums.has(m[1])) console.log('PG grapp-match title=' + JSON.stringify(t.Title) + ' gps=' + t.GPS); }
    for (const t of trains) if (t.GPS && t.GPS[0] > 48.95 && t.GPS[0] < 49.45 && t.GPS[1] > 14.9 && t.GPS[1] < 15.25) console.log('PG grapp-near title=' + JSON.stringify(t.Title) + ' gps=' + t.GPS);
  } catch (e) { console.log('PG ERROR ' + e.message); }
})();
