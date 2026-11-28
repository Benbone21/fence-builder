/* ---------- on a phone: a bar of big buttons at the bottom for the pages, the Builder's left bar as a panel that
   slides up over the map, and Walk the fence: stand at each corner and drop a fence point from the phone's GPS ---------- */
// PHONE_Q (08-offline.js) is the same test as the phone part of app.css: a narrow screen, or a phone on its side
const phoneMQ=matchMedia(PHONE_Q);
function isPhone(){return phoneMQ.matches}
let walkOn=false,sheetOpen=false,phoneFirst=true;
const money0=n=>'$'+Math.round(n||0).toLocaleString('en-US');
// renderPanel calls this every time a page is drawn
function phoneSync(){
  if(!S)return;
  const b=document.body;
  // opened again with a line half walked (the battery ran out, the page was closed): straight back to walking it
  if(phoneFirst){phoneFirst=false;if(isPhone()&&P().lines.some(l=>l.walking)){walkOn=true;if(S.tab!=='build'){S.tab='build';return renderAll()}}}
  const build=S.tab==='build';if(walkOn&&!build)walkOn=false;
  const was=b.classList.contains('walk'),now=walkOn&&build;
  b.classList.toggle('walk',now);b.classList.toggle('sheet',sheetOpen&&build&&!now);
  const here=now?'walk':build?'build':S.tab==='jobs'?'jobs':S.tab==='est'?'est':'more';
  for(const x of document.querySelectorAll('#phonebar [data-ph]')){const on=x.dataset.ph===here;x.classList.toggle('on',on);if(on)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current')}
  // the slide-up panel's one line: the line you picked (or the job), its length, and the job's price
  if(build&&A){const r=selLine&&A.lines.find(x=>x.l.id===selLine);
    $('#sheetSum').textContent=r?`${r.l.name} · ${fmtFt(r.len)} · ${money0(A.total)}`:`${P().lines.length?P().name:'No fence yet'} · ${fmtFt(A.totalFt)} · ${money0(A.total)}`;
    $('#sheetHint').textContent=sheetOpen?'Tap here to close':r?'This line, and the price of the whole job':'Tap for the fence setup and the details'}
  $('#sheetBar').setAttribute('aria-expanded',sheetOpen?'true':'false');$('#sheetMore').textContent=sheetOpen?'Close':'Details';
  $('#walkbox').hidden=!now;
  $('#proj').disabled=now&&!!walkLine();   // finish or cancel the line you are walking before changing jobs
  $('#proj').title=$('#proj').disabled?'Finish or cancel the line you are walking first':'';
  if(now){renderWalk();gpsStart();if(WK.active&&!WK.lock&&!WK.lockMsg)wakeOn()}else if(was)gpsStop();
  if(was!==now){if(!now)walkLayer.clearLayers();setTimeout(()=>map.invalidateSize(),0)}
}
phoneMQ.addEventListener('change',()=>{if(!isPhone())document.body.classList.remove('psearch');if(S)renderPanel();setTimeout(()=>map.invalidateSize(),0)});
// the bottom bar
$('#phonebar').addEventListener('click',e=>{
  const b=e.target.closest('[data-ph]');if(!b)return;const k=b.dataset.ph;
  if(k==='more')return openMore();
  if(k==='walk'){if(mode!=='idle')cancelDraw();walkOn=true;sheetOpen=false;selNode=null;map.closePopup();WK.centred=false;
    if(S.tab!=='build')gotoTab('build');else renderAll();if(WK.fix)setTimeout(()=>walkView(WK.fix,19),60);return}
  walkOn=false;if(k==='jobs')jobOpen=null;
  gotoTab(k);if(k!=='build')$('#panel').scrollTop=0;
});
// More: the setup pages (and your account on a shared server)
function openMore(){
  const d=$('#moreDlg'),pages=[['types','Fence types','Each kind of fence you build: wire, posts, braces, labor'],['braces','Braces','What goes into each brace, and its labor'],['prices','Materials','Everything you buy, with its price'],['settings','Settings','Your business, crew, look and text size']];
  d.innerHTML=`<h2>More</h2><p class="mut" style="margin:0">Setting things up. These pages are easier on a bigger screen, but they work here too.</p>
    <div class="addpick">${pages.map(([k,n,h])=>`<button class="addopt" data-pg="${k}"${S.tab===k?' aria-current="page"':''}><b>${n}</b><span>${h}</span></button>`).join('')}${$('#bMe').hidden?'':`<button class="addopt" data-pg="account"><b>Your account</b><span>${esc($('#bMe').textContent)}: password and sign out</span></button>`}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn big" data-pg="x">Close</button></div>`;
  d.onclick=e=>{const k=e.target.closest('[data-pg]')?.dataset.pg;if(!k&&e.target!==d)return;d.close();if(!k||k==='x')return;walkOn=false;
    if(k==='account'){setSec='account';gotoTab('settings')}else{if(k==='types')typeSel=null;if(k==='braces')braceSel=null;gotoTab(k)}$('#panel').scrollTop=0};
  d.showModal();d.querySelector('.addopt')?.focus();
}
// the Builder's panel: tap its bar to slide it up or down. Starting to draw puts it away so the map shows.
$('#sheetBar').onclick=()=>{sheetOpen=!sheetOpen;phoneSync();if(sheetOpen)$('#side').scrollTop=0};
$('#side').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b&&isPhone()&&['draw','gate','brace','zoom','cont'].includes(b.dataset.act)){sheetOpen=false;setTimeout(phoneSync,0)}},true);
$('#mapbar').addEventListener('click',()=>{if(sheetOpen&&isPhone()){sheetOpen=false;phoneSync()}},true);
// the map's More menu has what the phone's toolbar leaves out
$('#pmBrace').onclick=()=>$('#bBrace').click();
$('#pmRedo').onclick=()=>redo();
$('#pm3d').onclick=()=>$('#b3d').click();
$('#pmFind').onclick=()=>{document.body.classList.add('psearch');setTimeout(()=>{map.invalidateSize();$('#q').focus()},50)};
$('#search').addEventListener('submit',()=>{if(isPhone()&&document.body.classList.contains('psearch'))setTimeout(()=>{$('#q').blur();document.body.classList.remove('psearch');map.invalidateSize()},150)});

/* ---------- Walk the fence (GPS) ----------
   The walked line is a normal fence line from the first point on, saved as each point is dropped (so a dead battery
   or lost signal doesn't lose it). While it is being walked it carries `walking` (when the last point went in): its
   ground heights, hill braces and the ground under it wait until it is finished, then everything works out the
   same as for a line drawn on the map, with gates at roads and braces at rivers if those are turned on. */
const WALK_STEADY=3000,WALK_ROUGH_FT=30,WALK_SNAP_FT=12;
const WK={id:null,active:false,type:null,gate:false,watch:null,fix:null,buf:[],follow:true,centred:false,lock:null,lockMsg:'',busy:false,err:'',done:null,resumed:null};
const walkLayer=L.layerGroup().addTo(map);
const youAcc=L.circle([0,0],{radius:1,color:'#1a73e8',weight:1.5,opacity:.8,fillColor:'#1a73e8',fillOpacity:.13,interactive:false});
const youDot=L.marker([0,0],{interactive:false,keyboard:false,zIndexOffset:2000,icon:L.divIcon({className:'wyou',iconSize:[22,22]})});
const WALK_INSECURE="Your phone only shares its location with secure (https) websites. Ask whoever set up your Fence Builder server to turn on https (see the README: 'Later: a domain name and https').";
// still being walked (a walk left for half a day counts as finished for the heights and the ground, but can still be carried on)
function walkingNow(l){return !!l?.walking&&Date.now()-Date.parse(l.walking)<12*3600e3}
function walkLine(){
  const p=P();
  if(WK.id){const l=p.lines.find(x=>x.id===WK.id);if(l&&l.walking)return l;WK.id=null;WK.gate=false}
  const l=p.lines.find(x=>x.walking);if(!l)return null;
  WK.id=l.id;WK.type=l.type;WK.active=true;
  if(WK.resumed!==l.id&&walkOn){WK.resumed=l.id;setTimeout(()=>toast(`Carrying on with ${l.name}: ${l.pts.length} point${l.pts.length===1?'':'s'} so far.`),300)}
  return l;
}
const walkFt=()=>{const f=WK.fix;return f?Math.round(f.acc*FT):null};
// GPS: only while the Walk screen is showing
function gpsStart(){
  if(WK.watch!=null||!window.isSecureContext||!navigator.geolocation||WK.err==='denied')return;
  try{WK.watch=navigator.geolocation.watchPosition(gpsFix,gpsErr,{enableHighAccuracy:true,maximumAge:0,timeout:20000})}catch(e){WK.err='nofix'}
}
function gpsStop(){
  if(WK.watch!=null){try{navigator.geolocation.clearWatch(WK.watch)}catch(e){}WK.watch=null}
  youDot.remove();youAcc.remove();walkLayer.clearLayers();wakeOff();
}
function gpsFix(pos){
  const c=pos.coords,f={lat:c.latitude,lng:c.longitude,acc:Math.max(0,+c.accuracy||0),t:Date.now()};
  WK.fix=f;WK.err='';WK.buf.push(f);while(WK.buf.length&&WK.buf[0].t<f.t-30000)WK.buf.shift();
  if(!document.body.classList.contains('walk'))return;
  youAcc.setLatLng([f.lat,f.lng]).setRadius(Math.max(1,f.acc)).addTo(map);youDot.setLatLng([f.lat,f.lng]).addTo(map);
  if(WK.follow||!WK.centred){walkView(f,WK.centred?Math.max(map.getZoom(),17):19,WK.centred);WK.centred=true}
  updWalk();
}
function gpsErr(e){const was=WK.err;WK.err=e&&e.code===1?'denied':'nofix';if(WK.err==='denied'){gpsStop();renderWalk()}else if(was!==WK.err)updWalk()}
// dragging the map yourself stops it following you
map.on('dragstart',()=>{if(WK.follow&&document.body.classList.contains('walk')){WK.follow=false;updWalk()}});
// keep the screen on while walking, where the browser can
async function wakeOn(){
  if(!('wakeLock' in navigator)){WK.lockMsg='none';return updWalk()}
  if(WK.lock)return;
  try{const k=await navigator.wakeLock.request('screen');WK.lock=k;WK.lockMsg='on';k.addEventListener('release',()=>{if(WK.lock===k){WK.lock=null;WK.lockMsg='off'}updWalk()})}
  catch(e){WK.lockMsg='fail'}
  updWalk();
}
function wakeOff(){const k=WK.lock;WK.lock=null;WK.lockMsg='';if(k)k.release().catch(()=>{})}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.body.classList.contains('walk')&&WK.active&&WK.lockMsg!=='none')wakeOn()});
// a steady spot: stand still for a moment; the readings in that time are averaged (the sharper ones count for more)
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function steadyFix(){
  WK.busy=true;renderWalk();const t0=Date.now();
  for(let s=Math.ceil(WALK_STEADY/1000);s>0;s--){const el=$('#wBig');if(el)el.innerHTML=`Hold still… ${s}<span>Getting a steady GPS reading</span>`;await pause(1000)}
  WK.busy=false;
  let use=WK.buf.filter(r=>r.t>=t0-1500);
  if(!use.length&&WK.fix&&Date.now()-WK.fix.t<120000)use=[WK.fix];   // standing still, a phone may not send a new reading
  if(!use.length)return null;
  let sw=0,la=0,ln=0,ac=0;for(const r of use){const w=1/Math.max(1,r.acc)**2;sw+=w;la+=r.lat*w;ln+=r.lng*w;ac+=r.acc}
  return {lat:la/sw,lng:ln/sw,acc:ac/use.length};
}
// back at the start of this line, or at a corner of another fence line in this job: use that exact spot, so they join
function walkSnap(q,l){
  const me=L.latLng(q.lat,q.lng);let best=null,bd=WALK_SNAP_FT/FT,what='';
  const cand=[...P().lines.filter(x=>x!==l&&!x.manual).flatMap(x=>x.pts.filter(p=>p.brace!=='gate').map(p=>[p,x.name])),...(l&&l.pts.length>2?[[l.pts[0],'start']]:[])];
  for(const [p,n] of cand){const d=me.distanceTo(ll(p));if(d<bd){bd=d;best=p;what=n}}
  return best?{lat:best.lat,lng:best.lng,acc:q.acc,joined:what}:q;
}
// saved straight away through the normal save, without the usual short wait
function walkSave(){changed();if(saveT){clearTimeout(saveT);saveT=null;pushSave()}}
function walkNewLine(){const l={id:uid('l'),name:'Fence '+(P().lines.length+1),type:WK.type||drawTypeId(),pts:[],walking:new Date().toISOString()};P().lines.push(l);WK.id=l.id;return l}
const roughNote=q=>q&&q.acc*FT>WALK_ROUGH_FT?` The GPS was rough (±${Math.round(q.acc*FT)} ft): you can drag the point on the map later.`:'';
async function walkDrop(){
  if(WK.busy)return;
  if(!WK.fix)return toast('Waiting for the GPS. Stand in the open for a moment.');
  const q=await steadyFix();if(!q){renderWalk();return toast('No GPS reading yet. Wait a moment and tap again.')}
  let l=walkLine();const s=walkSnap(q,l),last=l?.pts[l.pts.length-1];
  if(WK.gate&&last){
    // the other gate post: the gate goes between it and the first one, like a gate drawn on the map
    const w=Math.round(ll(last).distanceTo(ll(s))*FT);
    if(w<3){renderWalk();return toast('You are still at the first gate post. Walk to the other one, then tap.')}
    const t=S.fenceTypes.find(x=>x.id===l.type)||S.fenceTypes[0];
    last.brace='none';l.pts.push({lat:(last.lat+s.lat)/2,lng:(last.lng+s.lng)/2,brace:'gate',gw:w,gm:t?.gateM},{lat:s.lat,lng:s.lng,brace:'none'});
    WK.gate=false;l.walking=new Date().toISOString();walkSave();
    return toast(`${w} ft gate. Keep walking the fence.${w>40?' That is a wide gate: you can change its width on the map.':''}${roughNote(q)}`);
  }
  WK.gate=false;
  if(last&&ll(last).distanceTo(ll(s))*FT<3){renderWalk();return toast('That is the same spot as the last point. Walk to the next corner first.')}
  if(!l)l=walkNewLine();
  l.pts.push({lat:s.lat,lng:s.lng,brace:null});l.walking=new Date().toISOString();walkSave();
  const n=l.pts.filter(p=>p.brace!=='gate').length;
  toast((s.joined==='start'?'Back at the start: the line goes all the way around.':s.joined?`Joined to the corner of ${s.joined}.`:n===1?'First point in. Walk to the next corner.':`Point ${n} in. ${fmtFt(flatLen(l.pts))} so far.`)+roughNote(q));
}
// a gate: this tap is one gate post (the last point, if you are still standing at it); then the other post
async function walkGate(){
  if(WK.busy)return;
  if(WK.gate){WK.gate=false;renderWalk();return toast('No gate. Keep walking the fence.')}
  if(!WK.fix)return toast('Waiting for the GPS. Stand in the open for a moment.');
  const q=await steadyFix();if(!q){renderWalk();return toast('No GPS reading yet. Wait a moment and tap again.')}
  let l=walkLine();const s=walkSnap(q,l),last=l?.pts[l.pts.length-1];
  if(!(last&&ll(last).distanceTo(ll(s))*FT<Math.max(8,Math.min(20,q.acc*FT)))){if(!l)l=walkNewLine();l.pts.push({lat:s.lat,lng:s.lng,brace:null})}
  WK.gate=true;l.walking=new Date().toISOString();walkSave();
  toast('One gate post is in. Walk to the other gate post and tap "Other gate post here".'+roughNote(q));
}
function walkUndo(){
  if(WK.busy)return;
  if(WK.gate){WK.gate=false;renderWalk();return toast('No gate. The point where it was going to start is still there.')}
  const l=walkLine();if(!l||!l.pts.length)return toast('There are no points to take back yet.');
  const ps=l.pts,b=ps.pop();let what='The last point is taken off.';
  if(b&&b.brace==='none'&&ps[ps.length-1]?.brace==='gate'){ps.pop();const a=ps[ps.length-1];if(a&&a.brace==='none')a.brace=null;what='The gate is taken off.'}
  if(!ps.length){P().lines=P().lines.filter(x=>x!==l);WK.id=null}else l.walking=new Date().toISOString();
  walkSave();toast(what);
}
function walkFinish(){
  if(WK.busy)return;
  const l=walkLine();
  if(!l||l.pts.length<2)return toast('Drop at least two points (where the fence starts and ends) before you finish.');
  delete l.walking;
  WK.id=null;WK.gate=false;WK.active=false;WK.done={id:l.id,name:l.name,len:flatLen(l.pts),n:l.pts.filter(p=>p.brace!=='gate').length,gates:l.pts.filter(p=>p.brace==='gate').length};
  wakeOff();S.tab='build';walkSave();
  // gates at roads and braces at rivers, as for a line drawn on the map (out of range: once back in range)
  if(crossOn()){if(navigator.onLine===false||netDown)crossLater(l.id);else findCrossings(l.id,true)}
  toast(`${l.name} is saved: ${fmtFt(WK.done.len)}.`);
}
async function walkCancel(){
  if(WK.busy)return;
  const l=walkLine();
  if(l&&!await ask(`Remove ${l.name}, the line you are walking? Its ${l.pts.length} point${l.pts.length===1?'':'s'} are thrown away.`))return;
  if(l)P().lines=P().lines.filter(x=>x!==l);
  WK.id=null;WK.gate=false;WK.active=false;wakeOff();
  if(l){walkSave();toast('The walked line is thrown away.')}else renderWalk();
}
function walkStart(){
  WK.type=$('#wType')?.value||drawTypeId();if(WK.type!==drawTypeId())setDrawType(WK.type);
  WK.active=true;WK.done=null;WK.gate=false;WK.follow=true;WK.centred=false;
  if(WK.fix)setTimeout(()=>walkView(WK.fix,19),60);
  wakeOn();renderWalk();
  toast(WK.fix?'Stand where the fence starts and tap "Drop the first point here".':'Looking for the GPS… stand in the open for a moment.');
}
// the Walk screen
function renderWalk(){
  const box=$('#walkbox');if(!box||!S)return;
  const l=walkLine(),walking=!!l||WK.active,t=S.fenceTypes.find(x=>x.id===(l?.type||WK.type))||TYP(drawTypeId());
  let h;
  if(!window.isSecureContext)h=`<h2>Walk the fence</h2><p class="wmsg warnbox" id="wInsecure">${esc(WALK_INSECURE)}</p>`;
  else if(!navigator.geolocation)h=`<h2>Walk the fence</h2><p class="wmsg warnbox">This browser can't tell Fence Builder where you are. Try Chrome or Safari on the phone.</p>`;
  else if(WK.err==='denied')h=`<h2>Walk the fence</h2><p class="wmsg warnbox">Your phone is not sharing its location with Fence Builder. To walk a fence, allow location for this website: in the browser, tap the lock or the ⓘ next to the web address, then Location, then Allow. Then tap Try again.</p><button class="btn pri wbig" data-w="retry">Try again</button>`;
  else if(!walking){
    const other=S.projects.find(p=>p.id!==P().id&&p.lines.some(x=>x.walking)),d=WK.done;
    h=`<h2>Walk the fence</h2>
      ${d?`<div class="wmsg wdone"><b>${esc(d.name)} is saved:</b> ${fmtFt(d.len)}, ${d.n} point${d.n===1?'':'s'}${d.gates?`, ${d.gates} gate${d.gates>1?'s':''}`:''}. Gates at roads and braces at rivers and on hills go in by themselves when they are turned on.<div class="wrow"><button class="btn wmid soft" data-w="see">See it on the map</button><button class="btn wmid" data-w="bill">Final bill</button></div></div>`
        :`<p>Stand at the corner where the fence starts. Each time you tap, a fence point goes in where you are standing.</p>`}
      ${other?`<p class="wmsg warnbox">You were walking a line in the job <b>${esc(other.name)}</b>. <button class="btn sm" data-w="otherJob" data-id="${other.id}">Go to that job</button></p>`:''}
      <label class="f" for="wType">Fence type</label><select id="wType">${typeOpts(t?.id||drawTypeId())}</select>
      <button class="btn pri wbig" data-w="start">${d?'Start walking another fence line':'Start walking a new fence line'}</button>
      <div class="wtop" style="margin-top:10px"><span id="wGps">Looking for the GPS…</span><span class="wacc" id="wAcc">…</span></div>
      <p class="wwarn" id="wWarn" hidden></p><p class="wwarn" id="wNet" hidden></p>
      ${tilesHtml()}`;
  }else{
    const n=l?l.pts.filter(p=>p.brace!=='gate').length:0,gates=l?l.pts.filter(p=>p.brace==='gate').length:0;
    const big=WK.busy?`Hold still…<span>Getting a steady GPS reading</span>`:WK.gate?`Other gate post here<span>Stand at the other side of the gate</span>`:n?`Drop a point here<span>A corner or brace, where you stand</span>`:`Drop the first point here<span>Where the fence starts</span>`;
    const dis=WK.busy?' disabled':'';
    h=`<div class="wtop"><div><b id="wLen">${fmtFt(l?flatLen(l.pts):0)} so far</b><span id="wPts">${l?esc(l.name)+': ':''}${n} point${n===1?'':'s'}${gates?`, ${gates} gate${gates>1?'s':''}`:''} · ${esc(t?.name||'')}</span><span id="wLive"></span></div><span class="wacc" id="wAcc">…</span></div>
      <p class="wwarn" id="wWarn" hidden></p><p class="wwarn" id="wNet" hidden></p>
      <button class="btn pri wbig" data-w="drop" id="wBig"${dis}>${big}</button>
      <div class="wrow"><button class="btn wmid" data-w="gate"${dis}>${WK.gate?'No gate after all':'Add a gate here'}</button><button class="btn wmid" data-w="undo"${dis}>${WK.gate?'Undo the gate':'Undo last point'}</button></div>
      <div class="wrow"><button class="btn wmid soft" data-w="finish"${dis}>Finish line</button><button class="btn wmid del" data-w="cancel"${dis}>Cancel</button></div>
      <label class="setcheck wfollow"><span><b>Follow me</b><span>Keep the map on where you are</span></span><span class="switch"><input type="checkbox" role="switch" id="wFollow"${WK.follow?' checked':''} aria-label="Follow me"><i></i><em>${WK.follow?'On':'Off'}</em></span></label>
      <p class="wnote" id="wLock"></p><p class="wnote">Each point is saved as soon as it goes in.</p>`;
  }
  box.innerHTML=h;updWalk();
}
// the parts that change with every GPS reading
function updWalk(){
  if(!document.body.classList.contains('walk'))return;
  const ft=walkFt(),acc=$('#wAcc'),warn=$('#wWarn'),l=walkLine();
  if(acc){acc.textContent=WK.fix?`GPS ±${ft} ft`:WK.err==='nofix'?'No GPS yet':'Looking for GPS…';acc.className='wacc'+(WK.fix?ft>WALK_ROUGH_FT?' rough':' good':'')}
  const g=$('#wGps');if(g)g.textContent=WK.fix?'Your location is the blue dot. The circle is how sure the GPS is.':'Looking for the GPS… Stand in the open, away from buildings.';
  if(warn){const rough=WK.fix&&ft>WALK_ROUGH_FT;warn.hidden=!rough;if(rough)warn.textContent=`GPS is rough right now (±${ft} ft). Wait a moment or move into the open.`}
  const net=$('#wNet');if(net){const off=netDown||navigator.onLine===false;net.hidden=!off;net.textContent=off?NOSIG:''}
  const tp=$('#wTileProg');if(tp&&WK.tiles)tp.textContent=`Keeping the map on this phone… ${Math.floor(WK.tiles.done/Math.max(1,WK.tiles.total)*100)}% (${fmtQ(Math.round(WK.tiles.bytes/1048576*10)/10)} MB)`;
  const live=$('#wLive'),last=l?.pts[l.pts.length-1];
  if(live)live.textContent=last&&WK.fix?`${fmtFt(ll(last).distanceTo(L.latLng(WK.fix.lat,WK.fix.lng))*FT)} from the ${WK.gate?'first gate post':'last point'} to you`:'';
  const f=$('#wFollow');if(f){f.checked=WK.follow;f.nextElementSibling.nextElementSibling.textContent=WK.follow?'On':'Off'}
  const lk=$('#wLock');if(lk)lk.textContent=WK.lockMsg==='on'?'The screen stays on while you walk.':WK.lockMsg==='none'||WK.lockMsg==='fail'?"This phone's browser can't keep the screen on by itself. Tap the screen now and then so it doesn't go dark.":WK.lockMsg==='off'?'The screen may go dark again: come back to this page to keep it on.':'';
  // on the map: the line so far (a one-point line isn't drawn with the others), and a dashed line from the last point to you
  walkLayer.clearLayers();
  if(l&&last){
    if(l.pts.length===1)L.circleMarker(ll(last),{radius:7,color:'#17191b',weight:2,fillColor:'#fff',fillOpacity:1,interactive:false}).addTo(walkLayer);
    if(WK.gate)L.circleMarker(ll(last),{radius:9,color:'#17191b',weight:2,fillColor:'#ffd21f',fillOpacity:1,interactive:false}).addTo(walkLayer);
    if(WK.fix)L.polyline([ll(last),[WK.fix.lat,WK.fix.lng]],{color:WK.gate?'#ffd21f':(S.fenceTypes.find(x=>x.id===l.type)?.color||'#fff'),weight:4,opacity:.95,dashArray:'8 8',interactive:false}).addTo(walkLayer);
  }
}
// put a spot in the middle of the part of the map you can see (above the walking buttons)
function walkView(f,z,anim){
  const box=$('#walkbox'),h=box&&!box.hidden?box.offsetHeight:0,zz=z??map.getZoom();
  map.setView(map.unproject(map.project([f.lat,f.lng],zz).add([0,h/2]),zz),zz,{animate:!!anim});
}
/* ---------- the map with no signal: the USGS aerial photo of an area kept on this phone ----------
   The pieces come through Fence Builder (api/off/tile/naip, from an area saved on the server when there is one) and
   are kept in the fb-tiles cache, which sw.js answers from. Esri's satellite photo may not be kept (its terms). */
const TILE_CAP_MB=150,TILE_KB=25,TILE_MAX=3000;
function keptTiles(){try{return JSON.parse(localStorage.getItem('fence-tiles')||'[]')}catch(e){return []}}
function tileList(b,z0,z1){const out=[];for(let z=z0;z<=z1;z++){const [x0,y0]=tileOf(b.getNorth(),b.getWest(),z),[x1,y1]=tileOf(b.getSouth(),b.getEast(),z);for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push(`api/off/tile/naip/${z}/${x}/${y}`)}return out}
function tilesHtml(){
  if(WK.tiles)return `<p class="wmsg" id="wTileProg">Keeping the map on this phone…</p>`;
  const k=keptTiles(),mb=k.reduce((a,x)=>a+(+x.mb||0),0);
  return `<div class="wmsg" style="margin-top:10px"><b>The map with no signal</b><br>${k.length?`The map of ${k.length===1?'one area':k.length+' areas'} is kept on this phone (${fmtQ(Math.max(1,Math.round(mb)))} MB). It shows when there is no signal.`:"Out of range, the map photo can't load (you still see your dot and the fence). Keep the map of this area on the phone first, while you have signal."}
    <div class="wrow"><button class="btn wmid" data-w="tiles">Keep this area's map on this phone</button>${k.length?'<button class="btn wmid del" data-w="tilesDel">Remove kept maps</button>':''}</div></div>`;
}
async function keepTiles(){
  if(navigator.onLine===false||netDown)return toast('This needs signal. Do it before you go out of range, for example at home on Wi-Fi.');
  if(!('caches' in window))return toast("This phone's browser can't keep the map.");
  // the area on the screen (zoom out first to take in more), and at least about half a mile around its middle
  const vb=map.getBounds(),c=vb.getCenter(),size=Math.min(6000,Math.max(800,vb.getNorthWest().distanceTo(vb.getSouthEast())/Math.SQRT2));
  const b=L.latLngBounds([c.toBounds(size).getSouthWest(),c.toBounds(size).getNorthEast(),vb.getSouthWest(),vb.getNorthEast()]);
  let z1=19,list;
  for(;;){list=tileList(b,13,z1);if((list.length*TILE_KB/1024<=TILE_CAP_MB&&list.length<=TILE_MAX)||z1<=15)break;z1--}
  const mb=Math.max(1,Math.round(list.length*TILE_KB/1024)),mi=fmtQ(Math.round(size*FT/5280*10)/10),mins=Math.max(1,Math.round(list.length/180));
  if(!await ask(`Keep the map of the area on the screen on this phone, so it shows with no signal? (Zoom the map out first to take in more.)\n\nAn area about ${mi} mile${mi==='1'?'':'s'} across: about ${mb} MB, ${mins} minute${mins===1?'':'s'} or so. Use Wi-Fi if you can.`))return;
  WK.tiles={done:0,total:list.length,bytes:0};renderWalk();
  const cache=await caches.open('fb-tiles');let i=0,fail=0;
  const one=async()=>{while(i<list.length){const u=new URL(list[i++],location.href).href;
    try{if(!await cache.match(u)){const r=await fetchT(u,{},20000);if(r.ok){WK.tiles.bytes+=(await r.clone().blob()).size;await cache.put(u,r)}else fail++}}catch(e){fail++}
    WK.tiles.done++;if(WK.tiles.done%8===0)updWalk()}};
  await Promise.all(Array.from({length:6},one));
  const got=list.length-fail,kept=keptTiles();
  if(got)kept.push({b:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],z1,n:got,mb:Math.round(WK.tiles.bytes/1048576*10)/10,at:new Date().toISOString()});
  try{localStorage.setItem('fence-tiles',JSON.stringify(kept))}catch(e){}
  WK.tiles=null;renderWalk();
  toast(!got?'The map could not be kept. Check the signal and try again.':fail?`The map is kept on this phone, but ${fail} of ${list.length} pieces did not come (no photo there, or the signal dropped).`:'The map of this area is kept on this phone.');
}
async function dropTiles(){if(!await ask('Remove the maps kept on this phone? The fence lines are not touched.'))return;try{await caches.delete('fb-tiles')}catch(e){}try{localStorage.removeItem('fence-tiles')}catch(e){}renderWalk();toast('The kept maps are removed.')}
$('#walkbox').addEventListener('click',e=>{
  const b=e.target.closest('[data-w]');if(!b||b.disabled)return;
  switch(b.dataset.w){
  case 'start':walkStart();break;
  case 'drop':walkDrop();break;
  case 'gate':walkGate();break;
  case 'undo':walkUndo();break;
  case 'finish':walkFinish();break;
  case 'cancel':walkCancel();break;
  case 'tiles':keepTiles();break;
  case 'tilesDel':dropTiles();break;
  case 'retry':WK.err='';gpsStart();renderWalk();break;
  case 'see':{const id=WK.done?.id;WK.done=null;walkOn=false;if(id&&getLine(id)){selectLine(id);setTimeout(()=>act('zoom',{id}),80)}else gotoTab('build');break}
  case 'bill':WK.done=null;walkOn=false;gotoTab('est');$('#panel').scrollTop=0;break;
  case 'otherJob':S.cur=b.dataset.id;selLine=null;selNode=null;WK.id=null;changed();fitProject();break;
  }
});
$('#walkbox').addEventListener('change',e=>{
  if(e.target.id==='wFollow'){WK.follow=e.target.checked;if(WK.follow&&WK.fix)walkView(WK.fix,Math.max(map.getZoom(),18),true);updWalk()}
  if(e.target.id==='wType'){WK.type=e.target.value;setDrawType(WK.type);save()}
});
