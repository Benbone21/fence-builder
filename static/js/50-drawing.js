/* ---------- drawing ---------- */
function snap(latlng){
  const p=map.latLngToContainerPoint(latlng);let best=null,bd=18;
  const cand=[...P().lines.flatMap(l=>l.pts),...(draft&&draft.pts.length>2?[draft.pts[0]]:[])];
  for(const q of cand){const d=map.latLngToContainerPoint(ll(q)).distanceTo(p);if(d<bd){bd=d;best=q}}
  if(best)return {lat:best.lat,lng:best.lng};
  // property lines on: snap to a property corner, or onto a property line
  if(map.hasLayer(parcels)&&parcelFeats.length){
    let corner=null,cd=14,edge=null,ed=9;const vb=map.getBounds().pad(0.1);
    for(const ft of parcelFeats){const g=ft.geometry,rings=g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
      for(const r of rings){if(!r.some(c=>vb.contains([c[1],c[0]])))continue;
        for(let i=0;i<r.length;i++){const a=map.latLngToContainerPoint([r[i][1],r[i][0]]),d=a.distanceTo(p);if(d<cd){cd=d;corner=[r[i][1],r[i][0]]}
          if(i){const b=map.latLngToContainerPoint([r[i-1][1],r[i-1][0]]),c=L.LineUtil.closestPointOnSegment(p,a,b),d2=c.distanceTo(p);if(d2<ed){ed=d2;edge=map.containerPointToLatLng(c)}}}}}
    if(corner)return {lat:corner[0],lng:corner[1]};
    if(edge)return {lat:edge.lat,lng:edge.lng};
  }
  return {lat:latlng.lat,lng:latlng.lng};
}
let offA=null,offList=[],offPoll=null;
const offRect=L.rectangle([[0,0],[0,0]],{color:'#ffd21f',weight:2,dashArray:'6 6',fillOpacity:.08,interactive:false});
let gateA=null;   // the first gate post clicked in gate mode, waiting for the other side
const gateMark=L.circleMarker([0,0],{radius:6,color:'#17191b',weight:2,fillColor:'#ffd21f',fillOpacity:1,interactive:false});
function setMode(m){
  mode=m;$('#map').classList.toggle('drawing',m!=='idle');gateA=null;gateMark.remove();
  $('#drawbar').hidden=m==='idle';$('#bUndo').hidden=$('#bFinish').hidden=m!=='draw';
  $('#bDraw').classList.toggle('on',m==='draw');$('#bGate').classList.toggle('on',m==='gate');$('#bBrace').classList.toggle('on',m==='brace');
  if(m==='draw')map.doubleClickZoom.disable();else map.doubleClickZoom.enable();
  if(m==='gate')$('#drawMsg').textContent='Click a fence line where the first gate post goes (one side of the road), then the other side';
  if(m==='brace')$('#drawMsg').textContent='Click a fence line or a point to put a brace there';
  if(m==='offsel')$('#drawMsg').textContent='Click one corner of the area to save, then the opposite corner. Press Cancel to stop.';
  if(m!=='offsel'){offA=null;offRect.remove()}$('#bOff').classList.toggle('on',m==='offsel');
  if(m!=='draw')rubber.remove(),rubberLab.remove();
  pickModeChanged(m);
  if(m!=='idle')map.closePopup();
  if(A){drawMap();if(S.tab==='build'&&!selLine)renderPanel()}
}
const draftType=()=>S.fenceTypes.find(x=>x.id===(draft?.appendTo?getLine(draft.appendTo)?.type:drawTypeId()))||S.fenceTypes[0];
const draftAll=()=>[...(draft.appendTo?getLine(draft.appendTo).pts.slice(-1):[]),...draft.pts];
function startDraw(appendTo){selNode=null;map.closePopup();draft={pts:[],appendTo:appendTo||null};if(appendTo)selLine=appendTo;setMode('draw');drawDraft();drawMap()}
function addDraftPoint(p){
  const prev=draftAll().slice(-1)[0];
  if(prev&&pxLen(ll(prev),ll(p))<4)return;
  draft.afterGate=false;
  if(draft.gate){
    // gate mode: the last point is one gate post, this click is the other. The gate sits between them.
    const a=draft.pts[draft.pts.length-1];if(!a){draft.gate=false;return toast('Click where the fence starts first, then press G')}
    const t=draftType(),w=Math.max(1,Math.round(ll(a).distanceTo(ll(p))*FT));
    a.brace='none';
    draft.pts.push({lat:(a.lat+p.lat)/2,lng:(a.lng+p.lng)/2,brace:'gate',gw:w,gm:t?.gateM},{lat:p.lat,lng:p.lng,brace:'none'});
    draft.gate=false;draft.afterGate=true;toast(`${w} ft gate. Back to drawing fence.`);return drawDraft();
  }
  draft.pts.push({lat:p.lat,lng:p.lng,brace:null});drawDraft();
}
// undo the last click while drawing; a gate comes off whole
function draftUndo(){
  const ps=draft.pts,b=ps.pop();draft.gate=draft.afterGate=false;
  if(b&&b.brace==='none'&&ps[ps.length-1]?.brace==='gate'){ps.pop();const a=ps[ps.length-1];if(a&&a.brace==='none')a.brace=null}
  drawDraft();
}
function draftGate(on){
  if(!draft.pts.length){draft.gate=false;toast('Click where the fence starts first, then press G for a gate');return drawDraft()}
  draft.gate=on;draft.afterGate=false;drawDraft();
}
function drawDraft(){
  draftLayer.clearLayers();if(mode!=='draw')return;
  const all=draftAll(),col=draftType()?.color||'#fff';
  if(all.length>1){
    L.polyline(all.map(ll),{color:'#000',weight:7,opacity:.35,interactive:false}).addTo(draftLayer);
    L.polyline(all.map(ll),{color:col,weight:4,opacity:1,interactive:false}).addTo(draftLayer);
    for(let i=1;i<all.length;i++){const a=ll(all[i-1]),b=ll(all[i]);if(pxLen(a,b)>=60)segLabel(a,b,fmtFt(a.distanceTo(b)*FT)).addTo(draftLayer)}
  }
  all.forEach((p,i)=>{if(p.brace==='gate'){const k=all[i-1],n=all[i+1];if(k&&n){L.polyline([ll(k),ll(n)],{color:'#000',weight:9,opacity:.5,interactive:false}).addTo(draftLayer);L.polyline([ll(k),ll(n)],{color:'#ffd21f',weight:5,dashArray:'6 6',interactive:false}).addTo(draftLayer);segLabel(ll(k),ll(n),'Gate '+fmtFt(+p.gw)).addTo(draftLayer)}return}
    L.circleMarker(ll(p),{radius:i===0&&all.length>2&&!draft.appendTo?7:5,color:'#17191b',weight:2,fillColor:p.brace==='none'?'#ffd21f':'#fff',fillOpacity:1,interactive:false}).addTo(draftLayer)});
  rubber.setStyle(draft.gate?{color:'#ffd21f',dashArray:'6 6'}:{color:col,dashArray:null});
  $('#bGate').classList.toggle('on',!!draft.gate);
  if(draft.gate){$('#drawMsg').textContent='Gate: click where the other gate post goes. Press F to go back to fence.';return}
  $('#drawMsg').textContent=all.length>1?fmtFt(flatLen(all))+' so far. Click to add corners. Press Finish line at the end.':all.length?'Click the next corner':'Click the map where the fence starts';
}
// the side you're about to place follows the mouse, with its length
const rubber=L.polyline([],{weight:3,opacity:.75,interactive:false});
const rubberLab=L.marker([0,0],{interactive:false,keyboard:false,icon:L.divIcon({className:'seglab',iconSize:[0,0],html:'<span></span>'})});
map.on('mousemove',e=>{
  if(mode==='gate'&&gateA){
    // stretch the gate along its fence line to the mouse
    const l=getLine(gateA.l);if(!l)return;const a=map.latLngToLayerPoint(ll(l.pts[gateA.i-1])),b=map.latLngToLayerPoint(ll(l.pts[gateA.i]));
    const q=map.layerPointToLatLng(L.LineUtil.closestPointOnSegment(map.latLngToLayerPoint(e.latlng),a,b));
    rubber.setStyle({color:'#ffd21f',dashArray:'6 6'}).setLatLngs([gateA.q,q]).addTo(map);
    rubberLab.setLatLng([(gateA.q.lat+q.lat)/2,(gateA.q.lng+q.lng)/2]).addTo(map);rubberLab.getElement().firstChild.textContent='Gate '+fmtFt(gateA.q.distanceTo(q)*FT);return;
  }
  if(mode!=='draw')return;const last=draftAll().slice(-1)[0];
  if(!last){rubber.remove();rubberLab.remove();return}
  const q=L.latLng(snap(e.latlng)),a=ll(last);
  rubber.setLatLngs([a,q]).addTo(map);
  rubberLab.setLatLng([(a.lat+q.lat)/2,(a.lng+q.lng)/2]).addTo(map);
  rubberLab.getElement().firstChild.textContent=(draft.gate?'Gate ':'')+fmtFt(a.distanceTo(q)*FT);
});
map.on('mouseout',()=>{rubber.remove();rubberLab.remove()});
function finishDraw(){
  if(mode!=='draw')return;
  if(draft.appendTo){const l=getLine(draft.appendTo);if(draft.pts.length){l.pts.push(...draft.pts)}selLine=l.id}
  else if(draft.pts.length>=2){
    const l={id:uid('l'),name:'Fence '+(P().lines.length+1),type:drawTypeId(),pts:draft.pts};
    P().lines.push(l);selLine=l.id;var picked=l.id;
  }else if(draft.pts.length)toast('A fence needs at least two points');
  const done=selLine;
  draft=null;setMode('idle');draftLayer.clearLayers();S.tab='build';changed();
  if(done&&crossOn())findCrossings(done,true);
}
function cancelDraw(){draft=null;setMode('idle');draftLayer.clearLayers();drawMap()}
