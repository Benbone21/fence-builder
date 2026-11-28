/* ---------- the ground along each fence line: soil and rock, water, trees and brush ----------
   Fence Builder's server asks public federal maps about each line (ground.py): the USDA soil survey, USGS streams and
   ditches, FEMA flood zones, US Fish and Wildlife wetlands, and LANDFIRE tree and shrub cover. Answers are kept per line
   shape (here and in this browser), asked for in the background after a line is drawn or changed, and never hold up
   drawing. If a map doesn't answer, the line just says so. Nothing here changes the bill until a button is pressed. */
const GTOPICS=['soil','streams','flood','wetlands','cover'];
const GROUND_FEE='Clearing trees and brush';
const gRate=()=>({trees:Math.max(0,+(S.settings.clearTrees??4)||0),brush:Math.max(0,+(S.settings.clearBrush??1.5)||0)});
// the line's shape: its corners, leaving out points on a straight run (gates and braces added later), so adding
// those doesn't ask the maps again
function groundShape(l){
  const P=l?.pts;if(!P||l.manual||P.length<2)return null;
  const lat0=P[0].lat,mx=111320*Math.cos(lat0*Math.PI/180),my=110574,xy=p=>[(p.lng-P[0].lng)*mx,(p.lat-lat0)*my],keep=[P[0]];
  for(let i=1;i<P.length-1;i++){const a=xy(keep[keep.length-1]),b=xy(P[i]),c=xy(P[i+1]),L2=Math.hypot(c[0]-a[0],c[1]-a[1]);
    const off=L2?Math.abs((c[0]-a[0])*(b[1]-a[1])-(c[1]-a[1])*(b[0]-a[0]))/L2:Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(off>0.5)keep.push(P[i])}
  keep.push(P[P.length-1]);
  const pts=keep.map(p=>[+p.lat.toFixed(6),+p.lng.toFixed(6)]),k=pts.map(p=>p.join(',')).join('|');
  return new Set(pts.map(p=>p.join(','))).size<2?null:{key:k,pts}}
// answers kept in this browser: shape -> {at, soil, streams, flood, wetlands, cover}
const gStore=(()=>{let o={};try{o=JSON.parse(localStorage.getItem('fence-ground')||'{}')||{}}catch(e){}
  for(const k of Object.keys(o))if(!(Date.now()-(o[k]?.at||0)<60*86400e3))delete o[k];return o})();
const gBusy=new Map(),gFail=new Map();   // shape#topic -> the request on its way / {at, msg} when it didn't answer
let gSaveT,gT,gDrawT;
function gKeep(){clearTimeout(gSaveT);gSaveT=setTimeout(()=>{const ks=Object.keys(gStore).sort((a,b)=>(gStore[b].at||0)-(gStore[a].at||0));for(const k of ks.slice(150))delete gStore[k];
  try{localStorage.setItem('fence-ground',JSON.stringify(gStore))}catch(e){}},800)}
function groundGet(sh,topic){
  const id=sh.key+'#'+topic,have=gStore[sh.key]?.[topic];
  if(have)return Promise.resolve(have);
  if(gBusy.has(id))return gBusy.get(id);
  const p=(async()=>{
    if(!serverOK)throw Error('server');
    if(navigator.onLine===false)throw Error('offline');
    let r,j=null;
    try{r=await fetchT('api/ground/'+topic,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pts:sh.pts})},60000)}catch(e){throw Error('')}
    try{j=await r.json()}catch(e){}
    if(!r.ok||!j||j.error)throw Error(j?.error||'');
    const o=gStore[sh.key]||(gStore[sh.key]={});o[topic]=j;o.at=Date.now();gFail.delete(id);gKeep();return j})();
  gBusy.set(id,p);
  p.catch(e=>gFail.set(id,{at:Date.now(),msg:e.message})).finally(()=>{gBusy.delete(id);gRedraw();scheduleGround()});
  return p}
function scheduleGround(){clearTimeout(gT);gT=setTimeout(ensureGround,1200)}
function ensureGround(){
  if(!S||!serverOK||navigator.onLine===false)return;
  const now=Date.now();
  for(const l of P().lines){const sh=groundShape(l);if(!sh)continue;
    for(const t of GTOPICS){const id=sh.key+'#'+t,f=gFail.get(id);
      if(gStore[sh.key]?.[t]||gBusy.has(id)||(f&&now-f.at<180000))continue;
      if(gBusy.size>=6)return;   // a few at a time: the rest start as these finish
      groundGet(sh,t).catch(()=>{})}}}
addEventListener('online',()=>{gFail.clear();scheduleGround()});
// show new answers, but not while someone is typing in a box on the page (it waits until they're done)
function gRedraw(){clearTimeout(gDrawT);gDrawT=setTimeout(()=>{if(!S||!(S.tab==='est'||(S.tab==='build'&&selLine)))return;
  const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.type!=='checkbox'&&($('#panel').contains(a)||$('#side').contains(a)))return gRedraw();
  renderPanel()},400)}
// what is known about one line: answers, what's still being checked, what didn't answer
function groundOf(l){
  const sh=groundShape(l);if(!sh)return null;const o={sh,res:gStore[sh.key]||{},busy:[],fail:{}};
  for(const t of GTOPICS){const id=sh.key+'#'+t;if(o.res[t])continue;if(gFail.has(id)&&!gBusy.has(id))o.fail[t]=gFail.get(id).msg;else o.busy.push(t)}
  return o}
const gCalm=m=>m==='offline'?'No internet right now. It is checked again when you are back online.':m==='server'?'Checking the ground needs the Fence Builder app or server.':m||'That map did not answer. Try again later.';
const gCap=s=>s?s[0].toUpperCase()+s.slice(1):s;
// short plain words for each answer
function soilText(s){
  if(!s.covered||!s.units?.length)return 'No soil survey along this line.';
  const a=[s.rocky_ft?`Rocky ground on ${fmtFt(s.rocky_ft)}.`:'No rocky ground on the soil map.'];
  if(s.bedrock_in!=null&&s.bedrock_in<=48)a.push(`Bedrock as shallow as ${s.bedrock_in} in.`);
  if(s.hardpan_in!=null&&s.hardpan_in<=48)a.push(`${esc(gCap(s.hardpan||'hardpan'))} as shallow as ${s.hardpan_in} in.`);
  return a.join(' ')}
function streamText(w){const c=w.crossings||[];if(!c.length)return 'No streams or ditches cross it on the USGS map.';
  return `Crosses ${c.length===1?'1 stream or ditch':c.length+' streams or ditches'}: `+c.slice(0,6).map(x=>`${x.name?esc(x.name):'a '+esc(x.kind)}${x.flow?' ('+esc(x.flow)+')':''} at ${fmtFt(x.at)}`).join(', ')+(c.length>6?' and more':'')+'.'}
function floodText(f){
  if(!f.f100_ft&&!f.f500_ft)return 'Not in a FEMA flood zone. (Some rural areas have no flood map.)';
  const a=[];
  if(f.f100_ft)a.push(`${fmtFt(f.f100_ft)} in the 100-year flood zone${f.floodway_ft?`, ${fmtFt(f.floodway_ft)} of it in the floodway, where flood water runs fastest`:''}.`);
  if(f.f500_ft)a.push(`${fmtFt(f.f500_ft)} in the 500-year flood zone.`);
  if(f.f100_ft)a.push('Ask the county if fence there needs a floodplain permit.');
  return a.join(' ')}
function wetText(w){const wet=(w.types||[]).filter(t=>!t.channel);
  if(!w.wet_ft)return 'No wetlands on the map along it.';
  return `${fmtFt(w.wet_ft)} through wetlands (${wet.map(t=>esc(t.type)).join(', ')}). Wetlands may need a permit: check before you build.`}
function coverText(c){
  if(!c.covered)return 'No tree and brush map here.';
  if(!c.trees_ft&&!c.brush_ft)return 'No trees or thick brush on the map along it.';
  const r=gRate(),cost=c.trees_ft*r.trees+c.brush_ft*r.brush;
  return `Trees on ${fmtFt(c.trees_ft)}, brush on ${fmtFt(c.brush_ft)}.${cost?` About ${money(Math.round(cost))} to clear at your rates.`:''}`}
const GROW=[['soil','Soil and rock',soilText],['streams','Streams and ditches',streamText],['flood','Flood zone',floodText],['wetlands','Wetlands',wetText],['cover','Trees and brush',coverText]];
// the "Ground along this fence" part of a line's page
function groundView(l){
  const g=groundOf(l);if(!g)return '';
  if(!serverOK)return `<h3>Ground along this fence</h3><p class="small mut">${gCalm('server')}</p>`;
  if(g.busy.length)scheduleGround();
  const rows=GROW.map(([t,name,fn])=>{const r=g.res[t];
    return `<div class="gline"><b>${name}</b><span>${r?fn(r):t in g.fail?`<span class="mut">${esc(gCalm(g.fail[t]))}</span>`:'<span class="mut">Checking the ground…</span>'}</span></div>`}).join('');
  const s=g.res.soil,units=s?.units?.filter(u=>u.ft>0)||[];
  const soils=units.length?`<details class="help" data-keep="groundSoils"${openKeep.groundSoils?' open':''}><summary>The soils along it</summary><table class="gsoil"><tbody>${units.map(u=>{const bits=[];
      if(u.water)bits.push('water');else{if(u.rock!=null)bits.push(u.rock>=1?`${u.rock}% rocks over 3 in`:'few rocks');if(u.gravel>=15)bits.push('gravelly');if(u.outcrop>=10)bits.push(`${u.outcrop}% rock outcrop`);
        if(u.bedrock_in!=null)bits.push(`bedrock at ${u.bedrock_in} in`);if(u.hardpan_in!=null)bits.push(`${esc(u.hardpan||'hardpan')} at ${u.hardpan_in} in`)}
      return `<tr><td>${esc(u.name)}${u.rocky?' <span class="tag warnt">rocky</span>':''}${u.shallow?' <span class="tag warnt">shallow</span>':''}<div class="small mut">${bits.join(' · ')}</div></td><td class="num">${fmtFt(u.ft)}</td></tr>`}).join('')}</tbody></table>
      <p class="small mut" style="margin:4px 0 0">Rocks and depths are for the top 40 inches, where posts and brace holes go.</p></details>`:'';
  const failed=Object.keys(g.fail).length;
  return `<h3>Ground along this fence</h3><div class="box ground">${rows}${soils}
    ${failed?`<button class="btn noprint" data-act="groundRetry" data-id="${l.id}" style="margin-top:6px">Try again</button>`:''}
    <p class="small mut" style="margin:6px 0 0">From USDA soil survey, USGS, FEMA, US Fish and Wildlife and LANDFIRE maps. A guide for planning, not a survey: check on site.</p></div>`}
// the job as a whole, on the Final bill, with the two suggestions
const siteSuggest=(rocky,shallow,ft)=>ft?Math.min(30,Math.round((15*rocky/ft+15*shallow/ft)/5)*5):null;
function groundJob(){
  const p=P(),seen=new Set(),t={n:0,soilFt:0,rocky:0,shallow:0,bed:null,pan:null,panK:'',trees:0,brush:0,cover:0,f100:0,wet:0,cross:0,busy:0,fail:0};
  for(const l of p.lines){const g=groundOf(l);if(!g||seen.has(g.sh.key))continue;seen.add(g.sh.key);t.n++;
    if(g.busy.length)t.busy++;else if(Object.keys(g.fail).length)t.fail++;
    const r=g.res;
    if(r.soil?.covered){t.soilFt+=r.soil.ft;t.rocky+=r.soil.rocky_ft||0;t.shallow+=r.soil.shallow_ft||0;
      if(r.soil.bedrock_in!=null&&(t.bed==null||r.soil.bedrock_in<t.bed))t.bed=r.soil.bedrock_in;
      if(r.soil.hardpan_in!=null&&(t.pan==null||r.soil.hardpan_in<t.pan)){t.pan=r.soil.hardpan_in;t.panK=r.soil.hardpan}}
    if(r.cover?.covered){t.cover++;t.trees+=r.cover.trees_ft;t.brush+=r.cover.brush_ft}
    if(r.flood)t.f100+=r.flood.f100_ft;if(r.wetlands)t.wet+=r.wetlands.wet_ft;if(r.streams)t.cross+=(r.streams.crossings||[]).length}
  return t}
function groundBill(){
  if(!serverOK)return '';
  const p=P(),t=groundJob();if(!t.n)return '';
  scheduleGround();
  const r=gRate(),sug=siteSuggest(t.rocky,t.shallow,t.soilFt),site=+p.site||0,clear=Math.round(t.trees*r.trees+t.brush*r.brush),fee=(p.fees||[]).find(f=>f.name===GROUND_FEE);
  const soil=t.soilFt?`${t.rocky?`Rocky ground on ${fmtFt(t.rocky)} of ${fmtFt(t.soilFt)}.`:'No rocky ground on the soil map.'}${t.bed!=null&&t.bed<=48?` Bedrock as shallow as ${t.bed} in.`:''}${t.pan!=null&&t.pan<=48?` ${esc(gCap(t.panK||'hardpan'))} as shallow as ${t.pan} in.`:''}`:'';
  const water=[t.cross?`${t.cross} stream or ditch crossing${t.cross>1?'s':''}`:'',t.f100?`${fmtFt(t.f100)} in the 100-year flood zone`:'',t.wet?`${fmtFt(t.wet)} through wetlands (may need a permit)`:''].filter(Boolean).join(', ');
  const siteRow=sug==null?'':`<div class="gline"><b>Site difficulty</b><span>Suggested: <b>${sug}%</b>. Up to 15% for rocky ground and up to 15% for bedrock or hardpan within 40 in, by how much of the fence is on it.
    ${sug===site?'<span class="okc">That is what this job uses.</span>':`<button class="btn noprint" data-act="groundSite" data-k="${sug}">Use ${sug}%</button>${site?` <span class="small mut">(now ${site}%)</span>`:''}`}</span></div>`;
  const clearRow=t.cover?`<div class="gline"><b>Clearing</b><span>Trees on ${fmtFt(t.trees)}, brush on ${fmtFt(t.brush)}${clear?`: about <b>${money(clear)}</b> to clear, with trees at ${money(r.trees)} and brush at ${money(r.brush)} a foot (<button class="lnk noprint" data-act="groundRates">change</button>)`:''}.
    ${clear?(fee&&+fee.amount===clear?'<span class="okc">That is the clearing fee on this job.</span>':`<button class="btn noprint" data-act="groundFee" data-k="${clear}">${fee?'Update the clearing fee to '+money(clear):'Add a '+money(clear)+' clearing fee'}</button>`):''}</span></div>`:'';
  return `<h2>The ground</h2><div class="box ground">
    ${soil?`<div class="gline"><b>Soil and rock</b><span>${soil}</span></div>`:''}${siteRow}${clearRow}
    ${water?`<div class="gline"><b>Water</b><span>${gCap(water)}.</span></div>`:''}
    ${t.busy?`<p class="small mut" style="margin:6px 0 0">Checking the ground along ${t.busy} line${t.busy>1?'s':''}…</p>`:''}
    ${t.fail?`<p class="small mut noprint" style="margin:6px 0 0">Some maps did not answer for ${t.fail} line${t.fail>1?'s':''}. <button class="btn" data-act="groundRetry" data-id="all">Try again</button></p>`:''}
    <p class="small mut" style="margin:6px 0 0">From public USDA, USGS, FEMA, US Fish and Wildlife and LANDFIRE maps. Each line's page has the details. Nothing changes on the bill until you press a button.</p></div>`}
function groundSettings(){const s=S.settings;
  return `<h2>Ground and clearing</h2><p class="lead">Fence Builder looks up the ground along each fence line on public maps: soil and rock, streams and ditches, flood zones, wetlands, trees and brush. You see it on each line's page and on the Final bill.</p>
    <h3>Clearing trees and brush</h3><p class="mut" style="margin-top:0">Starting guesses: change them to what clearing costs you.</p>
    <div class="setfield"><label class="f" for="sclt">Clearing trees, $ per foot of fence</label><input id="sclt" type="number" min="0" step="0.25" value="${+(s.clearTrees??4)}" data-f="set.clearTrees"></div>
    <div class="setfield"><label class="f" for="sclb">Clearing brush, $ per foot of fence</label><input id="sclb" type="number" min="0" step="0.25" value="${+(s.clearBrush??1.5)}" data-f="set.clearBrush"></div>
    <div class="note">Trees: where the map shows tree cover. Brush: where shrubs cover a quarter or more of the ground (thin sagebrush is left out). The map is in squares about 100 ft across, so a single row of trees can be missed.</div>`}
for(const el of [$('#panel'),$('#side')])el.addEventListener('click',e=>{
  const b=e.target.closest('[data-act^="ground"]');if(!b)return;const a=b.dataset.act,p=P();
  if(a==='groundSite'){p.site=+b.dataset.k||0;changed();toast(`Site difficulty set to ${p.site}%`)}
  else if(a==='groundFee'){const v=+b.dataset.k||0;p.fees=p.fees||[];const f=p.fees.find(x=>x.name===GROUND_FEE);if(f)f.amount=v;else p.fees.push({name:GROUND_FEE,amount:v});changed();toast(`Clearing fee: ${money(v)}`)}
  else if(a==='groundRates'){setSec='ground';gotoTab('settings')}
  else if(a==='groundRetry'){const ls=b.dataset.id==='all'?p.lines:[getLine(b.dataset.id)].filter(Boolean);
    for(const l of ls){const sh=groundShape(l);if(sh)for(const t of GTOPICS)gFail.delete(sh.key+'#'+t)}ensureGround();renderPanel()}});
/* ---------- braces at rivers: USGS streams and ditches (NHD) are the main source ----------
   findCrossings asks for these along with the street map. When the USGS map answers, its streams, rivers, canals and
   ditches are used and the street map's waterways are set aside (they are mostly the same creeks drawn a few yards apart,
   which would put two pairs of braces at one creek); the street map's waterways are the backup when USGS doesn't answer. */
const NHD_LAYER='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6';
async function nhdDirect(sh){   // no Fence Builder server: ask USGS straight from the browser
  let s=90,w=180,n=-90,e=-180;for(const [la,ln] of sh.pts){s=Math.min(s,la);n=Math.max(n,la);w=Math.min(w,ln);e=Math.max(e,ln)}
  const r=await fetchT(NHD_LAYER+'/query?where=ftype%20IN%20(460,336,558)&geometry='+[w,s,e,n].map(v=>v.toFixed(6)).join(',')+'&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=gnis_name,ftype&returnGeometry=true&f=json',{},20000);
  const j=await r.json();if(!Array.isArray(j.features))throw Error('bad');
  return j.features.flatMap(f=>{const nm=String(f.attributes?.gnis_name||'').trim(),low=nm.toLowerCase(),kind=f.attributes?.ftype===336?(low.includes('canal')?'canal':'ditch'):(low.includes('river')?'river':'stream');
    return (f.geometry?.paths||[]).map(p=>({name:nm,kind,path:p.map(([x,y])=>[y,x])}))})}
// USGS waterways along a line, shaped like the street map's answer; null if USGS didn't answer
async function riverWays(l){
  const sh=groundShape(l);if(!sh)return null;let ways=null;
  if(serverOK)try{ways=(await Promise.race([groundGet(sh,'streams'),new Promise((_,no)=>setTimeout(()=>no(Error('slow')),25000))])).ways}catch(e){}
  if(!ways&&!serverOK&&navigator.onLine!==false)ways=await nhdDirect(sh).catch(()=>null);
  return Array.isArray(ways)?ways.map(w=>({tags:{waterway:w.kind,...(w.name?{name:w.name}:{})},geometry:w.path.map(([lat,lon])=>({lat,lon})),nhd:true})):null}
function useRivers(ways,nhd,quiet){
  if(quiet&&(S.settings.autoRivers??S.settings.autoCross)===false)return ways&&ways.filter(w=>!w.tags?.waterway);   // braces at rivers are off
  if(!nhd)return ways;
  return [...(ways||[]).filter(w=>!w.tags?.waterway),...nhd]}
/* ---------- map layers: soils, streams, flood zones, wetlands, tree cover (off to start, each from its own public map) ---------- */
// zoomed out too far (gMin), a layer draws nothing (the legend says to zoom in) but can still be switched on
const BLANK='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GTile=L.TileLayer.extend({getTileUrl(c){if(c.z<(this.options.gMin||0))return BLANK;const n=2**c.z,sz=2*R3857/n,x0=-R3857+c.x*sz,y1=R3857-c.y*sz;
  return this.options.src+'&bbox='+[x0,y1-sz,x0+sz,y1].map(v=>v.toFixed(2)).join(',')}});
const GWms=L.TileLayer.WMS.extend({getTileUrl(c){return c.z<(this.options.gMin||0)?BLANK:L.TileLayer.WMS.prototype.getTileUrl.call(this,c)}});
const gExport=(base,q,o)=>new GTile('',{src:base+'?bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&'+q,maxZoom:22,...o});
const EVC_RULE={rasterFunction:'Colormap',rasterFunctionArguments:{Colormap:[[1,30,120,40],[2,205,160,60]],
  Raster:{rasterFunction:'Remap',rasterFunctionArguments:{InputRanges:[100,200,225,300],OutputValues:[1,2],AllowUnmatched:false}}}};
const GROUND_LAYERS={
  'Soils (USDA soil map, zoom in close)':{z:15,short:'Soils',note:'Soils: each orange outline is one soil, with its map symbol. A fence line\'s page lists the soils it crosses.',
    layer:new GWms('https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms',{layers:'mapunitpoly',format:'image/png',transparent:true,gMin:15,maxZoom:22,attribution:'Soils: USDA NRCS'})},
  'Streams and ditches (USGS)':{z:13,short:'Streams',note:'Streams: blue lines are creeks and rivers, orange lines are canals and ditches.',
    layer:gExport(NHD_LAYER.replace(/\/6$/,'')+'/export','layers=show:6&layerDefs='+encodeURIComponent(JSON.stringify({6:'ftype IN (460,336,558)'})),{gMin:13,attribution:'Streams: USGS NHD'})},
  'Flood zones (FEMA, zoom in close)':{z:14,short:'Flood zones',note:'Flood zones: blue is the 100-year flood zone, red stripes are the floodway, orange is the 500-year flood zone.',
    layer:gExport('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export','layers=show:28&layerDefs='+encodeURIComponent(JSON.stringify({28:"SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2 PCT%'"})),{gMin:14,opacity:.6,attribution:'Flood zones: FEMA'})},
  'Wetlands (US Fish and Wildlife)':{z:13,short:'Wetlands',note:'Wetlands: greens are marshes and wooded wetlands, blues are ponds, lakes and stream channels. Wetlands may need a permit.',
    layer:gExport('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export','layers=show:0',{gMin:13,opacity:.6,attribution:'Wetlands: USFWS NWI'})},
  'Trees and brush (LANDFIRE)':{z:12,short:'Trees and brush',note:'Green: trees. Tan: thick brush. In squares about 100 ft across.',
    layer:gExport('https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVC_CONUS/ImageServer/exportImage','interpolation=RSP_NearestNeighbor&renderingRule='+encodeURIComponent(JSON.stringify(EVC_RULE)),{gMin:12,opacity:.6,attribution:'Trees and brush: LANDFIRE'})}};
const gLeg=L.control({position:'bottomleft'});
gLeg.onAdd=()=>{const d=L.DomUtil.create('div','gleg');L.DomEvent.disableClickPropagation(d);return d};gLeg.addTo(map);
function gLegend(){const d=gLeg.getContainer(),z=map.getZoom(),on=Object.values(GROUND_LAYERS).filter(o=>map.hasLayer(o.layer));
  d.innerHTML=on.map(o=>`<div>${z<o.z?`<b>${esc(o.short)}:</b> zoom in closer to see them.`:esc(o.note)}</div>`).join('');d.hidden=!on.length}
for(const [n,o] of Object.entries(GROUND_LAYERS)){OVL[n]=o.layer;layCtl.addOverlay(o.layer,n);if(lay.on.includes(n))o.layer.addTo(map)}
map.on('overlayadd overlayremove zoomend',gLegend);gLegend();
