const log=(...a)=>console.log('PG',...a);
const hm=s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}`;
(async()=>{
 for (const line of ['705100','635007','495712','765102']) {
   const r=await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/match/${line}.json?x=${Date.now()}`);
   log(line,'status',r.status); if(!r.ok) continue;
   const d=await r.json(); log(' keys',Object.keys(d),'base',d.base,'trips',d.trips?.length);
   const today=new Date(); const base=Date.UTC(+d.base.slice(0,4),+d.base.slice(4,6)-1,+d.base.slice(6,8)); const off=Math.round((Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())-base)/86400000);
   log(' offset',off, 'runToday', d.trips.filter(t=>(t.days>>off)&1).length);
   for (const t of d.trips.slice(0,6)) log('  run',t.run,'days',t.days.toString(2),'from',hm(t.t[0]),'to',hm(t.t.at(-1)),'n?',Array.isArray(t.n), 'len',t.t.length);
   const todays=d.trips.filter(t=>(t.days>>off)&1).map(t=>`${t.run}:${hm(t.t[0])}-${hm(t.t.at(-1))}`); log(' today',todays.join(' ').slice(0,600));
 }
})();
