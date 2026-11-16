// Převod souřadnic S-JTSK (EPSG:5514 – Křovák East North, záporné x/y jako v ArcGIS) na WGS84.
// Inverzní Křovákovo zobrazení na Besselově elipsoidu (standardní postup ČÚZK) a sedmiprvková
// Helmertova transformace do WGS84. Přesnost kolem 1 m, pro polohy vozidel bohatě stačí.

export function sjtskToWgs84(x, y, height = 245) {
    // EPSG:5514 má x = −Y a y = −X klasického S-JTSK
    const X = -y, Y = -x;

    // --- Křovák: rovina → Besselův elipsoid ---
    const e = 0.081696831215303;
    const n = 0.97992470462083;
    const konstURo = 12310230.12797036;
    const sinUQ = 0.863499969506341, cosUQ = 0.504348889819882;
    const sinVQ = 0.420215144586493, cosVQ = 0.907424504992097;
    const alfa = 1.000597498371542;
    const k = 1.003419163966575;

    const ro = Math.sqrt(X * X + Y * Y);
    const epsilon = 2 * Math.atan(Y / (ro + X));
    const D = epsilon / n;
    const S = 2 * Math.atan(Math.exp((1 / n) * Math.log(konstURo / ro))) - Math.PI / 2;
    const sinS = Math.sin(S), cosS = Math.cos(S);
    const sinU = sinUQ * sinS - cosUQ * cosS * Math.cos(D);
    const cosU = Math.sqrt(1 - sinU * sinU);
    const sinDV = Math.sin(D) * cosS / cosU;
    const cosDV = Math.sqrt(1 - sinDV * sinDV);
    const sinV = sinVQ * cosDV - cosVQ * sinDV;
    const cosV = cosVQ * cosDV + sinVQ * sinDV;
    const L = 2 * Math.atan(sinV / (1 + cosV)) / alfa;
    const t = Math.exp((2 / alfa) * Math.log((1 + sinU) / cosU / k));
    let pom = (t - 1) / (t + 1);
    let sinB;
    for (let i = 0; i < 20; i++) {
        sinB = pom;
        pom = t * Math.exp(e * Math.log((1 + e * sinB) / (1 - e * sinB)));
        pom = (pom - 1) / (pom + 1);
        if (Math.abs(pom - sinB) < 1e-15) break;
    }
    const B = Math.atan(pom / Math.sqrt(1 - pom * pom));

    // --- Bessel (zeměpisné) → kartézské ---
    const aB = 6377397.15508, fB = 1 / 299.152812853;
    const e2B = 1 - (1 - fB) * (1 - fB);
    const roB = aB / Math.sqrt(1 - e2B * Math.sin(B) ** 2);
    const x1 = (roB + height) * Math.cos(B) * Math.cos(L);
    const y1 = (roB + height) * Math.cos(B) * Math.sin(L);
    const z1 = ((1 - e2B) * roB + height) * Math.sin(B);

    // --- Helmertova transformace Bessel → WGS84 ---
    const dx = 570.69, dy = 85.69, dz = 462.84;
    const sec = Math.PI / 180 / 3600;
    const wz = -5.2611 * sec, wy = -1.58676 * sec, wx = -4.99821 * sec;
    const m = 3.543e-6;
    const x2 = dx + (1 + m) * (x1 + wz * y1 - wy * z1);
    const y2 = dy + (1 + m) * (-wz * x1 + y1 + wx * z1);
    const z2 = dz + (1 + m) * (wy * x1 - wx * y1 + z1);

    // --- Kartézské → WGS84 (zeměpisné) ---
    const a = 6378137.0, f = 1 / 298.257223563;
    const a_b = f / (1 - f);
    const p = Math.sqrt(x2 * x2 + y2 * y2);
    const e2 = 1 - (1 - f) * (1 - f);
    const theta = Math.atan(z2 * (1 + a_b) / p);
    const st = Math.sin(theta), ct = Math.cos(theta);
    const lat = Math.atan((z2 + e2 * (1 + a_b) * a * st ** 3) / (p - e2 * a * ct ** 3));
    const lon = 2 * Math.atan(y2 / (p + x2));
    return { lat: lat * 180 / Math.PI, lng: lon * 180 / Math.PI };
}
