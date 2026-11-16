const log=(...a)=>console.log('PG',...a);
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const BASE='https://dopravniportal.dpkv.cz/dic/';
const body=JSON.stringify({scale:20000,resolution:5.291677250021167,extent:{xmin:-855061.2987892643,xmax:-847938.7012107357,ymin:-1013243.798154263,ymax:-1006756.201845737},layerFilterList:[{id:'RT spoje point'}]});
const hdr={accept:'application/json, text/javascript, */*; q=0.01','content-type':'application/json; charset=UTF-8',origin:'https://dopravniportal.dpkv.cz',referer:BASE,'x-requested-with':'XMLHttpRequest','user-agent':UA};
async function tryPost(label, extra={}){
  const t0=Date.now();
  try{
    const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),25000);
    const r=await fetch(BASE+'FeatureService/GetFeatures',{method:'POST',headers:{...hdr,...extra},body,signal:ctl.signal}); clearTimeout(to);
    const t=await r.text(); log(label,'status',r.status,'ms',Date.now()-t0,'len',t.length,'ct',r.headers.get('content-type'),JSON.stringify(t.slice(0,300)));
  }catch(e){ log(label,'ERROR after',Date.now()-t0,'ms',e.name,e.message, e.cause?.code||''); }
}
(async()=>{
  await tryPost('plain');
  // načtení stránky: cookies, tokeny, skripty
  let cookies='';
  try{
    const t0=Date.now(); const r=await fetch(BASE,{headers:{'user-agent':UA,accept:'text/html'}});
    const html=await r.text(); log('PAGE status',r.status,'ms',Date.now()-t0,'len',html.length);
    const sc=r.headers.getSetCookie?.()||[]; log('PAGE set-cookie',JSON.stringify(sc));
    cookies=sc.map(c=>c.split(';')[0]).join('; ');
    for(const m of html.matchAll(/<script[^>]*src=["']([^"']+)/g)) log('SCRIPT',m[1]);
    for(const m of html.matchAll(/.{0,150}(token|Token|antiforgery|RequestVerification|sessionId|apiKey|guid|hash).{0,200}/g)) log('CTX',JSON.stringify(m[0]));
    for(const m of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/g)) log('HIDDEN',m[0].slice(0,300));
    globalThis.HTML=html;
  }catch(e){ log('PAGE ERROR',e.message,e.cause?.code||''); }
  if(cookies) await tryPost('with-cookies',{cookie:cookies});
  // skripty – hledáme, jak se volá GetFeatures a jaké hlavičky přidává
  const scripts=[...(globalThis.HTML||'').matchAll(/<script[^>]*src=["']([^"']+)/g)].map(m=>new URL(m[1],BASE).href);
  for(const s of scripts){
    try{ const t=await (await fetch(s,{headers:{'user-agent':UA}})).text();
      const hits=[...t.matchAll(/.{0,250}(GetFeatures|FeatureService|setRequestHeader|beforeSend|headers\s*:|ajaxSetup|signalr|hub|token).{0,250}/gi)].slice(0,6);
      if(hits.length){ log('JS',s,'len',t.length); for(const h of hits) log('  JSCTX',JSON.stringify(h[0])); }
    }catch(e){ log('JS ERR',s,e.message); }
  }
  // s IPv4/bez keepalive? zkusit ještě jednou plain
  await tryPost('plain-again');
})();
