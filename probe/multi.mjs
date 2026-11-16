import { scheduledVehicles } from '../lib/dpmlbMatch.js';
const log=(...a)=>console.log('PG',...a);
(async()=>{
 for (let i=0;i<40;i++){ const r=await fetch('https://hoermalmeister.github.io/kdejemujbus-bridge/match/495712.json?x='+Date.now()); if(r.ok){log('pages ready after',i*15,'s');break;} await new Promise(r=>setTimeout(r,15000)); }
 log('now', new Date().toLocaleString('cs-CZ',{timeZone:'Europe/Prague'}));
 for (const line of ['705100','635007','495712']) {
   try {
     const vs = await scheduledVehicles(line);
     log(line, 'vehicles', vs.length);
     for (const v of vs) {
       const tt = await (await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/timetables/${line}_${v.run}.json`)).json().catch(()=>null);
       log(`  run=${v.run} ${v.lat.toFixed(5)},${v.lng.toFixed(5)} h=${v.heading} stop#${v.stopIndex}="${v.stop}" → "${v.destination}" | tt ${tt?tt.length:'MISSING'} stops, ${tt?.[v.stopIndex]?.name} dep ${tt?.[v.stopIndex]?.dep}, next ${tt?.[v.stopIndex+1]?.name} ${tt?.[v.stopIndex+1]?.dep ?? tt?.[v.stopIndex+1]?.arr}`);
     }
   } catch (e) { log('ERR', line, e.message); }
 }
 // průběh dne: kolik vozů jede v jednotlivých hodinách
})();
