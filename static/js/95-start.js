/* ---------- materials and cost for the open job, from the builder ---------- */
function copyBill(){
  const lines=[P().name+' fence estimate',fmtFt(A.totalFt)+' of fence',''];
  for(const r of A.rows)lines.push(`${fmtQ(r.q)} ${r.m.unit}  ${r.m.name}  @ ${money(r.price)}${r.custom?' (custom price)':''} = ${money(r.cost)}${r.m.url?'  '+r.m.url:''}`);
  lines.push('','Materials '+money(A.sub),'Tax '+money(A.tax));if(A.lab.cost)lines.push('Labor '+money(A.lab.cost));if(A.lab.matHead)lines.push('Headache charges '+money(A.lab.matHead));for(const f of A.lab.fees)lines.push((f.name||'Fee')+' '+money(+f.amount));lines.push('Total '+money(A.total));
  navigator.clipboard.writeText(lines.join('\n')).then(()=>toast('Materials list copied'),()=>toast('Copy was blocked by the browser'));
}
$('#importFile').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const j=JSON.parse(await f.text());if(!j.materials||!j.projects)throw 0;S=j;S.fenceTypes=(S.fenceTypes||[]).map(t=>migrateType(t,S.settings||{}));selLine=null;selNode=null;changed();fitProject();toast('Backup loaded')}catch(err){toast('That file is not a Fence Builder backup')}
  e.target.value='';
};
$('#proj').onchange=e=>{if(!e.target.value)return;if(e.target.value==='__newjob'){e.target.value=S.cur||'';$('#newProj').click();return}S.cur=e.target.value;selLine=null;selNode=null;cancelDraw();changed();fitProject()};
$('#newProj').onclick=async()=>{const n=await askText('Name for the new job','Job '+(S.projects.length+1));if(n===null)return;const p={id:uid('p'),name:n.trim()||'New job',stage:'bid',lines:[]};logJob(p,'Job started');S.projects.push(p);S.cur=p.id;selLine=null;selNode=null;if(mode!=='idle')cancelDraw();map.closePopup();S.tab='build';changed();toast('New job "'+p.name+'". Set up the fence, then draw it.')};
function fitProject(){const pts=P().lines.flatMap(l=>l.pts);if(pts.length)map.fitBounds(L.latLngBounds(pts.map(ll)),{padding:[40,40],maxZoom:19})}
function changed(){keepBlankJob();save();renderAll();record();scheduleElev()}

/* ---------- start ---------- */
// take loaded data and fill in anything an older save is missing
function adopt(s){
  S=s;const d=defaults();
  S.settings={...d.settings,...S.settings};S.braces=S.braces||d.braces;S.fenceTypes=S.fenceTypes||d.fenceTypes;S.projects=Array.isArray(S.projects)?S.projects:d.projects;   // no jobs at all is fine
  if(!S.projects.find(p=>p.id===S.cur))S.cur=S.projects[0]?.id||null;
  for(const p of S.projects){p.stage=p.stage||'bid';for(const l of p.lines)if(!Array.isArray(l.pts))l.pts=[]}
  if(!S.fenceTypes.some(t=>t.id===S.drawType))S.drawType=S.fenceTypes[0]?.id;
  if(S.fenceTypes.some(t=>!Array.isArray(t.wires))){S.fenceTypes=S.fenceTypes.map(t=>migrateType(t,S.settings));S.settings.labor=0;save()}
  else S.fenceTypes=S.fenceTypes.map(t=>migrateType(t,S.settings));
  if(S.tab==='builds')S.tab='types';
  // fence types use the automatic stretch limit where it agrees with the number they already had; a number you set yourself is kept
  // materials set to the old "Brace parts" kind move to Posts or Hardware
  for(const m of S.materials||[])if(m.kind==='part')m.kind=isPostName(m.name)?'post':'hw';
  if((S.pullAuto||0)<2){for(const t of S.fenceTypes){const own=+t.pullEvery||0;t.pullBy=own>0&&autoPull(t)!==own?'ft':'auto'}S.pullAuto=2}
  for(const t of S.fenceTypes)for(const w of t.wires||[]){const m=matOf(w.m);if(m&&m.roll==null&&w.roll!=null)m.roll=+w.roll||0}
}
load().then(s=>{
  adopt(s);
  setStatus(serverOK?'Saved':'Saving in this browser');
  accountBar();if(ME.note)setTimeout(()=>toast(ME.note),1200);
  renderAll();record();fitProject();scheduleElev();checkLatest();
  takeGrab();setTimeout(()=>autoPrices(false),5000);loadOffAreas();
  setTimeout(()=>checkUpdate(false),2500);setInterval(()=>checkUpdate(false),6*3600e3);setInterval(()=>autoPrices(false),3600e3);
});
