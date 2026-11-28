/* ---------- state + saving ---------- */
let S, serverOK=false, selLine=null, selNode=null, mode='idle', draft=null;
const busy={}, errs={};
// Every save carries the version this window loaded. The server refuses a save made on top of an
// older version, so two open windows can't wipe out each other's work; the stale one loads the latest.
let baseRev=0,saving=false,saveAgain=false,baseJSON=null;
async function load(){
  try{const r=await fetch('api/data',{cache:'no-store'});if(r.ok){serverOK=true;const j=await r.json();baseRev=+j?.rev||0;if(j&&j.materials){baseJSON=JSON.stringify(j);return j}}}catch(e){}
  try{const j=JSON.parse(localStorage.getItem('fence-est'));if(j&&j.materials)return j}catch(e){}
  // nothing saved yet: start from the setup that ships with the app (your fence types, braces and materials)
  try{const r=await fetch('seed.json',{cache:'no-store'});if(r.ok){const j=await r.json();if(j&&Array.isArray(j.materials)&&j.materials.length)return {...defaults(),...j}}}catch(e){}
  return defaults();
}
let saveT,elevOnly=false;
// save(true) is for heights that just loaded: if another copy of the app saved first, nothing of yours is
// lost (the heights load again), so that clash is taken quietly instead of warning about a lost change
function save(auto){elevOnly=auto===true&&(elevOnly||!saveT);clearTimeout(saveT);setStatus('Saving…');saveT=setTimeout(()=>{saveT=null;pushSave()},700)}
async function pushSave(){
  if(saving){saveAgain=true;return}
  saving=true;const body=JSON.stringify(S),quiet=elevOnly;elevOnly=false;
  try{localStorage.setItem('fence-est',body)}catch(e){}
  if(!serverOK){setStatus('Saved on this device');saving=false;return}
  try{
    const r=await fetch('api/data',{method:'PUT',headers:{'Content-Type':'application/json','X-Base-Rev':String(baseRev)},body});
    if(r.status===409){saving=false;saveAgain=false;return mergeLatest(quiet)}
    if(!r.ok)throw 0;
    baseRev=+(await r.json()).rev||baseRev;baseJSON=body;setStatus('Saved');
  }catch(e){setStatus('Saved on this device only, server not reachable')}
  saving=false;if(saveAgain){saveAgain=false;pushSave()}
}
function flush(){
  if(!saveT||!S)return;clearTimeout(saveT);saveT=null;const body=JSON.stringify(S);
  try{localStorage.setItem('fence-est',body)}catch(e){}
  if(serverOK)try{fetch('api/data',{method:'PUT',headers:{'Content-Type':'application/json','X-Base-Rev':String(baseRev)},body,keepalive:body.length<60000}).then(r=>r.ok?r.json():null).then(j=>{if(j?.rev){baseRev=+j.rev;baseJSON=body}}).catch(()=>{})}catch(e){}
}
addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)flush()});
// ---------- two copies saving at once: keep both sets of changes ----------
// baseJSON is what this window last had in common with the server. When the server has moved on, each thing
// (material, fence type, brace, job, line, setting...) is taken from whichever side changed it; if both did, yours.
const sameJ=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const isIdList=v=>Array.isArray(v)&&v.length>0&&v.every(x=>x&&typeof x==='object'&&typeof x.id==='string');
function merge3(b,l,t){
  if(sameJ(b,l))return t;          // not changed here: theirs
  if(sameJ(b,t))return l;          // not changed there: yours
  if((isIdList(l)||isIdList(t))&&(Array.isArray(l)&&Array.isArray(t))){
    const B=new Map((Array.isArray(b)?b:[]).map(x=>[x.id,x])),Lm=new Map(l.map(x=>[x.id,x])),out=[];
    for(const x of t){
      if(Lm.has(x.id))out.push(merge3(B.get(x.id),Lm.get(x.id),x));
      else if(!B.has(x.id)||!sameJ(B.get(x.id),x))out.push(x);   // new there, or you deleted it but they changed it: keep theirs
    }
    const tIds=new Set(t.map(x=>x.id));
    l.forEach((x,i)=>{if(tIds.has(x.id))return;if(B.has(x.id)&&sameJ(B.get(x.id),x))return;   // they deleted it and you didn't touch it
      out.splice(Math.min(i,out.length),0,x)});                                                    // new here (or changed here): keep yours
    return out;
  }
  if(l&&t&&typeof l==='object'&&typeof t==='object'&&!Array.isArray(l)&&!Array.isArray(t)){
    const bo=b&&typeof b==='object'?b:{},out={};
    for(const k of new Set([...Object.keys(t),...Object.keys(l)])){
      if(!(k in l)&&k in bo&&sameJ(bo[k],t[k]))continue;   // removed here
      if(!(k in t)&&k in bo&&sameJ(bo[k],l[k]))continue;   // removed there
      out[k]=k in l?(k in t?merge3(bo[k],l[k],t[k]):l[k]):t[k];
    }
    return out;
  }
  return l;                        // both changed the same value: yours
}
async function mergeLatest(quiet){
  if(!baseJSON)return takeLatest(!quiet);
  try{
    const r=await fetch('api/data',{cache:'no-store'});if(!r.ok)return;const t=await r.json();if(!t||!t.materials)return;
    const theirs=JSON.stringify(t),b=JSON.parse(baseJSON),l=JSON.parse(JSON.stringify(S));
    const m=merge3(b,l,t);
    for(const k of ['tab','cur','drawType'])if(k in l)m[k]=l[k];   // this window stays where it is
    const dlgOpen=$('#matDlg').open;
    adopt(m);baseRev=+t.rev||0;baseJSON=theirs;
    if(selLine&&!getLine(selLine))selLine=null;if(selNode&&!getLine(selNode.l))selNode=null;
    if(!dlgOpen)renderAll();scheduleElev();
    if(!quiet)toast('Another window saved at the same time. Both sets of changes were kept.');
    save(quiet);   // send the combined version
  }catch(e){takeLatest(!quiet)}
}
// load what another window saved, keeping this window on the same page and job
// a dialog open (new material, job details, a question) means you're in the middle of something
const busyEditing=()=>!!document.querySelector('dialog[open]');
async function takeLatest(lost){
  try{
    const r=await fetch('api/data',{cache:'no-store'});if(!r.ok)return;const j=await r.json();if(!j||!j.materials)return;
    const keep={tab:S.tab,cur:S.cur,drawType:S.drawType};
    clearTimeout(saveT);saveT=null;
    if(mode!=='idle')cancelDraw();map.closePopup();if($('#jobDlg').open)$('#jobDlg').close();if($('#matDlg').open)$('#matDlg').close();
    baseJSON=JSON.stringify(j);adopt(j);baseRev=+j.rev||0;
    S.tab=keep.tab;if(S.projects.some(p=>p.id===keep.cur))S.cur=keep.cur;if(S.fenceTypes.some(t=>t.id===keep.drawType))S.drawType=keep.drawType;
    selNode=null;if(selLine&&!getLine(selLine))selLine=null;
    hist.u=[];hist.r=[];snapNow=null;snapCur=null;
    renderAll();record();scheduleElev();setStatus('Saved');
    toast(lost?'This was changed in another window, so the latest was loaded. Your last change in this window was not saved.':'Loaded the changes made in another window.');
  }catch(e){}
}
// ---------- updates: a new release on GitHub shows a bar to install it ----------
let upd=null;
async function checkUpdate(force){
  if(!serverOK)return;
  try{const r=await fetch('api/version'+(force?'?force=1':''),{cache:'no-store'});upd=await r.json()}catch(e){return}
  const bar=$('#updbar');
  if(upd.available&&sessionStorage.getItem('fence-later')!==upd.latest){
    bar.innerHTML=`<span>Fence Builder ${esc(upd.latest)} is out. You have ${esc(upd.version)}.</span><a href="${esc(upd.url)}" target="_blank" rel="noopener">What's new</a><button class="btn sm" id="updGo">Update now</button><button class="btn sm" id="updLater">Later</button>`;
    bar.hidden=false;
    $('#updLater').onclick=()=>{sessionStorage.setItem('fence-later',upd.latest);bar.hidden=true};
    $('#updGo').onclick=installUpdate;
  }else bar.hidden=true;
  if(S?.tab==='settings')renderPanel();
}
async function installUpdate(){
  const bar=$('#updbar');
  if(!await ask(`Update Fence Builder to ${upd.latest}? Your jobs, prices and settings are kept. The app restarts when it is done.`))return;
  flush();bar.innerHTML='<span>Downloading and installing the update…</span>';
  try{
    const r=await fetch('api/update',{method:'POST'});const j=await r.json();if(!r.ok)throw Error(j.error||'The update did not install');
    bar.innerHTML=j.mode==='installer'?`<span>Installing ${esc(j.version)}. Fence Builder will be back in a minute…</span>`:`<span>Updated to ${esc(j.version)}. Restarting…</span>`;
    // wait for the server to come back, then load the new version (the installer takes longer)
    for(let i=0;i<(j.mode==='installer'?240:60);i++){await new Promise(res=>setTimeout(res,1000));try{const v=await (await fetch('api/version',{cache:'no-store'})).json();if(v.version===j.version)return location.reload()}catch(e){}}
    location.reload();
  }catch(e){bar.innerHTML=`<span>${esc(e.message||String(e))}</span><button class="btn sm" onclick="this.parentNode.hidden=true">OK</button>`}
}
let appVer=null;
async function checkLatest(){
  if(!serverOK||!S||document.hidden)return;
  try{
    const r=await fetch('api/rev',{cache:'no-store'});if(!r.ok)return;const j=await r.json();
    // the app itself was updated since this window loaded it: say so, with a one-click refresh
    if(j.app){if(appVer==null)appVer=j.app;else if(j.app!==appVer)$('#stale').hidden=false}
    if(saveT||saving||mode!=='idle')return;
    if(+j.rev!==baseRev&&!saveT&&!saving&&!busyEditing())takeLatest(false);   // wait while a dialog or an unsaved edit is open
  }catch(e){}
}
async function refreshNow(){
  if(mode!=='idle')cancelDraw();
  try{if(serverOK&&!saveT&&!saving&&!busyEditing()){const r=await fetch('api/rev',{cache:'no-store'});if(r.ok){const j=await r.json();if(+j.rev!==baseRev)await takeLatest(false)}}}catch(e){}
  renderAll();toast('Up to date with your latest prices, materials and fence types.');
}
addEventListener('focus',checkLatest);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkLatest()});
setInterval(checkLatest,4000);
const setStatus=t=>{$('#status').textContent=t};
function ask(msg){return new Promise(res=>{
  const d=$('#askDlg'),verb=(msg.match(/(Delete|Remove)(?![a-z])/)||[])[1];
  d.innerHTML=`<p style="margin:0 0 18px;white-space:pre-line;font-size:16px">${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn big" data-a="0">Cancel</button><button class="btn big ${verb?'del':'pri'}" data-a="1">${verb||'OK'}</button></div>`;
  let done=false;const fin=v=>{if(done)return;done=true;d.close();res(v)};
  d.onclick=e=>{const b=e.target.closest('[data-a]');if(b)fin(b.dataset.a==='1');else if(e.target===d)fin(false)};
  d.oncancel=e=>{e.preventDefault();fin(false)};
  d.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();fin(true)}};
  d.showModal();d.querySelector('[data-a="1"]').focus()})}
// a small form in a window: returns {name: value} from its fields, or null if cancelled.
// A product list's "+ New product…" opens the new material window on top and picks the new one.
function formDlg(title,body,okLabel='Add'){return new Promise(res=>{
  const d=$('#askDlg');
  d.innerHTML=`<h2 style="margin:0 0 10px">${esc(title)}</h2><div class="fdlg">${body}</div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn big" data-a="0">Cancel</button><button class="btn pri big" data-a="1">${esc(okLabel)}</button></div>`;
  let done=false;const vals=()=>{const o={};d.querySelectorAll('[name]').forEach(el=>o[el.name]=el.type==='number'?+el.value||0:el.value);return o};
  const fin=v=>{if(done)return;done=true;d.close();res(v)};
  d.onclick=e=>{const b=e.target.closest('[data-a]');if(b)fin(b.dataset.a==='1'?vals():null)};
  d.oncancel=e=>{e.preventDefault();fin(null)};
  d.onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='SELECT'){e.preventDefault();fin(vals())}};
  d.onchange=async e=>{const el=e.target;if(el.value==='__new'){const nid=await openMatDlg(null,JSON.parse(el.dataset.preset||'{}'));
      if(nid){el.insertAdjacentHTML('beforeend',opt(nid,matName(nid),''));el.value=nid}else el.value=el.dataset.was||'';}
    el.dataset.was=el.value;d.querySelectorAll('[data-when]').forEach(x=>x.hidden=!x.dataset.when.split(' ').includes(d.querySelector('[name="'+x.dataset.whenOf+'"]')?.value))};
  d.showModal();d.querySelectorAll('[data-when]').forEach(x=>x.hidden=!x.dataset.when.split(' ').includes(d.querySelector('[name="'+x.dataset.whenOf+'"]')?.value));
  d.querySelector('select,input')?.focus()})}
// a product list for a window, with what fits first
function prodSelect(name,fits,preset,label){
  const good=S.materials.filter(fits),rest=S.materials.filter(m=>!fits(m));
  return `<label class="f">${esc(label)}</label><select name="${name}" data-preset='${esc(JSON.stringify(preset))}'>${good.length?`<optgroup label="Suggested">${good.map(m=>opt(m.id,m.name,'')).join('')}</optgroup>`:''}${rest.length?`<optgroup label="Everything else">${rest.map(m=>opt(m.id,m.name,'')).join('')}</optgroup>`:''}<option value="__new">+ New product…</option></select>`;
}
const isWire=m=>m.kind==='wire'||rollOf({m:m.id})>0||/wire|woven|barb|mesh/i.test(m.name);
const isPost=m=>m.kind==='post'||/post|stay|dropper/i.test(m.name);
async function addWireDlg(id){
  const v=await formDlg('Add wire',`${prodSelect('m',isWire,{kind:'wire',unit:'roll',roll:330},'Which wire')}
    <label class="f">How many strands (1 for a roll of woven wire)</label><input type="number" name="strands" min="1" step="1" value="1">`,'Add wire');
  if(!v||!v.m||v.m==='__new')return;draftFt(id).wires.push({m:v.m,strands:Math.max(1,Math.round(v.strands||1))});renderPanel();toast('Wire added. Press Save to keep it.');
}
async function addPostDlg(id){
  const t=draftFt(id);
  const v=await formDlg('Add a post',`${prodSelect('m',isPost,{kind:'post'},'Which post')}
    <label class="f">Where it goes</label><select name="by">${opt('between','In between each post (added to the line posts)','between')}${opt('nth','Every so many posts, in place of a line post','between')}${opt('ft','Every so many feet, in place of a line post','between')}</select>
    <div data-when="between" data-when-of="by"><label class="f">How many in each gap</label><input type="number" name="nb" min="1" step="1" value="1"><p class="small mut">With line posts every ${+t.spacing||0} ft, 1 in between puts a post every ${fmtQ((+t.spacing||0)/2)} ft.</p></div>
    <div data-when="nth" data-when-of="by"><label class="f">Every how many posts</label><input type="number" name="nn" min="2" step="1" value="5"></div>
    <div data-when="ft" data-when-of="by"><label class="f">Every how many feet</label><input type="number" name="nf" min="1" step="any" value="100"></div>`,'Add post');
  if(!v||!v.m||v.m==='__new')return;
  (t.posts=t.posts||[]).push({m:v.m,by:v.by,n:v.by==='between'?Math.max(1,Math.round(v.nb||1)):v.by==='nth'?Math.max(2,Math.round(v.nn||5)):Math.max(1,v.nf||100)});renderPanel();toast('Post added. Press Save to keep it.');
}
async function addExtraDlg(id){
  const v=await formDlg('Add something else to buy',`${prodSelect('m',m=>!isWire(m)&&!isPost(m),{},'What is it')}
    <div class="g2"><div><label class="f">How many</label><input type="number" name="q" min="0" step="any" value="1"></div>
    <div><label class="f">For each</label><select name="per">${PER.map(([k,l])=>opt(k,l,'ft')).join('')}</select></div></div>
    <p class="small mut">For example 1 per line post for a clip, or 1 once per job for delivery.</p>`,'Add extra');
  if(!v||!v.m||v.m==='__new')return;draftFt(id).extras.push({m:v.m,q:v.q,per:v.per});renderPanel();toast('Extra added. Press Save to keep it.');
}
function askText(msg,def=''){return new Promise(res=>{
  const d=$('#askDlg');
  d.innerHTML=`<label style="display:block;margin:0 0 10px;white-space:pre-line;font-size:16px;font-weight:600">${esc(msg)}</label><input type="text" value="${esc(def)}" style="font-size:16px;min-height:44px"><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn big" data-a="0">Cancel</button><button class="btn pri big" data-a="1">OK</button></div>`;
  const inp=d.querySelector('input');let done=false;const fin=v=>{if(done)return;done=true;d.close();res(v)};
  d.onclick=e=>{const b=e.target.closest('[data-a]');if(b)fin(b.dataset.a==='1'?inp.value:null);else if(e.target===d)fin(null)};
  d.oncancel=e=>{e.preventDefault();fin(null)};
  d.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();fin(inp.value)}};
  d.showModal();inp.focus();inp.select()})}
let toastT;function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),3200)}
// the job you're working on. With every job deleted it's a blank one that isn't saved until you draw on it
let blankJob=null;
const P=()=>S.projects.find(p=>p.id===S.cur)||S.projects[0]||(blankJob??={id:uid('p'),name:'New job',stage:'bid',lines:[],log:[]});
function keepBlankJob(){if(!blankJob||S.projects.length)return blankJob=null;if(!blankJob.lines.length)return;
  logJob(blankJob,'Job started');S.projects.push(blankJob);S.cur=blankJob.id;blankJob=null}
const getLine=id=>P().lines.find(l=>l.id===id);
const matName=id=>(S.materials.find(m=>m.id===id)||{}).name||'(missing material)';

