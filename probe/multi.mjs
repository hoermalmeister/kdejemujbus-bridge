import { scheduledVehicles } from '../lib/dpmlbMatch.js';
import { __test } from '../lib/shapeInterp.js';
const log=(...a)=>console.log('PG',...a);
const R=6371000, rad=Math.PI/180;
const dist=(a,b,c,d)=>R*Math.hypot((c-a)*rad,(d-b)*rad*Math.cos(a*rad));
// vzdálenost bodu od polyline trasy
function distToShape(lat,lng,pts){let m=Infinity;for(let i=0;i<pts.length-1;i++){const[a,b]=pts[i],[c,d]=pts[i+1];for(let k=0;k<=10;k++){const f=k/10;m=Math.min(m,dist(lat,lng,a+(c-a)*f,b+(d-b)*f));}}return m;}
(async()=>{
 log('now', new Date().toLocaleString('cs-CZ',{timeZone:'Europe/Prague'}));
 for (const line of ['705100','635007','495712']) {
   const routes = await (await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/routes/${line}.json`)).json();
   const vs = await scheduledVehicles(line);
   log(line, 'vozů', vs.length);
   for (const v of vs) {
     const variant = routes.trips[String(v.run)]?.[0];
     const pts = variant ? __test.decodePolyline(routes.shapes[variant[0]]) : [];
     const off = pts.length ? distToShape(v.lat, v.lng, pts).toFixed(1) : 'bez trasy';
     log(`  spoj ${v.run}: ${v.lat.toFixed(5)},${v.lng.toFixed(5)} směr ${v.heading} zastávka #${v.stopIndex} ${v.stop} → odchylka od trasy ${off} m`);
   }
 }
})().catch(e=>log('ERR',e.stack));
