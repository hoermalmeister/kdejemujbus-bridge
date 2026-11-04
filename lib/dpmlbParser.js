// Zdroj DPMLB (Mladá Boleslav) je XML s polohami vozů. Každý vůz je <Item>, k němu patří
// jeden <Attribute type="40"> se směrem ve stupních (propojeno přes attributeItem = guid).
// guid je mezi dotazy stabilní, dá se použít jako identita vozu.

// Písmenné linky mají pevné celostátní číslo, číselné jsou 2651 + číslo
const LINE_CODES = { A: '265101', B: '265102', C: '265103', RB: '265104', RA: '265105', H: '265112' };

function decodeEntities(text) {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function attrs(tag) {
    const result = {};
    for (const match of tag.matchAll(/(\w+)="([^"]*)"/g)) result[match[1]] = match[2];
    return result;
}

function fullLine(title) {
    if (LINE_CODES[title]) return LINE_CODES[title];
    const number = parseInt(title, 10);
    return Number.isNaN(number) ? null : String(265100 + number);
}

function parseDelay(text) {
    if (/jede včas/i.test(text)) return 0;
    const match = /Zpoždění\s+(\d+)/i.exec(text);
    return match ? parseInt(match[1], 10) : 0;
}

export function parseDpmlbVehicles(xml) {
    const headings = new Map();
    for (const tag of xml.matchAll(/<Attribute\s+([\s\S]*?)\/>/g)) {
        const attr = attrs(tag[1]);
        if (attr.type === '40' && attr.attributeItem) {
            const value = parseInt(attr.value, 10);
            if (!Number.isNaN(value)) headings.set(attr.attributeItem, value);
        }
    }

    const vehicles = [];
    for (const tag of xml.matchAll(/<Item\s+([\s\S]*?)\/>/g)) {
        const item = attrs(tag[1]);
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        if (!item.guid || !item.title || !lat || !lng) continue;

        const [routePart, delayPart = ''] = decodeEntities(item.text || '').split('<br>');
        const route = routePart.trim();
        const destination = route.split(' - ').pop().trim() || null;

        vehicles.push({
            vehicle: item.guid,
            line: item.title,
            fullLine: fullLine(item.title),
            route: route || null,
            destination,
            lat,
            lng,
            heading: headings.has(item.guid) ? headings.get(item.guid) : null,
            delay: parseDelay(delayPart)
        });
    }
    return vehicles;
}
