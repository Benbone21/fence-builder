/* ---------- elevation (USGS 3DEP LiDAR first, Open-Meteo outside the US) ---------- */
const USGS='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
// elevFail: line id + shape -> {n: failed tries, next: when to try again}. After 3 tries it waits for "Try again".
// elevRedo: lines whose older (v2) numbers this copy has already redone once
const elevBusy=new Set(),elevFail=new Map(),elevRedo=new Set(),ELEV_WAIT=[0,5000,20000];let elevT,elevDownT;
function scheduleElev(){clearTimeout(elevT);elevT=setTimeout(ensureElev,900)}
function ensureElev(){
  const now=Date.now();
  for(const l of P().lines){
    if(l.manual||l.pts.length<2)continue;
    const k=geomKey(l),id=l.id+k,f=elevFail.get(id),ev=evOf(l);
    if(elevBusy.has(l.id)||(f&&(f.n>=3||now<f.next)))continue;
    // done, unless they are older numbers, or Open-Meteo stood in because USGS was down (then ask USGS
    // again a minute later, once)
    if(ev&&(elevRedo.has(id)||(ev.v>=EV&&!ev.down)))continue;
    if(ev&&ev.down&&now-(ev.at||0)<60000){clearTimeout(elevDownT);elevDownT=setTimeout(ensureElev,61000-(now-(ev.at||0)));continue}
    if(ev)elevRedo.add(id);
    elevBusy.add(l.id);
    fetchElev(l,k).then(()=>elevFail.delete(id),e=>{
      console.warn('elevation',e);const n=(f?.n||0)+1;elevFail.set(id,{n,next:Date.now()+(ELEV_WAIT[n]||0)});
      if(n<3)setTimeout(ensureElev,ELEV_WAIT[n]+50);renderPanel()})
    .finally(()=>{elevBusy.delete(l.id);if(geomKey(l)!==k)scheduleElev()});   // the line moved while loading: load the new shape
  }
}
// what the elevation for a line is doing right now: 'busy' (loading or about to), 'retry' (failed, trying again soon), 'fail'
function elevState(l){if(elevBusy.has(l.id))return 'busy';const f=elevFail.get(l.id+geomKey(l));return !f?'busy':f.n>=3?'fail':'retry'}
function fetchT(url,opt={},ms=25000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return fetch(url,{...opt,signal:c.signal}).finally(()=>clearTimeout(t))}
// a believable height in meters (USGS sends -9999 or huge numbers for "no data")
const okZ=v=>v!=null&&v!==''&&isFinite(v)&&+v>-500&&+v<9000;
// moving average of v over +-h meters of distance D (both sorted by D); nulls are skipped
function movAvg(D,v,h){
  const n=v.length,out=new Array(n);let a=0,b=0,s=0,c=0;
  for(let i=0;i<n;i++){
    while(b<n&&D[b]-D[i]<=h){if(v[b]!=null){s+=v[b];c++}b++}
    while(D[i]-D[a]>h){if(v[a]!=null){s-=v[a];c--}a++}
    out[i]=c?s/c:v[i];
  }
  return out;
}
// straight-line in-between of (X,Y) at each x in xs (X sorted)
function interp(X,Y,xs){let j=0;return xs.map(x=>{while(j<X.length-2&&X[j+1]<x)j++;const x0=X[j],x1=X[Math.min(j+1,X.length-1)];if(x1===x0)return Y[j];const t=Math.max(0,Math.min(1,(x-x0)/(x1-x0)));return Y[j]+(Y[Math.min(j+1,Y.length-1)]-Y[j])*t})}
const DEM_SAVED_RES=1;
async function usgsSamples(pts){
  const z=new Array(pts.length).fill(null),res=new Array(pts.length).fill(null),srcs={};let ok=0;
  for(let i=0;i<pts.length;i+=1000){
    const ch=pts.slice(i,i+1000);
    const body=()=>new URLSearchParams({geometry:JSON.stringify({points:ch.map(p=>[+p.lng.toFixed(7),+p.lat.toFixed(7)]),spatialReference:{wkid:4326}}),
      geometryType:'esriGeometryMultipoint',returnFirstValueOnly:'true',interpolation:'RSP_BilinearInterpolation',outFields:'Name,AcquisitionDate',f:'json'});
    let j=null;
    for(let t=0;t<(navigator.onLine===false?0:2)&&!j;t++){try{const r=await fetchT(USGS+'/getSamples',{method:'POST',body:body()});const x=await r.json();if(Array.isArray(x.samples))j=x}catch(e){}}
    if(!j){   // USGS not answering (no internet?): the LiDAR saved for offline, if this spot is in a saved area
      try{const r=await fetchT('api/off/elev',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pts:ch.map(p=>[p.lat,p.lng])})},20000);const x=await r.json();
        if(Array.isArray(x.z)&&x.z.some(v=>v!=null)){ok++;x.z.forEach((v,k)=>{if(okZ(v)){z[i+k]=v;res[i+k]=DEM_SAVED_RES}});srcs['saved for offline']=srcs['saved for offline']||{res:DEM_SAVED_RES,year:null}}}catch(e){}
      continue;   // still nothing: its points stay empty and are filled in below
    }
    ok++;
    for(const sm of j.samples){
      const id=sm.locationId,v=parseFloat(sm.value);   // USGS 3DEP heights are in meters
      if(!(id>=0&&id<ch.length)||!okZ(v))continue;
      z[i+id]=v;res[i+id]=sm.resolution;
      const n=sm.attributes?.Name;if(n&&!srcs[n])srcs[n]={res:sm.resolution,year:sm.attributes.AcquisitionDate?new Date(sm.attributes.AcquisitionDate).getUTCFullYear():null}}
  }
  if(!ok)throw Error('usgs not answering');
  return {z,res,srcs};
}
async function meteoSamples(pts){
  const out=[];
  for(let i=0;i<pts.length;i+=100){
    const ch=pts.slice(i,i+100),qs='latitude='+ch.map(s=>s.lat.toFixed(6)).join(',')+'&longitude='+ch.map(s=>s.lng.toFixed(6)).join(',');
    let j;
    try{const r=await fetchT('https://api.open-meteo.com/v1/elevation?'+qs,{},15000);if(!r.ok)throw 0;j=await r.json()}
    catch(e){const r=await fetchT('api/elevation?'+qs,{},20000);j=await r.json()}
    if(!j||!Array.isArray(j.elevation)||j.elevation.length!==ch.length)throw Error('no elevation');
    out.push(...j.elevation);
  }
  return out;
}
// Open-Meteo is a 90 m grid rounded to whole meters, so asking every 2 m gives flat stretches with
// 1 m steps between them. Ask about every 30 m, smooth over the 90 m it really knows, and draw a
// smooth line through that back at every sample.
async function meteoProfile(samples){
  const n=samples.length,tot=samples[n-1].d,sp=Math.max(30,tot/400),idx=[0];
  for(let i=1;i<n;i++)if(i===n-1||samples[i].d-samples[idx[idx.length-1]].d>=sp)idx.push(i);
  const raw=(await meteoSamples(idx.map(i=>samples[i]))).map(v=>okZ(v)?+v:null);
  const D=idx.map(i=>samples[i].d),good=raw.map((v,i)=>v!=null?i:-1).filter(i=>i>=0);
  if(!good.length)throw Error('no elevation');
  const filled=interp(good.map(i=>D[i]),good.map(i=>raw[i]),D);
  return interp(D,movAvg(D,filled,45),samples.map(s=>s.d));
}
// throw out single odd readings (a tile seam, a bridge, a bad pixel): anything far off the middle of its neighbours
function despike(z){
  const n=z.length,bad=[];
  for(let i=0;i<n;i++){
    if(z[i]==null)continue;const w=[];
    for(let j=Math.max(0,i-5);j<=Math.min(n-1,i+5);j++)if(z[j]!=null)w.push(z[j]);
    if(w.length<5)continue;w.sort((a,b)=>a-b);const m=w[w.length>>1],dev=w.map(x=>Math.abs(x-m)).sort((a,b)=>a-b)[w.length>>1];
    if(Math.abs(z[i]-m)>Math.max(3,4.5*dev))bad.push(i);
  }
  for(const i of bad)z[i]=null;
  return bad.length;
}
async function getElevations(samples){
  const n=samples.length,D=samples.map(s=>s.d);let z=new Array(n).fill(null),res=[],srcs={};
  let down=false;try{const u=await usgsSamples(samples);z=u.z;res=u.res;srcs=u.srcs}catch(e){down=true}
  // a 0 in the middle of high ground is "no data", not sea level
  const vals=z.filter(v=>v!=null).sort((a,b)=>a-b),mid=vals[vals.length>>1];
  if(vals.length&&Math.abs(mid)>50)z=z.map(v=>v===0?null:v);
  despike(z);
  const have=z.filter(v=>v!=null).length;
  if(!have){const m=await meteoProfile(samples);return {z:m,res:90,lidar:false,down,src:'Open-Meteo 90 m, smoothed ('+(down?'USGS is not answering right now':'USGS has no data here')+')'}}
  // fill the holes: short ones straight across from the heights on each side, long ones from Open-Meteo
  // shifted to meet the USGS heights at both ends, so there is no step where the two sources meet
  let met,nMet=0,nLin=0;
  for(let a=0;a<n;a++){
    if(z[a]!=null)continue;let b=a;while(b+1<n&&z[b+1]==null)b++;
    const L=a>0?a-1:-1,R=b<n-1?b+1:-1,span=(R>=0?D[R]:D[b])-(L>=0?D[L]:D[a]);
    if(span>40&&met===undefined){try{met=await meteoProfile(samples)}catch(e){met=null}}
    for(let i=a;i<=b;i++){
      if(span>40&&met){
        const oL=L>=0?z[L]-met[L]:null,oR=R>=0?z[R]-met[R]:null,t=L>=0&&R>=0?(D[i]-D[L])/(D[R]-D[L]):0;
        z[i]=met[i]+(oL!=null&&oR!=null?oL+(oR-oL)*t:(oL??oR));nMet++;
      }else{
        z[i]=L>=0&&R>=0?z[L]+(z[R]-z[L])*(D[i]-D[L])/(D[R]-D[L]):L>=0?z[L]:z[R];nLin++;
      }
    }
    a=b;
  }
  const rs=res.filter((r,i)=>r!=null),best=rs.length?Math.min(...rs):null,worst=rs.length?Math.max(...rs):null;
  const names=Object.entries(srcs).map(([nm,o])=>nm+(o.year?' ('+o.year+')':'')).slice(0,3).join(', ');
  let src='USGS 3DEP '+(best===worst?resLabel(best):resLabel(best)+' to '+resLabel(worst))+(names?', survey '+names:'');
  const pct=x=>Math.max(1,Math.round(100*x/n));
  if(nMet)src+=`, with Open-Meteo 90 m for ${pct(nMet)}% of the line where USGS had no data`;
  else if(nLin>n*0.02)src+=`, ${pct(nLin)}% of points filled in from their neighbours`;
  return {z,res:worst??1,lidar:worst!=null&&worst<=3&&nMet<n*0.1,src};
}
function resLabel(r){return r==null?'':r<=1.5?'1 m LiDAR':r<=5?'3 m (1/9 arc-second)':r<=15?'10 m':'30 m'}
async function fetchElev(l,k){
  const pts=l.pts.map(p=>({lat:p.lat,lng:p.lng}));let total=0;
  for(let i=1;i<pts.length;i++)total+=ll(pts[i-1]).distanceTo(ll(pts[i]));
  const step=Math.max(2,total/2500),samples=[];let acc=0;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],d=ll(a).distanceTo(ll(b)),n=Math.max(1,Math.ceil(d/step));
    for(let j=i===1?0:1;j<=n;j++){const t=j/n;samples.push({lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t,d:acc+d*t})}
    acc+=d;
  }
  const E=await getElevations(samples),n=samples.length,D=samples.map(s=>s.d);
  if(geomKey(l)!==k)return;   // moved while loading: ensureElev loads the new shape
  const had=evOf(l);if(E.down&&had&&/^USGS/.test(had.src||''))return;   // USGS down: keep the USGS heights already here
  // smooth over a few meters (more for coarser data) so a bump or a noisy reading in the ground model
  // doesn't count as a hill, then measure every 5 m: the length along the ground is what the fence is
  // priced on, and measuring every 2 m would add the noise to it
  const hw=Math.max(3,Math.min(15,E.res||1)),zs=movAvg(D,E.z,hw);
  const g=[0];for(let i=1;i<n;i++)if(i===n-1||D[i]-D[g[g.length-1]]>=5)g.push(i);
  let surf=0,climb=0,drop=0,grade=0,mn=Infinity,mx=-Infinity;
  for(const v of zs){mn=Math.min(mn,v);mx=Math.max(mx,v)}
  for(let q=1;q<g.length;q++){const i=g[q],h=g[q-1],dz=zs[i]-zs[h];surf+=Math.hypot(D[i]-D[h],dz);if(dz>0)climb+=dz;else drop-=dz}
  // steepest grade over at least 10 m of fence (more on coarse data)
  const gw=Math.min(Math.max(10,2*hw),D[n-1]||1);
  for(let i=0,j=0;i<n;i++){while(j<n-1&&D[j]-D[i]<gw)j++;if(D[j]-D[i]<gw-0.01)break;grade=Math.max(grade,Math.abs(zs[j]-zs[i])/(D[j]-D[i]))}
  const every=Math.max(1,Math.ceil(n/600)),prof=[];
  for(let i=0;i<n;i+=every)prof.push([+(D[i]*FT).toFixed(1),+(zs[i]*FT).toFixed(1)]);
  if((n-1)%every)prof.push([+(D[n-1]*FT).toFixed(1),+(zs[n-1]*FT).toFixed(1)]);
  l.elev={v:EV,key:k,at:Date.now(),down:!!E.down,src:E.src,lidar:E.lidar,flat:acc*FT,surface:Math.max(surf,acc)*FT,min:mn*FT,max:mx*FT,climb:climb*FT,drop:drop*FT,grade:grade*100,prof};
  if(snapCur===S.cur)snapNow=snapState();save(true);renderAll();
}
function profileSvg(ev){
  const pr=ev.prof;if(!pr||pr.length<2)return'';
  const W=400,H=110,pd=4,d0=pr[pr.length-1][0]||1;let a=Infinity,b=-Infinity;for(const[,z]of pr){a=Math.min(a,z);b=Math.max(b,z)}
  // keep the chart from stretching a foot or two of rise into a cliff: at least 15 ft tall, and at most
  // about 30 times taller than true scale for the length of the line
  const zr=Math.max(b-a,15,d0/30),lo=a-(zr-(b-a))/2,x=d=>(pd+(W-2*pd)*d/d0).toFixed(1),y=z=>(H-pd-(H-2*pd)*(z-lo)/zr).toFixed(1);
  const pts=pr.map(([d,z])=>x(d)+','+y(z)).join(' ');
  return `<div class="prof"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation along the fence"><polygon class="pf" points="${x(0)},${H} ${pts} ${x(d0)},${H}"/><polyline class="pl" points="${pts}"/></svg><div class="pax"><span>Start</span><span>Elevation along the line, ${fmtFt(b-a)} of rise and fall</span><span>End</span></div></div>`;
}
// the elevation block for the selected line: the last good heights stay up while new ones load
function elevView(l){
  const ev=evOf(l),old=ev?null:evAny(l),st=ev?'':elevState(l),e=ev||old;
  const again=`<button class="btn sm" data-act="retryElev" data-id="${l.id}">Try again</button>`;
  const note=ev?'':st==='fail'?`<p class="err">Heights could not load for the line's new shape (the elevation service is not answering). The numbers above are from before the last change, and the price uses the flat map distance for now. ${again}</p>`
    :st==='retry'?`<p class="small mut">The elevation service did not answer, trying again in a moment… These numbers are from before the last change.</p>`
    :`<p class="small mut">Updating heights for the new shape… These numbers are from before the last change.</p>`;
  if(!e)return st==='fail'?`<p class="err">Elevation could not load: USGS and Open-Meteo are not answering right now. ${again}</p>`
    :st==='retry'?`<p class="small mut">The elevation service did not answer, trying again in a moment…</p>`:`<p class="small mut">Getting LiDAR elevation…</p>`;
  return `<div class="sum${old?' stale':''}" style="margin-top:12px"><div><span>Along the ground</span><b>${fmtFt(e.surface)}</b></div><div><span>Flat map distance</span><b>${fmtFt(e.flat)}</b></div>
    <div><span>Total climb</span><b>${fmtFt(e.climb)}</b></div><div><span>Steepest grade</span><b>${(+e.grade||0).toFixed(0)}%</b></div></div>${profileSvg(e)}${note}<p class="small ${e.lidar?'okc':'mut'}">Heights from ${esc(e.src)}</p>`;
}

/* ---------- 3D view ---------- */
// The 3D ground is one 400 x 400 grid, so it covers an area up to about 8.5 km (5.3 miles) square,
// the same limit as before. That fits fence that spreads up to about 6.6 km (4 miles) with room around it.
const MAX3D=6640;
const mi=m=>(m/1609.34).toFixed(m<16093?1:0)+' miles';
// the area to show for some fence points: their bounds plus room around them
function area3D(pts){
  if(!pts.length)return null;
  const b=L.latLngBounds(pts.map(ll)),c=b.getCenter();
  const w=L.latLng(c.lat,b.getWest()).distanceTo(L.latLng(c.lat,b.getEast())),h=L.latLng(b.getSouth(),c.lng).distanceTo(L.latLng(b.getNorth(),c.lng));
  const size=Math.max(w,h);
  return {size,bounds:c.toBounds(Math.max(300,size*1.25+200))};   // toBounds takes the full width of the square
}
async function open3D(lineId){
  if(mode!=='idle')cancelDraw();
  const drawn=P().lines.filter(l=>!l.manual&&l.pts.length),one=lineId?getLine(lineId):null;
  const view=map.getBounds(),inView=pts=>pts.filter(p=>view.contains(ll(p)));
  let a,msg='';
  if(one&&one.pts.length){
    a=area3D(one.pts);
    if(a.size>MAX3D){const v=area3D(inView(one.pts));
      if(v&&v.size<=MAX3D){a=v;msg=`This line runs ${mi(a.size)} across, so the 3D view shows the part in the map view`}
      else return toast(`This line spreads ${mi(area3D(one.pts).size)} across and the 3D view covers fence up to about 4 miles across. Zoom the map in on the part you want to see, then open 3D again.`)}
  }else if(drawn.length){
    a=area3D(drawn.flatMap(l=>l.pts));
    if(a.size>MAX3D){const all=a.size,v=area3D(inView(drawn.flatMap(l=>l.pts)));
      if(v&&v.size<=MAX3D){a=v;msg=`The fence in this job spreads ${mi(all)} across, so the 3D view shows the fence in the map view`}
      else return toast(`The fence in this job spreads ${mi(all)} across and the 3D view covers fence up to about 4 miles across. Click one line, or zoom the map in on one part, then open 3D again.`)}
  }else{
    const s=Math.max(view.getNorthWest().distanceTo(view.getNorthEast()),view.getNorthWest().distanceTo(view.getSouthWest()));
    if(s>MAX3D*1.3)return toast(`There is no fence in this job yet, and the map shows ${mi(s)} across. Zoom in to under about 5 miles across, then open 3D again.`);
    a={bounds:view};
  }
  if(msg)toast(msg);
  try{const m=await import('./view3d.js');m.open3D({layoutOf:id=>A.lines.find(r=>r.l.id===id)?.stretches,postRule,bounds:a.bounds,lines:P().lines,types:S.fenceTypes,nodes:A.nodes,key,focus:lineId,braces:S.braces.map(b=>({...b,shape:braceShape(b)})),materials:S.materials,edit:edit3D()})}
  catch(e){console.error(e);toast('3D view could not load')}
}
// building fence from inside the 3D view (Draw fence, Add brace, Add gate there). Each one changes the job the same way
// the map tools do (saved, Final bill recounted, map redrawn) and hands the 3D view the fresh lines to stand back up.
function edit3D(){
  const typeOfLine=l=>S.fenceTypes.find(x=>x.id===l.type)||S.fenceTypes[0];
  const fresh=()=>({lines:P().lines,nodes:A.nodes});
  const ed={
    fresh,
    drawColor:()=>(S.fenceTypes.find(x=>x.id===drawTypeId())||S.fenceTypes[0])?.color||'#ffffff',
    // a new line from the clicked points (the last one the same as the first makes a closed loop)
    addLine(pts){
      if(!pts||pts.length<2)return {error:'A fence needs at least two points'};
      const l={id:uid('l'),name:'Fence '+(P().lines.length+1),type:drawTypeId(),pts:pts.map(p=>({lat:p.lat,lng:p.lng,brace:null}))};
      P().lines.push(l);selLine=l.id;selNode=null;S.tab='build';changed();
      if(S.settings.autoCross!==false){const n0=l.pts.length;
        findCrossings(l.id,true).then(()=>{const l2=getLine(l.id);if(l2&&l2.pts.length!==n0)ed.onOutsideChange?.(`Added gates at roads and braces at rivers along ${l2.name}. Drag them on the map to move them.`)}).catch(e=>console.error(e))}
      return {...fresh(),id:l.id,msg:l.name+' added'};
    },
    // a brace on line lineId: at point i when at is null (shared corners get it too, like the map), else a new point put in before point i
    addBrace(lineId,i,at){
      const l=getLine(lineId);if(!l||!l.pts[i])return {error:'That fence line is not there any more'};
      const id=braceFor(typeOfLine(l));if(!id)return {error:'Make a brace on the Braces tab first'};
      if(!at){const k=key(l.pts[i]);for(const l2 of P().lines)for(const p2 of l2.pts)if(key(p2)===k)p2.brace=id}
      else l.pts.splice(i,0,{lat:at.lat,lng:at.lng,brace:id});
      selLine=l.id;selNode=null;S.tab='build';changed();
      return {...fresh(),msg:`${kitName(id)} added on ${l.name}`};
    },
    // a gate between spots a and b, both on the stretch from point i-1 to point i (the same three points as the map's two-click gate)
    addGate(lineId,i,a,b){
      const l=getLine(lineId);if(!l||i<1||i>=l.pts.length)return {error:'That fence line is not there any more'};
      const t=typeOfLine(l),qa=L.latLng(a.lat,a.lng),qb=L.latLng(b.lat,b.lng),w=Math.round(qa.distanceTo(qb)*FT);
      if(w<1)return {error:'Click the other side of the gap for the second gate post'};
      const A0=ll(l.pts[i-1]),[n,f]=A0.distanceTo(qa)<A0.distanceTo(qb)?[qa,qb]:[qb,qa];   // nearer the start of the stretch first
      l.pts.splice(i,0,{lat:n.lat,lng:n.lng,brace:'none'},{lat:(n.lat+f.lat)/2,lng:(n.lng+f.lng)/2,brace:'gate',gw:w,gm:t.gateM},{lat:f.lat,lng:f.lng,brace:'none'});
      selLine=l.id;selNode=null;S.tab='build';changed();
      return {...fresh(),msg:`${w} ft gate added on ${l.name}`};
    }
  };
  return ed;
}
$('#b3d').onclick=()=>open3D(selLine);

