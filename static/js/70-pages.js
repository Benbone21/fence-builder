/* ---------- panel ---------- */
const TABS=[['jobs','Jobs'],['build','Builder'],['est','Final bill'],['types','Fence types'],['braces','Braces'],['prices','Materials'],['settings','Settings']];
const opt=(v,label,cur)=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(label)}</option>`;
const matOpts=(cur,allowNew,none)=>(none?opt('',none,cur||''):'')+(cur&&!S.materials.some(m=>m.id===cur)?`<option value="${esc(cur)}" selected>(deleted material: pick another)</option>`:'')+S.materials.map(m=>opt(m.id,m.name,cur)).join('')+(allowNew?'<option value="__new">+ New product…</option>':'');
const kitOpts=cur=>S.braces.map(b=>opt(b.id,b.name,cur)).join('');
const typeOpts=cur=>S.fenceTypes.map(t=>opt(t.id,t.name,cur)).join('');
const kitName=id=>id==='none'?'No brace':id==='gate'?'Gate':(S.braces.find(b=>b.id===id)||{}).name||'(missing brace)';

function renderAll(){A=analyze(P());drawMap();renderPanel();renderHeader()}
function renderHeader(){
  $('#proj').innerHTML=(S.projects.length?'':'<option value="" selected>No jobs yet</option>')+S.projects.map(p=>opt(p.id,p.name,S.cur)).join('')+'<option value="__newjob">+ Start a new job…</option>';
}
const focusKey=el=>el&&el.dataset&&(el.dataset.f||el.dataset.act)?['f','act','id','i'].filter(k=>el.dataset[k]!=null).map(k=>`[data-${k}="${el.dataset[k]}"]`).join(''):null;
function renderPanel(){
  if(!A)A=analyze(P());
  if(S.tab==='fence'||S.tab==='bill')S.tab='est';
  if(S.tab==='builds')S.tab='types';
  if(!TABS.some(t=>t[0]===S.tab))S.tab='build';
  applyUI();document.documentElement.style.setProperty('--tz',String(+S.settings.textSize||1));
  document.body.classList.toggle('pg-lib',['types','braces','prices','settings'].includes(S.tab));
  const tabBtn=([k,n])=>`<button data-tab="${k}" class="${S.tab===k?'on':''}"${S.tab===k?' aria-current="page"':''}>${n}</button>`,SETUP=['types','braces','prices','settings'];
  $('#tabs').innerHTML=TABS.filter(t=>!SETUP.includes(t[0])).map(tabBtn).join('');
  $('#tabs2').innerHTML=TABS.filter(t=>SETUP.includes(t[0])).map(tabBtn).join('');
  const build=S.tab==='build',box=build?$('#side'):$('#panel'),out=build?$('#side'):$('#body');
  const st=box.scrollTop,fk=box.contains(document.activeElement)?focusKey(document.activeElement):null;
  const fn={jobs:jobsView,build:sideView,est:estView,types:typesView,braces:bracesView,prices:pricesView,settings:settingsView}[S.tab];
  out.innerHTML=tipCard(S.tab==='jobs'&&jobOpen?'job':S.tab)+fn();box.scrollTop=st;
  if(fk){const el=out.querySelector(fk);if(el){el.focus({preventScroll:true});if(el.select&&/text|number/.test(el.type))el.select()}}
}
// labor and fee lines (used on the Final bill)
// labor, headache and fee lines at the bottom of the bill
function laborFoot(){
  const L=A.lab;if(!L)return '';let o='';
  if(L.override!=null)o+=`<tr class="custp"><td colspan="3">Labor: your own total for this job <span class="tag warnt">custom</span></td><td class="num">${money(L.override)}</td></tr>`;
  else if(L.figured)o+=`<tr><td colspan="3">Labor${L.site?`, with ${L.site}% site difficulty`:''}</td><td class="num">${money(L.cost)}</td></tr>`;
  if(L.matHead)o+=`<tr><td colspan="3">Headache charges on fussy materials</td><td class="num">${money(L.matHead)}</td></tr>`;
  for(const f of L.fees)o+=`<tr><td colspan="3">${esc(f.name||'Fee')}</td><td class="num">${money(+f.amount)}</td></tr>`;
  return o;
}
function laborView(){
  const L=A.lab,p=P();if(!L)return '';
  const rows=L.byType.map(x=>`<tr><td>${esc(x.t.name)}: ${fmtFt(x.ft)} × ${money(x.rate)} a foot${x.rate?'':` <button class="lnk" data-act="editFt" data-id="${x.t.id}">set its labor rate</button>`}</td><td class="num">${money(x.cost)}</td></tr>`).join('');
  return `<h2>Labor, headache and fees</h2>
  <div class="box scroll"><table class="bill"><tbody>
    <tr class="grp"><td colspan="2">Labor (each fence type's $ per foot, set on Fence types)</td></tr>
    ${rows||'<tr><td colspan="2" class="mut">No fence yet.</td></tr>'}
    ${L.byBrace?.length?`<tr class="grp"><td colspan="2">Braces (each brace's labor $, set on the Braces page)</td></tr>${L.byBrace.map(x=>`<tr><td>${esc(x.b.name)}: ${fmtQ(x.n)} × ${money(x.rate)} each${x.rate?'':' <span class="small mut">(no charge set)</span>'}</td><td class="num">${money(x.cost)}</td></tr>`).join('')}`:''}
    ${L.siteHead?`<tr><td>Headache: site difficulty, ${L.site}%</td><td class="num">${money(L.siteHead)}</td></tr>`:''}
    <tr class="tot"><td>Labor</td><td class="num">${money(L.figured)}</td></tr></tbody></table></div>
  <div class="box${L.override!=null?' warnbox':''}" style="margin-top:8px;padding:10px 12px">
    <div class="row"><label class="lbl">Site difficulty (headache) % <input type="number" min="0" step="5" value="${L.site}" data-f="proj.site" style="width:80px" title="Rocky ground, brush, steep hills, hard access"></label>
      <span class="small mut">Adds to the labor for rocky ground, brush, hills or hard access.</span></div>
    <div class="row" style="margin-top:8px"><label class="lbl">Use my own labor total for this job $ <input type="number" min="0" step="1" value="${L.override??''}" placeholder="${Math.round(L.figured)}" data-f="proj.laborTotal" style="width:110px"></label>
      ${L.override!=null?`<span class="small warn">Custom labor total. Figured it would be ${money(L.figured)}. <button class="lnk" data-act="laborReset">Use the figured amount</button></span>`:`<span class="small mut">Leave it empty to use the figured amount.</span>`}</div>
  </div>
  <h3>Headache charges on fussy materials</h3>
  <p class="small mut" style="margin:0 0 6px">Type an extra $ per unit in the Headache column of the materials list for anything fussy to handle or install on this job.</p>
  ${L.matHeadRows.length?`<div class="box scroll"><table class="bill"><tbody>${L.matHeadRows.map(x=>`<tr><td>${esc(x.name)}: ${fmtQ(x.q)} ${esc(x.unit)} × ${money(x.each)}</td><td class="num">${money(x.cost)}</td></tr>`).join('')}<tr class="tot"><td>Headache charges</td><td class="num">${money(L.matHead)}</td></tr></tbody></table></div>`:''}
  <h3>Other fees</h3>
  <div class="box" style="padding:8px 10px">${(p.fees||[]).map((f,i)=>`<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><input type="text" value="${esc(f.name)}" data-f="fee.name" data-i="${i}" placeholder="What for: travel, permit, rough ground…" aria-label="Fee"><input type="number" min="0" step="1" value="${+f.amount||0}" data-f="fee.amount" data-i="${i}" style="width:110px" aria-label="Amount"><button class="btn x" data-act="delFee" data-i="${i}" title="Remove">×</button></div>`).join('')}
    <button class="btn sm" data-act="addFee">Add a fee</button></div>`;
}
function estView(){
  const p=P(),st=S.settings,braces=Object.values(A.kits).reduce((a,b)=>a+b,0);
  const n=v=>`value="${+v||0}"`;
  let sumLen=0,sumGates=0;
  const rows=p.lines.map(l=>{
    const r=A.lines.find(x=>x.l===l);if(!r)return'';
    if(l.manual){sumLen+=+l.len||0;sumGates+=Math.floor(+l.gates||0);
      return `<tr><td><input type="text" value="${esc(l.name)}" data-f="line.name" data-id="${l.id}" aria-label="Run name"></td>
      <td><select data-f="line.type" data-id="${l.id}" aria-label="Fence type">${typeOpts(l.type)}</select></td>
      <td><input type="number" class="w-n" min="0" step="1" ${n(l.len)} data-f="line.len" data-id="${l.id}" aria-label="Length in feet"></td>
      <td><input type="number" class="w-s" min="0" step="1" ${n(l.corners)} data-f="line.corners" data-id="${l.id}" aria-label="Corners"></td>
      <td><input type="number" class="w-s" min="0" step="1" ${n(l.gates)} data-f="line.gates" data-id="${l.id}" aria-label="Gates"></td>
      <td style="text-align:center"><input type="checkbox" ${l.closed?'checked':''} data-f="line.closed" data-id="${l.id}" aria-label="Closed loop, no ends" title="Closed loop (no end braces)"></td>
      <td class="num">${fmtFt(r.len)}</td>
      <td><button class="btn x" data-act="delLine" data-id="${l.id}" aria-label="Remove run" title="Remove">×</button></td></tr>`}
    const nodes=l.pts.map(q=>A.nodes.get(key(q))),corners=nodes.filter(o=>o.role==='Corner').length,gates=l.pts.filter(q=>q.brace==='gate').length;
    sumLen+=r.len+r.gateW;sumGates+=gates;
    return `<tr class="drawn"><td class="name" data-act="sel" data-id="${l.id}" title="Open this line"><span class="dot" style="background:${esc(r.t.color)}"></span><b>${esc(l.name)}</b> <span class="small mut">drawn on map</span></td>
      <td><select data-f="line.type" data-id="${l.id}" aria-label="Fence type">${typeOpts(l.type)}</select></td>
      <td class="num">${fmtFt(r.len+r.gateW)}</td><td class="num">${corners}</td><td class="num">${gates}</td><td style="text-align:center" class="mut">${nodes[0]===nodes[nodes.length-1]?'yes':''}</td>
      <td class="num">${fmtFt(r.len)}</td>
      <td><button class="btn x" data-act="delLine" data-id="${l.id}" aria-label="Delete line" title="Delete">×</button></td></tr>`}).join('');
  const runs=rows?`<div class="box scroll"><table class="runs"><thead><tr><th>Name</th><th>Fence type</th><th class="num">Length, ft</th><th class="num">Corners</th><th class="num">Gates</th><th>Closed loop</th><th class="num">Without gates</th><th></th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total</td><td class="num">${fmtFt(sumLen)}</td><td></td><td class="num">${sumGates}</td><td></td><td class="num">${fmtFt(A.totalFt)}</td><td></td></tr></tfoot></table></div>`
    :`<div class="note">No fence yet. Draw it on the map with <b>Fence map</b>, or press <b>+ Add a fence run by length</b> and type how long it is.</div>`;
  let g='',body='';
  const hd=p.headache||{};
  for(const r of A.rows){if(r.grp!==g){g=r.grp;body+=`<tr class="grp"><td colspan="7">${esc(g)}</td></tr>`}
    let host='';try{host=new URL(r.m.url).hostname.replace(/^www\./,'')}catch(e){}
    body+=`<tr class="${r.custom?'custp':''}"><td class="buyq"><span class="qbadge"><b>${fmtQ(r.q)}</b><span>${esc(r.m.unit||'each')}${r.m.unit==='roll'&&r.q!==1?'s':''}</span></span></td><td><div class="mrow" style="align-items:flex-start">${thumb(r.m.image,44)}<div><b>${esc(r.m.name)}</b>${r.why?.length?`<div class="small mut">${r.why.map(([w,q])=>`${fmtQ(Math.round(q*10)/10)} for ${esc(w)}`).join(' · ')}</div>`:''}${r.custom?`<div class="small warn">Custom price for this job. Your normal price is ${money(r.base)}. <button class="lnk" data-act="jobPriceReset" data-id="${r.m.id}">Use the normal price</button></div>`:''}</div></div></td>
      <td class="num"><input type="number" class="pr noprint" min="0" step="0.01" value="${r.price}" data-f="jobp.price" data-id="${r.m.id}" aria-label="Price for this job" title="Type a different price to use on this job only. Your Materials page is not changed."><span class="printonly">${money(r.price)}</span></td>
      <td class="num"><input type="number" class="pr noprint" min="0" step="0.01" value="${hd[r.m.id]??''}" placeholder="0" data-f="jobhead.v" data-id="${r.m.id}" aria-label="Headache charge each, this job" title="Extra $ per unit for something fussy to install, on this job"><span class="printonly">${hd[r.m.id]?money(+hd[r.m.id]):''}</span></td>
      <td class="num">${money(r.cost)}</td>
      <td>${r.m.url?`<a class="btn sm" href="${esc(r.m.url)}" target="_blank" rel="noopener" title="Open the product page at ${esc(host)}">Buy at ${esc(host.split('.')[0]||'store')}</a>`:'<span class="small mut">no link</span>'}</td></tr>`}
  const nCustom=A.rows.filter(r=>r.custom).length;
  const kits=Object.entries(A.kits).map(([id,n])=>`${n} ${esc(kitName(id))}`).join(', ');
  const types=Object.values(A.types).filter(T=>T.L>0).map(T=>`${esc(T.t.name)}: ${fmtFt(T.L)}, ${postText(T)}${T.pulls?`, ${T.pulls} pull braces`:''}`).join('<br>');
  const bill=A.rows.length?`<p class="billsum">${types}${kits?`<br>Braces: ${kits}`:''}</p>
    ${nCustom?`<div class="note warnbox">${nCustom} material${nCustom>1?'s use':' uses'} a custom price on this job, not your normal price. <button class="lnk" data-act="jobPriceResetAll">Put them all back to normal</button></div>`:''}
    <div class="box scroll"><table class="bill final"><thead><tr><th class="buyq">Buy</th><th>Material and what it is for</th><th class="num">Price each, this job</th><th class="num">Headache $ each</th><th class="num">Total</th><th>Store</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td colspan="5">Materials</td><td class="num">${money(A.sub)}</td><td></td></tr>
    <tr><td colspan="5">Sales tax ${+st.tax||0}%</td><td class="num">${money(A.tax)}</td><td></td></tr>
    ${laborFoot().replace(/<td colspan="3">/g,'<td colspan="5">').replace(/<\/td><\/tr>/g,'</td><td></td></tr>')}
    <tr class="tot"><td colspan="5">Total</td><td class="num">${money(A.total)}</td><td></td></tr></tfoot></table></div>
`
    :`<p class="mut">Once there is some fence, the list of what to buy shows up here.</p>`;
  return `<div class="phead"><div><h1>Final bill: ${esc(p.name)}</h1><p>${p.customer?esc(p.customer)+'. ':''}What to buy and what to charge for this job. A price you change here is for this job only.</p></div><div class="row noprint"><button class="btn big" data-act="jobPage" data-id="${p.id}">Job details</button><button class="btn big" data-act="showMap">Fence map</button><button class="btn big" data-act="copyBill">Copy list</button><button class="btn big" data-act="print">Print my copy</button><button class="btn big" data-act="saveEst">Save estimate</button><button class="btn pri big" data-act="quote">Customer quote</button></div></div>
  ${estNote(p)}<div class="est"><div class="sum"><div><span>Fence length</span><b>${fmtFt(A.totalFt)}</b>${A.area?`<span class="areanote">${fmtAcres(A.area)} fenced in (${fmtSqFt(A.area)})</span>`:''}</div><div><span>Braces</span><b>${braces}</b></div><div><span>Gates</span><b>${A.gates}</b></div>
    <div><span>Materials</span><b>${money(A.sub)}</b></div><div><span>Labor</span><b>${money(A.lab.cost)}</b></div><div><span>Headache and fees</span><b>${money(A.lab.matHead+A.lab.feeTotal)}</b></div><div class="tot"><span>Total</span><b>${money(A.total)}</b></div></div>
  <div class="wide"><h2>Materials to buy</h2>${bill}</div>
  <div class="wide"><h2>The fence</h2>${runs}
  <div class="row noprint" style="margin-top:8px"><button class="btn" data-act="addRun">+ Add a fence run by length</button>
    <span class="small mut">For fence you measured yourself. Ends, corners and both sides of each gate get braces, as set on its fence type.</span></div>
  </div><div class="wide">${groundBill()}${laborView()}</div></div>`;
}
function lineView(){
  const l=getLine(selLine),r=A.lines.find(x=>x.l===l);if(!r)return estView();
  const evh=elevView(l);
  const nodes=l.pts.map((p,i)=>{const o=A.nodes.get(key(p));const on=selNode&&selNode.l===l.id&&selNode.i===i;
    const autoLbl='Automatic ('+kitName(o.auto)+')',cur=p.brace??'';
    const sel=`<select data-f="node.brace" data-id="${l.id}" data-i="${i}" aria-label="Brace at point ${i+1}">${opt('',autoLbl,cur)}${S.braces.map(b=>opt(b.id,b.name,cur)).join('')}${opt('none','No brace (line post)',cur)}${opt('gate','Gate opening',cur)}</select>`;
    const gate=o.brace==='gate'&&p.brace==='gate'?`<div class="g2" style="margin-top:6px"><label class="small mut">Width ft<input type="number" min="1" step="1" value="${+p.gw||0}" data-f="node.gw" data-id="${l.id}" data-i="${i}"></label><label class="small mut">Gate<select data-f="node.gm" data-id="${l.id}" data-i="${i}">${matOpts(p.gm)}</select></label></div>`:'';
    return `<tr class="${on?'on':''}"><td class="num">${i+1}</td><td>${o.role}${o.refs.length>1?'<br><span class="small mut">shared</span>':''}</td><td>${sel}${gate}</td><td><button class="btn x" data-act="delPt" data-id="${l.id}" data-i="${i}" aria-label="Remove point ${i+1}" title="Remove">×</button></td></tr>`}).join('');
  return `<div class="jobtop" style="margin-top:14px"><button class="btn big" data-act="back">← Back to fence setup</button></div>
  <h2 style="margin:0 0 8px">One fence line</h2><div class="row noprint"><button class="btn" data-act="zoom" data-id="${l.id}">Zoom to it</button></div>
  <label class="f">Line name</label><input type="text" value="${esc(l.name)}" data-f="line.name" data-id="${l.id}">
  <label class="f">Fence type</label><select data-f="line.type" data-id="${l.id}">${S.fenceTypes.map(t=>opt(t.id,t.name,l.type)).join('')}</select>
  <p class="big" style="margin:14px 0 2px">${fmtFt(r.len)}</p><p class="small mut" style="margin:0">of wire run${r.gateW?`, after ${fmtFt(r.gateW)} of gate openings`:''}. ${postText(r)}${r.pulls?`, ${r.pulls} pull braces`:''}.</p>
  ${r.area?`<div class="areabox"><span>Fenced in</span><b>${fmtAcres(r.area)}</b><span>${fmtSqFt(r.area)}</span></div>`:''}
  <p class="small" style="margin:4px 0 0">${gapText(r)}</p>
  ${(()=>{const ps=stretchParts(r);return ps.length?`<div class="box" style="margin-top:10px"><table class="strs"><thead><tr><th>Section</th><th class="num">Length</th><th>Which roll</th><th>Wire pulled</th></tr></thead><tbody>${ps.map((q,i)=>`<tr><td>${i+1}</td><td class="num">${fmtFt(q.len)}</td><td>${q.on?(q.on.q1>q.on.q0?`Rolls ${q.on.q0+1}–${q.on.q1+1}`:`Roll ${q.on.q0+1}`)+` <span class="mut">(${q.on.sizes.map(fmtQ).join(' + ')} ft)</span>`:'–'}</td><td>${q.split?'Into the pull brace':'From the end brace'}</td></tr>`).join('')}</tbody></table></div>`:''})()}
  <p class="small mut" style="margin:4px 0 0">Zoom in on the map to drag any post or pull brace along the fence, or click one to change it, delete it or add another.</p>
  ${r.stretches.some(x=>x.custom)?`<button class="btn sm" data-act="resetCust" data-id="${l.id}" style="margin-top:6px">Put all posts back to automatic</button>`:''}
  ${evh}
  ${groundView(l)}
  <h3>Points, braces and gates</h3>
  <div class="box"><table class="nodes"><thead><tr><th>#</th><th>Spot</th><th>What goes here</th><th></th></tr></thead><tbody>${nodes}</tbody></table></div>
  <div class="row" style="margin-top:12px"><button class="btn" data-act="cont" data-id="${l.id}">Keep drawing from the end</button><button class="btn" data-act="rev" data-id="${l.id}">Flip direction</button><button class="btn" data-act="cross" data-id="${l.id}" title="Put a gate where it crosses a road and braces on both banks of a river or creek">Find roads and rivers</button><button class="btn del" data-act="delLine" data-id="${l.id}">Delete line</button></div>
  <p class="small mut">Drag points on the map to move them. A point shared with another line counts as one corner.</p>`;
}
const KINDS=[['wire','Wire'],['post','Posts'],['hw','Hardware'],['gate','Gates'],['other','Other']];
// a post used in a brace counts as a post; everything else in a brace is hardware
const isPostName=n=>/post|pole|pipe|piling/i.test(n||'')&&!/insulator|clip|cap|driver|puller|bracket|clamp/i.test(n||'');
const MADE=[['','Not set'],['tpost','Steel T-post'],['pipe','Steel pipe'],['wood','Wood'],['stay','Stay (hangs on the wire, not in the ground)']];
function matUse(m){
  // where a material is used, and (unless you set its kind yourself) which kind that makes it
  const uses=[];let kind='';const C=c=>{kind=kind||c};
  for(const t of S.fenceTypes){
    if((t.wires||[]).some(w=>w.m===m.id)){uses.push(t.name);C('wire')}
    else if(t.postM===m.id||(t.posts||[]).some(r=>r.m===m.id)){uses.push(t.name);C('post')}
    else if(t.gateM===m.id){uses.push(t.name);C('gate')}
    else if(t.clipM===m.id||t.gateHw===m.id){uses.push(t.name);C('hw')}
    else if((t.extras||[]).some(e=>e.m===m.id)||(t.items||[]).some(i=>i.m===m.id)){uses.push(t.name);C('other')}
  }
  for(const b of S.braces)if(b.items.some(i=>i.m===m.id)){uses.push(b.name);C(isPostName(m.name)?'post':'hw')}
  if(!kind&&S.projects.some(p=>p.lines.some(l=>l.pts.some(q=>q.gm===m.id))))C('gate');
  // not used anywhere yet: go by its name
  kind=m.kind||kind||kindGuess(m.name,{})||'other';
  return {uses,kind,cat:(KINDS.find(k=>k[0]===kind)||KINDS[KINDS.length-1])[1]};
}
// one-line summary of a material's details
function matSpec(m,kind){
  const a=[],v=k=>m[k]!=null&&m[k]!==''&&m[k]!==0;
  if(kind==='wire'){if(v('gauge'))a.push(m.gauge+' ga');if(v('roll'))a.push(fmtQ(+m.roll)+' ft roll');if(v('height'))a.push(m.height+' in tall')}
  else if(kind==='post'){if(v('len'))a.push(m.len+' ft long');if(v('dia'))a.push(m.dia+' in thick');if(v('wall'))a.push(m.wall+' in wall');if(m.made)a.push((MADE.find(x=>x[0]===m.made)||[])[1])}
  else if(kind==='gate'){if(v('width'))a.push(m.width+' ft wide');if(v('height'))a.push(m.height+' in tall')}
  if(m.notes)a.push(m.notes);
  return a.join(' · ');
}
// Details for one material. Everything you type stays in this box until you press Save.
// With no id it makes a new material. Resolves to the material's id when saved, or null when cancelled.
function openMatDlg(id,preset){return new Promise(res=>{
  const isNew=!id,src=isNew?null:matOf(id);if(!isNew&&!src)return res(null);
  const m=isNew?{id:uid('m'),name:'',unit:'each',price:0,url:'',checked:null,src:'',...preset}:{...JSON.parse(JSON.stringify(src)),...(preset||{})};
  const dlg=$('#matDlg');let done=false,err='',busyNow=false;
  const fin=v=>{if(done)return;done=true;dlg.close();res(v)};
  const draw=()=>{
    const kind=m.kind||(isNew?'other':matUse(m).kind);
    const num=(k,lbl,step='any')=>`<div><label class="f">${lbl}</label><input type="number" min="0" step="${step}" value="${m[k]??''}" data-k="${k}" data-n="1"></div>`;
    const txt=(k,lbl,ph='')=>`<div><label class="f">${lbl}</label><input type="text" value="${esc(m[k])}" data-k="${k}" placeholder="${ph}"></div>`;
    const by={
      wire:`<h3>Wire details</h3><div class="g2">${txt('gauge','Gauge','12.5')}${num('roll','Length on one roll, ft','1')}${num('height','Height, inches')}${num('maxPull','Longest stretch in one pull, ft (blank = usual '+fmtQ(PULL_USUAL[wireLook(m)])+')','1')}
        <div><label class="f">In 3D it looks like</label><select data-k="look">${LOOKS.map(([k,l])=>opt(k,l,m.look||'')).join('')}</select></div></div>
        <p class="small mut">Roll length is used for how many rolls a job needs, the roll bands on the map, and the "two rolls joined" stretch limit. Use 0 if you buy it by the foot.</p>`,
      post:`<h3>Post details</h3><div class="g2">${num('len','Length, ft')}${num('dia','Thickness, inches')}${num('wall','Wall thickness, inches (pipe)')}
        <div><label class="f">Made of</label><select data-k="made">${MADE.map(([k,l])=>opt(k,l,m.made||'')).join('')}</select></div></div>
        <p class="small mut">Thickness and what it's made of set how the post is drawn in the 3D view.</p>`,
      gate:`<h3>Gate details</h3><div class="g2">${num('width','Width, ft')}${num('height','Height, inches')}</div>`};
    dlg.innerHTML=`<h2 style="margin:0 0 6px">${isNew?'New material':'Material details'}</h2>
      <div class="mrow" style="align-items:flex-start">${m.image?`<img class="mpic" src="${esc(m.image)}" alt="" referrerpolicy="no-referrer" style="width:96px;height:96px">`:''}<div class="grow">
      <label class="f">Name</label><input type="text" value="${esc(m.name)}" data-k="name" placeholder="What it is, for example: T-post 6 ft">
      <label class="f">Picture link (optional)</label><input type="url" value="${esc(m.image)}" data-k="image" placeholder="Filled in from the store page"></div></div>
      <div class="g3"><div><label class="f">Kind</label><select data-k="kind">${KINDS.map(([k,l])=>opt(k,l,kind)).join('')}</select></div>
        ${num('price','Price $','0.01')}${txt('unit','Sold by','each, roll, ft')}</div>
      ${by[kind]||''}
      <label class="f">Store link (optional)</label><div class="pick"><input type="url" value="${esc(m.url)}" data-k="url" placeholder="https://kencove.com/products/…"><button class="btn" data-x="price"${busyNow?' disabled':''}>${busyNow?'Reading…':'Get price and details'}</button></div>
      ${err?`<div class="err">${esc(err)}</div>`:m.checked?`<div class="small okc">Price read ${new Date(m.checked).toLocaleDateString()} from ${esc(m.src)}</div>`:''}
      <label class="f">Notes</label><textarea rows="2" data-k="notes">${esc(m.notes)}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><span class="small mut grow">${isNew?'It is added when you press Save.':'Changes apply everywhere this material is used, when you press Save.'}</span><button class="btn big" data-x="cancel">Cancel</button><button class="btn pri big" data-x="save">Save</button></div>`;
  };
  dlg.onchange=e=>{const t=e.target,k=t.dataset.k;if(!k)return;m[k]=t.dataset.n?(t.value===''?null:+t.value):t.value;if(k==='price')m.price=+t.value||0;if(k==='kind'||k==='image')draw()};
  dlg.oncancel=e=>{e.preventDefault();fin(null)};
  dlg.onclick=async e=>{
    const x=e.target.closest('[data-x]')?.dataset.x;if(e.target===dlg||x==='cancel')return fin(null);
    if(x==='price'){if(!m.url){err='Paste a product link first';return draw()}
      busyNow=true;err='';draw();try{const j=await lookupLink(m.url);applyLookup(m,j);if(!m.name)m.name=j.name||''}catch(ex){err=ex.message||String(ex)}busyNow=false;if(!done)draw()}
    if(x==='save'){
      if(!String(m.name||'').trim()){err='Give it a name first';return draw()}
      m.name=m.name.trim();
      if(isNew){m.updated=new Date().toISOString();S.materials.unshift(m)}
      else{const real=matOf(id);if(+real.price!==+m.price)m.updated=new Date().toISOString();for(const k of Object.keys(real))if(!(k in m))delete real[k];Object.assign(real,m)}
      changed();toast('Saved '+m.name);fin(m.id)}};
  draw();if(!dlg.open)dlg.showModal();
  if(isNew&&!m.name)dlg.querySelector('[data-k="name"]').focus();
})}
function autoLine(){
  const a=S.settings.autoPrices??'day',r=S.settings.priceRun;
  return `Store prices update ${a==='off'?'only when you ask':a==='week'?'automatically once a week':'automatically once a day'} (change it in Settings)${r?`; last checked ${new Date(r.at).toLocaleString()}: ${r.moved} changed${r.failed?`, ${r.failed} could not be read`:''}${r.byHand?`, ${r.byHand} from Premier 1 need the bookmark`:''}`:''}.`;
}
function pricesView(){
  const order=KINDS.map(k=>k[1]);
  const rows=S.materials.map(m=>({m,...matUse(m)})).sort((a,b)=>order.indexOf(a.cat)-order.indexOf(b.cat));
  const need=Object.fromEntries(A.rows.map(r=>[r.m.id,r]));
  let g='',body='';
  for(const {m,uses,cat,kind} of rows){
    if(cat!==g){g=cat;body+=`<tr class="grp"><td colspan="8">${esc(cat)}</td></tr>`}
    const when=m.checked||m.updated,r=need[m.id];
    let host='';try{host=new URL(m.url).hostname.replace(/^www\./,'')}catch(e){}
    body+=`<tr data-name="${esc((m.name+' '+uses.join(' ')).toLowerCase())}">
      <td><div class="mrow">${thumb(m.image)}<b>${esc(m.name)}</b></div></td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="matInfo" data-id="${m.id}">Edit</button> <span class="small mut">${esc(matSpec(m,kind))}</span></td>
      <td>${esc(m.unit)}</td>
      <td class="num">${money(+m.price)}</td>
      <td class="small mut">${uses.length?esc([...new Set(uses)].join(', ')):'–'}</td>
      <td>${m.url?`<div class="row" style="flex-wrap:nowrap"><a class="small" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(host||'store page')}</a><button class="btn sm" data-act="fetchPrice" data-id="${m.id}"${busy[m.id]?' disabled':''}>${busy[m.id]?'Checking…':'Get price'}</button></div>`:'<span class="mut">–</span>'}
        ${errs[m.id]?`<div class="err">${esc(errs[m.id])}</div>`:''}</td>
      <td class="small mut" style="white-space:nowrap">${when?new Date(when).toLocaleDateString():'–'}${m.checked&&m.src?`<br>${esc(m.src)}`:''}${m.prevPrice!=null&&Date.now()-Date.parse(m.priceMoved||0)<14*86400e3?`<br><span class="${m.price>m.prevPrice?'up':'down'}">${m.price>m.prevPrice?'▲ up':'▼ down'} from ${money(m.prevPrice)}</span>`:''}</td>
      <td><button class="btn x" data-act="delMat" data-id="${m.id}" aria-label="Remove ${esc(m.name)}" title="Remove">×</button></td></tr>`;
  }
  return `<div class="phead"><div><h1>Materials</h1><p>Everything you buy, with its price. Press <b>Edit</b> to change one: nothing changes until you press Save in its window.</p></div><button class="btn pri big" data-act="addMat">+ Add material</button></div>
  <div class="jobtools"><input type="search" id="matQ" placeholder="Find a material by name or fence type" aria-label="Find a material">
    <button class="btn big" data-act="addFromLink">Add from a store link</button><button class="btn big" data-act="shop">Find at Kencove or D&amp;B</button><button class="btn big" data-act="fetchAll"${autoBusy?' disabled':''}>${autoBusy?'Checking prices…':'Update store prices now'}</button></div>
  <details class="note grab"><summary><b>Add from Premier 1 or any store page</b> <span class="small mut">with a bookmark</span></summary>
    <p class="small" style="margin:8px 0">Some stores, like Premier 1 Supplies, only let people see their pages, so the app cannot read them on its own. This bookmark reads the page you have open instead: name, price, SKU and the specifications table, and sends it here.</p>
    <ol class="small" style="margin:0 0 8px;padding-left:18px"><li>Drag this button to your bookmarks bar: <a class="btn sm pri" href="${grabHref()}" data-act="grabHint">Add to Fence Builder</a></li>
      <li>Open a product on the store, pick the size you want, and click the bookmark.</li>
      <li>This app opens with the product filled in. Check it and press Save. If you already have that product, its new price is filled in for you to save.</li></ol>
    <p class="small mut" style="margin:0">Use it again on the same page any time to update that price.</p></details>
  <div class="box scroll"><table class="mats"><thead><tr><th>Material</th><th>Details</th><th>Sold by</th><th class="num">Price</th><th>Used in</th><th>Store link</th><th>Price checked</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
  <p class="small mut">${autoLine()} Get price reads the price off the store page. Kencove and other Shopify stores are read directly and also fill in roll length, gauge and height when the page has them. Some big stores block this, so a typed price always works.</p>`;
}
let typeSel=null;
const postText=x=>`${x.tposts} line posts`+(x.t.posts||[]).map((r,i)=>x.other?.[i]?`, ${x.other[i]} ${esc(matName(r.m))}`:'').join('');
const thumb=(u,px=40)=>u?`<img class="mpic" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:${px}px;height:${px}px">`:`<span class="mpic none" style="width:${px}px;height:${px}px"></span>`;
const unitOf=id=>(S.materials.find(m=>m.id===id)||{}).unit||'';
const priceOf=id=>+(S.materials.find(m=>m.id===id)||{}).price||0;
// price and unit boxes for a product, right where it's used (they change that product everywhere)
// Edits to a fence type or a brace go into a draft copy. Nothing in your jobs changes until you press Save.
const drafts={ft:{},kit:{}};
const TYP=id=>drafts.ft[id]||S.fenceTypes.find(x=>x.id===id);
// the fence type you draw with is kept on each job (another window or computer can't change it under you):
// the job's own pick, else the type of its last line, else the last one picked anywhere
function drawTypeId(){
  const ok=id=>id&&S.fenceTypes.some(t=>t.id===id),p=P();
  if(ok(p?.drawType))return p.drawType;
  const last=[...(p?.lines||[])].reverse().find(l=>ok(l.type));if(last)return last.type;
  return ok(S.drawType)?S.drawType:S.fenceTypes[0]?.id;
}
function setDrawType(id){S.drawType=id;if(P())P().drawType=id}
const KIT=id=>drafts.kit[id]||S.braces.find(x=>x.id===id);
const draftFt=id=>drafts.ft[id]||(drafts.ft[id]=JSON.parse(JSON.stringify(S.fenceTypes.find(x=>x.id===id))));
const draftKit=id=>drafts.kit[id]||(drafts.kit[id]=JSON.parse(JSON.stringify(S.braces.find(x=>x.id===id))));
const saveBar=(kind,id)=>drafts[kind==='Ft'?'ft':'kit'][id]?`<div class="savebar"><span class="grow"><b>Not saved yet.</b> Nothing changes until you press Save.</span><button class="btn" data-act="discard${kind}" data-id="${id}">Throw away changes</button><button class="btn pri big" data-act="save${kind}" data-id="${id}">Save</button></div>`:'';
addEventListener('beforeunload',e=>{if(Object.keys(drafts.ft).length||Object.keys(drafts.kit).length){e.preventDefault();e.returnValue=''}});
// a material's price, unit or roll length shown where it is used: click it to edit the material (with its own Save)
const matLink=(id,text)=>`<button class="lnk" data-act="matInfo" data-id="${id}" title="Edit this material">${text}</button>`;
const priceIn0=id=>{const m=S.materials.find(x=>x.id===id);return m?`<input type="number" class="pr" min="0" step="0.01" value="${+m.price||0}" data-f="mat.price" data-id="${m.id}" aria-label="Price each" title="Price for one ${esc(m.unit)}. Changes this product everywhere it is used.">`:''};
const unitIn0=id=>{const m=S.materials.find(x=>x.id===id);return m?`<input type="text" class="un" value="${esc(m.unit)}" data-f="mat.unit" data-id="${m.id}" aria-label="Unit" title="How it is sold: each, roll, ft, box…">`:''};
const priceIn=id=>{const m=matOf(id);return m?matLink(m.id,(+m.price||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})):''};
const unitIn=id=>{const m=matOf(id);return m?`<span class="small mut">${esc(m.unit)}</span>`:''};
const LOOKS=[['','Auto'],['mesh','Woven or mesh'],['barbed','Barbed strands'],['smooth','Smooth or electric']];
const PER=[['ft','per ft of fence'],['post','per line post'],['tpost','per normal line post'],['woodpost','per added post'],['stretch','per stretch between braces'],['brace','per brace assembly'],['gate','per gate'],['line','per fence line'],['job','once per job']];
function stretchFields(t){
  const d=`data-id="${t.id}"`,by=t.pullBy||'auto',r2=2*mainRoll(t),au=autoPull(t);
  return `<div><label class="f">Longest pull of wire between braces</label><div class="pick"><select data-f="ft.pullBy" ${d}>${opt('auto','Automatic, from the wire'+(au?' ('+fmtQ(au)+' ft)':''),by)}${opt('ft','A set length, ft',by)}${opt('roll2','Two rolls joined'+(r2?' ('+fmtQ(r2)+' ft)':''),by)}</select>${by==='ft'?`<input type="number" class="pr" min="0" step="any" value="${+t.pullEvery||0}" data-f="ft.pullEvery" ${d} aria-label="Longest stretch in feet">`:''}</div></div>
    <div><label class="f">It may go over that by %</label><input type="number" min="0" step="1" value="${t.pullSlack==null?15:+t.pullSlack||0}" data-f="ft.pullSlack" ${d}></div>
    <div><label class="f">When the fence is longer than that</label><select data-f="ft.pullMode" ${d}>${opt('even','Split it into equal pulls',t.pullMode||'even')}${opt('full','Full-length pulls first, leftover at the end',t.pullMode||'even')}</select></div>`;
}
// each stretch of wire on a line (brace to brace or pull brace): its length, rolls, and where to stretch it from
// how many feet of fence of the same type come before this line: rolls carry on from one line to the next
function totalOfType(t){let a=0;for(const r2 of A.lines)if(r2.t?.id===t?.id&&!r2.manual)for(const s of r2.stretches||[])a+=s.len;return a}
// is this the very last piece of fence of its type (so what's left on the roll is spare)
function isLastPiece(r,k,p){const same=A.lines.filter(r2=>r2.t?.id===r.t?.id&&!r2.manual);if(same[same.length-1]!==r)return false;const st=r.stretches||[];if(k!==st.length)return false;return p===st[k-1].items.filter(x=>x.k==='p').length}
function lineStartFt(r){let a=0;for(const r2 of A.lines){if(r2===r)break;if(r2.t?.id===r.t?.id&&!r2.manual)for(const s of r2.stretches||[])a+=s.len}return a}
// which rolls of the main wire a piece of fence from a to b feet (along all fence of its type) uses
function rollsAt(t,a,b,ends){ends=ends||rollEnds(t);if(!ends.length||b<=a)return null;const at=x=>{const i=ends.findIndex(e=>x<e.end-1e-6);return i<0?ends.length-1:i};
  const q0=at(a),q1=Math.max(q0,at(b-1e-6));return {q0,q1,sizes:[...new Set(ends.slice(q0,q1+1).map(e=>e.roll))]}}
function stretchParts(r){
  const ends=rollEnds(r.t),out=[];let at=lineStartFt(r);
  (r.stretches||[]).forEach((s,si)=>{const bs=[0,...s.items.filter(x=>x.k==='p').map(x=>x.f),1];
    for(let q=0;q<bs.length-1;q++){const len=s.len*(bs[q+1]-bs[q]);if(len<=0)continue;out.push({si,f0:bs[q],f1:bs[q+1],len,on:rollsAt(r.t,at,at+len,ends),split:bs.length>2});at+=len}});
  return out;
}
// every roll size a wire comes in, with its price and cost per foot
function rollSizes(t,w,i){
  const d=`data-id="${t.id}"`,main=matOf(w.m);if(!main)return '';
  const row=(id,isMain)=>{const m=matOf(id);if(!m)return '';const r=rollOf({m:id}),pr=+m.price||0;
    return `<tr><td>${r?`<b>${fmtQ(r)} ft</b> roll`:'by the foot'}${isMain?' <span class="tag">main</span>':''}</td>
      <td class="num">${matLink(id,money(pr))}</td><td class="num small mut">${r?money(pr/r)+' a foot':''}</td>
      <td class="small mut">${isMain?'':esc(m.name.length>46?m.name.slice(0,44)+'…':m.name)}</td>
      <td>${isMain?'':`<button class="btn x" data-act="ftwAltDel" ${d} data-i="${i}" data-alt="${id}" title="Stop using this roll size">×</button>`}</td></tr>`};
  const alts=(w.alts||[]).filter(id=>matOf(id));
  const pick=S.materials.filter(m=>m.id!==w.m&&!alts.includes(m.id)&&(m.kind==='wire'||rollOf({m:m.id})>0));
  return `<div class="rollbox"><div class="small mut">Roll sizes of this wire${alts.length?' · full rolls of the main size, then the cheapest of these to finish the end':''}</div>
    <table class="rollsz"><tbody>${row(w.m,true)}${alts.map(id=>row(id,false)).join('')}</tbody></table>
    <select data-f="ftwalt.add" ${d} data-i="${i}" aria-label="Add another roll size of this wire" class="altpick"><option value="">+ Add another roll size of this wire…</option>${pick.map(m=>opt(m.id,(rollOf({m:m.id})?fmtQ(rollOf({m:m.id}))+' ft · ':'')+money(+m.price||0)+' · '+m.name,'')).join('')}</select></div>`;
}
const POST_BY=[['nth','posts (in place of a line post)'],['ft','ft (in place of a line post)'],['between','in between each post']];
function postsEditor(t){
  const d=`data-id="${t.id}"`,n=v=>+v||0;
  const rows=(t.posts||[]).map((r,i)=>`<div class="po"><select data-f="fto.m" ${d} data-i="${i}" aria-label="Post">${matOpts(r.m,true)}</select><span class="mut small">${r.by==='between'?'add':'every'}</span>
    <input type="number" min="0" step="any" value="${n(r.n)}" data-f="fto.n" ${d} data-i="${i}" aria-label="How often">
    <select data-f="fto.by" ${d} data-i="${i}" aria-label="Counted in">${POST_BY.map(([k,l])=>opt(k,l,r.by||'nth')).join('')}</select><span class="mini"><span>$</span>${priceIn(r.m)}</span>
    <button class="btn x" data-act="delFto" ${d} data-i="${i}" title="Remove">×</button></div>`).join('');
  return `<div class="po head small mut"><span>Post</span><span></span><span>How often</span><span></span><span>$ each</span><span></span></div>
    <div class="po"><select data-f="ft.postM" ${d} aria-label="Normal line post">${matOpts(t.postM,true,'None')}</select><span class="mut small">every</span>
      <input type="number" min="1" step="any" value="${n(t.spacing)}" data-f="ft.spacing" ${d} aria-label="Post spacing in feet"><span class="small">ft</span><span class="mini"><span>$</span>${priceIn(t.postM)}</span><span></span></div>
    <label class="small" style="display:flex;gap:8px;align-items:center;margin:2px 0 8px">When the posts don't fit evenly
      <select data-f="ft.postFit" ${d} style="width:auto">${opt('closest','Space them closest to '+n(t.spacing)+' ft',t.postFit||'closest')}${opt('wide','Never closer than '+n(t.spacing)+' ft (a bit wider)',t.postFit||'closest')}${opt('tight','Never wider than '+n(t.spacing)+' ft (a bit closer)',t.postFit||'closest')}</select></label>
    ${rows}
    <button class="btn sm" data-act="addFto" ${d}>Add another post</button>
    <details class="help"><summary>How does this work?</summary><p class="small mut">The first row is your normal line post and its spacing. A post you add either takes the place of a normal one ("every 5 posts" or "every 100 ft"), or goes in between each post ("1 in between each post" puts one in every gap, so a 20 ft spacing gets a post every 10 ft). Ones that take a normal post's place are centered in each stretch, with the leftover split evenly at both ends, so the fence is mirrored.</p></details>`;
}
function typesView(){
  const all=[...S.fenceTypes.map(x=>TYP(x.id)),...Object.values(drafts.ft).filter(x=>x._new)];
  const t=all.find(x=>x.id===typeSel);
  if(t)return `<div class="jobtop"><button class="btn big" data-act="typesBack">← All fence types</button></div>
    <div class="phead"><div><h1><span class="dot big" style="background:${esc(t.color)}"></span> ${esc(t.name)}</h1><p>Change anything below, then press <b>Save</b>.</p></div></div>
    <section class="tedit">${typeEditor(t)}</section>`;
  typeSel=null;
  const used=id=>{let n=0,ft=0;for(const p of S.projects)for(const l of p.lines)if(l.type===id){n++}return n};
  const cards=all.map(x=>{const nl=used(x.id),ws=(x.wires||[]).filter(w=>matOf(w.m));
    return `<div class="tcard"><div class="tcbar" style="background:${esc(x.color)}"></div>
      <button class="jobname" data-act="selFt" data-id="${x.id}">${esc(x.name)}</button>${drafts.ft[x.id]?' <span class="tag warnt">not saved</span>':''}
      <dl class="tfacts">
        <dt>Wire</dt><dd>${ws.length?ws.map(w=>`${+w.strands>1?w.strands+' × ':''}${esc(matName(w.m))}`).join('<br>'):'<span class="mut">none yet</span>'}</dd>
        <dt>Posts</dt><dd>${matOf(x.postM)?esc(matName(x.postM))+', ':''}every ${+x.spacing||0} ft${(x.posts||[]).filter(r=>matOf(r.m)).map(r=>`<br>${esc(matName(r.m))}: ${esc(postHow(r))}`).join('')}</dd>
        <dt>Braces</dt><dd>Ends ${esc(kitName(x.braceEnd||'none'))} · corners ${esc(kitName(x.braceCorner||'none'))}</dd>
        <dt>Labor</dt><dd>${money(+x.labor||0)} a foot</dd>
      </dl>
      <div class="small mut">${nl?`Used on ${nl} fence line${nl===1?'':'s'}`:'Not used on any job yet'}</div>
      <div class="jobbtns"><button class="btn pri" data-act="selFt" data-id="${x.id}">Open and change</button><button class="btn" data-act="dupFt" data-id="${x.id}">Make a copy</button></div></div>`}).join('');
  return `<div class="phead"><div><h1>Fence types</h1><p>What each kind of fence is made of. The builder uses these when you draw. Click one to open it and make changes.</p></div><button class="btn pri big" data-act="addFt">+ New fence type</button></div>
  ${cards?`<div class="jobgrid tgrid">${cards}</div>`:'<p class="mut">Make a fence type to get started.</p>'}`;
}
function typeEditor(t){
  const T=A.types[t.id],q=T?.q,d=`data-id="${t.id}"`,n=v=>+v||0;
  const inp=(f,v,extra='')=>`<input type="number" min="0" step="any" value="${n(v)}" data-f="ft.${f}" ${d} ${extra}>`;
  const kitSel=(f,none=true)=>`<select data-f="ft.${f}" ${d}>${kitOpts(t[f])}${none?opt('none','No brace',t[f]):''}</select>`;
  const qty=(x,m)=>x==null||!T?'<span class="mut">–</span>':`${fmtQ(roundQ(x,unitOf(m)))} <span class="small mut">${esc(unitOf(m))}</span>`;
  const wl=(t.wires||[]).length;
  const wires=(t.wires||[]).map((w,i)=>`<tr><td class="ord"><button class="btn x" data-act="ftwUp" ${d} data-i="${i}" title="Move up (higher on the fence)"${i===wl-1?' disabled':''}>▲</button><button class="btn x" data-act="ftwDown" ${d} data-i="${i}" title="Move down (lower on the fence)"${i===0?' disabled':''}>▼</button></td>
    <td><div class="small mut">${i===0?'Bottom':i===wl-1?'Top':'Wire '+(i+1)}</div><select data-f="ftw.m" ${d} data-i="${i}" aria-label="Wire product">${matOpts(w.m,true)}</select>
      ${rollSizes(t,w,i)}</td>
    <td><input type="number" min="0" step="1" value="${n(w.strands)}" data-f="ftw.strands" ${d} data-i="${i}" aria-label="Strands or layers"></td>
    <td><input type="number" min="0" step="0.5" value="${w.start??''}" placeholder="auto" data-f="ftwsp.start" ${d} data-i="${i}" aria-label="Starts at, inches above ground"></td>
    <td><input type="number" min="0" step="0.5" value="${w.gap??''}" placeholder="auto" data-f="ftwsp.gap" ${d} data-i="${i}" aria-label="Inches apart"${+w.strands>1?'':' disabled title="Only for more than one strand"'}></td>
    <td><select data-f="ftw.look" ${d} data-i="${i}" aria-label="How it looks in 3D">${LOOKS.map(([k,lbl])=>opt(k,lbl,w.look||'')).join('')}</select></td>
    <td><button class="btn x" data-act="delFtw" ${d} data-i="${i}" title="Remove">×</button></td></tr>`).reverse().join('');   // shown top of the fence first
  const extras=(t.extras||[]).map((e,i)=>`<tr><td><select data-f="fte.m" ${d} data-i="${i}" aria-label="Extra product">${matOpts(e.m,true)}</select></td>
    <td><input type="number" min="0" step="any" value="${n(e.q)}" data-f="fte.q" ${d} data-i="${i}" aria-label="Quantity"></td>
    <td><select data-f="fte.per" ${d} data-i="${i}" aria-label="Counted">${PER.map(([k,lbl])=>opt(k,lbl,e.per)).join('')}</select></td>
    <td>${priceIn(e.m)}</td>
    <td><button class="btn x" data-act="delFte" ${d} data-i="${i}" title="Remove">×</button></td></tr>`).join('');
  const items=(t.items||[]).map((it,i)=>`<div class="it"><select data-f="fti.m" ${d} data-i="${i}" aria-label="Material">${matOpts(it.m,true)}</select>
      <input type="text" value="${esc(it.q)}" data-f="fti.q" ${d} data-i="${i}" aria-label="Quantity formula" spellcheck="false">
      <span class="q">${A.bad[t.id+':'+i]?'<span class="err">error</span>':''}</span>
      <button class="btn x" data-act="delFti" ${d} data-i="${i}" aria-label="Remove item" title="Remove">×</button></div>`).join('');
  return `${saveBar('Ft',t.id)}<div class="row" style="margin-bottom:12px"><input type="color" value="${esc(t.color)}" data-f="ft.color" ${d} aria-label="Line color on the map" title="Line color on the map">
    <input type="text" class="grow tname" style="width:auto" value="${esc(t.name)}" data-f="ft.name" ${d} aria-label="Fence type name">
    <button class="btn" data-act="dupFt" ${d}>Make a copy</button><button class="btn del" data-act="delFt" ${d}>Delete this fence type</button></div>
  <div class="sec"><h3>Wire</h3>
    <table class="ed"><thead><tr><th></th><th>Wire, from the bottom of the fence up</th><th class="num">Strands</th><th class="num" title="Inches above the ground for this wire's lowest strand, or the bottom of the woven wire">Starts at, in</th><th class="num" title="Inches between this wire's strands">Apart, in</th><th>3D look</th><th></th></tr></thead><tbody>${wires||'<tr><td colspan="7" class="mut">No wire yet.</td></tr>'}</tbody></table>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addFtw" ${d}>Add wire</button><span class="grow"></span>
      <label class="lbl">Extra wire for sag and splices % <input type="number" min="0" step="0.5" value="${n(t.waste)}" data-f="ft.waste" ${d} style="width:70px"></label></div>
    <details class="help"><summary>How does this work?</summary><p class="small mut">The list runs from the top of the fence down, so use ▲ ▼ to put your wires in order. "Starts at" sets how high a wire's lowest strand (or the bottom of woven wire) is, and "Apart" the gap between its strands, both in inches. Leave them on auto to space them evenly. Under each wire, "Roll sizes" lists every roll it comes in with its price. Add a shorter roll there, and the wire is laid in full rolls of the main size (a roll carries on past braces), with the end finished by the cheapest mix of the other sizes. Click a price to change it. Woven wire or mesh is 1 layer. Barbed or smooth wire is one line per strand. Set roll length to 0 if you buy it by the foot.</p></details></div>
  ${elkNote(t)}<div class="sec"><h3>Posts</h3>${postsEditor(t)}<div class="g3" style="margin-top:8px">
    <div><label class="f">Clips or insulators <span class="r">$ each</span></label><div class="pick"><select data-f="ft.clipM" ${d}>${matOpts(t.clipM,true,'None')}</select>${priceIn(t.clipM)}</div></div>
    <div><label class="f">Clips per normal line post</label>${inp('clipsPer',t.clipsPer)}</div>
    <div><label class="f">Fence height ft (for the 3D view)</label>${inp('height',t.height||4.5)}</div></div>
</div>
  <div class="sec"><h3>Braces</h3><div class="g3">
    <div><label class="f">Ends</label>${kitSel('braceEnd')}</div>
    <div><label class="f">Corners</label>${kitSel('braceCorner')}</div>
    <div><label class="f">Each side of a gate</label>${kitSel('braceGate')}</div>
    <div><label class="f">Pull spots on long stretches</label>${kitSel('bracePull')}</div>
    ${stretchFields(t)}</div>
    <div class="g3" style="margin-top:10px"><div><label class="f">Hill braces: slope change, %</label>${inp('hillGrade',t.hillGrade??15)}</div></div>
    <p class="small mut" style="margin:4px 0 0">With <b>Braces at hilltops</b> or <b>Braces at the bottoms of hills</b> turned on (top of the Builder), a brace goes where the ground's slope bends by at least this much over 50 ft, like going from 10% uphill to 5% downhill (a 15% change). A smaller number means more braces.</p>
    <details class="help"><summary>How does the longest pull work?</summary><p class="small mut">A run up to that length (plus the run-over) is stretched from its end brace in one pull. A longer run gets a pull brace in between to stretch into. Automatic uses the wire: 660 ft for woven wire, 1,320 ft for barbed, 2,640 ft for smooth, or the wire's own number from Materials.</p></details>
    <p class="small mut" style="margin:8px 0 0">What goes into each brace is set on the Braces tab. You can still change any single point on the map.</p></div>
  <div class="sec"><h3>Gates</h3><div class="g3">
    <div><label class="f">Gate panel <span class="r">$ each</span></label><div class="pick"><select data-f="ft.gateM" ${d}>${matOpts(t.gateM,true,'None')}</select>${priceIn(t.gateM)}</div></div>
    <div><label class="f">Gate width ft</label>${inp('gateW',t.gateW)}</div>
    <div><label class="f">Hardware per gate <span class="r">$ each</span></label><div class="pick"><select data-f="ft.gateHw" ${d}>${matOpts(t.gateHw,true,'None')}</select>${priceIn(t.gateHw)}</div></div></div>
    <p class="small mut" style="margin:8px 0 0">These are the starting values for new gates on this fence. Each gate can be changed on the map.</p></div>
  <div class="sec"><h3>Labor</h3>
    <div class="g3"><div><label class="f">Labor $ per foot of fence</label>${inp('labor',t.labor)}</div></div>${adviceHtml(t)}
    <p class="small mut" style="margin:6px 0 0">The Final bill charges this for every foot of this fence. Site difficulty, headache charges and other fees are added there, per job.</p></div>
  <div class="sec"><h3>Other things to buy</h3>
    <table class="ed"><thead><tr><th>Product</th><th class="num">Qty</th><th>Counted</th><th class="num">$ each</th><th></th></tr></thead><tbody>${extras||'<tr><td colspan="5" class="mut">Nothing extra. Add staples, tension springs, delivery, rentals, or anything else.</td></tr>'}</tbody></table>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="addFte" ${d}>Add something else</button><span class="grow"></span>
</div>
</div>
  <details class="sec"${items?' open':''}><summary><b>Custom formula items</b> <span class="small mut">(advanced)</span></summary>
    <p class="small mut">For anything the form above can't express. Use plain math with <code>ceil()</code> plus: <code>L</code> feet of wire run · <code>W</code> 1 + extra wire % · <code>posts</code> · <code>tposts</code> · <code>woodposts</code> · <code>sections</code> stretches · <code>pulls</code> · <code>braces</code> · <code>gates</code> · <code>lines</code> · <code>spacing</code>.</p>
    ${items}<button class="btn sm" data-act="addFti" ${d}>Add formula item</button></details>`;
}
/* what a brace looks like: style and real measurements (feet, thickness in inches) */
const BSTYLES=[['h','H-brace: level rail between two posts'],['a','Rance brace: rail down to a short ground post'],['aa','Double Rance brace: a short ground post and rail on both sides'],['n','N-brace: diagonal rail between two posts'],['single','Single post, no rail']];
function braceShape(b){
  const nm=b.name||'',sh=b.shape||{};
  const style=sh.style||(/single|no brace/i.test(nm)?'single':/double\s*(a|rance)\b|(^|\s)2\s*a\b/i.test(nm)?'aa':/(^|\s)a[- ]?(brace|frame)|rance|kicker/i.test(nm)?'a':/n[- ]brace|diagonal/i.test(nm)?'n':'h');
  const pipe=(b.items||[]).some(it=>/pipe|steel/i.test(matName(it.m)));
  return {span:8,h1:style==='a'||style==='aa'?4.5:4.75,bury1:3.5,h2:1,bury2:3.5,dia:pipe?2.875:6,rail:pipe?2.375:4,bays:/double/i.test(nm)?2:1,wire:style==='h',steel:pipe,...sh,style};
}
// rail height (feet above ground) where it meets the first and second post of a bay
function railEnds(sh,ha,hb){return sh.style==='h'?[sh.h1*0.8,sh.h1*0.8]:sh.style==='n'?[ha*0.92,0.4]:[Math.max(0.3,ha-0.5),Math.max(0.15,hb-0.25)]}
const ftIn=v=>{let f=Math.floor(v+1e-6),i=Math.round((v-f)*12);if(i===12){f++;i=0}return f+"' "+i+'"'};
const LABOR_BASE={mode:'hours',hrs100:2.5,braceHrs:2,gateHrs:1.5,perFt:0,perPost:0,perBrace:0,perGate:0,perJob:0};
const BRACE_HRS={single:0.5,a:1.5,aa:2.5,n:2,h:2};
function braceHours(b){if(!b)return 0;if(b.hours!=null&&b.hours!=='')return +b.hours||0;const sh=braceShape(b);return sh.style==='h'&&+sh.bays>1?3.5:BRACE_HRS[sh.style]??2}
function braceSvg(b){
  const sh=braceShape(b),st=sh.style,span=Math.max(1,+sh.span||8),isA=st==='a'||st==='aa';
  // drawn from the ground up: what's in the ground isn't shown
  const main=(x,lab)=>({x,h:+sh.h1||0,bury:0,lab}),short=(x,lab)=>({x,h:+sh.h2||0,bury:0,lab});
  let posts,pairs;   // pairs: [post the rail starts high on, post it runs to]
  if(st==='single'){posts=[main(0,'L')];pairs=[]}
  else if(st==='aa'){posts=[short(0,'L'),main(span,'T'),short(2*span,'R')];pairs=[[1,0],[1,2]]}
  else if(st==='a'){posts=[main(0,'L'),short(span,'R')];pairs=[[0,1]]}
  else{const bays=Math.max(1,Math.round(+sh.bays||1));posts=[main(0,'L')];pairs=[];for(let i=1;i<=bays;i++){posts.push(main(i*span,null));pairs.push([i-1,i])}}
  const maxH=Math.max(...posts.map(q=>q.h)),maxB=Math.max(...posts.map(q=>q.bury)),maxX=Math.max(...posts.map(q=>q.x));
  const padL=5,padR=5,wft=maxX+padL+padR,hft=maxH+maxB+2.6,W=440,sc=Math.min(W/wft,230/hft),H=hft*sc,gy=(maxH+1.2)*sc,X=x=>(padL+x)*sc;
  const pw=Math.max(2,(+sh.dia||4)/12*sc),rw=Math.max(2,(+sh.rail||3)/12*sc),col=sh.steel?'#9aa3ab':'#a37b52';
  let o=`<rect x="0" y="${gy}" width="${wft*sc}" height="${H-gy}" class="gr"/><line x1="0" x2="${wft*sc}" y1="${gy}" y2="${gy}" class="gl"/>`;
  for(const [ia,ic] of pairs){const a=posts[ia],c=posts[ic],[ya,yc]=railEnds(sh,a.h,c.h),x1=Math.min(X(a.x),X(c.x)),x2=Math.max(X(a.x),X(c.x)),dy=gy+Math.max(maxB*sc*0.45,16);
    o+=`<line x1="${X(a.x)}" y1="${gy-ya*sc}" x2="${X(c.x)}" y2="${gy-yc*sc}" stroke="${col}" stroke-width="${rw}" stroke-linecap="round"/>`;
    if(st==='h'&&sh.wire)o+=`<line x1="${X(a.x)}" y1="${gy-0.3*sc}" x2="${X(c.x)}" y2="${gy-ya*sc}" class="bw"/>`;
    o+=`<line x1="${x1+pw}" x2="${x2-pw}" y1="${dy}" y2="${dy}" class="dm"/><text x="${(x1+x2)/2}" y="${dy-5}" text-anchor="middle">${fmtQ(span)} ft</text>`}
  for(const q of posts){const x=X(q.x)-pw/2;
    o+=`<rect x="${x}" y="${gy}" width="${pw}" height="${q.bury*sc}" fill="${col}" opacity=".45"/><rect x="${x}" y="${gy-q.h*sc}" width="${pw}" height="${q.h*sc}" fill="${col}"/>`;
    if(q.lab==='T')o+=`<text x="${X(q.x)}" y="${gy-q.h*sc-6}" text-anchor="middle">${ftIn(q.h)} above ground</text>`+(q.bury?`<text x="${X(q.x)}" y="${gy+q.bury*sc+12}" text-anchor="middle" class="mu">${ftIn(q.bury)} in ground</text>`:'');
    else if(q.lab){const left=q.lab==='L',tx=left?x-6:x+pw+6,an=left?'end':'start';
      o+=`<text x="${tx}" y="${gy-Math.max(q.h*sc/2,7)+4}" text-anchor="${an}">${ftIn(q.h)}</text>`+(q.bury?`<text x="${tx}" y="${gy+q.bury*sc/2+4}" text-anchor="${an}" class="mu">${ftIn(q.bury)} in ground</text>`:'')}}
  return `<svg class="bsvg" viewBox="0 0 ${wft*sc} ${H}" role="img" aria-label="Side view of ${esc(b.name)}, drawn to scale">${o}</svg>`;
}
function shapeEditor(b){
  const sh=braceShape(b),d=`data-id="${b.id}"`,st=sh.style;
  const num=(k,lbl,step='any')=>`<div><label class="f">${lbl}</label><input type="number" min="0" step="${step}" value="${+sh[k]||0}" data-f="kits.${k}" ${d}></div>`;
  return `<h3>What it looks like <span class="small mut" style="font-weight:400">drawn to scale, used in the 3D view</span></h3>
  <div class="bshape"><div>${braceSvg(b)}</div><div>
    <label class="f">Style</label><select data-f="kits.style" ${d}>${BSTYLES.map(([k,l])=>opt(k,l,st)).join('')}</select>
    <div class="g2">${num('h1',st==='single'?'Sticks out of the ground ft':'Tall post sticks out of the ground ft')}
      ${st==='a'||st==='aa'?num('h2','Short post sticks out ft'):''}
      ${st!=='single'?num('span','Distance between posts ft'):''}${st==='h'||st==='n'?num('bays','Bays (2 for a double)','1'):''}</div>
    <div class="row" style="margin-top:8px"><label class="row"><input type="checkbox" ${sh.steel?'checked':''} data-f="kits.steel" ${d}> Steel pipe</label>
      ${st==='h'?`<label class="row"><input type="checkbox" ${sh.wire?'checked':''} data-f="kits.wire" ${d}> Brace wire</label>`:''}</div>
    <details style="margin-top:8px"><summary class="small mut">More measurements (not needed)</summary>
      <div class="g2" style="margin-top:6px">${num('bury1','Tall post in the ground ft')}${st==='a'||st==='aa'?num('bury2','Short post in the ground ft'):''}
        ${num('dia','Post thickness in')}${st!=='single'?num('rail','Rail thickness in'):''}</div></details>
  </div></div>
  <p class="small mut" style="margin:6px 0 0">This only changes the drawing and the 3D view, plus where the line posts start (the distance between posts). What you pay for it is the list above.</p>`;
}
let braceSel=null;   // the brace that's open on the Braces page
function bracesView(){
  const usedBy=id=>S.fenceTypes.filter(t=>['braceEnd','braceCorner','bracePull','braceGate'].some(k=>t[k]===id)).map(t=>t.name);
  const all=[...S.braces.map(b=>KIT(b.id)),...Object.values(drafts.kit).filter(b=>b._new)];
  const costOf=b=>b.items.reduce((a,it)=>a+(+it.q||0)*priceOf(it.m),0);
  const b=all.find(x=>x.id===braceSel);
  if(b){const u=usedBy(b.id),n=A.kits[b.id]||0,cost=costOf(b);
    return `<div class="jobtop"><button class="btn big" data-act="kitsBack">← All braces</button></div>
    <div class="phead"><div><h1>${esc(b.name)}</h1><p>Change anything below, then press <b>Save</b>. ${u.length?'Used by '+u.map(esc).join(', ')+'.':'Not used by any fence type yet.'}</p></div></div>
    <div class="bedit">${saveBar('Kit',b.id)}<div class="row"><input type="text" class="grow tname" style="width:auto" value="${esc(b.name)}" data-f="kit.name" data-id="${b.id}" aria-label="Brace name"><button class="btn" data-act="dupKit" data-id="${b.id}">Make a copy</button><button class="btn del" data-act="delKit" data-id="${b.id}">Delete this brace</button></div>
    <h3>What goes into one brace</h3>
    <table class="ed kit"><thead><tr><th>Part</th><th class="num">How many</th><th>Unit</th><th class="num">$ each</th><th class="num">Cost</th><th></th></tr></thead><tbody>
    ${b.items.map((it,i)=>`<tr><td><select data-f="kiti.m" data-id="${b.id}" data-i="${i}" aria-label="Material">${matOpts(it.m,true)}</select></td>
      <td><input type="number" min="0" step="any" value="${+it.q}" data-f="kiti.q" data-id="${b.id}" data-i="${i}" aria-label="How many"></td>
      <td>${unitIn(it.m)}</td><td>${priceIn(it.m)}</td><td class="num">${money((+it.q||0)*priceOf(it.m))}</td>
      <td><button class="btn x" data-act="delKiti" data-id="${b.id}" data-i="${i}" aria-label="Remove item" title="Remove">×</button></td></tr>`).join('')||'<tr><td colspan="6" class="mut">Nothing in it yet.</td></tr>'}
    </tbody><tfoot><tr><td colspan="4"><button class="btn sm" data-act="addKiti" data-id="${b.id}">Add a part</button></td><td class="num"><b>${money(cost)}</b></td><td></td></tr></tfoot></table>
    <p class="small mut" style="margin:4px 0 0">${money(cost)} for one of these, before tax. Click a price to change that material.</p>
    <div class="row" style="margin-top:12px"><label class="lbl">Labor $ per brace <input type="number" min="0" step="any" value="${+b.labor||0}" data-f="kit.labor" data-id="${b.id}" style="width:100px" aria-label="Labor charge for each brace"></label>
      <span class="small mut">Charged on the Final bill for every one of these in a job${n?` (${fmtQ(n)} in this job: ${money(n*(+b.labor||0))})`:''}.</span></div>
    ${shapeEditor(b)}</div>`}
  braceSel=null;
  const cards=all.map(b=>{const u=usedBy(b.id),n=A.kits[b.id]||0;
    return `<div class="tcard"><div class="tcbar" style="background:var(--acc)"></div>${braceSvg(b)}
      <button class="jobname" data-act="selKit" data-id="${b.id}">${esc(b.name)}</button>${drafts.kit[b.id]?' <span class="tag warnt">not saved</span>':''}
      <dl class="tfacts">
        <dt>Parts</dt><dd>${b.items.filter(it=>matOf(it.m)).map(it=>`${fmtQ(+it.q||0)} × ${esc(matName(it.m))}`).join('<br>')||'<span class="mut">none yet</span>'}</dd>
        <dt>Costs</dt><dd>${money(costOf(b))} each</dd>
        <dt>Labor</dt><dd>${money(+b.labor||0)} each</dd>
        <dt>Used by</dt><dd>${u.length?u.map(esc).join(', '):'<span class="mut">no fence type yet</span>'}</dd>
      </dl>
      <div class="small mut">${n?`${fmtQ(n)} in the open job`:'None in the open job'}</div>
      <div class="jobbtns"><button class="btn pri" data-act="selKit" data-id="${b.id}">Open and change</button><button class="btn" data-act="dupKit" data-id="${b.id}">Make a copy</button></div></div>`}).join('');
  return `<div class="phead"><div><h1>Braces</h1><p>What goes into each brace and what it costs. Each fence type picks which brace goes at its ends, corners, gates and long runs. Click one to open it and make changes.</p></div><button class="btn pri big" data-act="addKit">+ New brace</button></div>
  ${cards?`<div class="jobgrid tgrid">${cards}</div>`:'<p class="mut">Make a brace to get started.</p>'}`;
}
// Settings: a list of sections down the left, one open at a time
let setSec='look';
const SET_ALL=[['account','Your account','Password and signing out'],['look','Text size and help','Bigger words, how-to cards'],['biz','Your business','Name, logo and quote terms'],['crew','Crew','Who works on your jobs'],['money','Sales tax','Tax on materials'],['map','Drawing on the map','Slope, roads and rivers'],['ground','Ground and clearing','Soil, water, trees, clearing $'],['offline','Offline maps','Maps saved for no internet'],['prices','Store prices','Keep prices up to date'],['backup','Backup','Save or load a copy of everything'],['server','Fence Builder server','Use a shared server instead'],['updates','Updates','Your version and new ones']];
// Your account only on a shared server; the server choice only in the Windows app
const setSecs=()=>SET_ALL.filter(([k])=>k==='account'?isMulti():k==='server'?ME.desktop:true);
function settingsView(){
  const SET_SECS=setSecs(),s=S.settings,sec=SET_SECS.some(x=>x[0]===setSec)?setSec:'look';
  const nav=SET_SECS.map(([k,n,d])=>`<button class="setnav${k===sec?' on':''}" data-act="setSec" data-k="${k}"${k===sec?' aria-current="page"':''}><b>${n}</b><span>${d}</span></button>`).join('');
  const check=(f,on,label,help)=>`<label class="setcheck"><span><b>${label}</b>${help?`<span>${help}</span>`:''}</span><span class="switch"><input type="checkbox" role="switch" ${on?'checked':''} data-f="set.${f}" aria-label="${esc(label)}"><i></i><em>${on?'On':'Off'}</em></span></label>`;
  const crew=s.crew||[],b=s.biz||{};
  const bf=(k,label,type='text',ph='')=>`<div class="setfield"><label class="f" for="bz_${k}">${label}</label><input id="bz_${k}" type="${type}" value="${esc(b[k]??'')}" placeholder="${esc(ph)}" data-f="biz.${k}"></div>`;
  const plainWarn=ME.warn_plain?`<div class="note warnbox"><b>This connection is not private.</b> The address starts with http://, not https://, so your password and jobs travel over the internet unencrypted. Ask the person who runs Fence Builder to turn on https.</div>`:'';
  const body={
    account:`<h2>Your account</h2><p class="lead">You are signed in as <b>${esc(ME.user?.name||'')}</b>, user name <b>${esc(ME.user?.username||'')}</b>. Your jobs, prices and settings are your own. Other people who use this server can't see them.</p>${plainWarn}
      <h3>Change your password</h3>
      <div class="setfield"><label class="f" for="pwOld">Your password now</label><input id="pwOld" type="password" autocomplete="current-password"></div>
      <div class="setfield"><label class="f" for="pwNew">New password</label><input id="pwNew" type="password" autocomplete="new-password"></div>
      <div class="setfield"><label class="f" for="pwNew2">New password again</label><input id="pwNew2" type="password" autocomplete="new-password"></div>
      <p class="mut" style="margin-top:0">At least 10 letters, numbers or spaces. A short sentence you will remember works well, like <i>red barn by the creek</i>.</p>
      <button class="btn pri big" data-act="pwChange">Change my password</button>
      <h3>Signing out</h3><p class="mut" style="margin-top:0">On a computer other people use, sign out when you are done. Signing out also clears what this browser kept for you.</p>
      <button class="btn big" data-act="signOut">Sign out</button>
      ${isAdmin()?`<h3>Accounts</h3><p class="mut" style="margin-top:0">You are an admin: you can add people, reset passwords and see who signed in.</p><a class="btn pri big" href="admin">Manage accounts</a>`:''}
      ${inApp()?`<h3>This computer</h3><p class="mut" style="margin-top:0">Go back to the jobs kept on this computer, without the server.</p><button class="btn big" data-act="useLocal">Use the copy on this computer</button>`:''}`,
    server:`<h2>Fence Builder server</h2><p class="lead">This app keeps your jobs on this computer. If your business runs a shared Fence Builder server, where everyone signs in, this app can open that instead.</p>
      ${ME.server_url?`<div class="note">The app is set to open <b>${esc(ME.server_url)}</b>, but it could not reach it, so you are using the copy on this computer.</div>`:''}
      <div class="setfield" style="max-width:560px"><label class="f" for="srvUrl">The server's address</label><input id="srvUrl" type="url" inputmode="url" value="${esc(ME.server_url||'')}" placeholder="https://fence.example.com"></div>
      <div class="row"><button class="btn pri big" data-act="useServer">Use this server</button>${ME.server_url?'<button class="btn big" data-act="useLocalCopy">Keep using this computer</button>':''}</div>
      <div class="note">Your jobs on this computer stay here, apart from the server's. To come back to them, press <b>Use the copy on this computer</b> on the server's sign-in page or in its Settings, Your account.</div>`,
    look:`<h2>Text size</h2><p class="lead">Make the words and buttons bigger. It counts on this computer and every other one. The map itself stays the same.</p>
      <div class="sizepick">${[['1','Normal'],['1.15','Large'],['1.3','Larger']].map(([v,n])=>`<button class="sizebtn${String(+s.textSize||1)===v?' on':''}" data-act="textSize" data-k="${v}"><span style="font-size:${17*+v}px">Aa</span><b>${n}</b></button>`).join('')}</div>
      <h3>How-to cards</h3><p class="mut" style="margin-top:0">A short card at the top of each page says how it works. Press <b>Got it</b> on a card to hide it.</p>
      <button class="btn big" data-act="tipsReset">Show the how-to cards again</button>`,
    biz:`<h2>Your business</h2><p class="lead">What prints at the top and bottom of every customer quote.</p>
      <div class="bizlogo">${b.logo?`<img src="${esc(b.logo)}" alt="Your logo">`:'<span class="mut">No logo yet</span>'}<div class="row"><button class="btn big" data-act="bizLogo">${b.logo?'Change the logo':'Add your logo'}</button>${b.logo?'<button class="btn del" data-act="bizLogoDel">Remove</button>':''}</div></div>
      ${bf('name','Business name')}${bf('tag','A short line under the name (optional)','text','Farm, ranch and residential fencing')}
      ${bf('phone','Phone','tel')}${bf('email','Email','email')}${bf('web','Website (optional)')}
      <div class="setfield"><label class="f" for="bz_addr">Mailing address</label><textarea id="bz_addr" rows="2" data-f="biz.addr">${esc(b.addr||'')}</textarea></div>
      ${bf('lic','License or registration number (optional)')}
      <h3>Quotes</h3>
      <div class="setfield"><label class="f" for="bz_validDays">A quote is good for, days</label><input id="bz_validDays" type="number" min="0" step="1" value="${+(b.validDays??30)}" data-f="biz.validDays"></div>
      <div class="setfield"><label class="f" for="bz_deposit">Deposit to start, % of the total</label><input id="bz_deposit" type="number" min="0" max="100" step="5" value="${+(b.deposit??50)}" data-f="biz.deposit"></div>
      <div class="setfield"><label class="f" for="bz_detail">Prices on the quote</label><select id="bz_detail" data-f="biz.detail">${opt('lines','A price for each part of the job',b.detail||'lines')}${opt('total','The total only',b.detail||'lines')}</select></div>
      <div class="setfield"><label class="f" for="snq">Next quote number</label><input id="snq" type="number" min="1" step="1" value="${Math.max(1001,Math.round(+s.nextQuote||1001))}" data-f="set.nextQuote"></div>
      <div class="setfield" style="max-width:560px"><label class="f" for="bz_terms">Terms, one on each line</label><textarea id="bz_terms" rows="6" data-f="biz.terms">${esc(b.terms??QUOTE_TERMS)}</textarea></div>
      ${bf('thanks','Thank-you line at the bottom','text','Thank you for the chance to quote your fence.')}`,
    crew:`<h2>Crew</h2><p class="lead">The people who build your fences. Pick who works on each job on that job's page.</p>
      ${crew.length?`<div class="crewlist">${crew.map((c,i)=>`<div class="crewrow"><div><label class="f" for="cn${i}">Name</label><input id="cn${i}" type="text" value="${esc(c.name||'')}" data-f="crew.name" data-i="${i}" placeholder="Name"></div>
        <div><label class="f" for="cp${i}">Phone</label><input id="cp${i}" type="tel" value="${esc(c.phone||'')}" data-f="crew.phone" data-i="${i}" placeholder="Phone (optional)"></div>
        <div><label class="f" for="cw${i}">Pay $ an hour</label><input id="cw${i}" type="number" min="0" step="0.5" value="${+c.wage||0}" data-f="crew.wage" data-i="${i}"></div>
        <button class="btn del" data-act="delCrew" data-i="${i}">Remove</button></div>`).join('')}</div>`:'<p class="mut">No one yet.</p>'}
      <button class="btn pri big" data-act="addCrew" style="margin-top:12px">+ Add a person</button>
      <h3>What the crew costs you</h3><p class="mut" style="margin-top:0">Used on each job's <b>How the job really went</b> to show your profit and suggest a labor price.</p>
      <div class="setfield"><label class="f" for="sbur">Taxes, insurance and workers comp on top of pay, %</label><input id="sbur" type="number" min="0" step="1" value="${+s.burden||0}" data-f="set.burden"></div>
      <div class="setfield"><label class="f" for="sdh">Hours in a work day</label><input id="sdh" type="number" min="1" step="0.5" value="${+s.dayHrs||8}" data-f="set.dayHrs"></div>
      <div class="setfield"><label class="f" for="slm">Profit you want to make on labor, %</label><input id="slm" type="number" min="0" max="90" step="5" value="${+(s.laborMargin??35)}" data-f="set.laborMargin"></div>`,
    money:`<h2>Sales tax</h2><p class="lead">Added to the materials on every Final bill.</p>
      <div class="setfield"><label class="f" for="stax">Sales tax on materials, %</label><input id="stax" type="number" min="0" step="0.01" value="${+s.tax}" data-f="set.tax"></div>
      <div class="note">Labor is set as a $ per foot on each fence type, and per brace on the Braces page. Headache charges and other fees are added on each job's Final bill.</div>`,
    map:`<h2>Drawing on the map</h2><p class="lead">How fence lines are measured and what gets added when you draw.</p>
      ${check('useSurface',s.useSurface,'Measure along the ground slope','Footage follows the hills, from the LiDAR ground heights, instead of a flat line on the map.')}
      <h3>Braces added for you</h3>${autoSwitches('')}
      <div class="note">The rule for hill braces is on each fence type, under Braces. The same four switches are at the top of the Builder.</div>
      <div class="note">Every spot you click gets a brace: a bend gets the corner brace, a spot on a straight run gets the pull brace. You can change any single spot on the map afterwards.</div>`,
    ground:groundSettings(),
    offline:`<h2>Offline maps</h2><p class="lead">${isMulti()?'Areas saved on the server, for when its internet is slow or down':'Areas saved on this computer to use with no internet'}: the aerial photo, the LiDAR bare-earth map and ground heights, and the property lines. With no internet the map switches to them on its own.</p>
      ${isMulti()&&ME.offline!=='all'&&!(ME.offline==='admin'&&isAdmin())?'<p class="mut">Saving new areas is turned off on this server. Ask the person who runs it.</p>':''}
      ${serverOK?(offList.length?`<div class="box">${offList.map(a=>{const pct=a.total?Math.floor(a.done/a.total*100):0,st=a.status==='downloading'?`Downloading, ${pct}%`:a.status==='done'?'Ready':a.status==='partly'?`Ready, ${a.failed} pieces missing`:a.status==='stopped'?`Stopped at ${pct}%`:'Did not finish';
        return `<div class="offrow"><div><b>${esc(a.name)}</b><div class="mut">${st} · ${fmtQ(Math.round((a.bytes||0)/1e6))} MB · saved ${new Date(a.created*1000).toLocaleDateString()}</div></div>
          <div class="row" style="flex-wrap:nowrap">${['stopped','partly','error'].includes(a.status)?`<button class="btn" data-act="offResume" data-id="${a.id}">Finish it</button>`:''}<button class="btn" data-act="offShow" data-id="${a.id}">Show on map</button><button class="btn del" data-act="offDel" data-id="${a.id}">Delete</button></div></div>`}).join('')}</div>`:'<p class="mut">None saved yet.</p>'):'<p class="mut">This needs the Fence Builder app or server.</p>'}
      <button class="btn pri big" data-act="offNew" style="margin-top:12px">+ Save an area for offline</button>`,
    prices:`<h2>Store prices</h2><p class="lead">Prices of materials with a store link can update on their own. Prices you set on a single job are never changed.</p>
      <div class="setfield"><label class="f" for="sap">Update prices</label><select id="sap" data-f="set.autoPrices">${opt('day','Automatically, once a day',s.autoPrices??'day')}${opt('week','Automatically, once a week',s.autoPrices??'day')}${opt('off','Only when I press Update now',s.autoPrices??'day')}</select></div>
      <button class="btn big" data-act="fetchAll">Update now</button>
      ${s.priceRun?`<div class="note">Last checked ${new Date(s.priceRun.at).toLocaleString()}: ${s.priceRun.checked} checked, ${s.priceRun.moved} changed${s.priceRun.failed?`, ${s.priceRun.failed} could not be read`:''}.
        ${s.priceRun.list?.length?`<ul style="margin:6px 0 0;padding-left:18px">${s.priceRun.list.map(x=>`<li>${esc(x.name)}: ${money(x.from)} → ${money(x.to)}</li>`).join('')}</ul>`:''}</div>`:''}
      <h3>Another store</h3><p class="mut" style="margin-top:0">Kencove and D&amp;B Supply are built in. Add one more store here if it is built on Shopify, and it shows up in the store finder on the Materials page.</p>
      <div class="setfield"><label class="f" for="sshop">Store website (optional)</label><input id="sshop" type="text" value="${esc(s.shop||'')}" data-f="set.shop" placeholder="example.com"></div>`,
    backup:`<h2>Backup</h2><p class="lead">${serverOK?'Everything saves on its own as you work, with a backup copy kept every hour.':'No Fence Builder server found, so everything only saves in this browser.'} You can also keep your own copy.</p>
      <div class="row"><button class="btn pri big" data-act="export">Download a backup</button><button class="btn big" data-act="import">Load a backup</button></div>
      ${!isMulti()?`<h3>Starting setup for new installs</h3><p class="mut" style="margin-top:0">Saves your fence types, braces, materials and prices as what Fence Builder starts with on a new computer. Jobs are not included.</p>
      <button class="btn big" data-act="saveSeed">Save my setup as the starting setup</button>`:isAdmin()?`<h3>Starting setup for new accounts</h3><p class="mut" style="margin-top:0">Saves your fence types, braces, materials and prices as what each new account on this server starts with. Your jobs, business details and crew are not included.</p>
      <button class="btn big" data-act="saveSeed">Save my setup as the starting setup for new accounts</button>`:''}`,
    updates:upd?.server?`<h2>Updates</h2><p class="lead">This server has <b>Fence Builder ${esc(upd.version||'…')}</b>.${isAdmin()&&upd.newer?` <b>${esc(upd.latest)}</b> is out.`:''}</p>
      <div class="note">${isAdmin()?'A shared server is updated by whoever runs it, with a new Docker image. The steps are in <a href="https://github.com/Benbone21/fence-builder#updating-the-server" target="_blank" rel="noopener">the guide</a>. Nobody\'s jobs, prices or settings are touched.':'The person who runs this server keeps it up to date.'}</div>`:
    `<h2>Updates</h2><p class="lead">You have <b>Fence Builder ${esc(upd?.version||'…')}</b>.${upd?.available?` <b>${esc(upd.latest)}</b> is out.`:upd&&!upd.reason?' It is the newest version.':''}</p>
      ${upd?.reason?`<p class="mut">${esc(upd.reason)}</p>`:''}
      <div class="row">${upd?.available?'<button class="btn pri big" data-act="installUpd">Update now</button>':''}<button class="btn big" data-act="checkUpd">Check for updates</button>${upd?.url?`<a class="btn big" href="${esc(upd.url)}" target="_blank" rel="noopener">What's new</a>`:''}</div>
      <div class="note">Fence Builder checks for updates when it opens and every few hours. Updating never touches your jobs, prices or settings.</div>`,
  }[sec];
  return `<div class="phead"><div><h1>Settings</h1><p>Choices for the whole app and every job. Changes save on their own.</p></div></div>
  <div class="setwrap"><nav class="setmenu" aria-label="Settings sections">${nav}</nav><section class="setbody">${body}</section></div>`;
}

