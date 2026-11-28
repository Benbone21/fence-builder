/* ---------- customer quote: a clean printable page for the customer ---------- */
const QUOTE_TERMS='The price includes all materials, delivery to the site and installation as described above.\nA deposit is due when the quote is accepted, and the balance when the fence is finished.\nThe customer is responsible for knowing where the property lines are. Changes to the work, or buried rock or other conditions that could not be seen, may change the price.\nThis quote is good until the date shown above.';
const biz=()=>S.settings.biz||{};
function quoteOf(p){p.quote=p.quote||{};if(!p.quote.no){const s=S.settings;s.nextQuote=Math.max(1001,Math.round(+s.nextQuote||1001));p.quote.no=s.nextQuote++;save()}return p.quote}
const cleanName=n=>String(n||'').replace(/[,\s]*\(?\b\d[\d,]*\s*(ft|feet|')\s*(rolls?)?\)?\s*$/i,'').trim();
function fenceDesc(T){
  const t=T.t,parts=[],ok=id=>id&&matOf(id);
  if(+t.height)parts.push(`${fmtQ(+t.height)} ft tall`);
  const ws=(t.wires||[]).filter(w=>+w.strands>0&&ok(w.m)).map(w=>`${+w.strands>1?+w.strands+' strands of ':''}${cleanName(matName(w.m))}`);if(ws.length)parts.push(ws.join(' and '));
  if(ok(t.postM))parts.push(`${cleanName(matName(t.postM))} every ${fmtQ(+t.spacing||12)} ft`);
  (t.posts||[]).forEach((r,i)=>{if(T.other?.[i]&&ok(r.m))parts.push(`${T.other[i]} ${cleanName(matName(r.m))}`)});
  return parts.join(', ');
}
// the job total split into one line for each fence type, braces, gates and each fee; the lines add up to the total
function quoteParts(p,a){
  const L=a.lab||{},tx=1+(+S.settings.tax||0)/100,hd=p.headache||{},g=new Map(),byName={};
  const grp=(k,name,desc,qty)=>{if(!g.has(k))g.set(k,{k,name,desc,qty,amt:0});return g.get(k)};
  for(const T of Object.values(a.types))if(T.L>0){byName[T.t.name]=T;grp('t:'+T.t.id,T.t.name,fenceDesc(T),T.L)}
  const kits=Object.entries(a.kits).filter(([,n])=>n>0);
  if(kits.length)grp('braces','Braces',kits.map(([id,n])=>`${fmtQ(n)} ${kitName(id)}`).join(', ')+', at the ends, corners, gates and long pulls','');
  if(a.gates){const u=[...new Set([...a.nodes.values()].filter(o=>o.brace==='gate').map(o=>+o.pt?.gw||0).filter(Boolean))];
    grp('gates',a.gates>1?'Gates':'Gate',`${a.gates} gate${a.gates>1?'s':''}${u.length?`, ${u.map(w=>fmtQ(w)+' ft').join(' and ')} wide`:''}, hung with hinges and a latch`,'')}
  const keyOf=n=>byName[n]?'t:'+byName[n].t.id:n==='Gates'?'gates':'braces';
  const need=k=>g.get(k)||grp(k,k==='gates'?'Gates':'Braces','','');
  for(const r of a.rows){const by=r.by&&Object.keys(r.by).length?r.by:{[r.grp]:1},tot=Object.values(by).reduce((s,v)=>s+v,0)||1,amt=r.cost*tx+r.q*(+hd[r.m.id]||0);
    for(const [n,q] of Object.entries(by))need(keyOf(n)).amt+=amt*q/tot}
  const lab=[...(L.byType||[]).map(x=>['t:'+x.t.id,x.cost]),...(L.byBrace||[]).map(x=>['braces',x.cost])],base=lab.reduce((s,x)=>s+x[1],0);
  if(L.cost>0){if(base>0)for(const [k,c] of lab)need(k).amt+=c/base*L.cost;
    else{const ts=[...g.values()].filter(x=>x.k.startsWith('t:')),sum=ts.reduce((s,x)=>s+x.qty,0);if(sum)for(const x of ts)x.amt+=x.qty/sum*L.cost;else grp('labor','Installation','','').amt+=L.cost}}
  const out=[...g.values()];
  for(const f of L.fees||[])out.push({k:'fee',name:f.name||'Other',desc:'',qty:'',amt:+f.amount||0});
  for(const x of out)x.amt=Math.round(x.amt*100)/100;
  const diff=Math.round((a.total-out.reduce((s,x)=>s+x.amt,0))*100)/100;
  if(out.length&&diff){const big=out.reduce((b,x)=>x.amt>b.amt?x:b,out[0]);big.amt=Math.round((big.amt+diff)*100)/100}
  return out.filter(x=>x.amt>0.004||x.k.startsWith('t:')||x.k==='gates');
}
// a drawing of the fence lines, to scale, for the quote
function fenceSketch(p,a){
  const ls=p.lines.filter(l=>!l.manual&&(l.pts||[]).length>1);if(!ls.length)return '';
  const all=ls.flatMap(l=>l.pts),lat0=all.reduce((s,q)=>s+q.lat,0)/all.length,kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;
  const raw=q=>[q.lng*kx,-q.lat*ky],RR=all.map(raw);
  const minx=Math.min(...RR.map(v=>v[0])),maxx=Math.max(...RR.map(v=>v[0])),miny=Math.min(...RR.map(v=>v[1])),maxy=Math.max(...RR.map(v=>v[1]));
  const W=700,H=280,pad=36,s=Math.min((W-2*pad)/Math.max(1,maxx-minx),(H-2*pad)/Math.max(1,maxy-miny));
  const ox=(W-(maxx-minx)*s)/2,oy=(H-(maxy-miny)*s)/2,X=q=>{const v=raw(q);return [(v[0]-minx)*s+ox,(v[1]-miny)*s+oy]};
  const PAL=['#1f3a5f','#a0522d','#2f6b34','#6d2a6d','#8a1c1c','#0f6e6e'],tc={};let ti=0;
  const col=id=>tc[id]??(tc[id]=PAL[ti++%PAL.length]),f1=v=>v.toFixed(1);
  let paths='',dots='',labels='';
  for(const l of ls){const c=col(l.type),pts=l.pts.map(X);
    paths+=`<polyline points="${pts.map(v=>f1(v[0])+','+f1(v[1])).join(' ')}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    l.pts.forEach((q,i)=>{const o=a.nodes.get(key(q)),[x,y]=pts[i];
      if(o?.brace==='gate')dots+=`<rect x="${f1(x-6)}" y="${f1(y-6)}" width="12" height="12" rx="2" fill="#e08a00" stroke="#fff" stroke-width="1.5"/>`;
      else if(o&&o.brace&&o.brace!=='none')dots+=`<circle cx="${f1(x)}" cy="${f1(y)}" r="3.4" fill="#fff" stroke="${c}" stroke-width="2"/>`});
    let bi=1,bl=-1;for(let i=1;i<pts.length;i++){const dd=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(dd>bl){bl=dd;bi=i}}
    const r=a.lines.find(z=>z.l===l);
    if(r&&bl>40){const mx=(pts[bi][0]+pts[bi-1][0])/2,my=(pts[bi][1]+pts[bi-1][1])/2,up=Math.abs(pts[bi][0]-pts[bi-1][0])<Math.abs(pts[bi][1]-pts[bi-1][1]);
      labels+=`<text x="${f1(up?mx+9:mx)}" y="${f1(up?my+4:my-9)}" text-anchor="${up?'start':'middle'}" class="qlbl">${esc(fmtFt(r.len+(r.gateW||0)))}</text>`}}
  const ftPx=FT/s,want=ftPx*130,nice=[10,25,50,100,200,250,500,1000,2000,2500,5000,10000,20000].reduce((b,v)=>v<=want?v:b,10),bw=nice/ftPx;
  const bar=`<g transform="translate(16,${H-20})"><rect width="${f1(bw)}" height="6" fill="#1d2430"/><rect width="${f1(bw/2)}" height="6" fill="#fff" stroke="#1d2430" stroke-width="1"/><text x="${f1(bw+8)}" y="7" class="qlbl sm">${fmtQ(nice)} ft</text></g>`;
  const north=`<g transform="translate(${W-24},24)"><path d="M0,-13 L7,7 L0,2 L-7,7 Z" fill="#1d2430"/><text y="20" text-anchor="middle" class="qlbl sm">N</text></g>`;
  const leg=Object.entries(tc).map(([id,c])=>{const T=Object.values(a.types).find(z=>z.t.id===id);return `<span><i style="background:${c}"></i>${esc(T?.t.name||'')}${T?` · ${fmtFt(T.L)}`:''}</span>`}).join('')+(a.gates?'<span><i class="g"></i>Gate</span>':'')+'<span><i class="b"></i>Brace or corner</span>';
  return `<div class="qmap"><h4>Fence layout</h4><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Drawing of the fence lines">${paths}${dots}${labels}${bar}${north}</svg><div class="qleg">${leg}</div></div>`;
}
function quoteHTML(p,a){
  const b=biz(),q=quoteOf(p),today=new Date(),valid=Math.max(0,Math.round(+(b.validDays??30))),until=new Date(today.getTime()+valid*864e5);
  const dep=Math.max(0,Math.min(100,+(b.deposit??50))),depAmt=Math.round(a.total*dep)/100;
  const dt=x=>x.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
  const parts=quoteParts(p,a),itemized=(q.detail||b.detail||'lines')!=='total';
  const rows=parts.map(x=>`<tr><td><b>${esc(x.name)}</b>${x.desc?`<div class="qd">${esc(x.desc)}</div>`:''}</td><td class="qn">${typeof x.qty==='number'?fmtFt(x.qty):''}</td>${itemized?`<td class="qn">${x.amt>0.004?money(x.amt):'Included'}</td>`:''}</tr>`).join('');
  const contact=[b.phone,b.email,b.web].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const terms=String(b.terms??QUOTE_TERMS).split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join('');
  return `<div class="qpage">
  <div class="qhead"><div class="qbiz">${b.logo?`<img src="${esc(b.logo)}" alt="" class="qlogo">`:''}<div><div class="qname">${esc(b.name||'Your business name')}</div>${b.tag?`<div class="qtag">${esc(b.tag)}</div>`:''}${b.addr?`<div class="qaddr">${esc(b.addr).replace(/\n/g,'<br>')}</div>`:''}${contact?`<div class="qaddr">${contact}</div>`:''}${b.lic?`<div class="qaddr">${esc(b.lic)}</div>`:''}</div></div>
    <div class="qtitle"><div class="qword">Quote</div><table class="qmeta"><tr><td>Quote no.</td><td>${esc(q.no)}</td></tr><tr><td>Date</td><td>${dt(today)}</td></tr>${valid?`<tr><td>Good until</td><td>${dt(until)}</td></tr>`:''}</table></div></div>
  <div class="qparties"><div><h4>Prepared for</h4><b>${esc(p.customer||'')}</b>${p.phone?`<div>${esc(p.phone)}</div>`:''}${p.email?`<div>${esc(p.email)}</div>`:''}</div>
    <div><h4>Job site</h4>${p.address?`<div>${esc(p.address)}</div>`:''}<div class="qmut">${esc(p.name)}</div></div>
    <div class="qtotft"><h4>Fence</h4><b>${fmtFt(a.totalFt)}</b>${a.gates?`<div>${a.gates} gate${a.gates>1?'s':''}</div>`:''}</div></div>
  ${q.note?`<p class="qnote">${esc(q.note).replace(/\n/g,'<br>')}</p>`:''}
  <table class="qtable"><thead><tr><th>Work to be done</th><th class="qn">Length</th>${itemized?'<th class="qn">Amount</th>':''}</tr></thead><tbody>${rows}</tbody></table>
  <div class="qtotals"><table><tr class="qgrand"><td>Total</td><td>${money(a.total)}</td></tr>${dep?`<tr><td>Deposit to start (${fmtQ(dep)}%)</td><td>${money(depAmt)}</td></tr><tr><td>Balance when finished</td><td>${money(a.total-depAmt)}</td></tr>`:''}</table></div>
  ${q.map!==false?fenceSketch(p,a):''}
  ${terms?`<div class="qterms"><h4>Terms</h4><ul>${terms}</ul></div>`:''}
  <div class="qsign"><p>To accept this quote, sign below and return a copy${dep?' with the deposit':''}.</p>
    <div class="qsl"><div><span></span>Customer signature</div><div><span></span>Date</div></div>
    <div class="qsl"><div><span></span>${esc(b.name||'Contractor')}</div><div><span></span>Date</div></div></div>
  <div class="qfoot">${esc(b.thanks||'Thank you for the chance to quote your fence.')}</div></div>`;
}
let quoteOn=false;
function openQuote(){const p=P();if(!p||!A.rows.length)return toast('Draw some fence first, then make the quote');quoteOf(p);quoteOn=true;renderQuote()}
function renderQuote(){
  const p=P(),q=p.quote,b=biz(),el=$('#quoteView'),det=q.detail||b.detail||'lines';
  el.innerHTML=`<div class="qbar noprint"><b class="qbt">Customer quote</b>
    <label>Prices <select data-q="detail">${opt('lines','A price for each part',det)}${opt('total','The total only',det)}</select></label>
    <label><input type="checkbox" data-q="map"${q.map!==false?' checked':''}> Fence drawing</label>
    <button class="btn" data-q="note">${q.note?'Change the note':'Add a note for the customer'}</button>
    <button class="btn" data-q="biz">Your business info</button>
    <span class="grow"></span>
    <button class="btn pri big" data-q="print">Print or save as PDF</button><button class="btn big" data-q="close">Close</button></div>
    ${b.name?'':`<div class="qwarn noprint">Add your business name, phone and logo so they print at the top. <button class="btn sm" data-q="biz">Add them</button></div>`}
    <div class="qscroll">${quoteHTML(p,A)}</div>`;
  el.hidden=false;document.body.classList.add('quoting');
}
function closeQuote(){quoteOn=false;$('#quoteView').hidden=true;document.body.classList.remove('quoting')}
$('#quoteView').addEventListener('click',async e=>{
  const k=e.target.closest('[data-q]')?.dataset.q;if(!k||k==='detail'||k==='map')return;const p=P();
  if(k==='close')closeQuote();
  else if(k==='print'){logJob(p,`Quote ${p.quote.no} made: ${money(A.total)}`);if(!p.bidDate)p.bidDate=new Date().toLocaleDateString('en-CA');save();window.print()}
  else if(k==='biz'){closeQuote();setSec='biz';gotoTab('settings')}
  else if(k==='note'){const n=await askText('A note for the customer, printed above the price',p.quote.note||'');if(n!==null){p.quote.note=n.trim();save();renderQuote()}}
});
$('#quoteView').addEventListener('change',e=>{const k=e.target.dataset.q,p=P();if(k==='detail')p.quote.detail=e.target.value;else if(k==='map')p.quote.map=e.target.checked;else return;save();renderQuote()});
addEventListener('keydown',e=>{if(!quoteOn||document.querySelector('dialog[open]'))return;e.stopImmediatePropagation();if(e.key==='Escape'){e.preventDefault();closeQuote()}},true);
function pickLogo(){
  const f=document.createElement('input');f.type='file';f.accept='image/*';
  f.onchange=()=>{const file=f.files[0];if(!file)return;const rd=new FileReader();
    rd.onload=()=>{const img=new Image();img.onload=()=>{const k=Math.min(1,500/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*k));c.height=Math.max(1,Math.round(img.height*k));c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      S.settings.biz={...biz(),logo:c.toDataURL('image/png')};changed();toast('Logo added')};img.onerror=()=>toast('That picture could not be read');img.src=rd.result};
    rd.readAsDataURL(file)};
  f.click();
}

