/* ---------- maps saved on this device, for working with no internet ----------
   This browser downloads them itself, straight from USGS (public domain) and the county parcel maps, and keeps them on
   this device only (nothing goes through or onto the Fence Builder server):
     map pieces (aerial photo, LiDAR bare earth)  Cache Storage "fb-tiles", under their own USGS addresses (usgsTileUrl),
                                                  so the map's saved layers (40-map.js) and sw.js find them again
     ground heights                               IndexedDB "fence-maps", store "heights": blocks of up to 500 x 500
                                                  heights in meters (a Float32Array each, about 1 MB), about 1 m apart
     property lines                               IndexedDB "fence-maps", store "parcels": only each parcel's number,
                                                  acres and outline. Never an owner's name.
     the list of saved areas                      IndexedDB "fence-maps", store "areas"
   Esri's satellite photo is never kept (its terms). One downloader for the
   desktop's "Save area for offline" and the phone's "Keep this area's map on this phone": 5 downloads at a time, each
   tried 3 times, the size shown first, and an upper limit so a download stays a sensible size. */
const OFF_CAP={desk:{tiles:12000,mb:400,heights:4e6},phone:{tiles:3000,mb:150,heights:2e6}};
const OFF_KB={naip:16,hill:8},OFF_Z0=12,OFF_BLOCK=500,OFF_PAR=5;
const OFF_PARCELS=()=>PARCEL_SOURCES;   // the county maps and the State of Idaho layer (not IDWR's, which is never used)
let mapDbP=null,offEst=null;
const offRun=new Map();   // area id -> the area, while it downloads in this window
function mapDb(){
  return mapDbP??=new Promise((res,rej)=>{let r;try{r=indexedDB.open('fence-maps',1)}catch(e){return rej(e)}
    r.onupgradeneeded=()=>{for(const s of ['areas','heights','parcels'])if(!r.result.objectStoreNames.contains(s))r.result.createObjectStore(s)};
    r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();mapDbP=null};res(r.result)};r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('blocked'))})
    .catch(e=>{mapDbP=null;throw e});
}
async function mapReq(store,rw,fn){const db=await mapDb();return new Promise((res,rej)=>{const t=db.transaction(store,rw?'readwrite':'readonly'),q=fn(t.objectStore(store));let v;
  if(q)q.onsuccess=()=>{v=q.result};t.oncomplete=()=>res(v);t.onerror=t.onabort=()=>rej(t.error)})}
const mapGet=(s,k)=>mapReq(s,0,o=>o.get(k)),mapPut=(s,k,v)=>mapReq(s,1,o=>o.put(v,k)),mapDel=(s,k)=>mapReq(s,1,o=>o.delete(k)),mapAll=s=>mapReq(s,0,o=>o.getAll());
const offCanKeep=()=>'caches' in window&&'indexedDB' in window;
// a saved map piece (null when it isn't saved here)
async function offTileBlob(url){if(!('caches' in window))return null;const r=await (await caches.open('fb-tiles')).match(url,{ignoreVary:true});return r?r.blob():null}
// a piece of the aerial photo for the 3D view: the saved one, else from USGS
async function offPhotoTile(z,x,y){const u=usgsTileUrl('naip',z,x,y),b=await offTileBlob(u).catch(()=>null);if(b)return b;const r=await fetchT(u,{},20000);if(!r.ok)throw Error('no photo');return r.blob()}
const offLayerMax=l=>l==='hill'?18:19;
function offTileRange(a,cb){const [w,s,e,n]=a.bbox;for(const l of a.layers)for(let z=OFF_Z0;z<=Math.min(a.maxz,offLayerMax(l));z++){const [x0,y0]=tileOf(n,w,z),[x1,y1]=tileOf(s,e,z);cb(l,z,x0,x1,y0,y1)}}
function offTileUrls(a){const out=[];offTileRange(a,(l,z,x0,x1,y0,y1)=>{for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push(usgsTileUrl(l,z,x,y))});return out}
// the ground heights in blocks: about 1 m apart, farther on a big area so it stays under `most` heights in all
function offBlocks(bbox,most){
  const [w,s,e,n]=bbox,Wm=(e-w)*111320*Math.cos((s+n)/2*Math.PI/180),Hm=(n-s)*110574;
  const step=Math.max(1,Math.sqrt(Wm*Hm/most)),W=Math.max(2,Math.round(Wm/step)),H=Math.max(2,Math.round(Hm/step));
  const nx=Math.ceil(W/OFF_BLOCK),ny=Math.ceil(H/OFF_BLOCK),blocks=[];
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)blocks.push({bbox:[w+(e-w)*i/nx,n-(n-s)*(j+1)/ny,w+(e-w)*(i+1)/nx,n-(n-s)*j/ny],w:Math.max(2,Math.round(W/nx)),h:Math.max(2,Math.round(H/ny))});
  return {blocks,step,bytes:W*H*4};
}
// how big a download is, before it starts
function offPlan(bbox,maxz,layers,cap){
  let tiles=0,kb=0;offTileRange({bbox,maxz,layers},(l,z,x0,x1,y0,y1)=>{const k=(x1-x0+1)*(y1-y0+1);tiles+=k;kb+=k*OFF_KB[l]});
  const hb=offBlocks(bbox,cap.heights),mb=kb/1024+hb.bytes/1048576+0.3;
  return {tiles,mb,step:hb.step,too:tiles>cap.tiles||mb>cap.mb};
}
// room on this device: ask the browser to keep what is saved (not clear it when space runs low), then check the space left
async function offRoom(mb){
  try{if(navigator.storage?.persist&&!await navigator.storage.persisted())await navigator.storage.persist()}catch(e){}
  try{const e=await navigator.storage?.estimate?.();if(e?.quota&&e.quota-(e.usage||0)<mb*1048576*1.2)return false}catch(e){}
  return true;
}
const offWait=ms=>new Promise(r=>setTimeout(r,ms));
// USGS's image services often answer "busy" (502/504) for a moment: each piece is tried 4 times, waiting longer each time
async function offTry(fn){for(let t=0;;t++){try{return await fn()}catch(e){if(t>=3||navigator.onLine===false||e?.name==='QuotaExceededError')throw e;await offWait([1500,4000,9000][t])}}}
async function offPool(items,fn,n=OFF_PAR){let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length)await fn(items[i++])}))}
// the uncompressed 32-bit float GeoTIFF USGS sends (striped or tiled)
function offTiff(buf){
  const dv=new DataView(buf),le=dv.getUint16(0)===0x4949,u16=o=>dv.getUint16(o,le),u32=o=>dv.getUint32(o,le),T={},ifd=u32(4);
  for(let i=0;i<u16(ifd);i++){const e=ifd+2+i*12,tag=u16(e),typ=u16(e+2),cnt=u32(e+4);if(typ!==3&&typ!==4)continue;
    const sz=typ===3?2:4,at=sz*cnt<=4?e+8:u32(e+8),v=[];for(let k=0;k<cnt;k++)v.push(typ===3?u16(at+k*2):u32(at+k*4));T[tag]=v}
  const W=T[256][0],H=T[257][0];if((T[259]||[1])[0]!==1||(T[258]||[32])[0]!==32)throw Error('unexpected heights file');
  const z=new Float32Array(W*H);
  if(T[322]){const tw=T[322][0],th=T[323][0],across=Math.ceil(W/tw);
    T[324].forEach((o,t)=>{const tx=(t%across)*tw,ty=Math.floor(t/across)*th;for(let y=0;y<th&&ty+y<H;y++)for(let x=0;x<tw&&tx+x<W;x++)z[(ty+y)*W+tx+x]=dv.getFloat32(o+(y*tw+x)*4,le)})}
  else{const rps=(T[278]||[H])[0];T[273].forEach((o,si)=>{for(let r=0;r<rps&&si*rps+r<H;r++)for(let x=0;x<W;x++)z[(si*rps+r)*W+x]=dv.getFloat32(o+(r*W+x)*4,le)})}
  return {W,H,z};
}
// property lines in bbox from the county maps: only the parcel number, acres and outline are asked for and kept
async function offFetchParcels(bbox){
  const bb=bbox.map(v=>v.toFixed(6)).join(','),out=[],seen=new Set();
  await Promise.all(OFF_PARCELS().map(async src=>{
    const f=[src.id,src.acres].filter(Boolean).join(',');
    for(let off=0,pg=0;pg<20;pg++){
      const q=`where=1%3D1&geometry=${bb}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&outFields=${f}&returnGeometry=true&geometryPrecision=6&f=geojson&resultRecordCount=2000&resultOffset=${off}`;
      let j;try{const r=await fetchT(src.url+'/query?'+q,{},25000);if(!r.ok)break;j=await r.json()}catch(e){break}
      const fs=j.features||[];
      for(const ft of fs){if(!ft.geometry)continue;const pr=ft.properties||{},pid=String(pr[src.id]??'').trim(),g=JSON.stringify(ft.geometry),k=pid+'|'+g.length+g.slice(30,90);
        if(seen.has(k))continue;seen.add(k);
        out.push({type:'Feature',geometry:ft.geometry,properties:{pid,acres:src.acres&&typeof pr[src.acres]==='number'?pr[src.acres]:null}})}
      if(!(j.exceededTransferLimit||j.properties?.exceededTransferLimit)||!fs.length)break;off+=fs.length;
    }
  }));
  return out;
}
/* download (or finish) a saved area: the property lines, the ground heights, then the map pieces. Pieces already
   saved are not asked for again. onProg(area) is told how it is going. Resolves with the area when it is done. */
async function offStart(a,onProg){
  if(offRun.has(a.id))return offRun.get(a.id);
  Object.assign(a,{status:'downloading',done:0,failed:0,bytes:0,streak:0,stop:false,gone:false,full:false,down:false});
  offRun.set(a.id,a);await mapPut('areas',a.id,offRec(a));loadOffAreas();
  const urls=offTileUrls(a),hb=offBlocks(a.bbox,a.cap||OFF_CAP.desk.heights).blocks;
  a.total=1+hb.length+urls.length;
  let saved=0,shown=0;
  // USGS not answering at all (64 pieces in a row did not come): stop, and it can be finished later
  const tick=(bytes,ok)=>{a.done++;if(!ok){a.failed++;if(++a.streak>=64&&!a.stop){a.stop=a.down=true}}else a.streak=0;a.bytes+=bytes||0;onProg?.(a);const now=Date.now();
    if(now-shown>700){shown=now;offProg()}
    if(now-saved>2500&&!a.stop){saved=now;mapPut('areas',a.id,offRec(a)).catch(()=>{})}};
  const fail=e=>{if(e?.name==='QuotaExceededError'){a.full=true;a.stop=true}};
  try{
    // property lines (alongside the rest: a county map can be slow to answer)
    const parcelsP=(async()=>{try{let p=await mapGet('parcels',a.id);if(!p){p=await offFetchParcels(a.bbox);if(!a.stop)await mapPut('parcels',a.id,p)}
      a.parcels=p.length;tick(JSON.stringify(p).length,true)}catch(e){fail(e);tick(0,false)}})();
    // ground heights
    const dem=[];
    await offPool(hb.map((b,i)=>({...b,k:a.id+'/'+i})),async b=>{
      if(a.stop)return;
      try{let g=await mapGet('heights',b.k);
        if(!g){const [w,s,e,n]=b.bbox;
          const u=`${DEP_X}?bbox=${[w,s,e,n].map(v=>v.toFixed(7)).join(',')}&bboxSR=4326&imageSR=4326&size=${b.w},${b.h}&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&compression=None&f=image`;
          const t=offTiff(await offTry(async()=>{const r=await fetchT(u,{},60000);if(!r.ok)throw Error('answered '+r.status);return r.arrayBuffer()}));
          g={bbox:b.bbox,w:t.W,h:t.H,z:t.z};if(a.stop)return;await mapPut('heights',b.k,g)}
        dem.push({k:b.k,bbox:g.bbox});tick(g.z.byteLength,true)}catch(e){fail(e);tick(0,false)}
    });
    a.dem=dem;
    // map pieces: USGS's ready-made pieces one by one; the ones its image services draw (slow, a few seconds each)
    // 4 x 4 at a time in one picture, cut up here and kept under each piece's own address
    const cache=await caches.open('fb-tiles'),jobs=[];
    offTileRange(a,(l,z,x0,x1,y0,y1)=>{const k=usgsDrawn(l,z)&&self.OffscreenCanvas?4:1;
      for(let bx=Math.floor(x0/k)*k;bx<=x1;bx+=k)for(let by=Math.floor(y0/k)*k;by<=y1;by+=k){const t=[];
        for(let x=Math.max(bx,x0);x<=Math.min(bx+k-1,x1);x++)for(let y=Math.max(by,y0);y<=Math.min(by+k-1,y1);y++)t.push({x,y,u:usgsTileUrl(l,z,x,y)});
        jobs.push({l,z,bx,by,k,t})}});
    const get=u=>offTry(async()=>{const r=await fetchT(u,{},60000);if(!r.ok||!/^image\//.test(r.headers.get('Content-Type')||''))throw Error('answered '+r.status);return r});
    await offPool(jobs,async j=>{
      if(a.stop)return;
      const want=[];
      for(const t of j.t){const hit=await cache.match(t.u,{ignoreVary:true}).catch(()=>null);if(hit)tick((await hit.blob()).size,true);else want.push(t)}
      if(!want.length||a.stop)return;
      try{
        if(j.k===1){const r=await get(want[0].u),sz=(await r.clone().blob()).size;if(a.stop)return;await cache.put(want[0].u,r);tick(sz,true);return}
        const bm=await createImageBitmap(await (await get(usgsTileUrl(j.l,j.z,j.bx,j.by,j.k))).blob()),s=bm.width/j.k;
        const cv=new OffscreenCanvas(256,256),g=cv.getContext('2d'),type=j.l==='naip'?'image/jpeg':'image/png';
        for(const t of want){if(a.stop)return;
          g.clearRect(0,0,256,256);g.drawImage(bm,(t.x-j.bx)*s,(t.y-j.by)*s,s,s,0,0,256,256);
          const b=await cv.convertToBlob({type,quality:.85});
          await cache.put(t.u,new Response(b,{headers:{'Content-Type':type}}));tick(b.size,true)}
        bm.close?.();
      }catch(e){fail(e);for(let i=0;i<want.length;i++)tick(0,false)}
    });
    await parcelsP;
  }finally{offRun.delete(a.id)}
  if(a.gone){await offWipe(a);return a}   // deleted while it downloaded
  a.status=a.stop||a.done<a.total?'stopped':a.failed?'partly':'done';a.finished=Date.now();
  await mapPut('areas',a.id,offRec(a)).catch(()=>{});
  loadOffAreas();
  return a;
}
const offRec=a=>{const {stop,gone,streak,...r}=a;return r};
function offResume(id){const a=offList.find(x=>x.id===id);if(!a||offRun.has(id))return;
  if(navigator.onLine===false)return toast('Finishing a saved area needs internet.');
  toast('Finishing "'+a.name+'"…');offStart({...a}).then(offDoneToast)}
function offDoneToast(a){toast(a.full?`This device ran out of room while saving "${a.name}". Delete a saved area or free some space, then press Finish it.`
  :a.down?`USGS is not answering right now, so saving "${a.name}" stopped part way. Press Finish it in Settings → Offline maps later.`
  :a.status==='done'?`"${a.name}" is saved on this device for working with no internet.`
  :a.status==='partly'?`"${a.name}" is saved, but ${a.failed} of ${a.total} pieces did not come (USGS did not answer). Press Finish it in Settings → Offline maps to try those again.`
  :`Saving "${a.name}" stopped part way. Press Finish it in Settings → Offline maps.`)}
// heights, property lines and map pieces of a saved area. Map pieces another saved area also uses are kept.
async function offWipe(a){
  await mapDel('areas',a.id).catch(()=>{});await mapDel('parcels',a.id).catch(()=>{});
  await mapDel('heights',IDBKeyRange.bound(a.id+'/',a.id+'/￿')).catch(()=>{});
  for(const k of [...offGrid.keys()])if(k.startsWith(a.id+'/'))offGrid.delete(k);
  if(!('caches' in window))return;
  const keep=new Set(offList.filter(x=>x.id!==a.id).flatMap(offTileUrls)),c=await caches.open('fb-tiles');
  await offPool(offTileUrls(a).filter(u=>!keep.has(u)),u=>c.delete(u).catch(()=>{}),16);
}
async function offDelete(id){
  const a=offList.find(x=>x.id===id);if(!a)return;
  const run=offRun.get(id);if(run)run.stop=run.gone=true;   // it finishes clearing up when its downloads stop
  await offWipe(a);offList=offList.filter(x=>x.id!==id);await loadOffAreas();
}
/* reading the saved heights back: the blocks are loaded as needed (the last 24 used stay in memory) */
const offGrid=new Map();
async function offBlocksIn(bbox){
  const out=[];
  for(const a of offList)for(const d of a.dem||[]){const [w,s,e,n]=d.bbox;if(e<bbox[0]||w>bbox[2]||n<bbox[1]||s>bbox[3])continue;
    let g=offGrid.get(d.k);
    if(!g){try{g=await mapGet('heights',d.k)}catch(e){}if(!g)continue;offGrid.set(d.k,g);if(offGrid.size>24)offGrid.delete(offGrid.keys().next().value)}
    out.push(g)}
  return out;
}
function offHeightAt(bl,lat,lng){
  for(const {bbox:[w,s,e,n],w:W,h:H,z:v} of bl){
    if(!(w<=lng&&lng<=e&&s<=lat&&lat<=n))continue;
    const fx=(lng-w)/(e-w)*W-.5,fy=(n-lat)/(n-s)*H-.5,x0=Math.max(0,Math.min(W-1,Math.floor(fx))),y0=Math.max(0,Math.min(H-1,Math.floor(fy)));
    const x1=Math.min(W-1,x0+1),y1=Math.min(H-1,y0+1),tx=Math.max(0,Math.min(1,fx-x0)),ty=Math.max(0,Math.min(1,fy-y0));
    const c=[v[y0*W+x0],v[y0*W+x1],v[y1*W+x0],v[y1*W+x1]];
    if(c.some(z=>!(z>-1000))){const g=c.filter(z=>z>-1000);if(!g.length)continue;return g.reduce((p,q)=>p+q,0)/g.length}
    const top=c[0]+(c[1]-c[0])*tx,bot=c[2]+(c[3]-c[2])*tx;return top+(bot-top)*ty;
  }
  return null;
}
// heights in meters at points {lat,lng} from the saved LiDAR (null outside every saved area)
async function offHeights(pts){
  if(!pts.length||!offList.length)return pts.map(()=>null);
  let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;for(const p of pts){w=Math.min(w,p.lng);e=Math.max(e,p.lng);s=Math.min(s,p.lat);n=Math.max(n,p.lat)}
  const bl=await offBlocksIn([w,s,e,n]);return pts.map(p=>bl.length?offHeightAt(bl,p.lat,p.lng):null);
}
// a W x H grid of heights over bbox [w,s,e,n] for the 3D view, from the saved LiDAR; edges not saved take the nearest
// saved height in their row (or column). null when less than a third of it is saved.
async function offDemGrid(bbox,W,H){
  const [w,s,e,n]=bbox,bl=await offBlocksIn(bbox);if(!bl.length)return null;
  const v=new Array(W*H);let have=0;
  for(let j=0;j<H;j++){const lat=n-(j+.5)/H*(n-s);for(let i=0;i<W;i++){const z=offHeightAt(bl,lat,w+(i+.5)/W*(e-w));v[j*W+i]=z;if(z!=null)have++}}
  if(have<W*H/3)return null;
  const fill=(len,cnt,at)=>{for(let k=0;k<cnt;k++){const known=[];for(let i=0;i<len;i++)if(v[at(k,i)]!=null)known.push(i);if(!known.length)continue;
    for(let i=0,q=0;i<len;i++){if(v[at(k,i)]!=null)continue;while(q<known.length-1&&Math.abs(known[q+1]-i)<=Math.abs(known[q]-i))q++;v[at(k,i)]=v[at(k,known[q])]}}};
  fill(W,H,(j,i)=>j*W+i);fill(H,W,(i,j)=>j*W+i);
  const known=v.filter(z=>z!=null),avg=known.reduce((p,q)=>p+q,0)/known.length,data=new Float32Array(W*H);
  for(let i=0;i<W*H;i++)data[i]=v[i]??avg;
  return {W,H,data,offline:true};
}
// property lines saved with the areas that touch bbox [w,s,e,n]
async function offParcels(bbox){
  const out=[];
  for(const a of offList){const [w,s,e,n]=a.bbox;if(e<bbox[0]||w>bbox[2]||n<bbox[1]||s>bbox[3])continue;
    let p=null;try{p=await mapGet('parcels',a.id)}catch(e){}
    for(const ft of p||[]){const b=offFbox(ft.geometry);if(b&&!(b[2]<bbox[0]||b[0]>bbox[2]||b[3]<bbox[1]||b[1]>bbox[3]))out.push({...ft,properties:{...ft.properties,county:'',src:'county'}})}}
  return out;
}
function offFbox(g){let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;const walk=c=>{if(typeof c?.[0]==='number'){w=Math.min(w,c[0]);e=Math.max(e,c[0]);s=Math.min(s,c[1]);n=Math.max(n,c[1])}else for(const x of c||[])walk(x)};walk(g?.coordinates);return w<=e?[w,s,e,n]:null}
// the list of saved areas (Settings → Offline maps, the outlines on the map, the bar at the bottom while one downloads)
let offOld=true;
async function loadOffAreas(){
  if(offOld){offOld=false;   // maps kept on a phone by older versions came through the server: thrown away
    try{if(localStorage.getItem('fence-tiles')){localStorage.removeItem('fence-tiles');caches.open('fb-tiles').then(async c=>{for(const r of await c.keys())if(r.url.includes('/api/off/tile/'))await c.delete(r)}).catch(()=>{})}}catch(e){}}
  let all=[];try{all=await mapAll('areas')||[]}catch(e){}
  offList=all.map(a=>offRun.get(a.id)||(a.status==='downloading'?{...a,status:'stopped'}:a)).sort((x,y)=>(x.created||0)-(y.created||0));
  offAreas.clearLayers();
  for(const a of offList){const [w,s2,e,n]=a.bbox;L.rectangle([[s2,w],[n,e]],{color:'#ffd21f',weight:1.5,dashArray:'4 6',fill:false,interactive:false}).bindTooltip(a.name,{permanent:false}).addTo(offAreas)}
  try{offEst=await navigator.storage?.estimate?.()||null}catch(e){}
  offProg(true);
  if(document.body.classList.contains('walk')&&!WK.tiles&&!WK.active&&!walkLine())renderWalk();   // the phone's Walk screen lists them too
}
let offPanelAt=0;
function offProg(force){
  const busy=[...offRun.values()],bar=$('#offbar');
  if(busy.length){const d=busy.reduce((x,a)=>x+a.done,0),t=busy.reduce((x,a)=>x+(a.total||1),0);bar.hidden=false;
    bar.innerHTML=`Saving for offline: <b>${esc(busy[0].name)}</b>${busy.length>1?` and ${busy.length-1} more`:''} · ${Math.floor(d/t*100)}% · ${fmtQ(Math.round(busy.reduce((x,a)=>x+a.bytes,0)/1e5)/10)} MB`}
  else bar.hidden=true;
  if(S?.tab==='settings'&&(force||Date.now()-offPanelAt>2000)&&!document.querySelector('dialog[open]')){offPanelAt=Date.now();renderPanel()}
}
const offMB=b=>fmtQ(Math.max(.1,Math.round((b||0)/1e5)/10));

/* ---------- save an area for offline: two corners, then it downloads in the background ---------- */
const offLab=L.marker([0,0],{interactive:false,keyboard:false,icon:L.divIcon({className:'seglab',iconSize:[0,0],html:'<span></span>'})});
const kmOf=b=>{const lat=(b.getNorth()+b.getSouth())/2;return ((b.getEast()-b.getWest())*111.32*Math.cos(lat*Math.PI/180))*((b.getNorth()-b.getSouth())*110.57)};
const acresOf=km2=>km2*247.105;
map.on('mousemove',e=>{if(mode!=='offsel'||!offA)return;const b=L.latLngBounds(offA,e.latlng);offRect.setBounds(b).addTo(map);
  offLab.setLatLng(b.getCenter()).addTo(map);offLab.getElement().firstChild.textContent=fmtQ(Math.round(acresOf(kmOf(b))))+' acres'});
function startOffSel(){if(mode==='draw')cancelDraw();if(!UI.map)gotoTab('build');setMode(mode==='offsel'?'idle':'offsel')}
$('#bOff').onclick=startOffSel;
async function offClick(ll){
  if(!offA){offA=ll;offRect.setBounds(L.latLngBounds(ll,ll)).addTo(map);return}
  const b=L.latLngBounds(offA,ll);offA=null;offLab.remove();
  if(b.getNorth()-b.getSouth()<1e-4||b.getEast()-b.getWest()<1e-4){offRect.remove();return toast('That area is too small. Click two corners farther apart.')}
  const bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>+v.toFixed(6));
  const done=()=>{offRect.remove();setMode('idle')};
  if(!offCanKeep()){done();return toast("This browser can't keep maps here: it needs a secure (https) address.")}
  if(navigator.onLine===false){done();return toast('Saving an area for offline needs internet.')}
  const cap=offWanted()?OFF_CAP.phone:OFF_CAP.desk,LAY=['naip','hill'],pl={};
  for(const z of [19,18,17,16])pl[z]=offPlan(bbox,z,LAY,cap);
  const best=[19,18,17,16].find(z=>!pl[z].too);
  if(!best){done();return toast(`That area is too big to keep on this device (about ${fmtQ(Math.round(pl[16].mb))} MB even with less detail, and the most is ${cap.mb} MB). Pick a smaller area.`)}
  const lvl=(z,name)=>opt(String(z),`${name}, about ${fmtQ(Math.max(1,Math.round(pl[z].mb)))} MB${pl[z].too?' (too big)':''}`,String(best));
  const v=await formDlg('Save this area for offline',`<p style="margin:0">${fmtQ(Math.round(acresOf(kmOf(b))))} acres. This browser downloads the USGS aerial photo, the LiDAR bare-earth map, the LiDAR ground heights and the property lines for it, and keeps them on this device, so the map, slope footage and 3D view work here with no internet.</p>
    <label class="f">Name</label><input type="text" name="name" value="${esc(P()?.name||'Saved area')}">
    <label class="f">Detail</label><select name="maxz">${lvl(19,'Sharpest, zoom in all the way')}${lvl(18,'Sharp')}${lvl(17,'Less detail, smaller download')}${lvl(16,'Least detail, smallest download')}</select>
    <p class="small mut">It downloads in the background while this page is open (the most one area can be is ${cap.mb} MB). You can keep working, and see how it's going in Settings → Offline maps.</p>`,'Download');
  done();
  if(!v)return;
  const z=+v.maxz,p=pl[z];
  if(!p||p.too)return toast(`That is too big to keep on this device (the most is ${cap.mb} MB). Pick a smaller area or less detail.`);
  if(!await offRoom(p.mb))return toast(`This device doesn't have room for about ${fmtQ(Math.round(p.mb))} MB more. Delete a saved area or free some space, or pick a smaller area.`);
  const a={id:uid('a'),name:String(v.name||'').trim().slice(0,80)||'Saved area',bbox,maxz:z,layers:LAY,cap:cap.heights,created:Date.now()};
  toast('Saving "'+a.name+'" on this device…');
  offStart(a).then(offDoneToast,e=>{console.error(e);toast('Saving the area did not work: '+(e.message||e))});
}
$('#bDraw').onclick=()=>mode==='draw'?finishDraw():startDraw();
$('#bGate').onclick=()=>mode==='draw'?draftGate(!draft.gate):toggleMode('gate');
$('#bBrace').onclick=()=>toggleMode('brace');
$('#bUndo').onclick=draftUndo;
$('#bFinish').onclick=finishDraw;
$('#bCancel').onclick=()=>mode==='draw'?cancelDraw():setMode('idle');
// W A S D or the arrow keys slide the map around while you hold them (Shift is faster)
const panHeld=new Set(),PAN_KEYS={w:[0,-1],arrowup:[0,-1],s:[0,1],arrowdown:[0,1],a:[-1,0],arrowleft:[-1,0],d:[1,0],arrowright:[1,0]};
let panRaf=0,panLast=0;
map.keyboard?.disable();   // the map's own arrow keys would move it twice
function panStep(now){
  if(!panHeld.size){panRaf=0;return}
  const dt=Math.min(0.05,(now-(panLast||now))/1000);panLast=now;let x=0,y=0;
  for(const k of panHeld){const v=PAN_KEYS[k];if(v){x+=v[0];y+=v[1]}}
  const sp=(panHeld.has('shift')?1500:600)*dt;if(x||y)map.panBy([x*sp,y*sp],{animate:false});
  panRaf=requestAnimationFrame(panStep);
}
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||document.getElementById('v3d')||e.target.closest?.('input,textarea,select')||!UI.map)return;
  const k=e.key.toLowerCase();if(k==='shift'){panHeld.add('shift');return}
  if(!PAN_KEYS[k]||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();e.stopImmediatePropagation();if(!e.repeat&&!panHeld.has(k)){const v=PAN_KEYS[k],n=panHeld.has('shift')?160:60;map.panBy([v[0]*n,v[1]*n])}panHeld.add(k);if(!panRaf){panLast=0;panRaf=requestAnimationFrame(panStep)}
},true);
document.addEventListener('keyup',e=>panHeld.delete(e.key.toLowerCase()));
addEventListener('blur',()=>panHeld.clear());
const keysDlg=$('#keys');
$('#bKeys').onclick=()=>keysDlg.showModal();$('#keysClose').onclick=()=>keysDlg.close();
keysDlg.addEventListener('click',e=>{if(e.target===keysDlg)keysDlg.close()});
document.addEventListener('keydown',e=>{
  if(document.querySelector('dialog[open]')||document.getElementById('v3d')||e.target.closest?.('input,textarea,select'))return;
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
  if(e.key==='Escape'){
    // Esc ends the line at the last point you placed and keeps it; Cancel is what throws it away
    if(mode==='draw')return (draft.appendTo||draft.pts.length>=2)?finishDraw():cancelDraw();
    if(mode!=='idle')return setMode('idle');
    map.closePopup();
    if(selNode){selNode=null;return renderAll()}
    if(UI.full)return setFull(false);
    if(selLine){selLine=null;renderAll()}
    return;
  }
  if(mode==='draw'){
    // G: gate from the last point to your next click. F goes back to fence (and ends the line if you're already drawing fence)
    if(k==='g'&&!mod)draftGate(!draft.gate);
    else if(k==='f'&&!mod&&(draft.gate||draft.afterGate)){draft.gate=draft.afterGate=false;drawDraft();toast('Drawing fence')}
    else if(e.key==='Enter'||(k==='f'&&!mod))finishDraw();
    else if((mod&&k==='z')||e.key==='Backspace'){e.preventDefault();draftUndo()}
    return;
  }
  if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}
  else if(mod&&k==='y'){e.preventDefault();redo()}
  else if((e.key==='Delete'||e.key==='Backspace')&&selNode&&getLine(selNode.l)){e.preventDefault();map.closePopup();act('delPt',{id:selNode.l,i:selNode.i})}
  else if(mod||e.altKey)return;
  else if(e.key==='?'){e.preventDefault();keysDlg.showModal()}
  else if(k==='f'){if(!UI.map)setMap(true);startDraw()}
  else if(k==='g'||k==='b')toggleMode(k==='g'?'gate':'brace');
  else if(k==='m')setMap(!UI.map);
  else if(k==='t'){if(selLine&&getLine(selLine)?.pts.length>1){if(!UI.map)setMap(true);openTypePicker(selLine)}else toast('Click a line on the map first')}
  else if(k==='r'){selLine=null;selNode=null;if(mode!=='idle')cancelDraw();S.tab='est';act('addRun',{})}
  else if(e.key==='/'){e.preventDefault();if(!UI.map)setMap(true);$('#q').focus()}
  else if(/^[1-9]$/.test(e.key)&&TABS[+e.key-1])gotoTab(TABS[+e.key-1][0]);
});

/* ---------- totals box on the map (shown in full screen) ---------- */
function renderMapSum(){
  const el=$('#mapsum');if(!el||!A)return;
  const r=selLine&&A.lines.find(x=>x.l.id===selLine);
  el.innerHTML=`<div><span>Wire run</span><b>${fmtFt(A.totalFt)}</b></div><div><span>Total</span><b>${money(A.total)}</b></div>`+
    (r?`<div class="ln"><span><i class="dot" style="background:${esc(r.t.color)}"></i>${esc(r.l.name)}</span><b>${fmtFt(r.len)}</b></div>`:'');
}

/* ---------- drag the divider to resize the map ---------- */
{
  const mainEl=document.querySelector('main'),sp=$('#split');
  let w=+localStorage.getItem('fence-mapw')||0;if(w)mainEl.style.setProperty('--mapw',w+'px');
  let raf=0;
  sp.addEventListener('pointerdown',e=>{
    e.preventDefault();sp.setPointerCapture(e.pointerId);document.body.classList.add('resizing');
    const mv=ev=>{const r=mainEl.getBoundingClientRect();w=Math.round(Math.min(r.width-380,Math.max(320,r.right-ev.clientX)));mainEl.style.setProperty('--mapw',w+'px');
      cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>map.invalidateSize())};
    const up=()=>{sp.removeEventListener('pointermove',mv);sp.removeEventListener('pointerup',up);document.body.classList.remove('resizing');map.invalidateSize();try{localStorage.setItem('fence-mapw',w)}catch(e){}};
    sp.addEventListener('pointermove',mv);sp.addEventListener('pointerup',up);
  });
  sp.addEventListener('dblclick',()=>{mainEl.style.removeProperty('--mapw');try{localStorage.removeItem('fence-mapw')}catch(e){}setTimeout(()=>map.invalidateSize(),0)});
}
$('#bLoc').onclick=()=>{if(!navigator.geolocation)return toast('Location is not available here');navigator.geolocation.getCurrentPosition(p=>map.setView([p.coords.latitude,p.coords.longitude],18),()=>toast('Could not get your location (it needs https)'),{enableHighAccuracy:true,timeout:10000})};
$('#search').onsubmit=async e=>{
  e.preventDefault();const q=$('#q').value.trim();if(!q)return;
  const m=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(m)return map.setView([+m[1],+m[2]],18);
  if(searchBusy)return;searchBusy=true;
  let hit=null;
  try{hit=await findPlace(q)}finally{searchBusy=false}
  if(!hit)return toast(navigator.onLine===false?'Searching for a place needs internet.':'No place found for that search');
  if(hit.box)map.fitBounds(hit.box,{maxZoom:18});else map.setView([hit.lat,hit.lng],17);
  if(searchPin)searchPin.remove();
  searchPin=L.circleMarker([hit.lat,hit.lng],{radius:7,color:'#fff',weight:2,fillColor:'#d93025',fillOpacity:1}).addTo(map).bindTooltip(esc(hit.name||q),{direction:'top',offset:[0,-6]}).openTooltip();
};
// a place by name, asked by this browser: OpenStreetMap's Nominatim first (one question a second at most, see nomFetch),
// then Esri's address finder (only shown on the map, never kept)
let searchBusy=false;
async function findPlace(q){
  try{const r=await nomFetch('search?format=json&limit=5&q='+encodeURIComponent(q));
    const j=r.ok?await r.json():null,b=j?.[0]?.boundingbox;
    if(j?.length)return {lat:+j[0].lat,lng:+j[0].lon,name:j[0].display_name,box:b?[[+b[0],+b[2]],[+b[1],+b[3]]]:null}}catch(e){}
  try{const r=await fetchT('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&outSR=4326&maxLocations=5&SingleLine='+encodeURIComponent(q),{},12000);
    const c=(await r.json()).candidates?.[0],x=c?.extent;
    if(c?.location)return {lat:c.location.y,lng:c.location.x,name:c.address,box:x&&x.xmin<x.xmax?[[x.ymin,x.xmin],[x.ymax,x.xmax]]:null}}catch(e){}
  return null;
}

