const BASE='https://dpmhk.qrbus.me/index';
const headers={accept:'*/*',referer:'https://dpmhk.qrbus.me/','x-requested-with':'XMLHttpRequest','user-agent':'Mozilla/5.0'};
const fmt=(unix)=> new Date(unix*1000).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour12:false});
const fmtSec=(s)=> s<0?'-':`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
(async()=>{
 try{
  const vs=(await (await fetch(`${BASE}/getAllRtdVehicles`,{headers})).json()).vehicles||[];
  const act=vs.filter(v=>v.gpsi===0&&v.vp===1&&v.tn&&v.ln);
  console.log('PG on-trip-with-tn='+act.length);
  const v=act[0];
  console.log(`PG veh ln=${v.ln} rn=${v.rn} tn=${v.tn} o=${v.o} psi=${v.psi} d=${v.d} delayMin=${Math.round(v.d/60)}`);
  const body=JSON.stringify({lineNumber:String(v.ln),tripNumber:Number(v.tn),routeNumber:String(v.rn),obuNumber:Number(v.o)});
  const r=await fetch(`${BASE}/getPlatformsDataWithHistory`,{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded; charset=UTF-8',origin:'https://dpmhk.qrbus.me'},body});
  console.log('PG status='+r.status);
  const d=await r.json();
  const pf=d.platforms||[];
  console.log('PG stops='+pf.length);
  for(const p of pf){
    console.log(`PG #${p.stopOrder} ${p.stopName} | sched(dep unix→Prg)=${fmt(p.departureTime)} | realArrSFM=${fmtSec(p.realArrivalInSecondsFromMidnight)} realDepSFM=${fmtSec(p.realDepartureInSecondsFromMidnight)} | realDep unix→Prg=${p.realDeparture>0?fmt(p.realDeparture):'-'} stopId=${p.platformId}`);
  }
  // platforms index: does psi map to stopId? check getAllPlatforms
  const aps=(await (await fetch(`${BASE}/getAllPlatforms`,{headers})).json()).platforms||[];
  const byStopId=new Map(); for(const a of aps) byStopId.set(a.stopId,a.name);
  const byId=new Map(); for(const a of aps) byId.set(a.id,a.name);
  console.log(`PG psi=${v.psi} → byStopId=${byStopId.get(v.psi)} byId=${byId.get(v.psi)}`);
 }catch(e){console.log('PG ERROR '+e.message+' '+e.stack);}
})();
