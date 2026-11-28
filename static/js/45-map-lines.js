/* ---------- undo / redo (fence lines of the open project) ---------- */
const hist={u:[],r:[]};let snapNow=null,snapCur=null;
const snapState=()=>JSON.stringify(P().lines);
function record(){
  const now=snapState();
  if(snapCur!==S.cur){hist.u=[];hist.r=[]}
  else if(snapNow!=null&&now!==snapNow){hist.u.push(snapNow);if(hist.u.length>100)hist.u.shift();hist.r=[]}
  snapNow=now;snapCur=S.cur;histButtons();
}
function restore(from,to,word){
  if(mode!=='idle')cancelDraw();
  if(!from.length)return toast('Nothing to '+word);
  to.push(snapNow);P().lines=JSON.parse(from.pop());snapNow=snapState();
  selNode=null;if(selLine&&!getLine(selLine))selLine=null;map.closePopup();
  save();renderAll();scheduleElev();histButtons();
}
const undo=()=>restore(hist.u,hist.r,'undo'),redo=()=>restore(hist.r,hist.u,'redo');
function histButtons(){$('#bHU').disabled=!hist.u.length;$('#bHR').disabled=!hist.r.length}

$('#bHU').onclick=undo;$('#bHR').onclick=redo;$('#bRefresh').onclick=refreshNow;
let showDims=localStorage.getItem('fence-dims')!=='0';
let showRolls=localStorage.getItem('fence-rolls')!=='0';
const syncDims=()=>{$('#bDims').classList.toggle('on',showDims);$('#bRolls').classList.toggle('on',showRolls)};syncDims();
$('#bRolls').onclick=()=>{showRolls=!showRolls;try{localStorage.setItem('fence-rolls',showRolls?'1':'0')}catch(e){}syncDims();if(A)drawMap()};
$('#bDims').onclick=()=>{showDims=!showDims;try{localStorage.setItem('fence-dims',showDims?'1':'0')}catch(e){}syncDims();if(A)drawMap()};$('#bClear').onclick=()=>act('clearLines',{});

/* ---------- fence lines on the map ---------- */
let A=null;
let rollEndsBy={};   // roll layout per fence type, worked out once per map drawing
// a spot `dist` meters along a line from point i, toward the next points (dir 1) or the earlier ones (dir -1)
function alongLine(pts,i,dir,dist){let cur=ll(pts[i]),j=i+dir;
  while(j>=0&&j<pts.length){const nx=ll(pts[j]),d=cur.distanceTo(nx);if(d>=dist){const f=dist/(d||1);return L.latLng(cur.lat+(nx.lat-cur.lat)*f,cur.lng+(nx.lng-cur.lng)*f)}dist-=d;cur=nx;j+=dir}
  return cur}
// the stretch of a line from a to b meters away from point i, in one direction, as map points
function alongPath(pts,i,dir,a,b){const out=[alongLine(pts,i,dir,a)];let cur=ll(pts[i]),j=i+dir,run=0;
  while(j>=0&&j<pts.length){const nx=ll(pts[j]),d=cur.distanceTo(nx);if(run+d>a&&run+d<b)out.push(nx);run+=d;if(run>=b)break;cur=nx;j+=dir}
  out.push(alongLine(pts,i,dir,b));return out}
function drawGate(l,i,t){
  const p=l.pts[i],half=(+p.gw||+t?.gateW||16)/FT/2,pts=l.pts;
  const kit=S.braces.find(b=>b.id===t?.braceGate),sh=kit?braceShape(kit):null;
  const reach=sh&&sh.style!=='single'?Math.max(1,+sh.span||8)*(sh.style==='a'||sh.style==='aa'?1:Math.max(1,Math.round(+sh.bays||1)))/FT:0;
  const ends=[];
  for(const dir of [-1,1]){
    if(!(i+dir>=0&&i+dir<pts.length))continue;   // a gate at the very end of a line has a post on one side only
    const post=alongLine(pts,i,dir,half);ends.push(post);
    if(reach)for(const w of [[9,'#000',.45],[6,'#c98a3c',1]])L.polyline(alongPath(pts,i,dir,half,half+reach),{weight:w[0],color:w[1],opacity:w[2],interactive:false}).addTo(layer);
    L.marker(post,{interactive:true,keyboard:false,title:kit?`Gate brace: ${kit.name}`:'Gate post (no brace set for gates on this fence type)',icon:L.divIcon({className:'nd brace gatepost',iconSize:[14,14]})}).addTo(layer)
      .on('click',e=>{L.DomEvent.stop(e);if(mode!=='idle')return;L.popup({maxWidth:260}).setLatLng(post).setContent(`<div class="small mut">Gate post</div><b>${esc(kit?kit.name:'No brace')}</b><div class="small mut" style="margin-top:4px">${kit?'The brace on this side of the gate. Change it on the fence type ("Each side of a gate").':'Set a brace for "Each side of a gate" on the fence type.'}</div>`).openOn(map)});
  }
  // the opening: a dark gap with white dashes, so it reads as "no fence here" whatever the fence's color
  if(ends.length===2)for(const w of [[10,'#17191b',.95],[4,'#ffffff',1]])L.polyline([ends[0],ends[1]],{weight:w[0],color:w[1],opacity:w[2],dashArray:w[1]==='#ffffff'?'6 6':null,interactive:false}).addTo(layer);
}
function drawMap(){rollEndsBy={};
  layer.clearLayers();
  for(const l of P().lines){
    if(l.pts.length<2)continue;
    const t=S.fenceTypes.find(x=>x.id===l.type),col=t?.color||'#fff',sel=l.id===selLine;
    L.polyline(l.pts.map(ll),{color:'#000',weight:sel?10:7,opacity:sel?.55:.35,interactive:false}).addTo(layer);
    const pl=L.polyline(l.pts.map(ll),{color:col,weight:sel?5:4,opacity:1}).addTo(layer);
    pl.on('click',e=>{L.DomEvent.stop(e);if(mode==='gate'||mode==='brace')return addOnLine(e.latlng);if(mode==='draw')return addDraftPoint(snap(e.latlng));selectLine(l.id)});
    if(sel)for(let i=1;i<l.pts.length;i++){
      const a=ll(l.pts[i-1]),b=ll(l.pts[i]),px=pxLen(a,b);
      if(px>=60&&!showDims)segLabel(a,b,fmtFt(a.distanceTo(b)*FT)).addTo(layer);
      if(mode!=='idle'||px<28)continue;
      // handle in the middle of each side: drag it (or click it) to add a corner there
      const mid=L.latLng((a.lat+b.lat)/2,(a.lng+b.lng)/2);
      const h=L.marker(mid,{draggable:true,keyboard:false,title:'Drag to add a corner',icon:L.divIcon({className:'nd mid',iconSize:[12,12]})}).addTo(layer);
      h.on('click',e=>{L.DomEvent.stop(e);if(mode==='gate'||mode==='brace')return addOnLine(e.latlng);if(mode==='draw')return addDraftPoint(snap(e.latlng));insertPt(l,i,mid)});
      h.on('dragend',e=>insertPt(l,i,e.target.getLatLng()));
    }
    // each gate: the opening, a post on each side, and how far each side's brace reaches along the fence
    l.pts.forEach((p,i)=>{if(A.nodes.get(key(p))?.brace==='gate')drawGate(l,i,t)});
    l.pts.forEach((p,i)=>{
      const o=A.nodes.get(key(p));if(!o)return;
      const cls=o.brace==='gate'?'gate':o.brace==='none'?'pt':'brace';
      if(cls==='pt'&&!sel)return;
      const on=selNode&&selNode.l===l.id&&selNode.i===i;
      const s=cls==='pt'?12:cls==='gate'?18:15;
      const m=L.marker(ll(p),{draggable:sel&&mode==='idle',keyboard:false,title:cls==='gate'?'Gate: drag to slide it along the fence':'Click to change, drag to move',icon:L.divIcon({className:'nd '+cls+(on?' on':''),iconSize:[s,s]})}).addTo(layer);
      m.on('click',e=>{L.DomEvent.stop(e);if(mode==='draw')return addDraftPoint({lat:p.lat,lng:p.lng});if(mode==='gate'||mode==='brace')return addOnLine(e.latlng);
        selLine=l.id;selNode={l:l.id,i};S.tab='build';renderAll();openPointPopup(l.id,i);
        setTimeout(()=>document.querySelector('.nodes tr.on')?.scrollIntoView({block:'nearest'}),0)});
      // a gate in the middle of a line slides along that line instead of bending it
      if(cls==='gate'&&i>0&&i<l.pts.length-1)m.on('drag',e=>{
        const a=map.latLngToLayerPoint(ll(l.pts[i-1])),b=map.latLngToLayerPoint(ll(l.pts[i+1]));
        e.target.setLatLng(map.layerPointToLatLng(L.LineUtil.closestPointOnSegment(map.latLngToLayerPoint(e.target.getLatLng()),a,b)));
      });
      m.on('dragstart',()=>map.closePopup());
      m.on('dragend',e=>{const q=e.target.getLatLng(),k=key(p),nk=key({lat:q.lat,lng:q.lng});for(const l2 of P().lines){for(const p2 of l2.pts)if(key(p2)===k){p2.lat=q.lat;p2.lng=q.lng}
        if(l2.cust)for(const ck of Object.keys(l2.cust)){const nn=ck.split('>').map(x=>x===k?nk:x).join('>');if(nn!==ck){l2.cust[nn]=l2.cust[ck];delete l2.cust[ck]}}}selNode={l:l.id,i};changed()});
    });
  }
  if((showDims||showRolls)&&UI.map)for(const r of A.lines)if(!r.manual)drawDims(r.l,r);
  // every line post as a dot once you're zoomed in; on the selected line they are handles you can drag or click
  if(map.getZoom()>=17&&UI.map){
    const b=map.getBounds().pad(0.2);let shown=0;
    for(const r of A.lines){
      if(r.manual||shown>3000)continue;const sp=postSpots(r.l,r),edit=r.l.id===selLine&&mode==='idle';
      for(const m of sp.marks){
        if(!b.contains(m.ll))continue;shown++;
        if(m.k==='m'){L.circleMarker(m.ll,{radius:1.8,color:'#17191b',weight:1,fillColor:'#9aa3ab',fillOpacity:1,interactive:false}).addTo(layer);continue}   // in between posts and stays
        if(edit){
          const pull=m.k==='p',mk=L.marker(m.ll,{draggable:true,keyboard:false,title:'Drag to move it along the fence, click for options',icon:L.divIcon({className:'nd '+(pull?'brace pull':m.k>=0?'post wood':'post'),iconSize:pull?[13,13]:[10,10]})}).addTo(layer);
          mk.on('click',e=>{L.DomEvent.stop(e);openPostPopup(r.l.id,m.si,m.ii)});
          mk.on('dragstart',()=>map.closePopup());
          mk.on('drag',e=>e.target.setLatLng(sp.at(sp.near(e.target.getLatLng(),sp.st[m.si]))));
          mk.on('dragend',e=>{const S2=sp.st[m.si];movePost(r.l.id,m.si,m.ii,(sp.near(e.target.getLatLng(),S2)-S2.d0)/((S2.d1-S2.d0)||1))});
        }
        else if(m.k==='p')L.marker(m.ll,{interactive:false,keyboard:false,icon:L.divIcon({className:'nd brace',iconSize:[11,11]})}).addTo(layer);
        else L.circleMarker(m.ll,{radius:m.k>=0?3.2:2.4,color:'#17191b',weight:1,fillColor:m.k>=0?'#b98a5a':'#fff',fillOpacity:1,interactive:false}).addTo(layer);
      }
    }
  }
  renderMapSum();
}
map.on('zoomend moveend',()=>{if(S&&A&&UI.map&&mode==='idle'&&!dragging)drawMap()});
let dragging=false;map.on('dragstart',()=>dragging=true);map.on('dragend',()=>{dragging=false});
/* after drawing a new line: which fence type is it? */
function openTypePicker(lid){
  const l=getLine(lid);if(!l||l.pts.length<2)return;const r=A.lines.find(x=>x.l===l);
  const el=document.createElement('div');el.className='typick';
  el.innerHTML=`<b>What kind of fence is this?</b><div class="small mut">${r?fmtFt(r.len)+'. ':''}You can change it any time.</div>
    <div class="tplist">${S.fenceTypes.map(t=>`<button class="tli${t.id===l.type?' on':''}" data-t="${t.id}"><span class="dot" style="background:${esc(t.color)}"></span><span class="grow"><b>${esc(t.name)}</b></span></button>`).join('')}</div>
    <label class="f">Name</label><input type="text" value="${esc(l.name)}" aria-label="Line name">`;
  const nameIn=el.querySelector('input');
  el.addEventListener('click',e=>{const b=e.target.closest('[data-t]');if(!b)return;l.type=b.dataset.t;setDrawType(l.type);l.name=nameIn.value.trim()||l.name;map.closePopup();changed()});
  nameIn.addEventListener('keydown',e=>{if(e.key==='Enter'){l.name=nameIn.value.trim()||l.name;map.closePopup();changed()}});
  L.popup({minWidth:240,maxWidth:300,autoPanPadding:[30,30]}).setLatLng(ll(l.pts[l.pts.length-1])).setContent(el).openOn(map);
}
/* dimension lines, like on an engineering drawing: one for each stretch between braces, set off to the side of the fence */
function drawDims(l,r){
  const pts=l.pts,lp=pts.map(p=>map.latLngToLayerPoint(ll(p))),OFF=20;
  const stops=[];pts.forEach((p,i)=>{const b=A.nodes.get(key(p))?.brace??'none';if(i===0||i===pts.length-1||b!=='none')stops.push(i)});
  const LL=q=>map.layerPointToLatLng(q),ln=(a,b,w,c,o)=>L.polyline([LL(a),LL(b)],{color:c,weight:w,opacity:o,interactive:false}).addTo(layer);
  const stroke=(a,b)=>{ln(a,b,4,'#000',.45);ln(a,b,1.5,'#fff',1)};
  // cut a path (list of pixel points) from distance d0 to d1 along it
  const cut=(path,d0,d1)=>{const out=[];let acc=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=a.distanceTo(b);if(!len)continue;const s0=acc,s1=acc+len;
      if(s1>d0&&s0<d1){const f0=Math.max(0,(d0-s0)/len),f1=Math.min(1,(d1-s0)/len);if(!out.length)out.push(L.point(a.x+(b.x-a.x)*f0,a.y+(b.y-a.y)*f0));out.push(L.point(a.x+(b.x-a.x)*f1,a.y+(b.y-a.y)*f1))}acc=s1}return out};
  let at=lineStartFt(r);   // feet of this fence type laid before this piece: rolls carry on across braces and lines
  for(let k=1;k<stops.length;k++){
    const info=r.stretches?.[k-1];if(!info||info.len<=0)continue;
    const path=lp.slice(stops[k-1],stops[k]+1);let total=0;for(let i=1;i<path.length;i++)total+=path[i-1].distanceTo(path[i]);
    const cuts=[0,...info.items.filter(x=>x.k==='p').map(x=>x.f),1];
    for(let p=0;p<cuts.length-1;p++){
      const part=cut(path,total*cuts[p],total*cuts[p+1]);if(part.length<2)continue;
      const at0=at;at+=info.len*(cuts[p+1]-cuts[p]);
      let plen=0;for(let i=1;i<part.length;i++)plen+=part[i-1].distanceTo(part[i]);if(plen<64)continue;
      const side=(path,dist)=>path.map((q,i)=>{const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;return L.point(q.x-dy/d*dist,q.y+dx/d*dist)});
      const plenOf=path=>{let t=0;for(let i=1;i<path.length;i++)t+=path[i-1].distanceTo(path[i]);return t};
      const midOf=path=>{const tl=plenOf(path);let acc=0;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=a.distanceTo(b);if(acc+len>=tl/2||i===path.length-1){const f=len?Math.min(1,Math.max(0,(tl/2-acc)/len)):0;let ang=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(ang>90)ang-=180;if(ang<-90)ang+=180;return {pt:L.point(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f),ang}}acc+=len}return {pt:path[0],ang:0}};
      const label=(m,cls,txt)=>L.marker(LL(m.pt),{interactive:false,keyboard:false,icon:L.divIcon({className:cls,iconSize:[0,0],html:`<span style="transform:translate(-50%,-50%) rotate(${m.ang.toFixed(1)}deg)">${txt}</span>`})}).addTo(layer);
      const flen=info.len*(cuts[p+1]-cuts[p]);
      if(showDims){
        // dimension line set off to one side, with an extension line and tick at each end and the length on it
        const off=side(part,OFF);
        for(let i=1;i<off.length;i++)stroke(off[i-1],off[i]);
        for(const i of [0,part.length-1]){
          const q=part[i],e=off[i],nx=(e.x-q.x)/OFF,ny=(e.y-q.y)/OFF;stroke(L.point(q.x+nx*5,q.y+ny*5),L.point(q.x+nx*(OFF+6),q.y+ny*(OFF+6)));
          const tx=-ny,ty=nx;stroke(L.point(e.x-(tx+nx)*4,e.y-(ty+ny)*4),L.point(e.x+(tx+nx)*4,e.y+(ty+ny)*4))}
        label(midOf(off),'dimlab',fmtFt(flen));
      }
      // the rolls of the main wire, laid end to end along the other side of the fence: one band per roll
      const ends=showRolls?(rollEndsBy[r.t.id]??=rollEnds(r.t)):[];
      if(ends.length){
        // a roll carries on past a brace into the next stretch until it runs out (in fence feet, with the sag and splice extra)
        const W=1+(+r.t.waste||0)/100,mixed=new Set(ends.map(e=>e.roll)).size>1;let pos=0;
        while(pos<flen-1e-6){
          const abs=at0+pos;let q=ends.findIndex(e=>abs<e.end-1e-6);if(q<0)break;
          const Rl=ends[q].roll,take=Math.min(flen-pos,ends[q].end-abs);
          const seg=cut(part,plen*pos/flen,plen*Math.min(1,(pos+take)/flen));
          if(seg.length>=2){
            const band=side(seg,-13),col=q%2?'#ffb454':'#58b0ff';
            for(let i=1;i<band.length;i++){ln(band[i-1],band[i],8,'#000',.5);ln(band[i-1],band[i],5,col,1)}
            if(pos>0){const a=seg[0],b=band[0],nx=(b.x-a.x)/13,ny=(b.y-a.y)/13;stroke(L.point(a.x-nx*4,a.y-ny*4),L.point(a.x+nx*20,a.y+ny*20))}   // where two rolls join
            // "Roll 1 · 284 ft, 376 left" / "Rest of roll 1 · 357 ft" / last roll: what's spare
            const start=ends[q].end-Rl/W,left=(ends[q].end-(abs+take))*W,cont=abs>start+0.5/W,lastRoll=q===ends.length-1;
            const txt=`${cont?'Rest of roll':'Roll'} ${q+1}${mixed?` (${fmtQ(Rl)} ft)`:''} · ${fmtFt(take)}`+(left>0.5?(lastRoll&&pos+take>=flen-1e-6&&isLastPiece(r,k,p)?`, ${fmtFt(left)} spare`:`, ${fmtFt(left/W)} left`):'');
            if(plenOf(band)>=58)label(midOf(band),'rolllab r'+(q%2),txt);
          }
          pos+=Math.max(take,1e-3);
        }
      }
    }
  }
}
function insertPt(l,i,q){l.pts.splice(i,0,{lat:q.lat,lng:q.lng,brace:null});selNode={l:l.id,i};changed()}
function selectLine(id){selLine=id;selNode=null;S.tab='build';map.closePopup();renderAll()}

/* click a point: change its brace, make it a gate, delete it, or keep drawing from an end */
function openPointPopup(lid,i){
  const l=getLine(lid);if(!l||!l.pts[i]||!A)return;
  const p=l.pts[i],o=A.nodes.get(key(p));if(!o)return;
  const cur=p.brace??'',isEnd=i===0||i===l.pts.length-1,d=`data-id="${lid}" data-i="${i}"`;
  const el=document.createElement('div');el.className='ptpop';
  el.innerHTML=`<div class="small mut">${esc(l.name)}, point ${i+1} of ${l.pts.length}</div>
    <b>${o.brace==='gate'?'Gate':o.role+(o.refs.length>1?' (shared)':'')}</b>
    <label class="f">Brace</label><select data-f="node.brace" ${d}>${opt('',`Auto (${kitName(o.auto)})`,cur)}${S.braces.map(b=>opt(b.id,b.name,cur)).join('')}${opt('none','No brace (line post)',cur)}${opt('gate','Gate opening',cur)}</select>
    ${p.brace==='gate'?`<div class="g2"><div><label class="f">Width ft</label><input type="number" min="1" step="1" value="${+p.gw||0}" data-f="node.gw" ${d}></div><div><label class="f">Gate</label><select data-f="node.gm" ${d}>${matOpts(p.gm)}</select></div></div>
      ${!isEnd?'<p class="small mut" style="margin:6px 0 0">Drag the gate to slide it along the fence.</p>':''}`:''}
    <div class="row" style="margin-top:10px">${isEnd?'<button class="btn sm" data-k="cont">Keep drawing from here</button>':''}<button class="btn sm del" data-k="del">Delete point</button></div>`;
  el.addEventListener('change',e=>{if(e.target.dataset.f){setField(e.target);setTimeout(()=>openPointPopup(lid,i),0)}});
  el.addEventListener('click',e=>{const k=e.target.closest('[data-k]')?.dataset.k;if(!k)return;map.closePopup();
    if(k==='del')act('delPt',{id:lid,i});
    if(k==='cont'){if(i===0){l.pts.reverse();flipCust(l)}startDraw(lid)}});
  L.popup({minWidth:220,maxWidth:260,offset:[0,-4],autoPanPadding:[20,20]}).setLatLng(ll(p)).setContent(el).openOn(map);
}

