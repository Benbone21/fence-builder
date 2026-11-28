/* ---------- looking up the ground along a fence line, straight from this browser ----------
   This browser (or phone) asks the public federal maps itself, so the Fence Builder server does none of this work:
     - soil:      USDA NRCS soil survey (SSURGO), through Soil Data Access
     - streams:   USGS National Hydrography Dataset (NHD) streams, rivers, canals and ditches
     - flood:     FEMA National Flood Hazard Layer (NFHL) flood zones
     - wetlands:  US Fish and Wildlife Service National Wetlands Inventory (NWI)
     - cover:     LANDFIRE existing vegetation cover (trees, shrubs), USGS / US Forest Service
   Only the line's points go out, to these fixed addresses only, a couple of requests at a time, with short timeouts and
   a size limit on each answer. The answers are the same shape ground.py on the server used to give (soil "v: 2"), so
   saved jobs and the rest of the page don't change. Cutting the fence line by big flood and wetland outlines takes a
   short break every few milliseconds, so a phone stays smooth. groundLookup(topic, [[lat, lng], ...]) answers one topic,
   or fails with the words to show. */
const groundLookup=(()=>{
const SDA='https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',
  NHD='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query',
  NFHL='https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query',
  NWI='https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query',
  EVC='https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVC_CONUS/ImageServer/getSamples';
const FT=3.28084,MAX_LEN_M=40000,MAX_PTS=3000,TIMEOUT=30000,LIMIT=12e6,SLOTS=2;
const DEPTH_CM=102;   // "near the surface": the top 40 inches, where posts and brace holes go
const BRUSH_MIN=25;   // shrubs covering at least this % of the ground count as brush
const SOIL_V=2;       // answers without this (kept in a browser from before) are asked again
class Gerr extends Error{}   // a map didn't answer, or answered with something unusable
class Bad extends Error{}    // not a line that can be checked: these words are shown as they are
// rounding the way the server did it (Python: halves go to the even number)
const rnd=x=>Math.abs(x%1)===0.5?2*Math.round(x/2):Math.round(x);
const rnd1=x=>Number.isInteger(x*4)&&!Number.isInteger(x*2)?rnd(x*10)/10:+x.toFixed(1);
const fx=(v,n)=>+(+v).toFixed(n);
const ft=m=>rnd(m*FT);
// a short break now and then, so a phone keeps scrolling and drawing while big answers are worked through
let lastBreak=0;
const pause=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();r()};c.port2.postMessage(0)});
async function tick(){if(performance.now()-lastBreak>8){await pause();lastBreak=performance.now()}}
// a couple of outside requests at once, from this page together
let inUse=0;const waiting=[];
const slot=()=>inUse<SLOTS?(inUse++,Promise.resolve()):new Promise(r=>waiting.push(r));
const free=()=>{const n=waiting.shift();if(n)n();else inUse--};
async function ask(url,form,js){
  await slot();let txt;
  try{const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
    try{const r=await fetch(url,{method:'POST',body:js?JSON.stringify(js):new URLSearchParams(form),
        headers:{'Content-Type':js?'application/json':'application/x-www-form-urlencoded'},
        redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:c.signal});
      if(!r.ok)throw new Gerr('HTTP '+r.status);
      txt=await r.text()}
    finally{clearTimeout(t)}}
  catch(e){throw e instanceof Gerr?e:new Gerr(String(e?.message||e))}
  finally{free()}
  if(txt.length>LIMIT)throw new Gerr('answer too big');
  let j;try{j=JSON.parse(txt||'{}')}catch(e){throw new Gerr('not a map answer')}
  if(!j||typeof j!=='object'||Array.isArray(j)||j.error)throw new Gerr('the service said no');
  return j}
// ---------- the line, in meters on a flat local map ----------
function mkLine(pts){
  const lat0=pts[0][0],lng0=pts[0][1],mx=111320*Math.cos(lat0*(Math.PI/180)),my=110574;
  const toXY=(lat,lng)=>[(lng-lng0)*mx,(lat-lat0)*my],xy=pts.map(([a,b])=>toXY(a,b)),cum=[0];
  for(let i=1;i<xy.length;i++)cum.push(cum[i-1]+Math.hypot(xy[i][0]-xy[i-1][0],xy[i][1]-xy[i-1][1]));
  return {ll:pts,xy,cum,length:cum[cum.length-1],toXY,
    esri:()=>JSON.stringify({paths:[pts.map(([a,b])=>[fx(b,7),fx(a,7)])],spatialReference:{wkid:4326}}),
    wkt:()=>'LINESTRING('+pts.map(([a,b])=>b.toFixed(7)+' '+a.toFixed(7)).join(', ')+')',
    at(d){   // lat, lng at distance d meters along the line
      for(let i=1;i<cum.length;i++)if(cum[i]>=d||i===cum.length-1){const seg=cum[i]-cum[i-1]||1,t=Math.max(0,Math.min(1,(d-cum[i-1])/seg));
        const [a,b]=pts[i-1],[c,e]=pts[i];return [a+(c-a)*t,b+(e-b)*t]}
      return pts[0]}}}
function parseLine(pts){
  if(!Array.isArray(pts)||pts.length<2||pts.length>MAX_PTS)throw new Bad(`A fence line needs 2 to ${MAX_PTS} points`);
  const out=pts.map(p=>{const lat=+p?.[0],lng=+p?.[1];
    if(!(Number.isFinite(lat)&&Number.isFinite(lng)&&-85<lat&&lat<85&&-180<=lng&&lng<=180))throw new Bad('That point is not on the map');return [lat,lng]});
  const la=out.map(p=>p[0]),lo=out.map(p=>p[1]);
  if(Math.max(...la)-Math.min(...la)>0.5||Math.max(...lo)-Math.min(...lo)>0.7)throw new Bad('That fence line is too long to check (more than 25 miles)');
  const line=mkLine(out);
  if(line.length<1)throw new Bad('That fence line is too short to check');
  if(line.length>MAX_LEN_M)throw new Bad('That fence line is too long to check (more than 25 miles)');
  return line}
// where segment a-b meets segment c-d: [t along a-b, u along c-d], or null
function cross(a,b,c,d){
  const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx;
  if(Math.abs(den)<1e-12)return null;
  const qx=c[0]-a[0],qy=c[1]-a[1],t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1?[t,u]:null}
function inside(x,y,E){let c=false;
  for(let i=0;i<E.length;i+=4){const x1=E[i],y1=E[i+1],x2=E[i+2],y2=E[i+3];if((y1>y)!==(y2>y)&&x<(x2-x1)*(y-y1)/(y2-y1)+x1)c=!c}
  return c}
// the stretches of the line inside one polygon (its rings, even-odd), as [[from m, to m]]
async function insideRuns(line,rings){
  const e=[];
  for(const r of rings)for(let i=0;i<r.length;i++){const p=r[(i+r.length-1)%r.length],q=r[i];if(p[0]!==q[0]||p[1]!==q[1])e.push(p[0],p[1],q[0],q[1])}
  if(!e.length)return [];
  const E=Float64Array.from(e),runs=[];
  for(let i=1;i<line.xy.length;i++){await tick();
    const a=line.xy[i-1],b=line.xy[i],lox=Math.min(a[0],b[0]),hix=Math.max(a[0],b[0]),loy=Math.min(a[1],b[1]),hiy=Math.max(a[1],b[1]),ts=[0,1];
    for(let k=0;k<E.length;k+=4){const x1=E[k],y1=E[k+1],x2=E[k+2],y2=E[k+3];
      if(Math.max(x1,x2)<lox||Math.min(x1,x2)>hix||Math.max(y1,y2)<loy||Math.min(y1,y2)>hiy)continue;
      const h=cross(a,b,[x1,y1],[x2,y2]);if(h)ts.push(h[0])}
    ts.sort((p,q)=>p-q);
    const seg=line.cum[i]-line.cum[i-1];
    for(let k=1;k<ts.length;k++){const t0=ts[k-1],t1=ts[k];if(t1-t0<1e-9)continue;const tm=(t0+t1)/2;
      if(inside(a[0]+(b[0]-a[0])*tm,a[1]+(b[1]-a[1])*tm,E)){const d0=line.cum[i-1]+seg*t0,d1=line.cum[i-1]+seg*t1,l=runs[runs.length-1];
        if(l&&Math.abs(l[1]-d0)<0.01)l[1]=d1;else runs.push([d0,d1])}}}
  return runs}
function merge(runs){const out=[];
  for(const [a,b] of [...runs].sort((p,q)=>p[0]-q[0]||p[1]-q[1])){const l=out[out.length-1];if(l&&a<=l[1]+0.5)l[1]=Math.max(l[1],b);else out.push([a,b])}
  return out}
const total=runs=>runs.reduce((s,[a,b])=>s+(b-a),0);
const runsOut=runs=>runs.filter(([a,b])=>b-a>0.3).map(([a,b])=>[ft(a),ft(b)]);
// polygons of an ArcGIS layer that touch the line: [[attributes, rings in local meters]]
async function arcgisPolys(url,line,fields,where='1=1'){
  const j=await ask(url,{where,geometry:line.esri(),geometryType:'esriGeometryPolyline',inSR:4326,spatialRel:'esriSpatialRelIntersects',
    outFields:fields,returnGeometry:'true',outSR:4326,geometryPrecision:6,maxAllowableOffset:0.00001,f:'json'});
  const out=[];
  for(const f of j.features||[]){const rings=(f.geometry?.rings||[]).filter(r=>r.length>2).map(r=>r.map(p=>line.toXY(p[1],p[0])));
    if(rings.length)out.push([f.attributes||{},rings])}
  return out}
// the line inside each kind of polygon: Map label -> runs
async function tally(line,polys,labelOf){const by=new Map();
  for(const [attrs,rings] of polys){const lab=labelOf(attrs);if(!lab)continue;const r=await insideRuns(line,rings);
    if(!by.has(lab))by.set(lab,[]);by.get(lab).push(...r)}
  for(const [k,v] of by)by.set(k,merge(v));
  return by}

// ---------- soil and rock (USDA NRCS soil survey) ----------
// boiled down to the few things that matter for setting posts; 68-ground.js turns them into plain words
const HARDPAN=/duripan|petrocalcic|petrogypsic|petroferric|ortstein|fragipan|placic|cemented|densic material/i;
const ROCKY_NAME=/\b(stony|very stony|extremely stony|cobbly|bouldery|rubbly|rocky|rock outcrop|rock land)\b/i;
const PAN_WORDS=[['duripan','hardpan (cemented layer)'],['petrocalcic','caliche hardpan'],['petrogypsic','gypsum hardpan'],
  ['ortstein','hardpan (cemented layer)'],['fragipan','hard, packed layer'],['placic','thin iron hardpan'],
  ['petroferric','ironstone hardpan'],['cemented','hardpan (cemented layer)'],['densic','hard, packed layer']];
const DRAIN=['Excessively drained','Somewhat excessively drained','Well drained','Moderately well drained',
  'Somewhat poorly drained','Poorly drained','Very poorly drained','Subaqueous'];
const FLOODS=['Very rare','Rare','Occasional','Frequent','Very frequent'];
// how strongly the soil survey name says stony / cobbly / gravelly: 0 not at all, 1, 2 very, 3 extremely
function level(name,word){let lv=0;
  for(const m of name.matchAll(new RegExp(`\\b(very |extremely )?(${word})\\b`,'gi')))lv=Math.max(lv,{'':1,'very ':2,'extremely ':3}[(m[1]||'').toLowerCase()]);
  return lv}
// the kind of dirt in the top 40 inches, from sand and clay percent (or the name when they're missing)
function texture(sand,clay,name){
  if(/\b(muck|mucky|peat|peaty)\b/i.test(name))return 'muck';
  if(sand==null||clay==null){
    for(const [w,t] of [['clay loam','clayloam'],['sandy loam','sandyloam'],['loamy sand','sandy'],['silt','silty'],['clay','clay'],['sand','sand'],['loam','loam']])
      if(new RegExp('\\b'+w,'i').test(name))return t;
    return ''}
  const silt=100-sand-clay;
  if(sand>=85&&clay<10)return 'sand';
  if(sand>=70&&clay<15)return 'sandy';
  if(clay>=40)return 'clay';
  if(clay>=27)return 'clayloam';
  if(silt>=50)return 'silty';
  if(sand>=52)return 'sandyloam';
  return 'loam'}
async function sda(sql){
  const j=await ask(SDA,null,{query:sql,format:'JSON+COLUMNNAME'}),t=j.Table||[];if(!t.length)return [];
  const head=t[0];return t.slice(1).map(row=>{const o={};head.forEach((k,i)=>{if(i<row.length)o[k]=row[i]});return o})}
const num=v=>{if(v==null||typeof v==='boolean'||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isNaN(n)?null:n};
// length in meters of a WKT line, multi-line or collection (points count nothing)
function wktLen(line,wkt){let m=0;
  for(const g of String(wkt||'').matchAll(/\(([-\d.eE+\s,]+)\)/g)){const P=[];
    for(const pair of g[1].split(',')){const v=pair.trim().split(/\s+/);if(v.length>=2)P.push(line.toXY(parseFloat(v[1]),parseFloat(v[0])))}
    for(let i=1;i<P.length;i++)m+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1])}
  return m}
async function soil(line){
  const wkt=line.wkt();   // numbers only, made here
  const rows=await sda(`SELECT P.mukey, P.mupolygongeo.STIntersection(geometry::STGeomFromText('${wkt}', 4326)).STAsText() AS part `+
    `FROM mupolygon P WHERE P.mupolygongeo.STIntersects(geometry::STGeomFromText('${wkt}', 4326)) = 1`);
  const meters=new Map();
  for(const r of rows){const k=String(r.mukey||'');if(/^\d{1,12}$/.test(k))meters.set(k,(meters.get(k)||0)+wktLen(line,r.part));await tick()}
  if(!meters.size)return {v:SOIL_V,units:[],ft:0,covered:false};
  const keys=[...meters.keys()].map(k=>`'${k}'`).join(',');
  const qs={
    mu:`SELECT M.mukey, M.musym, M.muname FROM mapunit M WHERE M.mukey IN (${keys})`,
    co:'SELECT C.mukey, C.cokey, C.compname, C.compkind, C.comppct_r, C.slope_l, C.slope_h, C.drainagecl, C.frostact, '+
      `C.geomdesc FROM component C WHERE C.mukey IN (${keys})`,
    res:`SELECT C.cokey, R.reskind, R.resdept_r FROM component C JOIN corestrictions R ON R.cokey = C.cokey WHERE C.mukey IN (${keys})`,
    hz:'SELECT C.cokey, H.hzdept_r, H.hzdepb_r, H.frag3to10_r, H.fraggt10_r, H.sieveno10_r, H.sandtotal_r, H.claytotal_r, H.lep_r '+
      `FROM component C JOIN chorizon H ON H.cokey = C.cokey WHERE C.mukey IN (${keys}) AND H.hzdept_r < ${DEPTH_CM}`,
    // one row per soil: how wet it is, how often it floods
    ag:`SELECT A.mukey, A.wtdepannmin, A.flodfreqdcd, A.pondfreqprs, A.drclassdcd FROM muaggatt A WHERE A.mukey IN (${keys})`};
  // the wet-ground summary (ag) is extra: the rest still answers without it
  const got=Object.fromEntries(await Promise.all(Object.entries(qs).map(async([n,q])=>[n,await sda(q).catch(e=>{if(n==='ag')return [];throw e})])));
  const hz={},res={},comps={},ag={};
  for(const h of got.hz)(hz[String(h.cokey)]??=[]).push(h);
  for(const r of got.res)(res[String(r.cokey)]??=[]).push(r);
  for(const c of got.co)(comps[String(c.mukey)]??=[]).push(c);
  for(const a of got.ag)ag[String(a.mukey)]=a;
  const units=[];
  for(const mu of got.mu){await tick();
    const k=String(mu.mukey),name=mu.muname||'';
    let rockW=0,stoneW=0,gravelW=0,wsum=0,sandW=0,clayW=0,texW=0,swell=null,bedrock=null,hardpan=null,bedKind='',panKind='',outcrop=0;
    const cs=[...(comps[k]||[])].sort((a,b)=>(num(b.comppct_r)||0)-(num(a.comppct_r)||0)),main=cs[0]||{};
    for(const c of cs){
      const pct=num(c.comppct_r)||0,isRock=/rock outcrop|rock land|rubble/i.test(c.compname||'');
      if(isRock)outcrop+=pct;
      // rock, sand and clay in the top 40 inches, by horizon thickness
      let rS=0,sS=0,gS=0,th=0,saS=0,clS=0,tx=0,lepS=0,lepTh=0;
      for(const h of hz[String(c.cokey)]||[]){
        const top=num(h.hzdept_r),bot=num(h.hzdepb_r);if(top==null||bot==null)continue;
        const t=Math.max(0,Math.min(bot,DEPTH_CM)-Math.max(top,0));if(t<=0)continue;
        const stones=num(h.fraggt10_r)||0,big=(num(h.frag3to10_r)||0)+stones,sv=num(h.sieveno10_r),small=sv!=null?(100-sv)*(100-big)/100:0;
        rS+=big*t;sS+=stones*t;gS+=small*t;th+=t;
        const sa=num(h.sandtotal_r),cl=num(h.claytotal_r),lep=num(h.lep_r);
        if(sa!=null&&cl!=null){saS+=sa*t;clS+=cl*t;tx+=t}
        if(lep!=null){lepS+=lep*t;lepTh+=t}}
      if(isRock){rockW+=100*pct;wsum+=pct}
      else if(th>0){rockW+=pct*rS/th;stoneW+=pct*sS/th;gravelW+=pct*gS/th;wsum+=pct}
      if(tx>0&&!isRock){sandW+=pct*saS/tx;clayW+=pct*clS/tx;texW+=pct}
      if(lepTh>0&&pct>=30)swell=Math.max(swell||0,lepS/lepTh);   // clay that swells, in a soil that makes up a good part of the map unit
      if(pct>=15){   // the shallowest bedrock or hardpan of the soils that make up a good part of the map unit
        for(const r of res[String(c.cokey)]||[]){const d=num(r.resdept_r),kind=r.reskind||'';if(d==null)continue;
          if(/bedrock/i.test(kind)&&(bedrock==null||d<bedrock)){bedrock=d;bedKind=/^lithic/i.test(kind)?'solid':'soft'}
          else if(HARDPAN.test(kind)&&(hardpan==null||d<hardpan)){hardpan=d;panKind=kind}}
        if(isRock&&(bedrock==null||bedrock>0)){bedrock=0;bedKind='solid'}}}
    const rock=wsum?rockW/wsum:null,gravel=wsum?gravelW/wsum:null;
    const rocky=(rock!=null&&rock>=15)||ROCKY_NAME.test(name)||outcrop>=15;
    const deep=[bedrock,hardpan].filter(d=>d!=null),shallowCm=deep.length?Math.min(...deep):null;
    const water=/^\s*water\s*$/i.test(name),pl=panKind.toLowerCase();
    const pk=PAN_WORDS.find(([w])=>pl.includes(w))?.[1]??(hardpan!=null?'hard, packed layer':'');
    // how steep: from the name ("30 to 60 percent slopes"), or the main soil's range
    const m=name.match(/(\d+) to (\d+) percent slopes?/);
    let slope=m?[parseInt(m[1],10),parseInt(m[2],10)]:null;
    if(!slope&&num(main.slope_l)!=null&&num(main.slope_h)!=null)slope=[rnd(num(main.slope_l)),rnd(num(main.slope_h))];
    const a=ag[k]||{},drain=a.drclassdcd||main.drainagecl||'',wt=num(a.wtdepannmin),fl=a.flodfreqdcd||'';
    const misc=(main.compkind||'')==='Miscellaneous area'&&(num(main.comppct_r)||0)>=50?String(main.compname||'').trim():'';
    units.push({mukey:k,sym:mu.musym||'',name,ft:ft(meters.get(k)||0),
      rock:rock==null?null:rnd(rock),gravel:gravel==null?null:rnd(gravel),
      stone:wsum?rnd(stoneW/wsum):null,
      outcrop:rnd(outcrop),rocky:!!(rocky&&!water),water,
      bedrock_in:bedrock==null?null:rnd(bedrock/2.54),bedrock:bedrock!=null?bedKind:'',
      hardpan_in:hardpan==null?null:rnd(hardpan/2.54),hardpan:pk,
      shallow:shallowCm!=null&&shallowCm<DEPTH_CM,
      // the name's own words for rocks on and in the ground: 0 none, 1, 2 very, 3 extremely
      stony:Math.max(level(name,'stony|bouldery'),/\brubbly\b/i.test(name)?3:0),
      cobbly:level(name,'cobbly|channery|flaggy'),gravelly:level(name,'gravelly'),
      tex:water?'':texture(texW?sandW/texW:null,texW?clayW/texW:null,name),
      swell:swell==null?null:rnd1(swell),slope,
      drain:DRAIN.includes(drain)?drain:'',
      wt_in:wt==null||wt>=200?null:rnd(wt/2.54),
      flood:FLOODS.includes(fl)?fl:'',pond:rnd(num(a.pondfreqprs)||0),
      frost:['Low','Moderate','High'].includes(main.frostact)?main.frostact:'',
      bottom:/flood ?plain|flood-plain/i.test(main.geomdesc||''),
      misc:water?'':misc.slice(0,40)})}
  units.sort((a,b)=>b.ft-a.ft);
  const sum=f=>units.reduce((s,u)=>s+(f(u)?u.ft:0),0),least=k=>{const v=units.map(u=>u[k]).filter(x=>x!=null);return v.length?Math.min(...v):null};
  return {v:SOIL_V,units,ft:sum(()=>1),covered:true,rocky_ft:sum(u=>u.rocky),shallow_ft:sum(u=>u.shallow),
    bedrock_in:least('bedrock_in'),hardpan_in:least('hardpan_in'),
    hardpan:[...units].sort((a,b)=>(a.hardpan_in??1e9)-(b.hardpan_in??1e9)).find(u=>u.hardpan)?.hardpan||''}}

// ---------- streams, rivers, canals and ditches (USGS NHD) ----------
const NHD_TYPES=new Set([460,336,558]);   // stream/river, canal/ditch, path through a lake or wide river
const FLOW={46003:'dry part of the year',46007:'only after storms',46006:'flows all year'};
const kindOf=(ftype,name)=>{const n=(name||'').toLowerCase();return ftype===336?(n.includes('canal')?'canal':'ditch'):(n.includes('river')?'river':'stream')};
async function streams(line){
  const j=await ask(NHD,{where:'ftype IN (460,336,558)',geometry:line.esri(),geometryType:'esriGeometryPolyline',inSR:4326,
    spatialRel:'esriSpatialRelIntersects',outFields:'gnis_name,ftype,fcode',returnGeometry:'true',outSR:4326,geometryPrecision:6,f:'json'});
  const ways=[],hits=[];
  for(const f of j.features||[]){const a=f.attributes||{},ftype=a.ftype;if(!NHD_TYPES.has(ftype))continue;
    const name=String(a.gnis_name||'').trim(),kind=kindOf(ftype,name);
    for(const path of f.geometry?.paths||[]){if(path.length<2)continue;await tick();
      ways.push({name,kind,path:path.map(p=>[fx(p[1],6),fx(p[0],6)])});
      const P=path.map(p=>line.toXY(p[1],p[0]));
      for(let i=1;i<line.xy.length;i++)for(let k=1;k<P.length;k++){const h=cross(line.xy[i-1],line.xy[i],P[k-1],P[k]);
        if(h)hits.push({at:line.cum[i-1]+(line.cum[i]-line.cum[i-1])*h[0],name,kind,flow:FLOW[a.fcode]||''})}}}
  hits.sort((p,q)=>p.at-q.at);
  const out=[];
  for(const h of hits){const l=out[out.length-1];if(l&&h.at-l.at<5&&h.kind===l.kind)continue;out.push(h)}   // one crossing where pieces of the same stream meet at the fence
  for(const h of out){h.ll=line.at(h.at).map(v=>fx(v,6));h.at=ft(h.at)}
  return {crossings:out,ways:ways.slice(0,200)}}

// ---------- flood zones (FEMA) ----------
function floodLabel(a){
  const z=String(a.FLD_ZONE||'').trim().toUpperCase(),sub=String(a.ZONE_SUBTY||'').toUpperCase();
  if(sub.includes('FLOODWAY'))return 'floodway';
  if(a.SFHA_TF==='T'||z.startsWith('A')||z.startsWith('V'))return '100:'+z;
  if(sub.includes('0.2 PCT'))return '500';
  return null}
async function flood(line){
  const by=await tally(line,await arcgisPolys(NFHL,line,'FLD_ZONE,ZONE_SUBTY,SFHA_TF',"SFHA_TF = 'T' OR ZONE_SUBTY LIKE '0.2 PCT%'"),floodLabel);
  const f100=merge([...by].filter(([k])=>k.startsWith('100:')||k==='floodway').flatMap(([,v])=>v));
  const zones=new Set([...by.keys()].filter(k=>k.startsWith('100:')).map(k=>k.slice(4)));if(by.has('floodway'))zones.add('AE');
  return {f100_ft:ft(total(f100)),floodway_ft:ft(total(by.get('floodway')||[])),f500_ft:ft(total(by.get('500')||[])),
    zones:[...zones].sort(),runs100:runsOut(f100),runs500:runsOut(by.get('500')||[])}}

// ---------- wetlands (US Fish and Wildlife Service) ----------
const WET_WORDS={'Freshwater Emergent Wetland':'marsh or wet meadow','Freshwater Forested/Shrub Wetland':'wooded or brushy wetland',
  'Freshwater Pond':'pond','Lake':'lake','Riverine':'stream channel','Estuarine and Marine Wetland':'salt marsh',
  'Estuarine and Marine Deepwater':'open water','Other':'other wetland'};
async function wetlands(line){
  const by=await tally(line,await arcgisPolys(NWI,line,'WETLAND_TYPE,ATTRIBUTE'),a=>a.WETLAND_TYPE||'Other');
  const types=[...by].map(([k,v])=>({type:Object.hasOwn(WET_WORDS,k)?WET_WORDS[k]:String(k).toLowerCase(),ft:ft(total(v)),channel:k==='Riverine'}))
    .filter(t=>t.ft>0).sort((a,b)=>b.ft-a.ft);
  const wet=merge([...by].filter(([k])=>k!=='Riverine').flatMap(([,v])=>v));
  return {wet_ft:ft(total(wet)),types,runs:runsOut(wet)}}

// ---------- trees and brush (LANDFIRE existing vegetation cover, 30 m) ----------
async function cover(line){
  let step=Math.max(10,line.length/1500);
  const n=Math.max(1,Math.ceil(line.length/step));step=line.length/n;
  const ds=Array.from({length:n},(_,i)=>(i+0.5)*step),vals=new Array(n).fill(null);
  for(let s=0;s<n;s+=1000){const chunk=ds.slice(s,s+1000),pts=chunk.map(d=>{const [lat,lng]=line.at(d);return [fx(lng,7),fx(lat,7)]});
    const j=await ask(EVC,{geometry:JSON.stringify({points:pts,spatialReference:{wkid:4326}}),geometryType:'esriGeometryMultipoint',returnFirstValueOnly:'true',f:'json'});
    if(!Array.isArray(j.samples))throw new Gerr('no samples');
    for(const sm of j.samples){const i=sm?.locationId,v=num(sm?.value);if(Number.isInteger(i)&&i>=0&&i<chunk.length&&v!=null&&v>=0)vals[s+i]=Math.trunc(v)}}
  const kinds=vals.map(v=>v==null?null:v>=100&&v<200?'t':v>=200&&v<300?(v-200>=BRUSH_MIN?'b':'s'):'o');   // trees; thick brush, or thin shrubs (sagebrush flats); open
  if(kinds.every(k=>k==null))return {covered:false,trees_ft:0,brush_ft:0,thin_ft:0,runs:[]};
  const runs=[];
  kinds.forEach((k,i)=>{if(k!=='t'&&k!=='b')return;const a=i*step,b=(i+1)*step,l=runs[runs.length-1];
    if(l&&l[2]===k&&Math.abs(l[1]-a)<0.01)l[1]=b;else runs.push([a,b,k])});
  const f=k=>ft(step*kinds.filter(x=>x===k).length);
  return {covered:true,trees_ft:f('t'),brush_ft:f('b'),thin_ft:f('s'),open_ft:f('o'),step_ft:rnd1(step*FT),runs:runs.map(([a,b,k])=>[ft(a),ft(b),k])}}

const TOPICS={soil,streams,flood,wetlands,cover};
const SAID={soil:'The USDA soil survey',streams:'The USGS stream map',flood:"FEMA's flood map",wetlands:'The wetlands map',cover:'The tree and brush map'};
return async function groundLookup(topic,pts){
  if(!TOPICS[topic])throw Error('That map is not known');
  const line=parseLine(pts);   // its words are shown as they are
  try{const res=await TOPICS[topic](line);res.at=Math.floor(Date.now()/1000);return res}
  catch(e){console.warn('ground '+topic+':',e?.message||e);throw Error(SAID[topic]+' did not answer. Try again later.')}}
})();
