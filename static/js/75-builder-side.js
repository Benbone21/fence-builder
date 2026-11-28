/* ---------- builder sidebar: set the fence up, then draw it ---------- */
function gapText(r){
  const ss=(r.stretches||[]).filter(x=>x.items.some(i=>i.k!=='p'));if(!ss.length)return '';
  const a=Math.min(...ss.map(x=>x.gmin)),b=Math.max(...ss.map(x=>x.gmax)),f=v=>v.toFixed(1),set=+r.t.spacing||12,nc=r.stretches.filter(x=>x.custom).length;
  const range=b-a<0.05?f(a):f(a)+' to '+f(b);
  return nc?`${nc} stretch${nc>1?'es have':' has'} posts you placed by hand. Gaps run ${range} ft.`:`Posts are evened out between braces: ${range} ft apart (you set ${set} ft).`;
}
// Two views. Setting up: the job's two key numbers, pick the fence type, draw; the rest in sections that start closed.
// One line (after clicking it): see lineView. Sections remember open or closed (openKeep, data-keep).
function sideView(){
  const sel=selLine&&getLine(selLine)&&A.lines.find(x=>x.l.id===selLine);
  if(sel)return lineView();
  const head=`<div class="sum two sidesum"><div><span>Fence in this job</span><b>${fmtFt(A.totalFt)}</b>${A.area?`<span class="small mut areanote">${fmtAcres(A.area)} fenced in</span>`:''}</div><div class="tot"><span>Materials with tax</span><b>${money(A.sub+A.tax)}</b></div></div>
    <div class="row sumbtns"><button class="btn grow" data-act="tab" data-tab="est">Final bill: what to buy and the cost</button></div>`;
  const nOn=AUTO_KINDS.filter(x=>autoOn(x[0])).length;
  const auto=`<details class="sbox" data-keep="sideAuto"${openKeep.sideAuto?' open':''}><summary><b>Braces added for you</b><span class="sboxsum">${nOn} of 4 on</span></summary><div class="sboxbody">${autoSwitches('sidecross')}</div></details>`;
  const drawn=A.lines.filter(r=>!r.manual);
  const list=drawn.length?`<details class="sbox" data-keep="sideLines"${openKeep.sideLines!==false?' open':''}><summary><b>Fence lines in this job</b><span class="sboxsum">${drawn.length} line${drawn.length>1?'s':''}</span></summary><div class="sboxbody"><p class="small mut" style="margin:0 0 8px">Click a line to see its posts, braces and ground.</p><div class="box">${drawn.map(r=>`<button class="tli${r.l.id===selLine?' on':''}" data-act="sel" data-id="${r.l.id}"><span class="dot" style="background:${esc(r.t.color)}"></span><span class="grow"><b>${esc(r.l.name)}</b><span class="small mut">${esc(r.t.name)}${r.area?` · fences in ${fmtAcres(r.area)}`:''}</span></span><span class="num">${fmtFt(r.len)}</span></button>`).join('')}</div></div></details>`:'';
  const [top,rest]=setupView();return head+top+list+auto+rest;
}
function setupView(){
  const t=TYP(drawTypeId())||TYP(S.fenceTypes[0]?.id);if(!t)return ['<p class="mut">Make a fence type first, on the Fence types page.</p>',''];
  const d=`data-id="${t.id}"`,n=v=>+v||0;
  const num=(f,v)=>`<input type="number" min="0" step="any" value="${n(v)}" data-f="ft.${f}" ${d}>`;
  const kitSel=f=>`<select data-f="ft.${f}" ${d}>${kitOpts(t[f])}${opt('none','No brace',t[f])}</select>`;
  const q=A.types[t.id]?.q;
  const wires=(t.wires||[]).map((w,i)=>{const u=unitOf(w.m)||'each',need=q?.wires[i],lo=q?.left?.[i];
    return `<div class="wr"><select data-f="ftw.m" ${d} data-i="${i}" aria-label="Wire product">${matOpts(w.m,true)}</select>
    <label class="mini"><input type="number" min="0" step="1" value="${n(w.strands)}" data-f="ftw.strands" ${d} data-i="${i}" aria-label="Strands"><span>${(lk=>lk==='board'||lk==='rail'||lk==='log'?(n(w.strands)===1?'row':'rows'):lk==='picket'||lk==='panel'?(n(w.strands)===1?'layer':'layers'):n(w.strands)===1?'strand':'strands')(wireLook(matOf(w.m)))}</span></label>
    <label class="mini">${matOf(w.m)?`${matLink(w.m,fmtQ(rollOf(w)))}`:''}<span>${(lk=>lk==='board'||lk==='rail'||lk==='log'?'ft long':lk==='picket'||lk==='panel'?'ft wide each':'ft on a roll')(wireLook(matOf(w.m)))}</span></label>
    <button class="btn x" data-act="delFtw" ${d} data-i="${i}" title="Remove">×</button>
    <label class="mini"><span>$</span>${priceIn(w.m)}<span>per ${esc(u)}</span></label>
    <span class="small mut need">${lo?.mix?`This job needs ${esc(lo.mix)} rolls. `:need!=null?`This job needs ${fmtQ(roundQ(need,u)||0)} ${esc(u)}${u==="roll"&&roundQ(need,u)!==1?"s":""}. `:''}${lo&&lo.bought>0?`<b class="left">${lo.left>=1?`About ${fmtQ(Math.round(lo.left))} ft left over`:'No wire left over'}</b>${lo.left>=1?lo.mix?' on the last roll':lo.left<lo.roll?` (${Math.round(lo.left/lo.roll*100)}% of a ${fmtQ(lo.roll)} ft roll)`:'':''}. `:''}${matOf(w.m)?`<button class="lnk" data-act="matInfo" data-id="${w.m}">Details</button>`:''}</span></div>`}).join('');
  const apply=(()=>{const n=P().lines.filter(l=>l.type!==t.id).length;return n?`<button class="btn" data-act="applyType" data-id="${t.id}" style="margin-top:8px;width:100%;white-space:normal;padding:8px 12px">Switch the ${n===P().lines.length?'whole fence':n+' other line'+(n>1?'s':'')} in this job to ${esc(t.name)}</button>`:''})();
  return [`<h2 class="stp"><span class="stpn">1</span>Pick the kind of fence</h2>
  <div class="pick"><select data-f="ui.drawType" aria-label="Fence type">${typeOpts(t.id)}</select><button class="btn" data-act="addFt">New type</button></div>
  ${apply}
  <h2 class="stp"><span class="stpn">2</span>Draw it on the map${drawnNote()}</h2>
  <div class="row drawbtns"><button class="btn pri big" data-act="draw">${mode==='draw'?'Finish line':'Draw fence'}</button><button class="btn big" data-act="gate">Add gate</button><button class="btn big" data-act="brace">Add brace</button></div>
  <details class="help sidehelp" data-keep="sideDrawHelp"${openKeep.sideDrawHelp?' open':''}><summary>How to draw</summary><p class="small">Press <b>Draw fence</b>, then click each corner on the map. Press <b>Finish line</b> at the end. Every spot you click gets a brace (a bend gets a corner brace), and the posts space themselves evenly in between. Zoom in to see every post. You can also <b>right-click</b> the map to pick what goes there.</p></details>`,
  `${saveBar('Ft',t.id)}${elkNote(t)}<details class="stepbox" data-keep="side3"${openKeep.side3?' open':''}><summary><h2 class="stp"><span class="stpn">3</span>Check what goes into it<span class="stpmore">Show</span></h2><span class="small mut stepsum">${esc(t.name)}: ${esc(typeSummary(t))}</span></summary>
  <p class="small mut" style="margin:0 0 8px">These are the settings of the fence type <b>${esc(t.name)}</b>. A change here counts for every job that uses it, once you press Save.</p>
  <div class="sec"><h3>Wire</h3>${wires||'<p class="small mut" style="margin:0 0 6px">No wire yet.</p>'}
    <button class="btn sm" data-act="addFtw" ${d}>Add wire</button>
    <p class="small mut" style="margin:6px 0 0">Strands is how many wires of that product run the length of the fence: 1 for a woven wire roll, 2 for two barbed wires on top, and so on.</p></div>
  <div class="sec"><h3>Posts</h3>
    ${postsEditor(t)}</div>
  <div class="sec"><h3>Braces</h3><div class="g2">
    <div><label class="f">Ends</label>${kitSel('braceEnd')}</div><div><label class="f">Corners</label>${kitSel('braceCorner')}</div>
    <div><label class="f">Each side of a gate</label>${kitSel('braceGate')}</div><div><label class="f">Pull braces on long runs</label>${kitSel('bracePull')}</div>
    <div><label class="f">Hill braces: slope change %</label>${num('hillGrade',t.hillGrade??15)}</div></div></div>
  <details class="sec more" data-keep="sideMore"${openKeep.sideMore?' open':''}><summary><b>More options</b> <span class="small mut">labor, height, clips, gate width, longest pull</span></summary>
    <div class="g2"><div><label class="f">Labor $ per foot</label>${num('labor',t.labor)}</div><div><label class="f">Fence height ft</label>${num('height',t.height||4.5)}</div>
    <div><label class="f">Clips per normal post</label>${num('clipsPer',t.clipsPer)}</div><div><label class="f">Gate width ft</label>${num('gateW',t.gateW)}</div></div>${adviceHtml(t)}
    <div>${stretchFields(t)}</div></details>
  <button class="btn" data-act="editFt" ${d} style="width:100%;white-space:normal;padding:8px 12px">Open every option for ${esc(t.name)}</button></details>`];
}

/* where each line post sits, for the dots on the map (matches the counts in the estimate) */
function postSpots(l,r){
  const pts=l.pts,cum=[0];for(let i=1;i<pts.length;i++)cum[i]=cum[i-1]+ll(pts[i-1]).distanceTo(ll(pts[i]))*FT;
  const total=cum[cum.length-1],at=d=>{d=Math.min(total,Math.max(0,d));let i=0;while(i<pts.length-2&&cum[i+1]<d)i++;const f=(d-cum[i])/((cum[i+1]-cum[i])||1);return [pts[i].lat+(pts[i+1].lat-pts[i].lat)*f,pts[i].lng+(pts[i+1].lng-pts[i].lng)*f]};
  // distance along the line (ft) of the spot on it nearest to a map position, kept inside one stretch
  const near=(latlng,st)=>{const q=map.latLngToLayerPoint(latlng);let best=null;
    for(let i=1;i<pts.length;i++){const a=map.latLngToLayerPoint(ll(pts[i-1])),b=map.latLngToLayerPoint(ll(pts[i])),c=L.LineUtil.closestPointOnSegment(q,a,b),dd=c.distanceTo(q),len=a.distanceTo(b)||1;
      const d=cum[i-1]+(cum[i]-cum[i-1])*a.distanceTo(c)/len;if(d<st.d0-1e-6||d>st.d1+1e-6)continue;if(!best||dd<best.dd)best={dd,d}}
    return best?best.d:Math.min(st.d1,Math.max(st.d0,st.d0))};
  const stops=[];pts.forEach((p,i)=>{const o=A.nodes.get(key(p)),b=o?.brace??'none';if(i===0||i===pts.length-1||b!=='none')stops.push({d:cum[i],gw:b==='gate'?Math.max(0,+o.pt.gw||0):0})});
  const marks=[],st=[];
  for(let k=1;k<stops.length;k++){
    const info=r.stretches?.[k-1];if(!info)break;
    const d0=stops[k-1].d+stops[k-1].gw/2,d1=stops[k].d-stops[k].gw/2;st[k-1]={d0,d1};if(d1<=d0)continue;
    info.items.forEach((it,ii)=>marks.push({ll:at(d0+(d1-d0)*it.f),k:it.k,si:k-1,ii}));
    for(const m of info.mids||[])marks.push({ll:at(d0+(d1-d0)*m.f),k:'m',si:k-1});
  }
  return {marks,st,at,near};
}
/* your own layout for a stretch: starts as a copy of the automatic one the first time you change something */
// Put a line on another fence type and rebuild it from that type: posts go back to automatic at the
// new spacing, and braces or gates that came from the old type switch to the new type's.
function retype(l,typeId){
  const old=S.fenceTypes.find(x=>x.id===l.type),nt=S.fenceTypes.find(x=>x.id===typeId);if(!nt)return;
  l.type=typeId;delete l.cust;
  if(!old||old===nt)return;
  const oldKits=new Set([old.braceEnd,old.braceCorner,old.bracePull,old.braceGate].filter(x=>x&&x!=='none'));
  for(const q of l.pts||[]){
    if(q.brace==='gate'){if(q.gm===old.gateM)q.gm=nt.gateM;if(+q.gw===+old.gateW)q.gw=+nt.gateW||q.gw}
    else if(q.brace&&oldKits.has(q.brace))q.brace=null;   // back to automatic, so it follows the new type
  }
}
function custOf(l,r,si){const s=r.stretches[si];l.cust=l.cust||{};if(!Array.isArray(l.cust[s.key]))l.cust[s.key]=s.items.map(x=>({f:x.f,k:x.k}));return l.cust[s.key]}
// a brace you put in by hand becomes a real brace point on the line, so the fence is worked out again on
// both sides of it: posts re-space and the automatic pull braces come or go as needed
function bracePointAt(lid,si,f){
  const l=getLine(lid),r=A.lines.find(x=>x.l===l),s=r?.stretches[si];if(!s)return false;
  const sp=postSpots(l,r),S2=sp.st[si];if(!S2)return false;
  const d=S2.d0+(S2.d1-S2.d0)*f,[lat,lng]=sp.at(d);
  let cum=0,at=l.pts.length-1;for(let i=1;i<l.pts.length;i++){const seg=ll(l.pts[i-1]).distanceTo(ll(l.pts[i]))*FT;if(cum+seg>=d){at=i;break}cum+=seg}
  const kit=braceFor(r.t);if(!kit){toast('Make a brace on the Braces tab first');return false}
  if(l.cust)delete l.cust[s.key];   // this stretch is split in two now
  l.pts.splice(at,0,{lat,lng,brace:kit});selNode={l:l.id,i:at};changed();
  toast('Brace added. The posts and pull braces on each side were worked out again.');return true;
}
function movePost(lid,si,ii,f){
  const l=getLine(lid),r=A.lines.find(x=>x.l===l);if(!r?.stretches[si])return;
  // dragging a pull brace on an automatic stretch: put a real brace where it was dropped and work the rest out again
  if(r.stretches[si].items[ii]?.k==='p'&&!r.stretches[si].custom){bracePointAt(lid,si,Math.min(0.995,Math.max(0.005,f)));return}
  const c=custOf(l,r,si);if(!c[ii])return;c[ii].f=Math.min(0.995,Math.max(0.005,f));c.sort((a,b)=>a.f-b.f);changed();
}
function flipCust(l){if(!l.cust)return;const o={};for(const [k,v] of Object.entries(l.cust)){const [a,b]=k.split('>');o[b+'>'+a]=v.map(x=>({f:1-x.f,k:x.k})).reverse()}l.cust=o}
function openPostPopup(lid,si,ii){
  const l=getLine(lid),r=l&&A.lines.find(x=>x.l===l),s=r?.stretches[si],it=s?.items[ii];if(!it)return;
  const t=r.t,m=postSpots(l,r).marks.find(x=>x.si===si&&x.ii===ii);if(!m)return;
  const prev=(it.f-(s.items[ii-1]?.f??0))*s.len,next=((s.items[ii+1]?.f??1)-it.f)*s.len;
  const el=document.createElement('div');el.className='ptpop';
  el.innerHTML=`<div class="small mut">${esc(l.name)}, stretch ${si+1}</div><b>${it.k==='p'?'Pull brace':'Post'}</b>
    <div class="small mut">${prev.toFixed(1)} ft from the last one, ${next.toFixed(1)} ft to the next</div>
    <label class="f">What goes here</label><select data-k="kind">${opt('-1',(matName(t.postM)||'Line post')+' (normal)',String(it.k))}${(t.posts||[]).map((p,i)=>opt(String(i),matName(p.m),String(it.k))).join('')}${opt('p','Pull brace (stretch from here)',String(it.k))}</select>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-k="add">Add a post after it</button><button class="btn sm del" data-k="del">Delete</button></div>
    ${s.custom?'<button class="btn sm" data-k="reset" style="margin-top:6px">Put this stretch back to automatic</button>':'<p class="small mut" style="margin:6px 0 0">Drag it along the fence to move it.</p>'}`;
  el.addEventListener('change',e=>{if(e.target.dataset.k!=='kind')return;const v=e.target.value;
    if(v==='p'&&!s.custom){map.closePopup();bracePointAt(lid,si,it.f);return}   // a brace by hand: the fence is worked out again around it
    const c=custOf(l,r,si);c[ii].k=v==='p'?'p':+v;changed();openPostPopup(lid,si,ii)});
  el.addEventListener('click',e=>{const k=e.target.closest('button[data-k]')?.dataset.k;if(!k)return;map.closePopup();
    if(k==='reset'){delete l.cust[s.key];changed();return}
    const c=custOf(l,r,si);
    if(k==='add'){c.splice(ii+1,0,{f:(c[ii].f+(c[ii+1]?.f??1))/2,k:-1});changed();openPostPopup(lid,si,ii+1)}
    if(k==='del'){c.splice(ii,1);changed()}});
  L.popup({minWidth:220,maxWidth:270,offset:[0,-4],autoPanPadding:[20,20]}).setLatLng(m.ll).setContent(el).openOn(map);
}

