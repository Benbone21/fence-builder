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
  let est={};try{est=await (await fetchT('api/off/estimate?bbox='+bbox.join(','),{},15000)).json()}catch(e){}
  const mb=z=>est[z]?Math.max(1,Math.round(est[z]*0.02+kmOf(b)*4)):null,too=z=>est[z]>60000;
  const lvl=(z,name)=>opt(String(z),`${name}${mb(z)?`, about ${fmtQ(mb(z))} MB`:''}${too(z)?' (too big)':''}`,est[19]&&!too(19)?'19':est[18]&&!too(18)?'18':'17');
  const v=await formDlg('Save this area for offline',`<p style="margin:0">${fmtQ(Math.round(acresOf(kmOf(b))))} acres. Fence Builder downloads the USGS aerial photo, the LiDAR bare-earth map and the LiDAR ground heights for it, so the map, slope footage and 3D view work here with no internet.</p>
    <label class="f">Name</label><input type="text" name="name" value="${esc(P()?.name||'Saved area')}">
    <label class="f">Detail</label><select name="maxz">${lvl(19,'Sharpest, zoom in all the way')}${lvl(18,'Sharp')}${lvl(17,'Less detail, smaller download')}</select>
    <p class="small mut">It downloads in the background. You can keep working, and see how it's going in Settings → Offline maps.</p>`,'Download');
  offRect.remove();setMode('idle');
  if(!v)return;
  try{const r=await fetchT('api/off/areas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:v.name,bbox,maxz:+v.maxz})},20000);const j=await r.json();if(!r.ok)throw Error(j.error||'');toast('Saving "'+j.area.name+'" for offline…');loadOffAreas()}
  catch(e){toast(e.message||'Could not start the download. Is Fence Builder running?')}
}
async function loadOffAreas(){
  if(!serverOK)return;
  try{offList=(await (await fetchT('api/off/areas',{cache:'no-store'},10000)).json()).areas||[]}catch(e){return}
  offAreas.clearLayers();
  for(const a of offList){const [w,s2,e,n]=a.bbox;L.rectangle([[s2,w],[n,e]],{color:'#ffd21f',weight:1.5,dashArray:'4 6',fill:false,interactive:false}).bindTooltip(a.name,{permanent:false}).addTo(offAreas)}
  const busy=offList.filter(a=>a.status==='downloading');
  const bar=$('#offbar');
  if(busy.length){const d=busy.reduce((x,a)=>x+a.done,0),t=busy.reduce((x,a)=>x+a.total,0);bar.hidden=false;bar.innerHTML=`Saving for offline: <b>${esc(busy[0].name)}</b>${busy.length>1?` and ${busy.length-1} more`:''} · ${t?Math.floor(d/t*100):0}%`}else bar.hidden=true;
  clearTimeout(offPoll);if(busy.length)offPoll=setTimeout(loadOffAreas,2000);
  if(S?.tab==='settings')renderPanel();
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
  let j=null;
  try{const r=await fetch('api/geocode?q='+encodeURIComponent(q));if(!r.ok)throw 0;j=await r.json()}catch(e){
    try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q='+encodeURIComponent(q));j=await r.json()}catch(e2){}}
  if(!j||!j.length)return toast('No place found for that search');
  const b=j[0].boundingbox;if(b)map.fitBounds([[+b[0],+b[2]],[+b[1],+b[3]]],{maxZoom:18});else map.setView([+j[0].lat,+j[0].lon],17);
  if(searchPin)searchPin.remove();
  searchPin=L.circleMarker([+j[0].lat,+j[0].lon],{radius:7,color:'#fff',weight:2,fillColor:'#d93025',fillOpacity:1}).addTo(map).bindTooltip(esc(j[0].display_name||q),{direction:'top',offset:[0,-6]}).openTooltip();
};

