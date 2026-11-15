const log=(...a)=>console.log('PG',...a);
const UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'};
(async()=>{ try{
  const html=await (await fetch('https://mapa.idsjmk.cz/',{headers:UA})).text();
  for(const m of html.matchAll(/<script[^>]*>/g)) log('TAG',JSON.stringify(m[0]));
  for(const m of html.matchAll(/<link[^>]*>/g)) log('LINK',JSON.stringify(m[0].slice(0,200)));
  for(const m of html.matchAll(/.{0,300}(oken|x-access|Bearer|apikey|api_key).{0,400}/gi)) log('CTX',JSON.stringify(m[0]));
  log('TAIL',JSON.stringify(html.slice(-6000)));
}catch(e){log('ERROR',e.message)} })();
