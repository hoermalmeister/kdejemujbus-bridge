const log=(...a)=>console.log('PG',...a);
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'};
async function jmk(){
  const r=await fetch('https://mapa.idsjmk.cz/',{headers:UA}); const html=await r.text();
  log('JMK html status',r.status,'len',html.length,'set-cookie',r.headers.get('set-cookie'));
  log('JMK html head',JSON.stringify(html.slice(0,1500)));
  const scripts=[...html.matchAll(/<script[^>]+src="([^">]+)"/g)].map(m=>m[1]); log('JMK scripts',JSON.stringify(scripts));
  for(const m of html.matchAll(/.{0,120}(token|Token).{0,200}/g)) log('JMK html-token-ctx',JSON.stringify(m[0]));
  for(let s of scripts){ if(!s.startsWith('http')) s='https://mapa.idsjmk.cz'+(s.startsWith('/')?'':'/')+s;
    try{ const t=await (await fetch(s,{headers:UA})).text(); log('JMK script',s,'len',t.length,'hasPrefix',/fFdFQnw/.test(t));
      let n=0; for(const m of t.matchAll(/.{0,200}(x-access-token|fFdFQnw|accessToken|access_token).{0,300}/gi)){ log('JMK js-ctx',JSON.stringify(m[0])); if(++n>=8)break; }
    }catch(e){log('JMK script err',s,e.message)} }
}
async function pvvd(name,base){
  const pts=await (await fetch(base+'/Ajax/GetPoints?t='+Date.now(),{headers:UA})).json();
  const arr=Array.isArray(pts)?pts:(pts.data||pts.points||[]); log(name,'points',arr.length,'sample',JSON.stringify(arr[0]));
  const v=arr.find(x=>x.traction!=='TRAIN'&&x.finalStopName&&!/n\/a/i.test(x.finalStopName))||arr[0];
  for(const lang of [null,'cs','cs-CZ,cs;q=0.9']){ const h={...UA}; if(lang) h['Accept-Language']=lang;
    const d=await (await fetch(`${base}/Ajax/OpenInfoWindow?id=${v.id}&t=${Date.now()}`,{headers:h})).text();
    log(name,'detail lang='+lang,JSON.stringify(d.replace(/\s+/g,' ').slice(0,1800))); }
  const tt=await (await fetch(`${base}/Ajax/GetTimetable?vehicleNumber=${v.id}&currentStopId=0&t=${Date.now()}`,{headers:{...UA,'Accept-Language':'cs'}})).text();
  log(name,'timetable',JSON.stringify(tt.replace(/\s+/g,' ').slice(0,1500)));
}
async function jihlava(){
  const B='https://gis.jihlava-city.cz/server1/rest/services/verejnost/Ji_MHD_aktualni/MapServer';
  const ms=await (await fetch(B+'?f=json')).json(); log('JI layers',JSON.stringify((ms.layers||[]).map(l=>[l.id,l.name,l.type])),'tables',JSON.stringify((ms.tables||[]).map(l=>[l.id,l.name])));
  const v=await (await fetch(B+'/50/query?where=1%3D1&outFields=*&returnGeometry=false&f=json')).json(); log('JI vehicles',v.features?.length,JSON.stringify(v.features?.slice(0,2)));
  const s=await (await fetch(B+'/3/query?where=1%3D1&outFields=elp_id,elp_post,nazev,smer,linky&outSR=4326&f=json')).json(); log('JI stops',s.features?.length,'exceeded',s.exceededTransferLimit,JSON.stringify(s.features?.slice(0,2)));
  for(const id of (ms.layers||[]).map(l=>l.id).filter(i=>![3,50].includes(i)).slice(0,25)){ try{ const l=await (await fetch(`${B}/${id}?f=json`)).json(); log('JI layer',id,l.name,l.type,'fields',JSON.stringify((l.fields||[]).map(f=>f.name)).slice(0,300)); }catch(e){} }
  for(const ln of ['765004','765105','765102','765109']){ for(const k of ['routes','match']){ const r=await fetch(`https://hoermalmeister.github.io/kdejemujbus-bridge/${k}/${ln}.json`); log('PAGES',k,ln,r.status); } }
  const r=await (await fetch('https://hoermalmeister.github.io/kdejemujbus-bridge/routes/765004.json')).text().catch(()=>'' ); log('PAGES routes 765004 runs', (()=>{try{return Object.keys(JSON.parse(r).trips).length}catch{return 'n/a'}})());
}
for(const f of [jmk,()=>pvvd('IDPK','https://pvvd.idpk.cz'),()=>pvvd('VDV','https://mapavdv.kr-vysocina.cz'),jihlava]){ try{await f()}catch(e){log('ERROR',e.message)} }
