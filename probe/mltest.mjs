import http from 'http'; import fs from 'fs'; import { chromium } from 'playwright';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');
let fail = true, tileReq = 0;
const srv = http.createServer((q,r)=>{
  if (q.url.startsWith('/ml.js')) return r.end(fs.readFileSync('node_modules/maplibre-gl/dist/maplibre-gl.js'));
  if (q.url.startsWith('/t/')) { tileReq++; if (fail) { r.statusCode=500; return r.end(); } r.setHeader('content-type','image/png'); return r.end(png); }
  r.setHeader('content-type','text/html');
  r.end(`<div id=map style="width:600px;height:400px"></div><script src="/ml.js"></script><script>
  window.map=new maplibregl.Map({container:'map',style:{version:8,sources:{'carto-dark':{type:'raster',tiles:['http://localhost:8765/t/{z}/{x}/{y}.png'],tileSize:256}},layers:[{id:'l',type:'raster',source:'carto-dark'}]},center:[15,49],zoom:7});
  window.states=()=>Object.values(map.style.sourceCaches['carto-dark']._tiles).map(t=>t.state);
  window.revive=()=>{const c=map.style.sourceCaches['carto-dark'];c.clearTiles();c.update(map.transform);map.triggerRepaint();};
  </script>`);
}).listen(8765);
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']}); const p = await b.newPage();
p.on('pageerror',e=>console.log('PG PAGEERR',e.message));
await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
console.log('PG after failed load:', JSON.stringify(await p.evaluate(()=>states())), 'req', tileReq);
fail=false; const before=tileReq;
await p.evaluate(()=>{map.triggerRepaint()}); await p.waitForTimeout(1500);
console.log('PG repaint only (no retry expected): new req', tileReq-before, JSON.stringify(await p.evaluate(()=>states())));
await p.evaluate(()=>revive()); await p.waitForTimeout(2500);
console.log('PG after revive: new req', tileReq-before, JSON.stringify(await p.evaluate(()=>states())));
await b.close(); srv.close();
