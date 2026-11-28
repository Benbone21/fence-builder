/* ---------- roads and rivers a fence line crosses (from OpenStreetMap) ----------
   A road gets a gate as wide as the road (at least the fence type's gate width). A river, creek or ditch gets a
   brace on each bank. They are ordinary points afterwards: drag them, change them or delete them. */
const ROAD_W={motorway:24,trunk:20,primary:14,secondary:12,tertiary:10,unclassified:8,residential:9,living_street:7,road:8,service:6,track:4};
const WATER_W={river:20,canal:10,stream:4,drain:3,ditch:2};
// OpenStreetMap's public servers are often busy: ask every mirror at once and take the first answer
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
function overpass(q){
  const ac=new AbortController();setTimeout(()=>ac.abort(),15000);
  return Promise.any(OVERPASS.map(async u=>{const r=await fetch(u,{method:'POST',body:'data='+encodeURIComponent(q),signal:ac.signal});if(!r.ok)throw Error(r.status);const j=await r.json();if(!Array.isArray(j.elements))throw Error('bad');return j.elements}))
    .then(x=>{ac.abort();return x}).catch(()=>null);
}
// In the US, the Census road map (TIGER) and USGS rivers and creeks (National Hydrography) as a backup,
// turned into the same shape as OpenStreetMap's answer
const TIGER_KIND={S1100:'primary',S1200:'secondary',S1400:'residential',S1500:'track',S1630:'primary',S1640:'service',S1740:'service'};
const NHD_KIND={460:'stream',336:'ditch',558:'river'};
async function usRoadsRivers(bb){
  const [s0,w0,n0,e0]=bb.split(',').map(Number),env=[w0,s0,e0,n0].join(',');
  const q=(base,fields)=>`${base}/query?geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=true&f=json`;
  const get=async u=>{const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),20000);try{const r=await fetch(u,{signal:ac.signal});if(!r.ok)throw Error(r.status);const j=await r.json();if(j.error)throw Error('bad');return j.features||[]}finally{clearTimeout(tm)}};
  const T='https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer';
  const res=await Promise.allSettled([...[2,6,8].map(n=>get(q(T+'/'+n,'NAME,MTFCC'))),get(q('https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6','gnis_name,ftype'))]);
  if(res.every(r=>r.status==='rejected'))return null;
  const out=[],seen=new Set();
  res.forEach((r,k)=>{if(r.status!=='fulfilled')return;for(const f of r.value){
    const at=f.attributes||{},tags={};
    if(k<3){const kind=TIGER_KIND[at.MTFCC];if(!kind)continue;tags.highway=kind;if(at.NAME)tags.name=at.NAME}
    else{const kind=NHD_KIND[at.ftype];if(!kind)continue;tags.waterway=kind;if(at.gnis_name)tags.name=at.gnis_name}
    for(const path of f.geometry?.paths||[]){const id=JSON.stringify(path[0])+JSON.stringify(path[path.length-1]);if(seen.has(id))continue;seen.add(id);out.push({tags,geometry:path.map(([x,y])=>({lat:y,lon:x}))})}
  }});
  return out;
}
async function findCrossings(lid,quiet){
  const l=getLine(lid);if(!l||l.pts.length<2)return;
  const lat0=l.pts[0].lat,lng0=l.pts[0].lng,mx=111320*Math.cos(lat0*Math.PI/180),my=110574;
  const xy=p=>[(p.lng-lng0)*mx,(p.lat-lat0)*my],back=([x,y])=>({lat:lat0+y/my,lng:lng0+x/mx});
  let s0=90,w0=180,n0=-90,e0=-180;for(const p of l.pts){s0=Math.min(s0,p.lat);n0=Math.max(n0,p.lat);w0=Math.min(w0,p.lng);e0=Math.max(e0,p.lng)}
  const pad=0.0005,bb=[s0-pad,w0-pad,n0+pad,e0+pad].map(v=>v.toFixed(6)).join(',');
  const q=`[out:json][timeout:25];(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|service|track)(_link)?$"](${bb});way["waterway"~"^(river|canal|stream|drain|ditch)$"](${bb}););out tags geom;`;
  if(!quiet)toast('Looking for roads and rivers along '+l.name+'…');
  let ways;
  const us=usRoadsRivers(bb);   // asked at the same time, used if OpenStreetMap doesn't answer
  const nhd=riverWays(l);   // USGS streams and ditches: the main source for braces at rivers (68-ground.js)
  ways=await overpass(q);
  if(!ways)ways=await us.catch(()=>null);
  ways=useRivers(ways,await nhd,quiet);
  if(!ways){if(!quiet)toast('The street map servers are busy, so roads and rivers could not be checked. Try "Find roads and rivers" again in a minute.');return}
  const L2=getLine(lid);if(!L2)return;   // deleted while we waited
  if(quiet&&!crossOn())return;   // the road and river switches were turned off while we waited
  const t=S.fenceTypes.find(x=>x.id===L2.type)||S.fenceTypes[0],P2=L2.pts.map(xy),hits=[];
  for(const w of ways){
    const tg=w.tags||{},road=tg.highway?.replace(/_link$/,''),water=tg.waterway;if(!w.geometry)continue;
    if(road&&tg.tunnel==='yes')continue;   // a road in a tunnel under the fence doesn't need a gate
    if(quiet&&!autoOn(road?'autoRoads':'autoRivers'))continue;   // that switch is off
    const G=w.geometry.map(g=>xy({lat:g.lat,lng:g.lon}));
    let width=parseFloat(tg.width)||0;   // meters, when the map says
    if(!width)width=road?(ROAD_W[road]||8):(WATER_W[water]||4);
    const name=tg.name||tg.ref||(road?(road==='track'?'farm track':road==='service'?'driveway':'road'):water);
    for(let i=1;i<P2.length;i++){const [ax,ay]=P2[i-1],[bx,by]=P2[i];
      for(let j=1;j<G.length;j++){const [cx,cy]=G[j-1],[dx,dy]=G[j];
        const den=(bx-ax)*(dy-cy)-(by-ay)*(dx-cx);if(Math.abs(den)<1e-9)continue;
        const u=((cx-ax)*(dy-cy)-(cy-ay)*(dx-cx))/den,v=((cx-ax)*(by-ay)-(cy-ay)*(bx-ax))/den;
        if(u<=0||u>=1||v<0||v>1)continue;
        const seg=Math.hypot(bx-ax,by-ay),ux=(bx-ax)/seg,uy=(by-ay)/seg,cross=Math.abs(ux*(dy-cy)-uy*(dx-cx))/Math.hypot(dx-cx,dy-cy)||1;
        hits.push({i,u,seg,kind:road?'road':'water',name,w:width/Math.max(0.3,cross),at:[ax+(bx-ax)*u,ay+(by-ay)*u],ux,uy});
      }}
  }
  // skip crossings already handled (a point or gate within a few meters of it)
  const near=(a,b,d)=>Math.hypot(a[0]-b[0],a[1]-b[1])<d;
  const fresh=hits.filter((h,k)=>!hits.slice(0,k).some(o=>near(o.at,h.at,3))&&!P2.some((p,i)=>near(p,h.at,Math.max(6,h.w/2+3))&&(L2.pts[i].auto||L2.pts[i].brace==='gate')));
  if(!fresh.length){if(!quiet)toast('No roads or rivers cross '+L2.name+' on the street map');return}
  fresh.sort((a,b)=>b.i-a.i||b.u-a.u);   // add from the far end back, so earlier spots keep their place
  const kit=braceFor(t),said=[];
  for(const h of fresh){
    const ins=[];
    if(h.kind==='road'){
      const gw=Math.max(+t.gateW||16,Math.ceil(h.w*FT/2)*2+4);   // road width in ft plus room, rounded up
      ins.push({...back(h.at),brace:'gate',gw,gm:t.gateM,auto:'road',autoName:h.name});said.push(`a ${gw} ft gate at ${h.name}`);
    }else{
      const off=Math.min(h.w/2+2,h.seg*h.u-0.5,h.seg*(1-h.u)-0.5);if(off<=0.5)continue;   // a couple of meters back from each bank
      for(const sg of [-1,1])ins.push({...back([h.at[0]+h.ux*off*sg,h.at[1]+h.uy*off*sg]),brace:kit||null,auto:'water',autoName:h.name});
      said.push(`braces on both banks of ${h.name}`);
    }
    L2.pts.splice(h.i,0,...ins);
  }
  if(!said.length)return;
  changed();toast('Added '+said.reverse().join(', ')+'. Drag them to where you want them.');
}
// the brace a fence type uses in the middle of a run (its pull brace), else its end brace
const braceFor=t=>[t?.bracePull,t?.braceEnd,S.braces[0]?.id].find(id=>id&&id!=='none'&&S.braces.some(b=>b.id===id));
function addOnLine(latlng){
  const kind=mode,pt=map.latLngToLayerPoint(latlng),typeOfLine=l=>S.fenceTypes.find(x=>x.id===l.type)||S.fenceTypes[0];
  const done=(l,i)=>{setMode('idle');selLine=l.id;selNode={l:l.id,i};S.tab='build';changed();openPointPopup(l.id,i)};
  if(kind==='brace')for(const l of P().lines)for(let i=0;i<l.pts.length;i++)if(map.latLngToLayerPoint(ll(l.pts[i])).distanceTo(pt)<14){
    // clicked an existing point: brace it (shared corners get it too)
    const id=braceFor(typeOfLine(l)),k=key(l.pts[i]);if(!id)return toast('Make a brace on the Braces tab first');
    for(const l2 of P().lines)for(const p2 of l2.pts)if(key(p2)===k)p2.brace=id;
    return done(l,i);
  }
  let best=null;
  for(const l of P().lines)for(let i=1;i<l.pts.length;i++){
    const a=map.latLngToLayerPoint(ll(l.pts[i-1])),b=map.latLngToLayerPoint(ll(l.pts[i]));
    const c=L.LineUtil.closestPointOnSegment(pt,a,b),d=c.distanceTo(pt);
    if(!best||d<best.d)best={d,l,i,c};
  }
  if(!best||best.d>30){toast('Click right on a fence line to place the '+(kind==='gate'?'gate':'brace'));return}
  const q=map.layerPointToLatLng(best.c),t=typeOfLine(best.l);
  if(kind==='gate'){
    // a gate takes two clicks: one gate post on each side (of a road, say), and the gate fills the gap between them
    if(!gateA){gateA={l:best.l.id,i:best.i,q};gateMark.setLatLng(q).addTo(map);histButtons();$('#drawMsg').textContent='Now click where the other gate post goes, across the gap. Press Cancel to stop.';return}
    const a=gateA;gateA=null;gateMark.remove();rubber.remove();rubberLab.remove();
    if(a.l!==best.l.id||a.i!==best.i){$('#drawMsg').textContent='Click a fence line where the first gate post goes';return toast('Put both gate posts on the same straight stretch of fence (between two corners). Click the first one again.')}
    const w=Math.round(a.q.distanceTo(q)*FT);
    if(w<1){$('#drawMsg').textContent='Click a fence line where the first gate post goes';return toast('Click the other side of the gap for the second gate post')}
    const A0=ll(best.l.pts[best.i-1]),[n,f]=A0.distanceTo(a.q)<A0.distanceTo(q)?[a.q,q]:[q,a.q];   // nearer the start of the stretch first
    best.l.pts.splice(best.i,0,{lat:n.lat,lng:n.lng,brace:'none'},{lat:(n.lat+f.lat)/2,lng:(n.lng+f.lng)/2,brace:'gate',gw:w,gm:t.gateM},{lat:f.lat,lng:f.lng,brace:'none'});
    toast(`${w} ft gate`);return done(best.l,best.i+1);
  }
  else{const id=braceFor(t);if(!id)return toast('Make a brace on the Braces tab first');best.l.pts.splice(best.i,0,{lat:q.lat,lng:q.lng,brace:id})}
  done(best.l,best.i);
}
function toggleMode(m){
  if(mode===m)return setMode('idle');
  if(mode==='draw')cancelDraw();
  if(!P().lines.some(l=>l.pts.length>1))return toast('Draw a fence on the map first');
  if(!UI.map)setMap(true);
  setMode(m);
}
map.on('click',e=>{
  if(mode==='offsel')return offClick(e.latlng);
  if(mode==='pick')return pickClick(e.latlng);
  if(mode==='draw')addDraftPoint(snap(e.latlng));
  else if(mode==='gate'||mode==='brace')addOnLine(e.latlng);
  else if(selLine){selLine=null;selNode=null;renderAll()}
  else map.closePopup();
});
map.on('dblclick',e=>{if(mode==='draw'){L.DomEvent.stop(e);finishDraw()}});
/* fence a whole property: the parcel under the spot, from the county map, as one closed fence line.
   County outlines have lots of tiny jogs, and every point of a fence line is a brace, so the outline is
   straightened first: only real corners are kept (bends of more than a few degrees, a foot or two off a straight line). */
function inRing(r,x,y){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
function parcelAt(ll2){
  for(const ft of parcelFeats){const g=ft.geometry,polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const poly of polys)if(poly[0]&&inRing(poly[0],ll2.lng,ll2.lat)&&!poly.slice(1).some(h=>inRing(h,ll2.lng,ll2.lat)))return {ft,ring:poly[0]}}
  return null}
function straighten(ring,tolM=0.6){
  const lat0=ring[0][1]*Math.PI/180,kx=111320*Math.cos(lat0),ky=110574,P2=ring.map(([x,y])=>[x*kx,y*ky]);
  let pts=P2.slice();if(pts.length>1){const a=pts[0],b=pts[pts.length-1];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6)pts.pop()}
  if(pts.length<3)return null;
  // start at the sharpest corner so the loop's join is a real corner too
  const turn=i=>{const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];const u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];return Math.abs(Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1]))};
  let best=0;for(let i=1;i<pts.length;i++)if(turn(i)>turn(best))best=i;
  pts=[...pts.slice(best),...pts.slice(0,best),pts[best]];
  const dp=(a,b)=>{let mi=-1,md=0;const A=pts[a],B=pts[b],L=Math.hypot(B[0]-A[0],B[1]-A[1])||1;
    for(let i=a+1;i<b;i++){const d=Math.abs((B[0]-A[0])*(A[1]-pts[i][1])-(A[0]-pts[i][0])*(B[1]-A[1]))/L;if(d>md){md=d;mi=i}}
    return md>tolM?[...dp(a,mi),...dp(mi,b).slice(1)]:[a,b]};
  // a loop starts and ends at the same point, so split it at the point farthest from the start and straighten each half
  const n=pts.length-1;let far=1,fd=0;for(let i=1;i<n;i++){const d=Math.hypot(pts[i][0]-pts[0][0],pts[i][1]-pts[0][1]);if(d>fd){fd=d;far=i}}
  const keep=[...dp(0,far),...dp(far,n).slice(1)];
  return keep.map(i=>({lat:pts[i][1]/ky,lng:pts[i][0]/kx}));
}
async function fenceProperty(ll2){
  if(map.getZoom()<PARCEL_Z)map.setView(ll2,PARCEL_Z);
  if(!map.hasLayer(parcels))parcels.addTo(map);
  let hit=parcelAt(ll2);
  if(!hit){toast('Looking up the property lines here…');const [x,y]=tileOf(ll2.lat,ll2.lng,PARCEL_Z),f=await parcelTile(x,y);parcelTiles.set(x+'/'+y,f.length);
    for(const ft of f){const k=parcelKey(ft);if(!parcelSeen.has(k)){parcelSeen.add(k);parcelFeats.push(ft)}}drawParcels();hit=parcelAt(ll2)}
  if(!hit)return toast('No property lines found at that spot. Property lines come from county maps; some areas have none.');
  const pts=straighten(hit.ring);if(!pts||pts.length<4)return toast('That property outline is too small to fence.');
  const p=hit.ft.properties,l={id:uid('l'),name:'Property '+(p.pid||''),type:drawTypeId(),pts:pts.map(q=>({lat:q.lat,lng:q.lng,brace:null}))};
  l.name=l.name.trim();P().lines.push(l);selLine=l.id;S.tab='build';changed();
  map.fitBounds(L.latLngBounds(pts.map(q=>[q.lat,q.lng])),{padding:[40,40]});
  toast(`Fenced the property line: ${pts.length-1} corners. Property lines are approximate, so check the corners.`);
  if(crossOn())findCrossings(l.id,true);
}
/* fence several parcels as one loop: an owner's whole land (a ranch split into tax lots), or parcels picked by hand.
   The outlines are merged: corners closer than half a meter become one, a corner of one parcel lying on (or within
   1.5 m of) a neighbour's side becomes a corner of that side too, so shared sides match point for point even where
   the county drew them a little apart; sides two parcels share cancel out, and what's left is stitched into loops.
   Only outer loops are fenced (holes, slivers and gaps inside are dropped). */
const polysOf=g=>g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
function mergeOutlines(parts,snapM=0.5,joinM=1.5){
  const r0=parts.find(p=>p[0]?.length)?.[0];if(!r0)return {rings:[],comp:[]};
  const lat0=r0[0][1]*Math.PI/180,kx=111320*Math.cos(lat0),ky=110574,ox=r0[0][0],oy=r0[0][1];
  const X=[],Y=[],NP=[],NC=[],grid=new Map();
  // a corner joins one within snapM, or within joinM when that one is another parcel's (sliver gaps and overlaps)
  const node=(x,y,pi)=>{const cx=Math.floor(x/snapM),cy=Math.floor(y/snapM),R=Math.ceil(joinM/snapM);let best=-1,bd=joinM;
    for(let i=-R;i<=R;i++)for(let j=-R;j<=R;j++)for(const k of grid.get((cx+i)+','+(cy+j))||[]){const d=Math.hypot(X[k]-x,Y[k]-y);if(d<bd&&(d<snapM||NC[k]!==pi)){bd=d;best=k}}
    if(best<0){best=X.length;X.push(x);Y.push(y);NP.push(new Set());NC.push(pi);const key=cx+','+cy;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(best)}
    NP[best].add(pi);return best};
  const rings=[];
  parts.forEach((poly,pi)=>poly.forEach((r,ri)=>{
    const pts=r.map(([x,y])=>[(x-ox)*kx,(y-oy)*ky]);let a=0;
    while(pts.length>1&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<1e-6)pts.pop();   // the closing point
    for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1]}
    if(!a)return;if((a>0)!==(ri===0))pts.reverse();   // outer loops counterclockwise, holes clockwise
    const ids=[];for(const [x,y] of pts){const k=node(x,y,pi);if(ids[ids.length-1]!==k)ids.push(k)}
    while(ids.length>1&&ids[0]===ids[ids.length-1])ids.pop();
    if(ids.length>=3)rings.push({pi,ids,pts,outer:ri===0})}));
  // corners lying on a neighbour's side join that side (nodes sorted by x, so each side looks only at nearby ones)
  const N=X.length,byX=[...Array(N).keys()].sort((p,q)=>X[p]-X[q]),xs=byX.map(k=>X[k]);
  const lo=v=>{let a=0,b=N;while(a<b){const m=(a+b)>>1;if(xs[m]<v)a=m+1;else b=m}return a};
  for(const rg of rings){const ids=rg.ids,mine=new Set(ids),out=[];
    for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length];out.push(a);
      const ax=X[a],ay=Y[a],dx=X[b]-ax,dy=Y[b]-ay,L2=dx*dx+dy*dy;if(L2<1e-6)continue;const L=Math.sqrt(L2);
      const y0=Math.min(ay,Y[b])-joinM,y1=Math.max(ay,Y[b])+joinM,x1=Math.max(ax,X[b])+joinM,ins=[];
      for(let s=lo(Math.min(ax,X[b])-joinM);s<N&&xs[s]<=x1;s++){const k=byX[s];
        if(mine.has(k)||Y[k]<y0||Y[k]>y1||(NP[k].size===1&&NP[k].has(rg.pi)))continue;
        const t=((X[k]-ax)*dx+(Y[k]-ay)*dy)/L2;if(t*L<snapM||(1-t)*L<snapM)continue;
        if(Math.abs((X[k]-ax)*dy-(Y[k]-ay)*dx)/L>joinM)continue;ins.push([t,k])}
      ins.sort((p,q)=>p[0]-q[0]);for(const [,k] of ins){if(out[out.length-1]!==k)out.push(k);mine.add(k);NP[k].add(rg.pi)}}
    rg.ids=out}
  // sides of overlapping parcels that cross get a shared corner where they cross
  const E=[];rings.forEach((rg,r)=>rg.ids.forEach((a,i)=>{const b=rg.ids[(i+1)%rg.ids.length];E.push({r,i,a,b,x0:Math.min(X[a],X[b]),x1:Math.max(X[a],X[b]),y0:Math.min(Y[a],Y[b]),y1:Math.max(Y[a],Y[b])})}));
  E.sort((p,q)=>p.x0-q.x0);const cuts=new Map(),cutAt=(e,t,k)=>{const key=e.r+','+e.i;if(!cuts.has(key))cuts.set(key,[]);cuts.get(key).push([t,k]);NP[k].add(rings[e.r].pi)};
  for(let s=0;s<E.length;s++){const e=E[s];for(let u=s+1;u<E.length&&E[u].x0<=e.x1;u++){const f=E[u];
    if(f.y0>e.y1||f.y1<e.y0||rings[f.r].pi===rings[e.r].pi||e.a===f.a||e.a===f.b||e.b===f.a||e.b===f.b)continue;
    const ex=X[e.b]-X[e.a],ey=Y[e.b]-Y[e.a],fx=X[f.b]-X[f.a],fy=Y[f.b]-Y[f.a],den=ex*fy-ey*fx;if(Math.abs(den)<1e-9)continue;
    const gx=X[f.a]-X[e.a],gy=Y[f.a]-Y[e.a],t=(gx*fy-gy*fx)/den,v=(gx*ey-gy*ex)/den;if(t<=1e-6||t>=1-1e-6||v<=1e-6||v>=1-1e-6)continue;
    const x=X[e.a]+t*ex,y=Y[e.a]+t*ey;let k=-1;for(const c of [e.a,e.b,f.a,f.b])if(Math.hypot(X[c]-x,Y[c]-y)<snapM)k=c;
    if(k<0){k=X.length;X.push(x);Y.push(y);NP.push(new Set());NC.push(-1)}
    if(k!==e.a&&k!==e.b)cutAt(e,t,k);if(k!==f.a&&k!==f.b)cutAt(f,v,k)}}
  if(cuts.size)rings.forEach((rg,r)=>{const out=[];rg.ids.forEach((a,i)=>{if(out[out.length-1]!==a)out.push(a);const c=cuts.get(r+','+i);
      if(c){c.sort((p,q)=>p[0]-q[0]);for(const [,k] of c)if(out[out.length-1]!==k)out.push(k)}});
    while(out.length>1&&out[0]===out[out.length-1])out.pop();rg.ids=out});
  // parcels that share a corner are one piece of land
  const par=parts.map((_,i)=>i),find=i=>{while(par[i]!==i)i=par[i]=par[par[i]];return i};
  for(const s of NP){let f=null;for(const p of s){if(f===null)f=find(p);else{const g=find(p);if(g!==f)par[g]=f}}}
  // sides drawn both ways (shared by two parcels) cancel
  const net=new Map(),from=new Map();
  for(const {ids,pi} of rings)for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length];if(a===b)continue;const k=a<b?a+','+b:b+','+a;net.set(k,(net.get(k)||0)+(a<b?1:-1));if(!from.has(k))from.set(k,pi)}
  // a side with another parcel right outside it (overlapping parcels) is inside the land, not around it
  const PB=[],PR=[];for(const rg of rings){const b=PB[rg.pi]||(PB[rg.pi]=[1e12,1e12,-1e12,-1e12]);(PR[rg.pi]||(PR[rg.pi]=[])).push(rg);
    for(const [x,y] of rg.pts){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)}}
  const inPart=(q,x,y)=>{let c=false;for(const rg of PR[q]){const r=rg.pts;let h=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)h=!h}
    if(h){if(!rg.outer)return false;c=true}}return c};
  const covered=(a,b,pi)=>{const dx=X[b]-X[a],dy=Y[b]-Y[a],L=Math.hypot(dx,dy);if(!L)return false;const x=(X[a]+X[b])/2+dy/L*0.2,y=(Y[a]+Y[b])/2-dx/L*0.2;
    for(let q=0;q<PB.length;q++)if(q!==pi&&PB[q]&&x>=PB[q][0]&&x<=PB[q][2]&&y>=PB[q][1]&&y<=PB[q][3]&&inPart(q,x,y))return true;return false};
  const outE=new Map(),bal=new Map(),cov=[],add=(a,b)=>{if(!outE.has(a))outE.set(a,[]);outE.get(a).push(b);bal.set(a,(bal.get(a)||0)+1);bal.set(b,(bal.get(b)||0)-1)};
  for(const [k,v] of net){if(!v)continue;let [a,b]=k.split(',').map(Number);if(v<0)[a,b]=[b,a];if(covered(a,b,from.get(k)))cov.push([a,b]);else add(a,b)}
  // ...but never leave a loop open: a dropped side that would close a break goes back in
  for(let again=true;again;){again=false;for(let i=0;i<cov.length;i++){const [a,b]=cov[i];if(bal.get(a)<0&&bal.get(b)>0){add(a,b);cov.splice(i--,1);again=true}}}
  // stitch what's left into loops; where several sides leave one corner, take the sharpest left turn (keeps loops apart)
  const res=[];
  for(const [s0,list] of outE)while(list.length){
    let a=s0,b=list.pop();const ids=[a];
    for(let g=0;g<1e6;g++){if(b===s0)break;ids.push(b);const cand=outE.get(b);
      if(!cand?.length){   // a dead end (outlines that don't quite meet): carry on from the nearest loose end within 3 m
        let nb=-1,nd=3;if(Math.hypot(X[s0]-X[b],Y[s0]-Y[b])<nd){nb=s0;nd=Math.hypot(X[s0]-X[b],Y[s0]-Y[b])}
        for(const [n,l] of outE)if(l.length&&n!==b){const d=Math.hypot(X[n]-X[b],Y[n]-Y[b]);if(d<nd){nd=d;nb=n}}
        if(nb<0){ids.length=0;break}a=b;b=nb;continue}
      const dx=X[b]-X[a],dy=Y[b]-Y[a];let bi=0,bt=-9;
      cand.forEach((c,i)=>{const vx=X[c]-X[b],vy=Y[c]-Y[b],t=Math.atan2(dx*vy-dy*vx,dx*vx+dy*vy);if(t>bt){bt=t;bi=i}});
      a=b;b=cand.splice(bi,1)[0]}
    if(ids.length<3)continue;
    // drop needle spikes and slits (a corner whose two sides fold back within ~8 degrees): gaps between parcels that open to the outside
    let cl=ids.slice();for(let again=true;again&&cl.length>3;){again=false;
      for(let i=0;i<cl.length&&cl.length>3;i++){const p=cl[(i-1+cl.length)%cl.length],q=cl[i],r=cl[(i+1)%cl.length];
        const ux=X[p]-X[q],uy=Y[p]-Y[q],vx=X[r]-X[q],vy=Y[r]-Y[q],lu=Math.hypot(ux,uy),lv=Math.hypot(vx,vy);
        if(p===r||!lu||!lv||(ux*vx+uy*vy)/(lu*lv)>Math.cos(8*Math.PI/180)){cl.splice(i,1);again=true;i--}}}
    let ar=0;for(let i=0;i<cl.length;i++){const p=cl[i],q=cl[(i+1)%cl.length];ar+=X[p]*Y[q]-X[q]*Y[p]}ar/=2;
    if(ar<50)continue;   // holes (clockwise) and crumbs
    res.push({ids:cl,area:ar,comp:find(NP[cl[0]].values().next().value)})}
  // an outer loop inside another (a parcel in a hole of another) is already inside the fence
  const inside=(r,x,y)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=X[r[i]],yi=Y[r[i]],xj=X[r[j]],yj=Y[r[j]];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c};
  const keep=res.filter(r=>!res.some(o=>o!==r&&o.area>r.area&&r.ids.every(k=>o.ids.includes(k)||inside(o.ids,X[k],Y[k]))));
  return {comp:parts.map((_,i)=>find(i)),rings:keep.map(r=>({comp:r.comp,area:r.area,ll:[...r.ids,r.ids[0]].map(k=>[ox+X[k]/kx,oy+Y[k]/ky])}))}
}
// parcels -> separate pieces of land (parcels that touch), each with its merged outline(s), parcel count and acres
function piecesOf(feats){
  const parts=[],pf=[];feats.forEach((ft,fi)=>polysOf(ft.geometry).forEach(p=>{if(p[0]?.length>3){parts.push(p);pf.push(fi)}}));
  const m=mergeOutlines(parts),by=new Map();
  const get=r=>{if(!by.has(r))by.set(r,{rings:[],parts:[],pp:[],fi:new Set(),acres:0,box:[180,90,-180,-90]});return by.get(r)};
  parts.forEach((p,i)=>{const pc=get(m.comp[i]),ft=feats[pf[i]];pc.parts.push(p);pc.fi.add(pf[i]);
    const ac=polysOf(ft.geometry).length>1?ringAcres({type:'Polygon',coordinates:p}):(ft.properties.acres??ringAcres(ft.geometry));
    pc.acres+=ac;pc.pp.push([ft.properties.pid||'#'+pf[i],ac]);
    for(const [x,y] of p[0]){const b=pc.box;b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)}});
  for(const r of m.rings)get(r.comp).rings.push(r.ll);
  // a parcel drawn inside another (stacked, or in its hole) has no outline of its own: it goes with the land around it
  for(const [r,pc] of by)if(!pc.rings.length){const q=pc.parts[0][0],x=q.reduce((s,p)=>s+p[0],0)/q.length,y=q.reduce((s,p)=>s+p[1],0)/q.length;
    const o=[...by.values()].find(o=>o.rings.some(rr=>inRing(rr,x,y)));if(o){o.parts.push(...pc.parts);o.pp.push(...pc.pp.map(([id])=>[id,0]));pc.fi.forEach(i=>o.fi.add(i));by.delete(r)}}
  // parcels counted by parcel number (one number can come as several outlines)
  return [...by.values()].map(pc=>{const ids=[...new Set([...pc.fi].map(i=>feats[i].properties.pid||'#'+i))];
    return {rings:pc.rings,parts:pc.parts,pp:pc.pp,box:pc.box,acres:pc.acres,n:ids.length,pids:ids.filter(s=>s[0]!=='#')}})}
const pieceHas=(pc,ll2)=>pc.parts.some(p=>p[0]&&inRing(p[0],ll2.lng,ll2.lat)&&!p.slice(1).some(h=>inRing(h,ll2.lng,ll2.lat)));
// one closed, straightened fence line around each outline. Line names say parcels and acres only.
function fencePieces(pieces,what){
  const made=[],total=pieces.reduce((s,p)=>s+p.rings.length,0);let k=0;
  for(const pc of pieces){
    // land whose parcels touch only at a corner makes two loops: each loop names the parcels inside it
    const per=pc.rings.map(()=>({ids:new Set(),ac:0}));
    if(pc.rings.length>1)pc.parts.forEach((p,i)=>{const q=p[0],x=q.reduce((s,v)=>s+v[0],0)/q.length,y=q.reduce((s,v)=>s+v[1],0)/q.length,w=per[Math.max(0,pc.rings.findIndex(r=>inRing(r,x,y)))];w.ids.add(pc.pp[i][0]);w.ac+=pc.pp[i][1]});
    pc.rings.forEach((r,ri)=>{const pts=straighten(r);if(!pts||pts.length<4)return;k++;
    const n=pc.rings.length>1?per[ri].ids.size:pc.n,ac=pc.rings.length>1?per[ri].ac:pc.acres;
    const l={id:uid('l'),name:`${what}${total>1?' (piece '+k+')':''}: ${n} parcel${n===1?'':'s'}, ${acTxt(ac)}`,type:drawTypeId(),pts:pts.map(q=>({lat:q.lat,lng:q.lng,brace:null}))};
    P().lines.push(l);made.push(l)})}
  if(!made.length)return made;
  selLine=made[0].id;S.tab='build';changed();
  map.fitBounds(L.latLngBounds(made.flatMap(l=>l.pts.map(q=>[q.lat,q.lng]))),{padding:[40,40]});
  if(crossOn())(async()=>{for(const l of made)await findCrossings(l.id,true)})();
  return made}
const corners=made=>made.reduce((s,l)=>s+l.pts.length-1,0),acTxt=a=>{const v=a<10?Math.round(a*10)/10:Math.round(a);return fmtQ(v)+(v===1?' acre':' acres')};
/* "Fence this owner's land": the parcel under the spot, and the parcels around it with the same owner on the county map.
   It looks at the 3x3 map tiles around the spot (about 1.6 miles across) and keeps reaching out while the owner's land
   runs on, up to OWNER_TILE_CAP tiles and OWNER_PARCEL_CAP parcels. Parcels of the owner that don't touch the clicked
   piece (a field down the road) are asked about: each becomes its own closed line.
   Owner names: asked straight from the county (not the browser's cache, not Fence Builder's server), squeezed to a
   comparison key, and dropped as soon as the parcels are grouped. Never shown, saved, or put in the parcel layer. */
const OWNER_TILE_CAP=100,OWNER_PARCEL_CAP=300;
const ownKey=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function ownerTile(src,x,y){
  const [w,s2,e,n]=tileBox(x,y,PARCEL_Z),bb=[w,s2,e,n].map(v=>v.toFixed(6)).join(','),f=[src.id,src.acres,src.county,src.owner].filter(Boolean).join(','),out=[];
  for(let off=0,pg=0;pg<10;pg++){
    const q=`where=1%3D1&geometry=${bb}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&outFields=${f}&returnGeometry=true&geometryPrecision=6&f=geojson&resultRecordCount=1000&resultOffset=${off}`;
    const r=await fetchT(src.url+'/query?'+q,{cache:'no-store'},20000);if(!r.ok)throw Error('county map');const j=await r.json();if(j.error)throw Error('county map');
    for(const ft of j.features||[]){const pr=ft.properties||{};if(!ft.geometry)continue;
      out.push({type:'Feature',geometry:ft.geometry,properties:{pid:String(pr[src.id]??'').trim(),acres:src.acres&&typeof pr[src.acres]==='number'?pr[src.acres]:null,county:String(pr[src.county]??'').trim()||src.name.replace(' Assessor',''),src:src.name},own:ownKey(pr[src.owner])})}
    if(!(j.exceededTransferLimit||j.properties?.exceededTransferLimit)||!(j.features||[]).length)break;off+=j.features.length}
  return out}
async function fenceOwnerLand(ll2){
  const pickInstead=msg=>startPick(ll2,msg+' Click each parcel to fence together instead, then press Fence these.');
  if(navigator.onLine===false)return pickInstead('Telling which parcels share an owner needs the internet.');
  if(map.getZoom()<PARCEL_Z)map.setView(ll2,PARCEL_Z);
  if(!map.hasLayer(parcels))parcels.addTo(map);
  toast('Looking up the parcels around here…');
  const [cx,cy]=tileOf(ll2.lat,ll2.lng,PARCEL_Z),at=ft=>polysOf(ft.geometry).some(p=>p[0]&&inRing(p[0],ll2.lng,ll2.lat)&&!p.slice(1).some(h=>inRing(h,ll2.lng,ll2.lat)));
  // which county map answers here (a county's own map first), and the parcel under the spot
  const first=await Promise.all(PARCEL_SOURCES.filter(s=>s.owner).map(s=>ownerTile(s,cx,cy).then(f=>({s,f}),()=>null)));
  let src=null,hit=null,tiles=new Map();
  for(const a of first)if(a&&!hit){const h=a.f.find(at);if(h){src=a.s;hit=h;tiles.set(cx+'/'+cy,a.f)}}
  const own=hit?.own;
  const forget=()=>{for(const a of first)if(a)for(const ft of a.f)delete ft.own;for(const fs of tiles.values())for(const ft of fs)delete ft.own;tiles.clear()};
  if(!hit||!own){forget();
    if(!first.some(Boolean))return pickInstead('Couldn\'t reach the county map to tell which parcels share an owner.');
    if(!hit&&!(await parcelsHere(ll2)))return toast('No property lines found at that spot. Property lines come from county maps; some areas have none.');
    return pickInstead(hit?'The county map lists no owner for this parcel.':'This county\'s map doesn\'t list owners.')}
  // reach out tile by tile while the owner's land runs on
  let want=[],capped=false,failed=0,mine=[],pieces=[],main=null;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy)want.push([cx+dx,cy+dy]);
  for(;;){
    await Promise.all(want.map(([x,y])=>ownerTile(src,x,y).then(f=>tiles.set(x+'/'+y,f),()=>{tiles.set(x+'/'+y,[]);failed++})));
    const seen=new Set();mine=[];
    for(const fs of tiles.values())for(const ft of fs){if(ft.own!==own)continue;const k=parcelKey(ft);if(!seen.has(k)){seen.add(k);mine.push(ft)}}
    if(mine.length>OWNER_PARCEL_CAP){capped=true;mine=mine.slice(0,OWNER_PARCEL_CAP)}
    pieces=piecesOf(mine);main=pieces.find(pc=>pc.rings.length&&pieceHas(pc,ll2))||pieces.find(pc=>pc.rings.some(r=>inRing(r,ll2.lng,ll2.lat)))||pieces.find(pc=>pieceHas(pc,ll2));
    if(capped||!main)break;
    const pad=0.0002,[x0,y1]=tileOf(main.box[3]+pad,main.box[0]-pad,PARCEL_Z),[x1,y0]=tileOf(main.box[1]-pad,main.box[2]+pad,PARCEL_Z);
    want=[];for(let x=x0;x<=x1;x++)for(let y=y1;y<=y0;y++)if(!tiles.has(x+'/'+y))want.push([x,y]);
    if(!want.length)break;
    if(tiles.size+want.length>OWNER_TILE_CAP){capped=true;break}
  }
  forget();   // owner names gone: from here on only outlines, parcel numbers and acres
  if(!main?.rings.length)return toast('Couldn\'t make one outline from those parcels. Try "Pick several parcels to fence together".');
  let use=[main];const others=pieces.filter(pc=>pc!==main&&pc.rings.length);
  if(others.length){const n=others.reduce((s,p)=>s+p.n,0),ac=others.reduce((s,p)=>s+p.acres,0);
    if(await ask(`The same owner has ${others.length} more piece${others.length>1?'s':''} of land nearby that ${others.length>1?'don\'t':'doesn\'t'} touch this one (${n} parcel${n>1?'s':''}, ${acTxt(ac)}).\n\nFence ${others.length>1?'each of those':'it'} too, with its own closed line?`))use=use.concat(others)}
  const made=fencePieces(use,'Owner\'s land');
  if(!made.length)return toast('That land is too small to fence.');
  const pids=main.pids.length&&main.pids.length<=3?' ('+main.pids.join(', ')+')':'';
  toast(`Fenced the owner's land: ${main.n} parcel${main.n>1?'s':''}${pids}, ${acTxt(main.acres)}, ${made.length>1?made.length+' lines, ':''}${corners(made)} corners.${capped?' Their land reaches farther than Fence Builder looks (about 5 miles across), so parcels beyond that are left out: check the far side.':''}${failed?' Part of the county map didn\'t answer, so check the outline.':''} Property lines are approximate, so check the corners.`);
}
// the parcels under a spot, looking up its map tile if it isn't loaded yet
async function parcelsHere(ll2){
  let hit=parcelAt(ll2);if(hit)return hit;
  const [x,y]=tileOf(ll2.lat,ll2.lng,PARCEL_Z);if(parcelTiles.get(x+'/'+y))return null;
  toast('Looking up the property lines here…');const f=await parcelTile(x,y);parcelTiles.set(x+'/'+y,f.length);
  for(const ft of f){const k=parcelKey(ft);if(!parcelSeen.has(k)){parcelSeen.add(k);parcelFeats.push(ft)}}
  drawParcels();return parcelAt(ll2)}
/* "Pick several parcels to fence together": click parcels to add or take them out, then Fence these.
   Works anywhere there are property lines, offline too (the lines saved with offline areas); no owner names. */
var pickSel=null,pickLay=null,pickBtn=null;   // var: setMode runs before this part of the script has
function pickModeChanged(m){if(m==='pick'||!pickSel)return;pickSel.clear();pickLay.clearLayers();pickLay.remove();pickBtn.hidden=true}
async function startPick(ll2,msg){
  if(mode==='draw')cancelDraw();
  if(!pickSel){pickSel=new Map();pickLay=L.layerGroup();pickBtn=document.createElement('button');pickBtn.className='btn pri';pickBtn.id='bPickFence';pickBtn.textContent='Fence these';pickBtn.hidden=true;pickBtn.onclick=pickFence;$('#bCancel').before(pickBtn)}
  if(map.getZoom()<PARCEL_Z)map.setView(ll2||map.getCenter(),PARCEL_Z);
  if(!map.hasLayer(parcels))parcels.addTo(map);
  setMode('pick');pickLay.addTo(map);pickBtn.hidden=false;pickShow();
  if(ll2)await pickClick(ll2);
  if(msg)toast(msg)}
async function pickClick(ll2){
  const hit=await parcelsHere(ll2);if(mode!=='pick')return;
  if(!hit)return toast('No property line there. Click inside a parcel.');
  const k=parcelKey(hit.ft);if(pickSel.has(k))pickSel.delete(k);else pickSel.set(k,hit.ft);pickShow()}
function pickShow(){
  pickLay.clearLayers();let ac=0;
  for(const ft of pickSel.values()){ac+=ft.properties.acres??ringAcres(ft.geometry);L.geoJSON(ft,{interactive:false,style:{color:'#ffd21f',weight:3,opacity:1,fillColor:'#ffd21f',fillOpacity:.3}}).addTo(pickLay)}
  const n=pickSel.size;pickBtn.disabled=!n;
  $('#drawMsg').textContent=n?`${n} parcel${n>1?'s':''} picked, ${acTxt(ac)}. Click parcels to add or take them out.`:'Click each parcel to fence together. Click one again to take it out.'}
function pickFence(){
  const feats=[...pickSel.values()];if(!feats.length)return toast('Click the parcels to fence first.');
  const pieces=piecesOf(feats).filter(pc=>pc.rings.length),n=new Set(feats.map((f,i)=>f.properties.pid||'#'+i)).size,ac=pieces.reduce((s,p)=>s+p.acres,0);
  setMode('idle');
  const made=fencePieces(pieces,'Parcels');
  if(!made.length)return toast('Couldn\'t make an outline from those parcels.');
  toast(`Fenced ${n} parcel${n>1?'s':''}, ${acTxt(ac)}: ${made.length>1?made.length+' separate lines (the parcels don\'t all touch), ':''}${corners(made)} corners. Property lines are approximate, so check the corners.`)}
/* ---------- deleting: a point (corner, brace or gate) or one stretch of fence ---------- */
const isLoop=l=>l.pts.length>3&&key(l.pts[0])===key(l.pts[l.pts.length-1]);
// take a point out of a line; the fence runs straight from the point before to the point after
async function deletePoint(lid,i){
  const l=getLine(lid);if(!l||!l.pts[i])return;
  if(isLoop(l)&&(i===0||i===l.pts.length-1)){   // the start of a loop is also its end: take out both and close it again
    const ring=l.pts.slice(1,-1);if(ring.length<3)return deleteLine(lid);l.pts=[...ring,{...ring[0]}];
  }else if(l.pts.length<=2)return deleteLine(lid);
  else l.pts.splice(i,1);
  delete l.cust;selNode=null;changed();toast('Point deleted. The fence runs straight across now.');
}
async function deleteLine(lid){const l=getLine(lid);if(!l)return;
  if(!await ask(`That leaves less than two points. Delete "${l.name}"?`))return;
  P().lines=P().lines.filter(x=>x.id!==lid);if(selLine===lid)selLine=null;selNode=null;changed()}
// take out one stretch of fence, the side from point i-1 to point i. A loop opens up there; a plain line splits in two
function deleteStretch(lid,i){
  const l=getLine(lid);if(!l||i<1||i>=l.pts.length)return;
  delete l.cust;
  if(isLoop(l)){const ring=l.pts.slice(0,-1),n=ring.length;l.pts=[...ring.slice(i%n),...ring.slice(0,i%n)].map(p=>({...p}));}
  else{
    const a=l.pts.slice(0,i),b=l.pts.slice(i);
    if(a.length>=2&&b.length>=2){l.pts=a;P().lines.splice(P().lines.indexOf(l)+1,0,{...JSON.parse(JSON.stringify(l)),id:uid('l'),name:l.name+' (2)',pts:b})}
    else if(a.length>=2)l.pts=a;else if(b.length>=2)l.pts=b;
    else{P().lines=P().lines.filter(x=>x.id!==lid);if(selLine===lid)selLine=null}
  }
  selNode=null;changed();toast('That stretch of fence is gone. Undo puts it back.');
}
// what's under a right-click: a point (within a few pixels), else a stretch of fence
function nearFence(latlng){
  const pt=map.latLngToContainerPoint(latlng);let pnt=null,seg=null;
  for(const l of P().lines){if(l.manual)continue;
    l.pts.forEach((p,i)=>{const d=map.latLngToContainerPoint(ll(p)).distanceTo(pt);if(d<14&&(!pnt||d<pnt.d))pnt={d,l,i}});
    for(let i=1;i<l.pts.length;i++){const a=map.latLngToContainerPoint(ll(l.pts[i-1])),b=map.latLngToContainerPoint(ll(l.pts[i])),d=L.LineUtil.closestPointOnSegment(pt,a,b).distanceTo(pt);if(d<14&&(!seg||d<seg.d))seg={d,l,i}}}
  return {pnt,seg};
}
/* right-click the map: a menu of what to put there */
function nearLine(latlng,px=30){const pt=map.latLngToLayerPoint(latlng);let best=null;
  for(const l of P().lines)for(let i=1;i<l.pts.length;i++){const a=map.latLngToLayerPoint(ll(l.pts[i-1])),b=map.latLngToLayerPoint(ll(l.pts[i])),d=L.LineUtil.closestPointOnSegment(pt,a,b).distanceTo(pt);if(d<px&&(!best||d<best.d))best={d,l}}
  return best?.l||null}
map.on('contextmenu',e=>{
  L.DomEvent.preventDefault(e.originalEvent);
  if(mode==='draw'){addDraftPoint(snap(e.latlng));return}   // while drawing, a right-click places a point too
  if(mode==='pick'){pickClick(e.latlng);return}             // picking parcels: a right-click picks one too
  if(mode!=='idle')setMode('idle');
  const ll2=e.latlng,onLine=nearLine(ll2),el=document.createElement('div');el.className='ctxmenu';
  const item=(k,label,help)=>`<button class="btn${k.startsWith('del')?' delitem':''}" data-k="${k}"><b>${label}</b>${help?`<span>${help}</span>`:''}</button>`;
  // right on a point or a side of a fence: offer to delete it first
  const nf=nearFence(ll2),np=nf.pnt,ns=np?null:nf.seg;
  const npKind=np?(A.nodes.get(key(np.l.pts[np.i]))||{}):null,npWord=np?(npKind.brace==='gate'?'gate':npKind.brace==='none'?'point':npKind.role==='Corner'?'corner and its brace':'brace'):'';
  const nsLen=ns?fmtFt(ll(ns.l.pts[ns.i-1]).distanceTo(ll(ns.l.pts[ns.i]))*FT):'';
  el.innerHTML=`${np?item('delpt','Delete this '+npWord,esc(np.l.name)+': the fence runs straight across instead'):''}
    ${ns?item('delseg','Delete this stretch of fence',nsLen+' on '+esc(ns.l.name)+(isLoop(ns.l)?': the loop opens up here':': the line splits in two')):''}
    <div class="ctxhead">What goes here?</div>
    ${item('fence','Start a fence line here','Then click each corner')}
    ${onLine?item('gate','Gate here','Then click the other side of the gap'):''}
    ${onLine?item('brace','Brace here','On '+esc(onLine.name)):''}
    ${item('prop','Fence this property','Around its property lines')}
    ${item('own','Fence this owner\'s land','Their parcels that touch this one, as one fence')}
    ${item('pick','Pick several parcels to fence together','Click each one, then Fence these')}
    ${item('addr','Address of this spot','')}`;
  el.onclick=ev=>{const k=ev.target.closest('[data-k]')?.dataset.k;if(!k)return;map.closePopup();
    if(k==='delpt')deletePoint(np.l.id,np.i);
    else if(k==='delseg')deleteStretch(ns.l.id,ns.i);
    else if(k==='fence'){startDraw();addDraftPoint(snap(ll2))}
    else if(k==='gate'||k==='brace'){setMode(k);addOnLine(ll2)}
    else if(k==='prop')fenceProperty(ll2);
    else if(k==='own')fenceOwnerLand(ll2);
    else if(k==='pick')startPick(ll2);
    else if(k==='addr')addressAt(ll2)};
  L.popup({maxWidth:300,minWidth:240,className:'ctxpop'}).setLatLng(ll2).setContent(el).openOn(map);
});
