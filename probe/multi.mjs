import { getDpmjVehicles } from '../lib/dpmjApi.js';
import { matchDpmlb } from '../lib/dpmlbMatch.js';
const log=(...a)=>console.log('PG',...a);
const norm=(s)=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/^jihlava,+/,'').replace(/[^a-z0-9]/g,'');
(async()=>{
 try{
  const r=await fetch('https://grapp-bridge-production.up.railway.app/idsjmk'); const t=await r.text(); log('RAILWAY idsjmk status',r.status,'len',t.length,t.slice(0,120));
 }catch(e){log('ERR jmk',e.message)}
 try{
  for(const [n,u] of [['IDPK','https://pvvd.idpk.cz/Ajax/GetPoints'],['VDV','https://mapavdv.kr-vysocina.cz/Ajax/GetPoints']]){ const a=await (await fetch(u)).json(); const z=a.filter(x=>x.azm===0).length, nn=a.filter(x=>!Number.isFinite(x.azm)).length; log(n,'azm total',a.length,'zero',z,'nonfinite',nn,'min',Math.min(...a.map(x=>x.azm)),'max',Math.max(...a.map(x=>x.azm))); }
 }catch(e){log('ERR azm',e.message)}
 try{
  const B='https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer';
  const tb=await (await fetch(B+'/1017/query?where=1%3D1&outFields=*&f=json')).json(); log('JI table fields',JSON.stringify((tb.fields||[]).map(f=>f.name)),'rows',tb.features?.length,JSON.stringify(tb.features?.slice(0,40).map(f=>f.attributes)).slice(0,1500));
  const w=await (await fetch(B+'/51/query?where=1%3D1&outFields=*&returnGeometry=false&f=json')).json(); log('JI waiting(51)',w.features?.length,JSON.stringify(w.features?.slice(0,2)));
 }catch(e){log('ERR ji',e.message)}
 try{
  const vs=await getDpmjVehicles(); log('DPMJ vehicles',vs.length);
  let ok=0,stopOk=0,destOk=0,plainSame=0;
  for(const v of vs){
    const hints=v.hints; 
    const m=await matchDpmlb(v.fullLine,v.lat,v.lng,v.delay,hints);
    const m0=await matchDpmlb(v.fullLine,v.lat,v.lng,v.delay,null);
    let ttStop=null,ttEnd=null,ttLen=0;
    if(m){ ok++; const tt=await (await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/timetables/${v.fullLine}_${m.run}.json`)).json().catch(()=>null);
      if(tt){ ttLen=tt.length; ttStop=tt[m.stopIndex]?.name; ttEnd=tt[tt.length-1]?.name; if(norm(ttStop)===norm(v.stop)) stopOk++; if(norm(ttEnd)===norm(v.destination)) destOk++; } }
    if(m&&m0&&m.run===m0.run) plainSame++;
    log(`veh=${v.vehicle} ${v.line} ${v.fullLine} delay=${v.delay} stop="${v.stop}" dest="${v.destination}" hints=${hints.last.length}/${hints.final.length} → run=${m?.run} idx=${m?.stopIndex}/${ttLen} ttStop="${ttStop}" ttEnd="${ttEnd}" | bezNapovedy run=${m0?.run}`);
  }
  log(`DPMJ summary matched=${ok}/${vs.length} stopNameOk=${stopOk} destNameOk=${destOk} sameAsPlain=${plainSame}`);
 }catch(e){log('ERR dpmj',e.message,e.stack)}
})();
