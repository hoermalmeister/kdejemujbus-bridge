// Zdroj DPMD je JavaScriptový soubor s proměnnými. Text jen rozebíráme, nikdy ho nespouštíme.
const FIELD = /^\s*(\w+): `(.*?)`,?$/gms;

export function parseDpmdVehicles(source) {
    const start = source.indexOf('buspositions = [');
    if (start < 0) throw new Error('DPMD: v odpovědi chybí polohy');
    const end = source.indexOf('legends = [', start);
    const section = source.slice(start, end < 0 ? undefined : end);

    const vehicles = [];
    for (const block of section.split(/\n\}, \{\n/)) {
        const fields = Object.fromEntries([...block.matchAll(FIELD)].map(match => [match[1], match[2]]));
        // Vozy bez linky stojí v garáži
        if (!fields.line) continue;

        const coords = /([\d.]+)N,\s*([\d.]+)E/.exec(fields.coords || '');
        if (!coords) continue;

        const body = fields.body || '';
        const heading = parseInt(fields.arrow, 10);
        const delay = parseInt(/Zpoždění:\s*(-?\d+)/.exec(body)?.[1], 10);

        const stops = [];
        let lastStopIndex = -1;
        for (const part of (body.split('Jízdní řád</span>')[1] || '').split('<br>')) {
            if (part.includes('&darr;')) {
                lastStopIndex = stops.length - 1;
                continue;
            }
            const stop = /^(\d{1,2}:\d{2}) - (.+)$/.exec(part.trim());
            if (stop) stops.push({ time: stop[1], name: stop[2] });
        }

        vehicles.push({
            vehicle: fields.vehicle,
            line: fields.line,
            run: /Spoj:\s*([^<]+)/.exec(body)?.[1].trim() ?? null,
            destination: /Konečná:\s*([^<]+)/.exec(body)?.[1].trim() ?? fields.name ?? null,
            carrier: /Dopravce:\s*([^<]+)/.exec(body)?.[1].trim() ?? null,
            lat: Number(coords[1]),
            lng: Number(coords[2]),
            heading: isNaN(heading) ? null : heading,
            delay: isNaN(delay) ? 0 : delay,
            lastStopIndex,
            stops
        });
    }
    return vehicles;
}
