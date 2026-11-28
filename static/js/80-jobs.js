/* ---------- jobs ---------- */
const STAGES=[['bid','Bid'],['sched','Scheduled'],['prog','In progress'],['done','Done']];
const STAGE_HELP={bid:'Measured and priced, waiting on the customer',sched:'The customer said yes, it has a start date',prog:'The crew is building it',done:'Built and finished'};
const stageName=k=>(STAGES.find(s=>s[0]===k)||STAGES[0])[1];
let jobOpen=null,jobQ='',jobStage='all';   // the job page that's open, the search, the stage filter (this window only)
const jobView=()=>{try{return localStorage.getItem('fence-jobview')||'cards'}catch(e){return 'cards'}};
const dayOf=s=>s?new Date(s+'T12:00'):null;
const fmtDay=s=>{const d=dayOf(s);return d&&!isNaN(d)?d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}):''};
const todayISO=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const overdue=p=>p.due&&p.due<todayISO()&&(p.stage||'bid')!=='done';
function logJob(p,text){p.log=[...(p.log||[]),{at:new Date().toISOString(),text}]}
function setStage(p,k){if((p.stage||'bid')===k)return;p.stage=k;logJob(p,'Moved to '+stageName(k))}
const jobAnalysis=p=>p.id===S.cur?A:analyze(p);
const jobSearch=p=>[p.name,p.customer,p.phone,p.email,p.address,p.notes].filter(Boolean).join(' ').toLowerCase();
// the one line under a job's name that says when
function whenLine(p){
  const st=p.stage||'bid';
  if(overdue(p))return `<span class="warn">Past due: ${esc(fmtDay(p.due))}</span>`;
  if(st==='sched'&&p.start)return 'Starts '+esc(fmtDay(p.start));
  if(st==='prog'&&p.due)return 'Finish by '+esc(fmtDay(p.due));
  if(st==='done'&&p.due)return 'Finished '+esc(fmtDay(p.due));
  if(st==='bid'&&p.bidDate)return 'Bid sent '+esc(fmtDay(p.bidDate));
  return p.due?'Finish by '+esc(fmtDay(p.due)):'';
}
function jobsView(){
  if(jobOpen){const p=S.projects.find(x=>x.id===jobOpen);if(p)return jobPage(p);jobOpen=null}
  const jobs=S.projects.map(p=>({p,a:jobAnalysis(p),st:p.stage||'bid'}));
  const shown=jobs.filter(j=>(jobStage==='all'||j.st===jobStage)&&(!jobQ||jobSearch(j.p).includes(jobQ.toLowerCase())));
  const chip=(k,name,list)=>`<button class="stagechip${jobStage===k?' on':''}" data-act="jobStage" data-k="${k}"><b>${name}</b><span>${list.length} job${list.length===1?'':'s'}${list.length?' · '+money(list.reduce((a,j)=>a+j.a.total,0)):''}</span></button>`;
  const chips=chip('all','All jobs',jobs)+STAGES.map(([k,n])=>chip(k,n,jobs.filter(j=>j.st===k))).join('');
  const view=jobView();
  const next=st=>{const i=STAGES.findIndex(s=>s[0]===st);return STAGES[i+1]},prev=st=>{const i=STAGES.findIndex(s=>s[0]===st);return i>0?STAGES[i-1]:null};
  const card=({p,a,st})=>{const nx=next(st),pv=prev(st);return `<div class="job${p.id===S.cur?' cur':''}" draggable="true" data-job="${p.id}">
      <button class="jobname" data-act="jobPage" data-id="${p.id}">${esc(p.name)}</button>
      ${p.customer?`<div>${esc(p.customer)}</div>`:''}
      ${p.phone?`<div class="mut">${esc(p.phone)}</div>`:''}
      ${p.address?`<div class="mut">${esc(p.address)}</div>`:''}
      ${whenLine(p)?`<div class="when">${whenLine(p)}</div>`:''}
      <div class="jobnums"><span>${fmtFt(a.totalFt)}</span><b>${money(a.total)}</b></div>
      <div class="jobbtns"><button class="btn pri" data-act="jobPage" data-id="${p.id}">Open job</button>${nx?`<button class="btn" data-act="jobNext" data-id="${p.id}" title="${esc(STAGE_HELP[nx[0]])}">Move to ${nx[1]} →</button>`:''}${pv?`<button class="btn back" data-act="jobPrev" data-id="${p.id}" title="Move it back to ${esc(pv[1])}">← Back to ${pv[1]}</button>`:''}</div></div>`};
  let body;
  // a new job starts as a bid: a big "New job" card at the top of the Bid column
  const addCard=`<button class="newjob" data-act="newJob"><span class="plus" aria-hidden="true">+</span><b>New job</b><span>Start a bid</span></button>`;
  if(!jobs.length)body=`<div class="jobgrid">${addCard}</div>`;
  else if(!shown.length)body=`<div class="note">No jobs match${jobQ?` "${esc(jobQ)}"`:''}${jobStage!=='all'?' in '+stageName(jobStage):''}. <button class="lnk" data-act="jobClear">Show all jobs</button></div>`;
  else if(view==='list')body=`${addCard.replace('class="newjob"','class="newjob wide"')}<div class="box"><table class="joblist"><thead><tr><th>Job</th><th>Customer</th><th>Phone</th><th>Stage</th><th>When</th><th class="num">Fence</th><th class="num">Total</th><th></th></tr></thead><tbody>${shown.map(({p,a,st})=>`<tr data-job="${p.id}"><td><button class="jobname" data-act="jobPage" data-id="${p.id}">${esc(p.name)}</button></td><td>${esc(p.customer||'')}</td><td>${esc(p.phone||'')}</td><td><span class="stagepill s-${st}">${stageName(st)}</span></td><td>${whenLine(p)}</td><td class="num">${fmtFt(a.totalFt)}</td><td class="num"><b>${money(a.total)}</b></td><td><button class="btn pri" data-act="jobPage" data-id="${p.id}">Open job</button></td></tr>`).join('')}</tbody></table></div>`;
  else if(jobStage!=='all')body=`<div class="jobgrid">${jobStage==='bid'?addCard:''}${shown.map(card).join('')}</div>`;
  else body=`<div class="board">${STAGES.map(([k,name])=>{const mine=shown.filter(j=>j.st===k);return `<div class="col" data-stage="${k}"><h3><span>${name}</span><span class="mut">${mine.length}</span></h3><p class="small mut colhelp">${STAGE_HELP[k]}</p>${k==='bid'?addCard:''}${mine.map(card).join('')||(k==='bid'?'':'<p class="mut" style="margin:6px 4px">None</p>')}</div>`}).join('')}</div>`;
  return `<div class="phead"><div><h1>Jobs</h1><p>Click a job to see everything about it. Move a job along with its button, or drag its card to another column.</p></div></div>
  <div class="jobtools"><input type="search" id="jobQ" value="${esc(jobQ)}" placeholder="Find a job: name, customer, phone or address" aria-label="Find a job">
    <div class="seg" role="group" aria-label="Show jobs as"><button class="btn${view==='cards'?' on':''}" data-act="jobView" data-k="cards">Cards</button><button class="btn${view==='list'?' on':''}" data-act="jobView" data-k="list">List</button></div></div>
  <div class="stagechips">${chips}</div>
  ${body}`;
}
// everything about one job on one page
function jobPage(p){
  const a=jobAnalysis(p),st=p.stage||'bid',d=`data-id="${p.id}"`;
  const field=(k,label,type='text',extra='')=>`<div><label class="f" for="jf_${k}">${label}</label><input id="jf_${k}" type="${type}" value="${esc(p[k]??'')}" data-f="job.${k}" ${d} ${extra}></div>`;
  const stepper=STAGES.map(([k,n],i)=>{const at=STAGES.findIndex(s=>s[0]===st);return `<button class="step${k===st?' on':''}${i<at?' past':''}" data-act="jobSetStage" data-k="${k}" ${d}><b>${i+1}. ${n}</b><span>${STAGE_HELP[k]}</span></button>`}).join('');
  const crew=S.settings.crew||[],mine=Array.isArray(p.crew)?p.crew:crew.map(c=>c.id);
  const paid=+p.paid||0,bal=a.total-paid;
  const where=p.address?encodeURIComponent(p.address):(()=>{const pt=p.lines.find(l=>l.pts?.length)?.pts[0];return pt?`${pt.lat},${pt.lng}`:''})();
  const lines=a.lines.map(r=>`<tr><td>${esc(r.l.name)}</td><td><span class="dot" style="background:${esc(r.t?.color||'#fff')}"></span> ${esc(r.t?.name||'')}</td><td class="num">${fmtFt(r.len)}</td></tr>`).join('');
  const log=[...(p.log||[])].reverse().map(x=>`<li><span class="mut">${esc(new Date(x.at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))}</span> ${esc(x.text)}</li>`).join('');
  return `<div class="jobtop noprint"><button class="btn big" data-act="jobBack">← All jobs</button></div>
  <div class="phead"><div><h1>${esc(p.name)} <span class="stagepill s-${st}">${stageName(st)}</span></h1><p>${esc([p.customer,p.address].filter(Boolean).join(' · ')||'Add the customer below.')}</p></div>
    <div class="row noprint"><button class="btn pri big" data-act="openJob" ${d}>Fence map</button><button class="btn big" data-act="jobBill" ${d}>Final bill</button><button class="btn big" data-act="jobQuote" ${d}>Customer quote</button><button class="btn big" data-act="print">Print</button></div></div>
  <div class="stepper noprint" role="group" aria-label="Stage">${stepper}</div>
  <div class="jobcols">
    <div class="card"><h2>Customer</h2>
      ${field('name','Job name')}
      <div class="g2">${field('customer','Customer name')}${field('phone','Phone','tel')}</div>
      ${field('email','Email','email')}
      ${field('address','Address or location')}
      ${field('access','Gate code, directions or how to get in')}
      <div class="row noprint" style="margin-top:10px">${p.phone?`<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g,''))}">Call ${esc(p.phone)}</a>`:''}${p.email?`<a class="btn" href="mailto:${esc(p.email)}">Email</a>`:''}${where?`<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${where}" target="_blank" rel="noopener">Directions</a>`:''}</div>
    </div>
    <div class="card"><h2>Schedule</h2>
      <div class="g2">${field('bidDate','Bid sent','date')}${field('start','Start date','date')}</div>
      <div class="g2">${field('due','Finish by','date')}<div></div></div>
      ${overdue(p)?`<p class="warn">This job is past its finish date.</p>`:''}
      ${crew.length?`<label class="f">Crew on this job</label><div class="crewpick">${crew.map(c=>`<label class="row"><input type="checkbox" ${mine.includes(c.id)?'checked':''} data-f="jcrew.on" data-id="${c.id}" data-job="${p.id}"> ${esc(c.name||'Crew member')}</label>`).join('')}</div>`:`<p class="mut">No crew set up yet. <button class="lnk" data-act="goCrew">Add your crew</button></p>`}
    </div>
    <div class="card"><h2>Money</h2>
      <div class="money"><div><span>Job total</span><b>${money(a.total)}</b></div><div><span>Paid so far</span><b>${money(paid)}</b></div><div class="tot"><span>Still owed</span><b>${money(bal)}</b></div></div>
      <div class="g2">${field('paid','Paid so far $','number','min="0" step="0.01"')}<div></div></div>
      <p class="small mut">Materials ${money(a.sub+a.tax)} with tax · labor ${money(a.lab?.cost||0)}${a.lab?.feeTotal?` · fees ${money(a.lab.feeTotal)}`:''}${p.est?`<br>Estimate saved ${esc(new Date(p.est.at).toLocaleDateString())}: ${money(p.est.total)}${Math.abs(p.est.total-a.total)>0.5?' (the job has changed since)':''}`:''}</p>
    </div>
    <div class="card"><h2>The fence</h2>
      ${lines?`<table class="mini2"><tbody>${lines}</tbody><tfoot><tr><td colspan="2">Total</td><td class="num"><b>${fmtFt(a.totalFt)}</b></td></tr></tfoot></table>`:'<p class="mut">No fence drawn yet. Press <b>Fence map</b> to draw it.</p>'}
    </div>
    ${actualCard(p,a)}
    <div class="card wide"><h2>Notes</h2><textarea rows="5" data-f="job.notes" ${d} aria-label="Notes" placeholder="Anything to remember about this job">${esc(p.notes||'')}</textarea></div>
    <div class="card wide"><h2>History</h2>
      <div class="row noprint"><input type="text" id="jobLogT" placeholder="Add to the history, like &quot;Called, left a message&quot;" style="flex:1"><button class="btn" data-act="jobLog" ${d}>Add</button></div>
      ${log?`<ul class="joblog">${log}</ul>`:'<p class="small mut">Stage changes and your notes show here with their dates.</p>'}
    </div>
  </div>
  <div class="row noprint" style="justify-content:space-between;margin-top:18px"><button class="btn" data-act="jobCopy" ${d}>Copy this job</button><button class="btn del" data-act="jobDel" ${d}>Delete this job</button></div>`;
}
function openJobDlg(id){jobOpen=id;gotoTab('jobs')}
// drag a job card to another column
{
  const pn=$('#panel');let dragId=null;
  pn.addEventListener('dragstart',e=>{const c=e.target.closest?.('.job');if(!c)return;dragId=c.dataset.job;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId)});
  pn.addEventListener('dragover',e=>{const c=e.target.closest?.('.col');if(!c||!dragId)return;e.preventDefault();pn.querySelectorAll('.col.over').forEach(x=>x!==c&&x.classList.remove('over'));c.classList.add('over')});
  pn.addEventListener('dragend',()=>{dragId=null;pn.querySelectorAll('.col.over').forEach(x=>x.classList.remove('over'))});
  pn.addEventListener('drop',e=>{const c=e.target.closest?.('.col');if(!c||!dragId)return;e.preventDefault();const p=S.projects.find(x=>x.id===dragId);dragId=null;if(p&&(p.stage||'bid')!==c.dataset.stage){setStage(p,c.dataset.stage);changed()}else renderPanel()});
}

