import { getDpmhkVehicles, getDpmhkRoute } from '../lib/dpmhkApi.js';
(async () => {
  try {
    const vs = await getDpmhkVehicles();
    const total = vs.length;
    const withDest = vs.filter(v => v.destination).length;
    const withRoute = vs.filter(v => v.lineId && v.routeId).length;
    const dash = vs.filter(v => v.line === '-').length;
    const unknownLine = vs.filter(v => v.line === '?').length;
    console.log(`PG total=${total} withDest=${withDest} withRoute=${withRoute} prejezd(dash)=${dash} unknownLine=${unknownLine}`);
    // sample a few
    for (const v of vs.slice(0, 8)) console.log(`PG veh=${v.vehicle} line=${v.line} dest=${v.destination} lineId=${v.lineId} routeId=${v.routeId}`);
    // test getRoute on one normal + one prejezd
    const normal = vs.find(v => v.line !== '-' && v.line !== '?' && v.lineId && v.routeId);
    if (normal) {
      const s = await getDpmhkRoute(normal.lineId, normal.routeId);
      console.log(`PG route-normal line=${normal.line} points=${s.length}`);
    }
    const pre = vs.find(v => v.line === '-' && v.lineId && v.routeId);
    if (pre) {
      const s = await getDpmhkRoute(pre.lineId, pre.routeId);
      console.log(`PG route-prejezd lineId=${pre.lineId} routeId=${pre.routeId} points=${s.length}`);
    } else {
      console.log('PG no-prejezd-with-route-this-cycle');
    }
  } catch (e) {
    console.log('PG ERROR ' + e.message);
  }
})();
