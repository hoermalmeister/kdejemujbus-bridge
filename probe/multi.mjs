import { getArrivaVehicles } from '../lib/arrivaApi.js';
import { matchDpmlb, stopNameKey } from '../lib/dpmlbMatch.js';
const log=(...a)=>console.log('PG',...a);
(async()=>{
 // Pages se po pipeline publikují s prodlevou – počkáme na data se jmény zastávek
 for (let i=0;i<40;i++){ const r=await fetch('https://hoermalmeister.github.io/kdejemujbus-bridge/match/225606.json?x='+Date.now()); if(r.ok){ const j=await r.json(); if(j.trips?.[0]?.n){log('pages ready after',i*15,'s');break;} } await new Promise(r=>setTimeout(r,15000)); }
 for (const type of ['Kladno','Express']) {
  try{
   const vs=await getArrivaVehicles(type);
   let ok=0, stopOk=0, destOk=0, stopHint=0, plainSame=0;
   for (const v of vs) {
     const m=await matchDpmlb(v.fullLine,v.lat,v.lng,v.delay,{lastName:v.stop,finalName:v.destination});
     const m0=await matchDpmlb(v.fullLine,v.lat,v.lng,v.delay,null);
     let tt=null; if(m){ ok++; tt=await (await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/timetables/${v.fullLine}_${m.run}.json`)).json().catch(()=>null); }
     const ttStop=tt?.[m.stopIndex]?.name, ttEnd=tt?.[tt.length-1]?.name;
     if (tt && stopNameKey(ttStop)===stopNameKey(v.stop)) stopOk++;
     if (tt && stopNameKey(ttEnd)===stopNameKey(v.destination)) destOk++;
     if (m?.stopMatched) stopHint++;
     if (m && m0 && m.run===m0.run) plainSame++;
     log(type,`${v.line} ${v.fullLine} veh=${v.vehicle} d=${v.delay} stop="${v.stop}" dest="${v.destination}" → run=${m?.run} idx=${m?.stopIndex} matched=${m?.stopMatched} ttStop="${ttStop}" ttEnd="${ttEnd}" | bez napovedy run=${m0?.run}`);
   }
   log(type,`SUMMARY vehicles=${vs.length} matched=${ok} stopHintUsed=${stopHint} stopNameOk=${stopOk} destOk=${destOk} sameAsPlain=${plainSame}`);
  }catch(e){log('ERR',type,e.message,e.stack)}
 }
})();
