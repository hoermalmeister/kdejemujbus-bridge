const log=(...a)=>console.log('PG',...a);
(async()=>{ try{
  for (const ep of ['dpmul','mdt']) {
    const vs=await (await fetch('https://grapp-bridge-production.up.railway.app/'+ep)).json();
    log(ep,'vehicles',vs.length,'sample',JSON.stringify(vs[0]));
    let n=0;
    for (const v of vs) {
      if (!v.spoj || !v.cis) continue;
      const tt=await (await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/timetables/${v.cis}_${v.spoj}.json`)).json().catch(()=>null);
      if (!tt) { log(ep,'no-tt',v.cis,v.spoj); continue; }
      log(ep, `${v.cis}/${v.spoj} stop=${JSON.stringify(v.stop)} delay=${v.delay}`, '| tt:', JSON.stringify(tt.map(s=>s.name+' '+s.dep)));
      if (++n>=14) break;
    }
  }
}catch(e){log('ERR',e.message)} })();
