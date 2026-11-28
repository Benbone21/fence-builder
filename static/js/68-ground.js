/* ---------- the ground along each fence line: soil and rock, water, trees and brush ----------
   This browser asks public federal maps about each line itself (67-ground-fetch.js), so the server does none of it:
   the USDA soil survey, USGS streams and ditches, FEMA flood zones, US Fish and Wildlife wetlands, and LANDFIRE tree and
   shrub cover. Answers are kept per line shape in this browser, asked for in the background after a line is drawn or
   changed, a few at a time, and never hold up drawing. With no signal they wait until it is back. If a map doesn't
   answer, the line just says so. Nothing here changes the bill until a button is pressed. */
const GTOPICS=['soil','streams','flood','wetlands','cover'];
const GASK=['streams','soil','flood','wetlands','cover'];   // the order they are asked in: streams first, river braces wait on them
const GROUND_FEE='Clearing trees and brush';
const gRate=()=>({trees:Math.max(0,+(S.settings.clearTrees??4)||0),brush:Math.max(0,+(S.settings.clearBrush??1.5)||0)});
// the line's shape: its corners, leaving out points on a straight run (gates and braces added later), so adding
// those doesn't ask the maps again
function groundShape(l){
  const P=l?.pts;if(!P||l.manual||P.length<2||walkingNow(l))return null;
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
  // when this browser's room is full, the oldest shapes make way (they are asked for again if their job is opened)
  for(let n=Math.min(ks.length,150);n>0;n=Math.floor(n/2)){try{localStorage.setItem('fence-ground',JSON.stringify(gStore));return}catch(e){}for(const k of ks.slice(Math.floor(n/2)))delete gStore[k]}},800)}
const gNoSignal=()=>navigator.onLine===false||netDown;   // no signal: asked for when it is back (offBack in 08-offline.js)
function groundGet(sh,topic){
  const id=sh.key+'#'+topic,have=gStore[sh.key]?.[topic];
  if(have&&!gOld(topic,have))return Promise.resolve(have);
  if(gBusy.has(id))return gBusy.get(id);
  const p=(async()=>{
    if(gNoSignal())throw Error('offline');
    const j=await groundLookup(topic,sh.pts);   // straight from this browser to the public maps
    const o=gStore[sh.key]||(gStore[sh.key]={});o[topic]=j;o.at=Date.now();gFail.delete(id);gKeep();return j})();
  gBusy.set(id,p);
  p.catch(e=>gFail.set(id,{at:Date.now(),msg:e.message})).finally(()=>{gBusy.delete(id);gRedraw();scheduleGround()});
  return p}
function scheduleGround(){clearTimeout(gT);gT=setTimeout(ensureGround,1200)}
function ensureGround(){
  if(!S||gNoSignal())return;
  const now=Date.now();
  for(const l of P().lines){const sh=groundShape(l);if(!sh)continue;
    for(const t of GASK){const id=sh.key+'#'+t,f=gFail.get(id);
      if((gStore[sh.key]?.[t]&&!gOld(t,gStore[sh.key][t]))||gBusy.has(id)||(f&&now-f.at<180000))continue;
      if(gBusy.size>=3)return;   // a few at a time: the rest start as these finish
      groundGet(sh,t).catch(()=>{})}}}
addEventListener('online',()=>{gFail.clear();scheduleGround()});
// show new answers, but not while someone is typing in a box on the page (it waits until they're done)
function gRedraw(){clearTimeout(gDrawT);gDrawT=setTimeout(()=>{try{gLegend()}catch(e){}if(!S||!(S.tab==='est'||(S.tab==='build'&&selLine)))return;
  const a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&a.type!=='checkbox'&&($('#panel').contains(a)||$('#side').contains(a)))return gRedraw();
  renderPanel()},400)}
// what is known about one line: answers, what's still being checked, what didn't answer
function groundOf(l){
  const sh=groundShape(l);if(!sh)return null;const o={sh,res:{...gStore[sh.key]},busy:[],fail:{}};if(gOld('soil',o.res.soil))delete o.res.soil;
  for(const t of GTOPICS){const id=sh.key+'#'+t;if(o.res[t])continue;if(gFail.has(id)&&!gBusy.has(id))o.fail[t]=gFail.get(id).msg;else o.busy.push(t)}
  return o}
const gCalm=m=>m==='offline'?'No internet right now. It is checked again when you are back online.':m||'That map did not answer. Try again later.';
const gCap=s=>s?s[0].toUpperCase()+s.slice(1):s;
/* ---------- soil in plain words: what the ground is like to build fence in ----------
   The soil survey's answer (67-ground-fetch.js) is turned into a few plain words per soil and a short "what this means for
   posts". The survey's own soil names and map labels are kept, small, under each one. */
const SOIL_V=2;   // soil answers from before the plain words (kept in this browser) are asked for again
const gOld=(t,r)=>t==='soil'&&!!r&&!(r.v>=SOIL_V);
const TEXW={sand:'sand',sandy:'sandy soil',sandyloam:'sandy loam',loam:'loam',silty:'silty soil',clayloam:'clay loam',clay:'clay',muck:'soft muck'};
const MISCW=[[/riverwash/i,'River sand and gravel'],[/rock outcrop|rock land/i,'Bare rock'],[/rubble/i,'Piles of loose rock'],[/\bpits?\b|quarr/i,'Gravel pit'],
  [/urban|made land/i,'Built-over ground'],[/badland/i,'Bare, washed-out hills'],[/dune/i,'Sand dunes'],[/dump|mine|tailing/i,'Dug-up or dumped ground'],
  [/lava/i,'Lava rock'],[/marsh|swamp/i,'Marsh'],[/water/i,'Open water']];
const DRAINW={'Excessively drained':'dry, drains fast','Somewhat excessively drained':'dry, drains fast','Well drained':'drains well',
  'Moderately well drained':'damp for a while in spring','Somewhat poorly drained':'wet in spring','Poorly drained':'stays wet much of the year',
  'Very poorly drained':'soggy most of the year','Subaqueous':'under water'};
const WET_D=['Somewhat poorly drained','Poorly drained','Very poorly drained','Subaqueous'];
const FLOODW={'Rare':'floods once in a long while','Occasional':'floods now and then','Frequent':'floods often','Very frequent':'floods very often'};
const GRADE={1:['Easy digging','okt'],2:['Some extra work',''],3:['Hard digging','warnt'],4:['Very hard digging','warnt'],9:['No posts','warnt']};
// one soil: {title, facts, posts, grade, k: what it counts toward in the summary}
function soilPlain(u){
  const o={title:'',facts:[],posts:[],grade:1,k:{}},k=o.k,post=(t,g)=>{o.posts.push(t);o.grade=Math.max(o.grade,g)};
  if(u.water){o.title='Open water';post('No posts here: plan a water gap, or go around.',9);k.water=1;return o}
  const misc=u.misc?(MISCW.find(([re])=>re.test(u.misc))?.[1]||gCap(String(u.misc).toLowerCase())):'',bare=misc==='Bare rock'||u.outcrop>=50;
  const rk=Math.max(u.stony||0,u.cobbly||0,u.rock>=50?3:u.rock>=35?2:u.rock>=15?1:0),big=(u.stony||0)>0||(u.stone||0)>=10;
  const gr=rk?0:Math.max(u.gravelly||0,u.gravel>=35?2:u.gravel>=15?1:0);
  const sl=Array.isArray(u.slope)?(u.slope[0]+u.slope[1])/2:null;
  o.title=misc||gCap((rk?'rocky ':gr>=2?'gravelly ':'')+(TEXW[u.tex]||'soil'))+(u.bottom&&(sl==null||sl<3)?' on river-bottom ground':sl==null?'':
    sl<3?' on flat ground':sl<8?' on gentle slopes':sl<15?' on rolling ground':sl<30?' on hillsides':sl<60?' on steep hillsides':' on very steep slopes');
  // what it is like
  if(!bare){const n=big?'big rocks (head-size and up)':'rocks bigger than a fist';
    if(rk>=3)o.facts.push(`${big?'big rocks':'rocks bigger than a fist'} all over, on top and in the ground`);else if(rk===2)o.facts.push('lots of '+n);
    else if(rk===1)o.facts.push('some '+n);else if(u.rock>=5)o.facts.push('a few rocks bigger than a fist');
    if(gr>=2)o.facts.push('lots of gravel');else if(gr)o.facts.push('some gravel')}
  const bed=u.bedrock_in,pan=u.hardpan_in,bw=u.bedrock==='soft'?'soft rock':'solid rock';
  if(bed!=null&&bed<=60&&!bare)o.facts.push(bed<=2?bw+' at the top':`${bw} ${bed} in down`);
  if(pan!=null&&pan<=60&&!(bed!=null&&bed<=pan))o.facts.push(`${u.hardpan||'hardpan'} ${pan} in down`);
  const wetD=WET_D.includes(u.drain),dw=DRAINW[u.drain];
  if(dw&&!(u.drain==='Well drained'&&o.facts.length>=2))o.facts.push(dw);
  if(u.wt_in!=null&&u.wt_in<=40)o.facts.push(u.wt_in<=2?'ground water at the top part of the year':`ground water ${u.wt_in} in down part of the year`);
  if(FLOODW[u.flood])o.facts.push(FLOODW[u.flood]);
  if(u.pond>=15)o.facts.push('water stands on it at times');
  if(u.swell>=6)o.facts.push(u.tex==='clay'?'clay that swells when wet and cracks when dry':'clay below the top that swells when wet and cracks when dry');
  // what it means for posts, worst first
  const sh=Math.min(bed??999,pan??999),sw=sh===bed?(u.bedrock==='soft'?'soft rock':'rock'):'hardpan';
  if(bare||sh<=2){post('Bare rock: drill and pin posts, or go around.',4);k.shallow={d:0,w:'rock'}}
  else if(sh<=24){post(`Expect to hit ${sw}: plan on a rock bar or rock drill, or set shorter posts in concrete. Driven T-posts will stop short.`,4);k.shallow={d:sh,w:sw}}
  else if(sh<=40){post(`Holes deeper than about ${gFeet(sh)} ft will hit ${sw}, and driven T-posts may stop short.`,3);k.shallow={d:sh,w:sw}}
  if(rk>=2)post('Expect to dig around rocks: augers bounce, and T-posts can stop short or bend.',3);
  else if(rk===1)post('Some rocks to dig around.',2);
  else if(gr>=2)post('Gravel: slow digging, and holes can cave in.',2);
  if(u.flood==='Frequent'||u.flood==='Very frequent'){post('High water and drift can take fence out: plan a water gap or let-down fence.',2);k.floodOften=1}
  else if(u.flood==='Occasional')k.floodSome=1;
  if(wetD||(u.wt_in!=null&&u.wt_in<=12)){post('Wet ground: hard to get a truck in, holes fill with water, posts heave. Build when it is dry.',2);k.wet=1}
  if(u.tex==='muck'){post('Soft ground: posts sink and lean. Go deeper or use concrete.',2);k.sandy=1}
  else if(u.tex==='sand'||u.tex==='sandy'){post('Easy digging, but sand is loose: set posts deeper or in concrete. Holes can cave in.',1);k.sandy=1}
  if(u.swell>=6){post('Clay moves as it wets and dries, so posts can lean: set them deeper.',2);k.swell=1}
  if(u.frost==='High'&&!k.wet)post('Frost can lift posts: set them deep.',2);
  if(sl!=null&&sl>=30){post('Steep: hard to get a truck or auger on it.',2);k.steep=1}
  if(!o.posts.length)post('Easy digging.',1);
  k.rocky=rk>=1||!!u.rocky||!!k.shallow;k.easy=o.grade===1&&!k.sandy;
  return o}
const gFt=n=>fmtFt(n>=1000?Math.round(n/50)*50:Math.round(n/10)*10);
const gFeet=i=>{const h=Math.round(i/6)/2;return h<1?'less than 1':(h%1?(h>1?Math.floor(h):'')+'½':String(h))};
// "What this means for posts": two to four short sentences for a line, or for the whole job
function soilSum(units){
  units=(units||[]).filter(u=>u.ft>0);const tot=units.reduce((a,u)=>a+u.ft,0);if(!tot)return '';
  const by={easy:0,rocky:0,shallow:0,water:0,floodOften:0,floodSome:0,wet:0,sandy:0,swell:0,steep:0},dep=[],kinds=new Set();
  for(const u of units){const k=soilPlain(u).k;for(const x in by)if(k[x])by[x]+=u.ft;if(k.shallow){dep.push(k.shallow.d);kinds.add(k.shallow.w)}}
  const land=tot-by.water,most=n=>land>0&&n>=land*.5,worth=n=>n>=Math.max(50,tot*.03);
  const traits=[most(by.rocky)?'rocky':'',most(by.wet)?'wet':'',most(by.sandy)?'sandy':''].filter(Boolean);
  const a=[!land?'All open water.':traits.length?`Mostly ${traits.join(', ')} ground${traits[0]==='rocky'?': hard digging':''}.`:by.easy===land?'Easy digging all along.':most(by.easy)?'Mostly easy digging.':'Mixed ground.'];
  if(worth(by.rocky)||worth(by.shallow)){
    const lo=Math.min(...dep),hi=Math.max(...dep),rng=!dep.length?'':lo<=2?'at the top':gFeet(lo)===gFeet(hi)?`about ${gFeet(hi)} ft down`:`${gFeet(lo)}–${gFeet(hi)} ft down`;
    const kw=kinds.size>1?'rock or hardpan':kinds.has('hardpan')?'hardpan':kinds.has('soft rock')?'soft rock':'solid rock';
    a.push(!worth(by.shallow)?`About ${gFt(by.rocky)} is rocky: expect slow digging, and driven T-posts may stop short.`:
      (by.rocky>by.shallow+20?`About ${gFt(by.rocky)} is rocky, and ${gFt(by.shallow)} of it has ${kw} ${rng}.`:`About ${gFt(by.shallow)} has ${kw} ${rng}.`)+' Plan on a rock bar or auger, or set those posts in concrete.')}
  const wa=[by.water?`${gFt(by.water)} is open water`:'',worth(by.floodOften)?`${gFt(by.floodOften)} floods often`:'',worth(by.floodSome)?`${gFt(by.floodSome)} floods now and then`:''].filter(Boolean);
  if(wa.length)a.push(`About ${wa.length>2?wa.slice(0,-1).join(', ')+' and '+wa[wa.length-1]:wa.join(' and ')}: plan water gaps or let-down fence there.`);
  if(worth(by.wet))a.push(`About ${gFt(by.wet)} is wet much of the year: build when it is dry, and expect posts to heave.`);
  if(worth(by.sandy))a.push(`About ${gFt(by.sandy)} is soft, sandy ground: set posts deeper or in concrete.`);
  if(worth(by.steep))a.push(`About ${gFt(by.steep)} is steep hillside: hard to get a truck or auger on it.`);
  if(worth(by.swell))a.push(`About ${gFt(by.swell)} is clay that swells and shrinks: set posts deeper.`);
  return a.slice(0,4).join(' ')}
// each soil along a line as a short card; soils that read the same are put together
function soilCards(units){
  const g=new Map();
  for(const u of units){const p=soilPlain(u),key=p.title+'|'+p.facts.join()+'|'+p.posts.join();
    const c=g.get(key)||(g.set(key,{p,ft:0,names:[]}),g.get(key));c.ft+=u.ft;if(u.name||u.sym)c.names.push(u)}
  const cards=[...g.values()].sort((a,b)=>b.ft-a.ft),all=cards.map(c=>[c.p.facts,c.p.posts].flat().join(' ')).join(' ');
  const words=[[/hardpan/,'hardpan: a cemented layer, hard like rock'],[/soft rock/,'soft rock: breaks up with a bar or a big auger, with work'],
    [/solid rock|hit rock/,'solid rock: bedrock, you need a rock drill or have to go around'],[/ground water/,'ground water: how deep a hole fills with water'],
    [/water gap/,'water gap: a hanging or swinging section where fence crosses water']].filter(([re])=>re.test(all)).map(w=>w[1]);
  return cards.map(({p,ft,names})=>{const [gw,gc]=GRADE[p.grade]||GRADE[1];
    const nm=names.map(u=>esc(u.name||'')+(u.sym?` <span class="gsym">(map label ${esc(u.sym)})</span>`:'')).join('; ');
    return `<div class="gcard"><div class="gtop"><b>${esc(p.title)}</b> <span class="tag ${gc}">${gw}</span><span class="num">${fmtFt(ft)}</span></div>
      ${p.facts.length?`<div>${esc(gCap(p.facts.join('; ')))}.</div>`:''}<div><b>Posts:</b> ${esc(p.posts.slice(0,2).join(' '))}</div>
      ${nm?`<div class="small mut">Soil survey name${names.length>1?'s':''}: ${nm}</div>`:''}</div>`}).join('')+
    `<p class="small mut" style="margin:6px 0 0">Rocks are for the top 40 inches and rock or hardpan for the top 5 ft, where posts and brace holes go.${words.length?' Words: '+esc(words.join(' · '))+'.':''}</p>`}
// short plain words for each answer
function soilText(s){
  if(!s.covered||!s.units?.length)return 'No soil survey along this line.';
  return `<b>What this means for posts:</b> ${soilSum(s.units)}`}
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
// A section of the line's page that starts closed: its heading says the gist ("Mostly easy digging."), and inside is
// what it means for posts, a "Show each soil" switch for the soil cards, then water, flood, wetlands and trees.
function groundView(l){
  const g=groundOf(l);if(!g)return '';
  const box=(sum,body)=>`<details class="sbox ground" data-keep="lnGround"${openKeep.lnGround?' open':''}><summary><b>Ground along this fence</b><span class="sboxsum">${sum}</span></summary><div class="sboxbody">${body}</div></details>`;
  if(g.busy.length)scheduleGround();
  const line=(t,name,fn)=>{const r=g.res[t];
    return `<div class="gline"><b>${name}</b><span>${r?fn(r):t in g.fail?`<span class="mut">${esc(gCalm(g.fail[t]))}</span>`:'<span class="mut">Checking the ground…</span>'}</span></div>`};
  const s=g.res.soil,units=s?.units?.filter(u=>u.ft>0)||[];
  const first=s?(s.covered&&units.length?(soilSum(units).match(/^[^.]*\./)||[''])[0]:'No soil survey here'):'soil' in g.fail?'':'checking…';
  const soils=units.length?`<details class="help gmore" data-keep="groundSoilCards"${openKeep.groundSoilCards?' open':''}><summary>Show each soil (${units.length})</summary><div class="gsoils">${soilCards(units)}</div></details>`:'';
  const failed=Object.keys(g.fail).length;
  return box(esc(first||'soil, water, trees'),`<div class="gsoil1">${line('soil','Soil and rock',soilText)}${soils}</div>
    ${GROW.filter(([t])=>t!=='soil').map(([t,n,fn])=>line(t,n,fn)).join('')}
    ${failed?`<button class="btn noprint" data-act="groundRetry" data-id="${l.id}" style="margin-top:6px">Try again</button>`:''}
    <p class="small mut" style="margin:8px 0 0">From USDA soil survey, USGS, FEMA, US Fish and Wildlife and LANDFIRE maps. A guide for planning, not a survey: check on site.</p>`)}
// the job as a whole, on the Final bill, with the two suggestions
const siteSuggest=(rocky,shallow,ft)=>ft?Math.min(30,Math.round((15*rocky/ft+15*shallow/ft)/5)*5):null;
function groundJob(){
  const p=P(),seen=new Set(),t={n:0,units:[],soilFt:0,rocky:0,shallow:0,bed:null,pan:null,panK:'',trees:0,brush:0,cover:0,f100:0,wet:0,cross:0,busy:0,fail:0};
  for(const l of p.lines){const g=groundOf(l);if(!g||seen.has(g.sh.key))continue;seen.add(g.sh.key);t.n++;
    if(g.busy.length)t.busy++;else if(Object.keys(g.fail).length)t.fail++;
    const r=g.res;
    if(r.soil?.covered){t.soilFt+=r.soil.ft;t.units.push(...(r.soil.units||[]));t.rocky+=r.soil.rocky_ft||0;t.shallow+=r.soil.shallow_ft||0;
      if(r.soil.bedrock_in!=null&&(t.bed==null||r.soil.bedrock_in<t.bed))t.bed=r.soil.bedrock_in;
      if(r.soil.hardpan_in!=null&&(t.pan==null||r.soil.hardpan_in<t.pan)){t.pan=r.soil.hardpan_in;t.panK=r.soil.hardpan}}
    if(r.cover?.covered){t.cover++;t.trees+=r.cover.trees_ft;t.brush+=r.cover.brush_ft}
    if(r.flood)t.f100+=r.flood.f100_ft;if(r.wetlands)t.wet+=r.wetlands.wet_ft;if(r.streams)t.cross+=(r.streams.crossings||[]).length}
  return t}
function groundBill(){
  const p=P(),t=groundJob();if(!t.n)return '';
  scheduleGround();
  const r=gRate(),sug=siteSuggest(t.rocky,t.shallow,t.soilFt),site=+p.site||0,clear=Math.round(t.trees*r.trees+t.brush*r.brush),fee=(p.fees||[]).find(f=>f.name===GROUND_FEE);
  const soil=t.soilFt?`<b>What this means for posts:</b> ${soilSum(t.units)} <span class="small mut">Each line's page has the soils one by one.</span>`:'';
  const water=[t.cross?`${t.cross} stream or ditch crossing${t.cross>1?'s':''}`:'',t.f100?`${fmtFt(t.f100)} in the 100-year flood zone`:'',t.wet?`${fmtFt(t.wet)} through wetlands (may need a permit)`:''].filter(Boolean).join(', ');
  const siteRow=sug==null?'':`<div class="gline"><b>Site difficulty</b><span>Suggested: <b>${sug}%</b>. Up to 15% for rocky ground and up to 15% for solid rock or hardpan within 40 in, by how much of the fence is on it.
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
   findCrossings asks for these along with the street map (the same answer as the line's "Streams and ditches"). When the USGS map answers, its streams, rivers, canals and
   ditches are used and the street map's waterways are set aside (they are mostly the same creeks drawn a few yards apart,
   which would put two pairs of braces at one creek); the street map's waterways are the backup when USGS doesn't answer. */
const NHD_LAYER='https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6';
// USGS waterways along a line, shaped like the street map's answer; null if USGS didn't answer
async function riverWays(l){
  const sh=groundShape(l);if(!sh)return null;let ways=null;
  try{ways=(await Promise.race([groundGet(sh,'streams'),new Promise((_,no)=>setTimeout(()=>no(Error('slow')),25000))])).ways}catch(e){}
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
  'Soils (USDA soil map, zoom in close)':{z:15,short:'Soils',note:gSoilLegend,
    layer:new GWms('https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms',{layers:'mapunitpoly',format:'image/png',transparent:true,gMin:15,maxZoom:22,attribution:'Soils: USDA NRCS'})},
  'Streams and ditches (USGS)':{z:13,short:'Streams',note:'Streams: blue lines are creeks and rivers, orange lines are canals and ditches.',
    layer:gExport(NHD_LAYER.replace(/\/6$/,'')+'/export','layers=show:6&layerDefs='+encodeURIComponent(JSON.stringify({6:'ftype IN (460,336,558)'})),{gMin:13,attribution:'Streams: USGS NHD'})},
  'Flood zones (FEMA, zoom in close)':{z:14,short:'Flood zones',note:'Flood zones: blue is the 100-year flood zone, red stripes are the floodway, orange is the 500-year flood zone.',
    layer:gExport('https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export','layers=show:28&layerDefs='+encodeURIComponent(JSON.stringify({28:"SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2 PCT%'"})),{gMin:14,opacity:.6,attribution:'Flood zones: FEMA'})},
  'Wetlands (US Fish and Wildlife)':{z:13,short:'Wetlands',note:'Wetlands: greens are marshes and wooded wetlands, blues are ponds, lakes and stream channels. Wetlands may need a permit.',
    layer:gExport('https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export','layers=show:0',{gMin:13,opacity:.6,attribution:'Wetlands: USFWS NWI'})},
  'Trees and brush (LANDFIRE)':{z:12,short:'Trees and brush',note:'Green: trees. Tan: thick brush. In squares about 100 ft across.',
    layer:gExport('https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVC_CONUS/ImageServer/exportImage','interpolation=RSP_NearestNeighbor&renderingRule='+encodeURIComponent(JSON.stringify(EVC_RULE)),{gMin:12,opacity:.6,attribution:'Trees and brush: LANDFIRE'})}};
// the soils legend: the map's soil labels on this job's fence lines, in plain words
function gSoilLegend(){
  const m=new Map();let ls=[];try{ls=P().lines||[]}catch(e){}
  for(const l of ls){const sh=groundShape(l),s=sh&&gStore[sh.key]?.soil;if(!s||gOld('soil',s))continue;
    for(const u of s.units||[])if(u.sym&&u.ft>0){const o=m.get(u.sym)||(m.set(u.sym,{u,ft:0}),m.get(u.sym));o.ft+=u.ft}}
  const list=[...m.values()].sort((a,b)=>b.ft-a.ft);
  const head='<b>Soils:</b> orange lines show where the soil changes. The letters are only the soil survey\'s labels';
  if(!list.length)return head+'. Each fence line\'s page says what its ground is like to build on.';
  return head+'. On this job\'s fence lines:'+list.slice(0,6).map(({u})=>{const p=soilPlain(u);return `<div class="gsl"><b>${esc(u.sym)}</b> ${esc(p.title)} (${esc((GRADE[p.grade]||GRADE[1])[0].toLowerCase())})</div>`}).join('')+
    (list.length>6?`<div class="gsl mut">and ${list.length-6} more: see each line's page</div>`:'')}
const gLeg=L.control({position:'bottomleft'});
gLeg.onAdd=()=>{const d=L.DomUtil.create('div','gleg');L.DomEvent.disableClickPropagation(d);return d};gLeg.addTo(map);
function gLegend(){const d=gLeg.getContainer(),z=map.getZoom(),on=Object.values(GROUND_LAYERS).filter(o=>map.hasLayer(o.layer));
  d.innerHTML=on.map(o=>`<div>${z<o.z?`<b>${esc(o.short)}:</b> zoom in closer to see them.`:typeof o.note==='function'?o.note():esc(o.note)}</div>`).join('');d.hidden=!on.length}
for(const [n,o] of Object.entries(GROUND_LAYERS)){OVL[n]=o.layer;layCtl.addOverlay(o.layer,n);if(lay.on.includes(n))o.layer.addTo(map)}
map.on('overlayadd overlayremove zoomend moveend',gLegend);gLegend();
