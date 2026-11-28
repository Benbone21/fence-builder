/* ---------- map ---------- */
let view=null;try{view=JSON.parse(localStorage.getItem('fence-view'))}catch(e){}
const map=L.map('map',{zoomControl:false,maxZoom:21}).setView(view?.c||[44.2,-114.6],view?.z||7);
L.control.zoom({position:'bottomright'}).addTo(map);
L.control.scale({position:'bottomleft',imperial:true,metric:false}).addTo(map);
const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:19,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics'});
const topo=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:21,maxNativeZoom:17,subdomains:'abc',attribution:'&copy; OpenTopoMap (CC-BY-SA), &copy; OpenStreetMap'});
const streets=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:21,maxNativeZoom:19,attribution:'&copy; OpenStreetMap contributors'});
const labels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:19,zIndex:20,attribution:'Labels &copy; Esri'});
const roads=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:19,zIndex:15});
/* USGS 3DEP LiDAR layers, drawn live by USGS for whatever area is on screen */
const R3857=20037508.342789244;
const Usgs=L.TileLayer.extend({getTileUrl(c){const n=2**c.z,sz=2*R3857/n,x0=-R3857+c.x*sz,y1=R3857-c.y*sz;
  return USGS+'/exportImage?bbox='+[x0,y1-sz,x0+sz,y1].map(v=>v.toFixed(2)).join(',')+'&bboxSR=3857&imageSR=3857&size=256,256&format=png32&interpolation=RSP_BilinearInterpolation&renderingRule='+encodeURIComponent(JSON.stringify({rasterFunction:this.options.fn}))+'&f=image'}});
const usgs=(fn,o)=>new Usgs('',{fn,maxZoom:21,attribution:'Elevation: USGS 3DEP',...o});
// saved for working offline: these come through Fence Builder, which answers from the saved copy first (USGS, public domain)
const aerial=L.tileLayer('api/off/tile/naip/{z}/{x}/{y}',{maxZoom:21,maxNativeZoom:19,attribution:'Aerial photo: USGS NAIP'});
const hillBase=L.tileLayer('api/off/tile/hill/{z}/{x}/{y}',{maxZoom:21,maxNativeZoom:18,attribution:'Elevation: USGS 3DEP'});
const offAreas=L.layerGroup();
/* ---------- property lines: county parcel maps, approximate, for reference only ----------
   Each county's own public map (only the parcel number and acres are asked for, never owner names). Where no
   county map answers, Regrid's free nationwide lines show instead (a picture only, online only).
   owner: the map's owner field, asked only by "Fence this owner's land" to tell which parcels share an owner
   (ownerTile below); it is never shown or kept. Canyon and Ada list no owners (the state layer has none for Ada). */
const PARCEL_SOURCES=[
  {name:'Gem County',url:'https://services7.arcgis.com/IG8lUXQpcTiHlZLc/arcgis/rest/services/Parcels_Public_view/FeatureServer/0',id:'PIN',owner:'OwnerName1'},
  {name:'Canyon County',url:'https://maps.canyoncounty.id.gov/arcgisserver/rest/services/General/Canyon_County_Public_Tax_Parcels/FeatureServer/0',id:'PIN',acres:'ACRES'},
  {name:'Valley County',url:'https://services6.arcgis.com/ikurHvtarxfN6u3u/arcgis/rest/services/Valley_County_Parcels_Open_Data/FeatureServer/0',id:'PARCELNO',acres:'LegalAc',owner:'OwnerName1'},
  {name:'Ada County Assessor',url:'https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services/Parcels/FeatureServer/5',id:'PARCEL',acres:'ACRES'},
  {name:'State of Idaho',url:'https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7',id:'PARCEL_ID',acres:'ASR_ACRES',county:'County',owner:'OWNER1'}];
const parcelLines=L.layerGroup(),parcels=L.layerGroup([parcelLines]);
const regrid=L.tileLayer('https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}',{minZoom:15,maxNativeZoom:17,maxZoom:22,attribution:'Parcels &copy; Regrid'});
const Plss=L.TileLayer.extend({getTileUrl(c){const n=2**c.z,sz=2*R3857/n,x0=-R3857+c.x*sz,y1=R3857-c.y*sz;
  return 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/export?bbox='+[x0,y1-sz,x0+sz,y1].map(v=>v.toFixed(2)).join(',')+'&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:1,2,3&f=image'}});
const plss=new Plss('',{minZoom:11,maxZoom:22,opacity:.85,attribution:'Sections: BLM'});
let parcelFeats=[],parcelSeen=new Set(),parcelTiles=new Map(),parcelT=0,parcelNote=false;
// one parcel outline (a county can draw one parcel number as several separate outlines, so the outline counts too)
const parcelKey=ft=>{const g=JSON.stringify(ft.geometry);return ft.properties.county+'|'+ft.properties.pid+'|'+g.length+g.slice(30,90)};
const PARCEL_Z=15,tileOf=(lat,lng,z)=>{const n=2**z;return [Math.floor((lng+180)/360*n),Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*n)]};
const tileBox=(x,y,z)=>{const n=2**z,lng=v=>v/n*360-180,lat=v=>{const k=Math.PI-2*Math.PI*v/n;return 180/Math.PI*Math.atan(.5*(Math.exp(k)-Math.exp(-k)))};return [lng(x),lat(y+1),lng(x+1),lat(y)]};
// acres of a parcel outline (when the county map doesn't say)
function ringAcres(g){const rings=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];let m2=0;
  for(const poly of rings)poly.forEach((r,ri)=>{const lat0=r[0][1]*Math.PI/180,kx=111320*Math.cos(lat0),ky=110574;let a=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];a+=(p[0]*kx)*(q[1]*ky)-(q[0]*kx)*(p[1]*ky)}m2+=(ri?-1:1)*Math.abs(a/2)});
  return m2/4046.86}
async function parcelTile(x,y){
  const [w,s2,e,n]=tileBox(x,y,PARCEL_Z),bb=[w,s2,e,n].map(v=>v.toFixed(6)).join(','),out=[];
  let online=false;
  await Promise.all(PARCEL_SOURCES.map(async src=>{
    const f=[src.id,src.acres,src.county].filter(Boolean).join(',');
    for(let off=0,pg=0;pg<10;pg++){
      const q=`where=1%3D1&geometry=${bb}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&outFields=${f}&returnGeometry=true&geometryPrecision=6&f=geojson&resultRecordCount=2000&resultOffset=${off}`;
      let j;try{const r=await fetchT(src.url+'/query?'+q,{},20000);if(!r.ok)return;j=await r.json();online=true}catch(e){return}
      for(const ft of j.features||[]){const pr=ft.properties||{};if(!ft.geometry)continue;
        out.push({type:'Feature',geometry:ft.geometry,properties:{pid:String(pr[src.id]??'').trim(),acres:src.acres&&typeof pr[src.acres]==='number'?pr[src.acres]:null,county:String(pr[src.county]??'').trim()||src.name.replace(' Assessor',''),src:src.name}})}
      if(!(j.exceededTransferLimit||j.properties?.exceededTransferLimit)||!(j.features||[]).length)break;off+=j.features.length}
  }));
  if(!online&&serverOK)try{const j=await (await fetchT('api/off/parcels?bbox='+bb,{},15000)).json();out.push(...(j.features||[]))}catch(e){}   // no internet: the lines saved with offline areas
  return out;
}
function drawParcels(){
  parcelLines.clearLayers();
  if(!parcelFeats.length)return;
  L.geoJSON({type:'FeatureCollection',features:parcelFeats},{style:{color:'#ff4fd8',weight:2,opacity:.95,fill:false},
    onEachFeature:(ft,l)=>{const p=ft.properties,ac=p.acres??ringAcres(ft.geometry);
      // while drawing, a click on a property line goes to the map (a fence point there); otherwise it shows the parcel
      const html=`<div class="small mut">Property line</div><b>Parcel ${esc(p.pid||'(no number)')}</b><div>${fmtQ(Math.round(ac*100)/100)} acres · ${esc(p.county||'')}</div><div class="small mut" style="margin-top:6px;max-width:240px">Approximate, from ${esc(p.src)} records. For reference only, not a survey. Check corners against a recorded survey before building on a property line.</div>`;
      l.on('click',e=>{if(mode!=='idle')return;L.DomEvent.stop(e);L.popup({maxWidth:280}).setLatLng(e.latlng).setContent(html).openOn(map)})}}).addTo(parcelLines);
}
async function loadParcels(){
  if(!map.hasLayer(parcels))return;
  if(map.getZoom()<PARCEL_Z){parcelLines.clearLayers();parcels.removeLayer(regrid);return}
  const b=map.getBounds(),[x0,y0]=tileOf(b.getNorth(),b.getWest(),PARCEL_Z),[x1,y1]=tileOf(b.getSouth(),b.getEast(),PARCEL_Z);
  if((x1-x0+1)*(y1-y0+1)>30)return;
  const want=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)if(!parcelTiles.has(x+'/'+y))want.push([x,y]);
  const res=await Promise.all(want.map(([x,y])=>parcelTile(x,y).then(f=>{parcelTiles.set(x+'/'+y,f.length);return f})));
  for(const f of res.flat()){const k=parcelKey(f);if(parcelSeen.has(k))continue;parcelSeen.add(k);parcelFeats.push(f)}
  if(want.length)drawParcels();
  // no county map here: Regrid's nationwide lines (online only)
  let any=false;for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)if(parcelTiles.get(x+'/'+y))any=true;
  if(!any&&navigator.onLine!==false){if(!parcels.hasLayer(regrid))parcels.addLayer(regrid)}else parcels.removeLayer(regrid);
}
map.on('moveend',()=>{clearTimeout(parcelT);parcelT=setTimeout(loadParcels,400)});
parcels.on('add',async()=>{
  if(!parcelNote){parcelNote=true;let seen=false;try{seen=localStorage.getItem('fence-parcel-note')==='1'}catch(e){}
    if(!seen){toast('Property lines are approximate, from county records. For reference only, not a survey.');try{localStorage.setItem('fence-parcel-note','1')}catch(e){}}}
  if(map.getZoom()<PARCEL_Z)toast('Zoom in closer to see property lines.');
  loadParcels()});
const hill=usgs('Hillshade Multidirectional',{opacity:.55}),cont2=usgs('Preset 2ft Contour Interval',{minZoom:15}),cont10=usgs('Preset 10ft Contour Interval',{minZoom:13}),slope=usgs('Slope Map',{opacity:.5});
const BASE={'Satellite':sat,'Aerial photo (USGS, works offline when saved)':aerial,'Streets (house numbers when zoomed in)':streets,'LiDAR bare earth (no trees or buildings, works offline when saved)':hillBase,'Topo with contour lines':topo};
const OVL={'Property lines (approximate, not a survey)':parcels,'Section lines (BLM survey)':plss,'Areas saved for offline':offAreas,'Roads and street names':roads,'State lines and place names':labels,'LiDAR shading over the photo':hill,'2 ft contour lines (zoomed in)':cont2,'10 ft contour lines':cont10,'Slope map':slope};
const layCtl=L.control.layers(BASE,OVL,{position:'topright'}).addTo(map);   // 68-ground.js adds the soil, water and tree layers
/* remember which layers are on; roads and state lines start on */
const lay={base:'Satellite',on:['Roads and street names','State lines and place names','Areas saved for offline']};
try{Object.assign(lay,JSON.parse(localStorage.getItem('fence-layers')))}catch(e){}
(BASE[lay.base]||sat).addTo(map);for(const n of lay.on)OVL[n]?.addTo(map);
const saveLay=()=>{try{localStorage.setItem('fence-layers',JSON.stringify(lay))}catch(e){}};
map.on('baselayerchange',e=>{if(!offSwitching){lay.base=e.name;saveLay()}});
/* ---------- no internet: the saved aerial photo takes over from the satellite photo, and back again ---------- */
let offSwitching=false,offShown=false,tileErrs=[];
function useOffline(on){
  if(on===offShown)return;offShown=on;
  const want=on?(lay.base.startsWith('LiDAR')?hillBase:aerial):(BASE[lay.base]||sat);
  offSwitching=true;for(const l of Object.values(BASE))if(l!==want&&map.hasLayer(l))map.removeLayer(l);if(!map.hasLayer(want))want.addTo(map);offSwitching=false;
  toast(on?'No internet: showing the map areas you saved for offline.':'Back online.');
}
addEventListener('offline',()=>useOffline(true));addEventListener('online',()=>useOffline(false));
if(navigator.onLine===false)setTimeout(()=>useOffline(true),500);
// lots of satellite tiles failing at once means the internet is down even if Windows hasn't noticed yet
sat.on('tileerror',async()=>{const now=Date.now();tileErrs=tileErrs.filter(t=>now-t<8000);tileErrs.push(now);
  if(tileErrs.length===8&&!offShown){try{await fetchT('https://server.arcgisonline.com/ArcGIS/rest/info?f=json',{mode:'no-cors',cache:'no-store'},5000)}catch(e){useOffline(true)}}});
sat.on('tileload',()=>{tileErrs=[]});
map.on('overlayadd overlayremove',()=>{lay.on=Object.keys(OVL).filter(n=>map.hasLayer(OVL[n]));saveLay()});

/* click the map (when not drawing) to see the nearest address */
let addrReq=0;
async function addressAt(latlng){
  const n=++addrReq,el=document.createElement('div');el.className='addr';el.textContent='Looking up the address…';
  L.popup({maxWidth:280}).setLatLng(latlng).setContent(el).openOn(map);
  const ll6=latlng.lat.toFixed(6)+', '+latlng.lng.toFixed(6);let txt=null;
  try{const r=await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location='+latlng.lng.toFixed(6)+','+latlng.lat.toFixed(6));const j=await r.json();txt=j.address?.LongLabel||j.address?.Match_addr||null}catch(e){}
  if(!txt)try{const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat='+latlng.lat.toFixed(6)+'&lon='+latlng.lng.toFixed(6));txt=(await r.json()).display_name||null}catch(e){}
  if(n!==addrReq)return;
  el.innerHTML=`<div class="small mut">Nearest address</div><b>${esc(txt||'None found here')}</b><div class="small mut" style="margin-top:4px">${ll6}</div><button class="btn sm" style="margin-top:6px">Copy</button>`;
  el.querySelector('button').onclick=()=>navigator.clipboard.writeText(txt?txt+'\n'+ll6:ll6).then(()=>toast('Copied'),()=>toast('Copy was blocked by the browser'));
}
let searchPin=null;
// pages: the builder page is the map with the setup sidebar; every other page is full width
const UI={get map(){return S?.tab==='build'},full:false};let mapSeen=false;
function applyUI(){
  const on=UI.map;if(document.body.classList.contains('pg-build')===on)return;
  document.body.classList.toggle('pg-build',on);
  if(on)setTimeout(()=>{map.invalidateSize();if(!mapSeen){mapSeen=true;fitProject()}},0);
}
function gotoTab(k){if(k!=='build'){selNode=null;if(mode!=='idle')cancelDraw();map.closePopup()}S.tab=k;renderAll()}
function setMap(on){gotoTab(on?'build':'est')}
function setFull(){}
const layer=L.layerGroup().addTo(map),draftLayer=L.layerGroup().addTo(map);
map.on('moveend',()=>{try{localStorage.setItem('fence-view',JSON.stringify({c:[map.getCenter().lat,map.getCenter().lng],z:map.getZoom()}))}catch(e){}});
const segLabel=(a,b,txt)=>L.marker([(a.lat+b.lat)/2,(a.lng+b.lng)/2],{interactive:false,keyboard:false,icon:L.divIcon({className:'seglab',iconSize:[0,0],html:'<span>'+txt+'</span>'})});
const pxLen=(a,b)=>map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));

