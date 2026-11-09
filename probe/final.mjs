import { getDpmhkVehicles, getDpmhkTimetable } from '../lib/dpmhkApi.js';
(async()=>{
 try{
  const vs=await getDpmhkVehicles();
  const withStop=vs.filter(v=>v.stop).length;
  const withTrip=vs.filter(v=>v.trip).length;
  console.log(`PG total=${vs.length} withStop=${withStop} withTrip=${withTrip}`);
  for(const v of vs.slice(0,5)) console.log(`PG veh=${v.vehicle} line=${v.line} stop=${v.stop} trip=${v.trip} rn=${v.routeName} obu=${v.obu} ln=${v.lineNum}`);
  const t=vs.find(v=>v.trip&&v.routeName&&v.obu);
  if(t){
    console.log(`PG tt-for line=${t.lineNum} trip=${t.trip} rn=${t.routeName} obu=${t.obu}`);
    const st=await getDpmhkTimetable(t.lineNum,t.trip,t.routeName,t.obu);
    console.log('PG tt-stops='+st.length);
    for(const s of st) console.log(`PG   ${s.station} plan=${s.planned} dep=${s.actualDep} arr=${s.actualArr} delay=${s.delayMin}`);
  } else console.log('PG no-trip-vehicle');
 }catch(e){console.log('PG ERROR '+e.message+' '+e.stack);}
})();
