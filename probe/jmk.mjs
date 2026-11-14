(async()=>{ try{
 const h=(t)=>({accept:'application/json, text/plain, */*',Origin:'https://mapa.idsjmk.cz',Referer:'https://mapa.idsjmk.cz/','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)','x-access-token':t});
 for (const t of ['fFdFQnwABCDEF123','']) { const r=await fetch('https://mapa.idsjmk.cz/api/vehicles',{headers:h(t)}); const x=await r.text(); console.log('PG badtoken='+JSON.stringify(t)+' status='+r.status+' ct='+r.headers.get('content-type')+' body='+JSON.stringify(x.slice(0,200))); }
 const html=await (await fetch('https://mapa.idsjmk.cz/')).text(); const m=html.match(/(fFdFQnw[A-Za-z0-9+/=]+)/); console.log('PG token-in-html='+Boolean(m)+' len='+(m?m[1].length:0));
 if(m){ const r=await fetch('https://mapa.idsjmk.cz/api/vehicles',{headers:h(m[1])}); const x=await r.text(); console.log('PG good status='+r.status+' len='+x.length+' head='+JSON.stringify(x.slice(0,80))); }
}catch(e){console.log('PG ERROR '+e.message)} })();
