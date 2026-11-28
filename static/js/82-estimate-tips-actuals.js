/* ---------- saving the estimate to the jobs board ---------- */
function saveEstimate(){
  const p=P();if(!p||!A.rows.length)return toast('Draw some fence first, then save the estimate');
  p.est={total:A.total,sub:A.sub,labor:A.lab.cost,headache:A.lab.matHead,fees:A.lab.feeTotal,ft:A.totalFt,at:new Date().toISOString(),rows:A.rows.map(r=>({id:r.m.id,name:r.m.name,q:r.q,unit:r.m.unit,price:r.price,custom:r.custom||undefined,cost:r.cost}))};
  p.stage=p.stage||'bid';logJob(p,'Estimate saved: '+money(A.total)+' for '+fmtFt(A.totalFt));changed();
  toast('Estimate saved. It shows on the jobs board under '+stageName(p.stage)+'.');
}
function estNote(p){
  if(!A.rows.length)return '';
  if(!p.est)return `<div class="note noprint estnote">This estimate is not saved to the jobs board yet. <button class="btn sm pri" data-act="saveEst">Save estimate</button></div>`;
  const ch=Math.abs(p.est.total-A.total)>0.5;
  return `<div class="note noprint estnote${ch?' warnbox':''}">Estimate saved ${esc(new Date(p.est.at).toLocaleDateString())}: ${money(p.est.total)} for ${fmtFt(p.est.ft)}.${ch?` The job has changed since and is now ${money(A.total)}. <button class="btn sm pri" data-act="saveEst">Save it again</button>`:''}</div>`;
}

/* ---------- add a material: from a store, from a link, or your own ---------- */
function addMatPick(){
  const d=$('#askDlg'),stores=storeList();
  d.innerHTML=`<h2 style="margin:0 0 4px">Add a material</h2><p class="mut" style="margin:0 0 14px">Where does it come from?</p>
    <div class="addpick">${stores.map((s,i)=>`<button class="addopt" data-p="s${i}"><b>From ${esc(s.name)}</b><span>Search or browse ${esc(s.name)} and add it with its price, picture and link</span></button>`).join('')}
    <button class="addopt" data-p="link"><b>From a store link</b><span>Paste the web address of a product page from any store</span></button>
    <button class="addopt" data-p="own"><b>My own material</b><span>Type in the name, price and details yourself</span></button></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn big" data-p="x">Cancel</button></div>`;
  d.oncancel=null;d.onkeydown=null;d.onchange=null;
  d.onclick=e=>{const k=e.target.closest('[data-p]')?.dataset.p;if(!k&&e.target!==d)return;d.close();if(!k||k==='x')return;
    if(k==='own')openMatDlg(null);
    else if(k==='link')addFromLink();
    else{const i=+k.slice(1);if(i!==shop.sel)Object.assign(shop,{sel:i,cols:null,cat:null,all:null,items:[],title:'',msg:'',q:''});openShopDlg()}};
  d.classList.add('addmat');d.addEventListener('close',()=>d.classList.remove('addmat'),{once:true});   // a wider window for the four choices
  d.showModal();d.querySelector('.addopt')?.focus();
}

/* ---------- how-to cards at the top of each page ---------- */
const TIPS={
  jobs:['Your jobs, by stage',['Press <b>+ New job</b> in the Bid column to start one.','Click a job to open its page: the customer, the schedule, the money and notes.','Move a job along with the buttons on its card, or drag it to another column.']],
  job:['This job',['Fill in the customer at the top.','<b>Fence map</b> draws the fence. <b>Final bill</b> shows the price. <b>Customer quote</b> makes a quote to print or send.','When the job is done, fill in <b>How the job really went</b> to see your profit and a suggested labor price.']],
  build:['Drawing a fence',['Pick the kind of fence.','Press <b>Draw fence</b>, click each corner on the map, then press <b>Finish line</b>.','Made a mistake? Press <b>Undo</b> at the top of the map. Right-click the map for more choices.']],
  est:['The Final bill',['Everything to buy for this job, and what to charge.','A price you change here counts for this job only.','<b>Save estimate</b> keeps it on the jobs board. <b>Customer quote</b> makes a clean quote for the customer.']],
  types:['Fence types',['Each kind of fence you build: its wire, posts, braces and labor price.','Click one to open it. Changes wait until you press <b>Save</b>.']],
  braces:['Braces',['What goes into each brace, and its labor charge.','Each fence type picks which brace goes at its ends, corners, gates and long runs.']],
  prices:['Materials',['Every material you buy, and its price.','<b>+ Add material</b> adds one from Kencove, D&amp;B Supply, a store link, or your own.','Prices with a store link update on their own.']],
  settings:['Settings',['Pick a section on the left.','<b>Your business</b> is what prints at the top of customer quotes.']],
};
let tipsSeen=(()=>{try{return JSON.parse(localStorage.getItem('fence-tips')||'{}')}catch(e){return {}}})();
function tipCard(k){const t=TIPS[k];if(!t||tipsSeen[k])return '';
  return `<div class="tipcard noprint"><div><b>How this page works: ${t[0]}</b><ol>${t[1].map(x=>`<li>${x}</li>`).join('')}</ol></div><button class="btn" data-act="tipDone" data-k="${k}">Got it</button></div>`}

/* ---------- builder sidebar helpers ---------- */
function typeSummary(t){const w=(t.wires||[]).reduce((s,x)=>s+(+x.strands||0),0);
  return [`${w} strand${w===1?'':'s'} of wire`,`posts every ${fmtQ(+t.spacing||12)} ft`,`${kitName(t.braceCorner)} at corners`].join(' · ')}
function drawnNote(){const n=P().lines.filter(l=>!l.manual&&l.pts?.length>1).length;return n?`<span class="stpdone">✓ ${n} line${n>1?'s':''}, ${fmtFt(A.totalFt)}</span>`:''}

/* ---------- what the job really took, and what to charge for labor next time ---------- */
// the crew's cost per hour: average pay of the people on the job, plus taxes and insurance
function crewRate(p){const s=S.settings,crew=s.crew||[],ids=Array.isArray(p.crew)?p.crew:crew.map(c=>c.id);
  const paid=crew.filter(c=>+c.wage>0),on=paid.filter(c=>ids.includes(c.id)),list=on.length?on:paid;
  const pay=list.length?list.reduce((a,c)=>a+(+c.wage),0)/list.length:0;
  return {pay,rate:pay*(1+(+s.burden||0)/100),n:ids.length}}
function actualOf(p,a){
  const x=p.actual||{},cr=crewRate(p),rate=+x.rate>0?+x.rate:cr.rate;
  const days=+x.days||0,people=+x.people||cr.n||1,hpd=+x.hpd||+S.settings.dayHrs||8;
  const hours=+x.hours>0?+x.hours:days*people*hpd,tx=1+(+S.settings.tax||0)/100,qty=x.qty||{},usedQ=Object.keys(qty).length;
  const matQ=a.rows.reduce((s,r)=>s+(qty[r.m.id]!=null?+qty[r.m.id]:r.q)*r.price*tx,0);
  const mat=x.mat!=null?+x.mat:usedQ?matQ:null;
  return {x,rate,pay:cr.pay,days,people,hpd,hours,mat,matQ,usedQ,wages:hours>0?hours*rate:null,other:+x.other||0,any:hours>0||mat!=null||+x.other>0}
}
// per fence type, from every job where "How the job really went" has the time filled in
function laborHistory(){
  const h={};
  for(const p of S.projects){if(!p.actual)continue;const a=jobAnalysis(p),R=actualOf(p,a);if(!(R.hours>0)||!(a.totalFt>0))continue;
    const brace=(a.lab?.byBrace||[]).reduce((s,y)=>s+y.cost,0);
    for(const T of Object.values(a.types)){if(!(T.L>0))continue;const sh=T.L/a.totalFt,e=h[T.t.id]=h[T.t.id]||{ft:0,hrs:0,cost:0,brace:0,jobs:0};
      e.ft+=T.L;e.hrs+=R.hours*sh;e.cost+=R.hours*sh*R.rate;e.brace+=brace*sh;e.jobs++}}
  return h;
}
function laborAdvice(typeId){
  const e=laborHistory()[typeId];if(!e||e.ft<1)return null;
  const m=Math.min(90,Math.max(0,+(S.settings.laborMargin??35)))/100,costFt=e.cost/e.ft,braceFt=e.brace/e.ft;
  return {...e,m,costFt,braceFt,hrs100:e.hrs/e.ft*100,rec:Math.round(Math.max(0,costFt/(1-m)-braceFt)*100)/100};
}
function adviceHtml(t){
  const v=laborAdvice(t.id);
  if(!v)return `<p class="small mut advice">When a job with this fence is done, fill in <b>How the job really went</b> on its job page, and a labor price is suggested here from it.</p>`;
  if(!(v.cost>0))return `<p class="small mut advice">Add each person's pay in <button class="lnk" data-act="goCrew">Settings → Crew</button> to get a suggested labor price from your finished jobs.</p>`;
  return `<div class="advice"><div><b>Suggested labor: ${money(v.rec)} a foot</b>${Math.abs(v.rec-(+t.labor||0))>=0.01?` <button class="btn sm pri" data-act="useLaborRec" data-id="${t.id}" data-k="${v.rec}">Use ${money(v.rec)}</button>`:' <span class="tag">You are using it</span>'}</div>
    <div class="small mut">From ${v.jobs} finished job${v.jobs>1?'s':''} (${fmtFt(v.ft)}): ${v.hrs100.toFixed(1)} crew hours per 100 ft, which costs you ${money(v.costFt)} a foot${v.braceFt>0.005?`, less ${money(v.braceFt)} a foot you already charge for braces`:''}, with ${Math.round(v.m*100)}% profit on labor.</div></div>`;
}
function actualCard(p,a){
  const R=actualOf(p,a),x=R.x,d=`data-id="${p.id}"`,st=p.stage||'bid',L=a.lab||{},ft=a.totalFt;
  const inp=(k,label,ph,step='1')=>`<div><label class="f" for="ja_${k}">${label}</label><input id="ja_${k}" type="number" min="0" step="${step}" value="${x[k]??''}" placeholder="${esc(ph)}" data-f="jact.${k}" ${d}></div>`;
  const matEst=a.sub+a.tax,labCh=(L.cost||0)+(L.matHead||0),feeCh=L.feeTotal||0;
  const left=(est,act)=>{if(act==null)return '<td></td>';const v=est-act;return `<td class="num ${v>=0?'good':'bad'}">${v<0?'−':''}${money(Math.abs(v))}</td>`};
  const tr=(name,help,est,act,none)=>`<tr><td><b>${name}</b><div class="small mut">${help}</div></td><td class="num">${money(est)}</td><td class="num">${act==null?`<span class="mut">${none}</span>`:money(act)}</td>${left(est,act)}</tr>`;
  const cost=(R.mat??matEst)+(R.wages??0)+R.other,profit=a.total-cost,pct=a.total>0?profit/a.total*100:0,done=R.wages!=null;
  const used=a.rows.map(r=>{const v=x.qty?.[r.m.id],df=v==null?null:v-r.q;
    return `<tr><td>${esc(r.m.name)}</td><td class="num">${fmtQ(r.q)} <span class="small mut">${esc(r.m.unit||'')}</span></td><td class="num"><input type="number" min="0" step="any" value="${v??''}" placeholder="${fmtQ(r.q)}" data-f="jactq.q" data-id="${r.m.id}" data-job="${p.id}" style="width:90px" aria-label="Really used: ${esc(r.m.name)}"></td><td class="num ${df==null?'':df>0?'bad':'good'}">${df==null?'':(df>0?'+':'')+fmtQ(Math.round(df*10)/10)}</td></tr>`}).join('');
  const perFt=v=>ft>0?money(v/ft)+' a foot':'—';
  const adv=Object.values(a.types).filter(T=>T.L>0).map(T=>{const v=laborAdvice(T.t.id);if(!v||!(v.cost>0))return '';
    return `<li><b>${esc(T.t.name)}:</b> charge about <b>${money(v.rec)} a foot</b> for labor <span class="small mut">(you charge ${money(+T.t.labor||0)} now, from ${v.jobs} finished job${v.jobs>1?'s':''})</span> <button class="btn sm" data-act="editFt" data-id="${T.t.id}">Open ${esc(T.t.name)}</button></li>`}).join('');
  const open=openKeep.actual??(R.any||st==='prog'||st==='done');
  return `<details class="card wide actual" data-keep="actual"${open?' open':''}><summary><h2>How the job really went</h2><span class="small mut">${done?`Profit ${money(profit)} (${pct.toFixed(0)}%)`:'Fill this in when the job is done: what it really cost and how long it took'}</span></summary>
    <p class="small mut" style="margin-top:0">Fill in what really happened. Fence Builder compares it with the estimate, shows your profit, and works out what to charge for labor next time.</p>
    <h3>Time on the job</h3>
    <div class="g4">${inp('days','Days on the job','0','0.5')}${inp('people','People on the crew',String(R.people||1))}${inp('hpd','Hours a day',String(+S.settings.dayHrs||8),'0.5')}${inp('hours','Or total crew hours',R.days?String(Math.round(R.days*R.people*R.hpd*10)/10):'','0.5')}</div>
    <p class="small mut">${R.hours?`<b>${fmtQ(Math.round(R.hours*10)/10)} crew hours</b>${ft?`, ${(R.hours/ft*100).toFixed(1)} hours per 100 ft`:''}. `:''}${R.rate?`The crew costs you <b>${money(R.rate)} an hour</b> ${+x.rate>0?'(set for this job)':`(average pay ${money(R.pay)}, plus ${+S.settings.burden||0}% taxes and insurance, from <button class="lnk" data-act="goCrew">Settings → Crew</button>)`}.`:`Add each person's pay in <button class="lnk" data-act="goCrew">Settings → Crew</button> to work out what the crew cost.`}</p>
    <h3>Money spent</h3>
    <div class="g3">${inp('mat','Materials really cost $, with tax',(R.usedQ?R.matQ:matEst).toFixed(2),'0.01')}${inp('other','Other costs $: fuel, rentals, dump fees','0','0.01')}${inp('rate','Crew cost an hour $, only if different',R.rate?R.rate.toFixed(2):'','0.01')}</div>
    <details class="sub" data-keep="actualQty"${openKeep.actualQty?' open':''}><summary><b>What you really used</b> <span class="small mut">optional: type a number where it was different from the estimate</span></summary>
      ${used?`<div class="box scroll"><table class="bill"><thead><tr><th>Material</th><th class="num">Estimate</th><th class="num">Really used</th><th class="num">Difference</th></tr></thead><tbody>${used}</tbody></table></div>`:'<p class="mut">No materials on this job.</p>'}
      ${R.usedQ&&x.mat==null?`<p class="small mut">Materials cost worked out from what you used: ${money(R.matQ)}.</p>`:''}</details>
    <h3>Estimate and actual</h3>
    <div class="box scroll"><table class="bill"><thead><tr><th></th><th class="num">Estimate, on the bill</th><th class="num">Actual</th><th class="num">Left over</th></tr></thead><tbody>
      ${tr('Materials','What you charged for materials, and what they really cost',matEst,R.mat,'same as the estimate')}
      ${tr('Labor','What you charged for labor, and what the crew cost you',labCh,R.wages,'fill in the time')}
      ${feeCh||R.other?tr('Fees and other costs','Fees on the bill, and other costs you had',feeCh,R.other||0,''):''}
    </tbody>${done?`<tfoot><tr class="tot"><td>Whole job</td><td class="num">${money(a.total)}</td><td class="num">${money(cost)}</td><td class="num ${profit>=0?'good':'bad'}">${profit<0?'−':''}${money(Math.abs(profit))}</td></tr></tfoot>`:''}</table></div>
    ${done?`<div class="money actmoney"><div><span>Profit</span><b class="${profit>=0?'good':'bad'}">${profit<0?'−':''}${money(Math.abs(profit))}</b></div><div><span>Profit margin</span><b>${pct.toFixed(0)}%</b></div><div><span>Labor cost you</span><b>${perFt(R.wages)}</b></div><div><span>You charged for labor</span><b>${perFt(labCh)}</b></div></div>`:''}
    ${adv?`<h3>Labor price for next time</h3><p class="small mut" style="margin:0 0 6px">From your finished jobs, to make ${Math.round(+(S.settings.laborMargin??35))}% profit on labor (set in Settings → Crew):</p><ul class="advlist">${adv}</ul>`:''}
  </details>`;
}

