// Převod souřadnic S-JTSK (EPSG:5514) na WGS84 (Křovákovo zobrazení, přesnost asi 1 m).
const rad = Math.PI / 180;
const A_BESSEL = 6377397.155;
const F_BESSEL = 1 / 299.1528128;
const E2_BESSEL = 2 * F_BESSEL - F_BESSEL * F_BESSEL;
const E = Math.sqrt(E2_BESSEL);

const PHI_C = 49.5 * rad;
const LAMBDA_0 = (24 + 50 / 60) * rad;
const ALPHA_C = (30 + 17 / 60 + 17.30311 / 3600) * rad;
const PHI_P = 78.5 * rad;
const K = 0.9999;

const sinC = Math.sin(PHI_C);
const A = A_BESSEL * Math.sqrt(1 - E2_BESSEL) / (1 - E2_BESSEL * sinC * sinC);
const B = Math.sqrt(1 + E2_BESSEL * Math.cos(PHI_C) ** 4 / (1 - E2_BESSEL));
const GAMMA_0 = Math.asin(sinC / B);
const T0 = Math.tan(Math.PI / 4 + GAMMA_0 / 2) * ((1 + E * sinC) / (1 - E * sinC)) ** (E * B / 2)
    / Math.tan(Math.PI / 4 + PHI_C / 2) ** B;
const N = Math.sin(PHI_P);
const R0 = K * A / Math.tan(PHI_P);

// Parametry transformace S-JTSK -> WGS84
const [DX, DY, DZ] = [570.8, 85.7, 462.8];
const ARCSEC = rad / 3600;
const [RX, RY, RZ] = [4.998 * ARCSEC, 1.587 * ARCSEC, 5.261 * ARCSEC];
const SCALE = 1 + 3.56e-6;
const A_WGS = 6378137;
const F_WGS = 1 / 298.257223563;
const E2_WGS = 2 * F_WGS - F_WGS * F_WGS;

function krovakToBessel(x, y) {
    const southing = -y;
    const westing = -x;
    const r = Math.hypot(southing, westing);
    const d = Math.atan2(westing, southing) / N;
    const t = 2 * (Math.atan((R0 / r) ** (1 / N) * Math.tan(Math.PI / 4 + PHI_P / 2)) - Math.PI / 4);
    const u = Math.asin(Math.cos(ALPHA_C) * Math.sin(t) - Math.sin(ALPHA_C) * Math.cos(t) * Math.cos(d));
    const v = Math.asin(Math.cos(t) * Math.sin(d) / Math.cos(u));

    let phi = u;
    for (let i = 0; i < 6; i++) {
        const esin = E * Math.sin(phi);
        phi = 2 * (Math.atan(T0 ** (-1 / B) * Math.tan(u / 2 + Math.PI / 4) ** (1 / B)
            * ((1 + esin) / (1 - esin)) ** (E / 2)) - Math.PI / 4);
    }
    return [phi, LAMBDA_0 - v / B];
}

// Vrací [lng, lat]
export function jtskToWgs84(x, y) {
    const [phi, lambda] = krovakToBessel(x, y);
    const sinPhi = Math.sin(phi);
    const nu = A_BESSEL / Math.sqrt(1 - E2_BESSEL * sinPhi * sinPhi);
    const X = nu * Math.cos(phi) * Math.cos(lambda);
    const Y = nu * Math.cos(phi) * Math.sin(lambda);
    const Z = nu * (1 - E2_BESSEL) * sinPhi;

    const wx = DX + SCALE * (X - RZ * Y + RY * Z);
    const wy = DY + SCALE * (RZ * X + Y - RX * Z);
    const wz = DZ + SCALE * (-RY * X + RX * Y + Z);

    const p = Math.hypot(wx, wy);
    let lat = Math.atan2(wz, p * (1 - E2_WGS));
    for (let i = 0; i < 6; i++) {
        const sinLat = Math.sin(lat);
        const nuWgs = A_WGS / Math.sqrt(1 - E2_WGS * sinLat * sinLat);
        lat = Math.atan2(wz + E2_WGS * nuWgs * sinLat, p);
    }
    return [Math.atan2(wy, wx) / rad, lat / rad];
}
