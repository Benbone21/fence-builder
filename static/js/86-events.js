/* ---------- panel events ---------- */
for(const el of [$('#panel'),$('#side')])el.addEventListener('change',e=>{const t=e.target;if(t.dataset.f)setField(t)});
async function setField(t){
  const [sc,k]=t.dataset.f.split('.'),id=t.dataset.id,i=+t.dataset.i;
  let v=t.type==='checkbox'?t.checked:t.type==='number'?(t.value===''?0:+t.value):t.value;
  if(v==='__new'){
    // a new product: fill in its details and Save, and it is picked here
    const nid=await openMatDlg(null,{kind:sc==='ftw'?'wire':sc==='fto'||k==='postM'?'post':sc==='kiti'?undefined:k==='gateM'?'gate':undefined,unit:sc==='ftw'?'roll':'each',roll:sc==='ftw'?330:undefined});
    if(!nid){renderPanel();return}
    v=nid;
  }
  const ft=()=>draftFt(id),kit=()=>draftKit(id);
  if(sc==='mat'){const m=S.materials.find(x=>x.id===id);m[k]=v;if(k==='price')m.updated=new Date().toISOString()}
  else if(sc==='ft')ft()[k]=v;
  else if(sc==='fti')ft().items[i][k]=v;
  else if(sc==='ftw')ft().wires[i][k]=v;
  else if(sc==='ftwsp'){const w=ft().wires[i];if(t.value==='')delete w[k];else w[k]=Math.max(0,+t.value||0)}
  else if(sc==='ftwalt'){if(v){const w=ft().wires[i];w.alts=[...new Set([...(w.alts||[]),v])]}}
  else if(sc==='fto')ft().posts[i][k]=v;
  else if(sc==='fte')ft().extras[i][k]=v;
  else if(sc==='kit')kit()[k]=v;
  else if(sc==='kiti')kit().items[i][k]=v;
  else if(sc==='kits'){const b=kit();b.shape={...braceShape(b),[k]:v}}
  else if(sc==='set'){S.settings[k]=v;if(k==='autoCross'){applyAutoCross(v);return}}
  else if(sc==='joblab'){const p=P();p.labor={...LABOR_BASE,...(S.settings.laborDefaults||{}),...(p.labor||{}),[k]:v}}
  else if(sc==='jobhead'){const p=P();p.headache=p.headache||{};if(t.value===''||!(+t.value>0))delete p.headache[id];else p.headache[id]=+t.value}
  else if(sc==='fee'){const p=P();if(p.fees?.[i])p.fees[i][k]=v}
  else if(sc==='crew'){if(S.settings.crew?.[i])S.settings.crew[i][k]=v}
  else if(sc==='jobcrew'){const p=P(),all=(S.settings.crew||[]).map(c=>c.id);let cur=Array.isArray(p.crew)?p.crew.filter(x=>all.includes(x)):all.slice();cur=t.checked?[...new Set([...cur,id])]:cur.filter(x=>x!==id);p.crew=cur.length===all.length?undefined:cur}
  else if(sc==='biz'){S.settings.biz={...(S.settings.biz||{}),[k]:t.type==='number'?Math.max(0,+t.value||0):t.value}}
  else if(sc==='jact'){const p=S.projects.find(x=>x.id===id);if(!p)return;p.actual=p.actual||{};if(t.value==='')delete p.actual[k];else p.actual[k]=Math.max(0,+t.value||0)}
  else if(sc==='jactq'){const p=S.projects.find(x=>x.id===t.dataset.job);if(!p)return;p.actual=p.actual||{};p.actual.qty=p.actual.qty||{};if(t.value==='')delete p.actual.qty[id];else p.actual.qty[id]=Math.max(0,+t.value||0)}
  else if(sc==='job'){const p=S.projects.find(x=>x.id===id);if(!p)return;if(k==='name'&&!String(v).trim())return renderPanel();p[k]=k==='paid'?Math.max(0,+v||0):v}
  else if(sc==='jcrew'){const p=S.projects.find(x=>x.id===t.dataset.job);if(!p)return;const all=(S.settings.crew||[]).map(c=>c.id);let cur=Array.isArray(p.crew)?p.crew.filter(x=>all.includes(x)):all.slice();cur=t.checked?[...new Set([...cur,id])]:cur.filter(x=>x!==id);p.crew=cur.length===all.length?undefined:cur}
  else if(sc==='ui'){if(k==='drawType')setDrawType(v);else S[k]=v}
  else if(sc==='jobp'){const p=P(),base=+(matOf(id)?.price)||0;p.prices=p.prices||{};if(t.value===''||+t.value===base)delete p.prices[id];else p.prices[id]=Math.max(0,+t.value||0)}
  else if(sc==='line'){if(k==='type')retype(getLine(id),v);else getLine(id)[k]=v}
  else if(sc==='proj'){if(k==='laborTotal'&&t.value==='')delete P().laborTotal;else P()[k]=v}
  else if(sc==='node'){
    const p=getLine(id).pts[i];
    if(k==='brace'){const kk=key(p);for(const l2 of P().lines)for(const p2 of l2.pts)if(key(p2)===kk){p2.brace=v===''?null:v;if(v==='gate'){const ty=S.fenceTypes.find(x=>x.id===getLine(id).type)||S.fenceTypes[0];p2.gw=p2.gw||+ty.gateW||16;p2.gm=p2.gm||ty.gateM}}}
    else p[k]=v;
    selNode={l:id,i};
  }
  if(['ft','fti','ftw','ftwalt','ftwsp','fto','fte','kit','kiti','kits'].includes(sc)){setTimeout(renderPanel,0);return}   // a draft: wait for Save
  setTimeout(changed,0);
}
for(const el of [$('#panel'),$('#side')])el.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)act(b.dataset.act,b.dataset)});
$('#panel').addEventListener('input',e=>{if(e.target.id==='jobQ'){jobQ=e.target.value;const at=e.target.selectionStart;renderPanel();const q=$('#jobQ');if(q){q.focus();q.setSelectionRange(at,at)}return}});
$('#panel').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='jobLogT'){e.preventDefault();$('#panel').querySelector('[data-act="jobLog"]')?.click()}});
$('#panel').addEventListener('input',e=>{if(e.target.id!=='matQ')return;const q=e.target.value.trim().toLowerCase();for(const tr of $('#panel').querySelectorAll('table.mats tbody tr[data-name]'))tr.hidden=!!q&&!tr.dataset.name.includes(q);
  // hide a group heading (Wire, Posts…) when none of its materials match
  let g=null,any=false;for(const tr of $('#panel').querySelectorAll('table.mats tbody tr')){if(tr.classList.contains('grp')){if(g)g.hidden=!any;g=tr;any=false}else if(!tr.hidden)any=true}if(g)g.hidden=!any});
for(const nav of [$('#tabs'),$('#tabs2')])nav.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;if(b.dataset.tab==='jobs')jobOpen=null;if(b.dataset.tab==='types')typeSel=null;if(b.dataset.tab==='braces')braceSel=null;gotoTab(b.dataset.tab)});
// sections you opened (like "More options") stay open when the page redraws
const openKeep=(()=>{try{return JSON.parse(localStorage.getItem('fence-open')||'{}')}catch(e){return {}}})();
for(const el of [$('#panel'),$('#side')])el.addEventListener('toggle',e=>{const k=e.target.dataset?.keep;if(k){openKeep[k]=e.target.open;try{localStorage.setItem('fence-open',JSON.stringify(openKeep))}catch(_){}}},true);
async function act(a,d){
  const id=d.id,i=+d.i;
  switch(a){
  case 'tab':gotoTab(d.tab);break;
  case 'applyType':{const ls=P().lines.filter(l=>l.type!==id);if(!ls.length)break;for(const l of ls)retype(l,id);map.closePopup();selNode=null;changed();
    toast('Switched '+ls.length+' line'+(ls.length>1?'s':'')+' to '+(S.fenceTypes.find(x=>x.id===id)?.name||'that type')+'. Ctrl+Z puts it back.');break}
  case 'clearLines':{const n=P().lines.filter(l=>!l.manual).length;if(!n)return toast('There are no fence lines on the map');
    if(!await ask('Remove all '+n+' fence line'+(n>1?'s':'')+' from the map for "'+P().name+'"? You can undo this with Ctrl+Z.'))break;
    if(mode!=='idle')cancelDraw();map.closePopup();P().lines=P().lines.filter(l=>l.manual);selLine=null;selNode=null;changed();toast('Map cleared. Ctrl+Z brings the lines back.');break}
  case 'draw':mode==='draw'?finishDraw():startDraw();renderPanel();break;
  case 'gate':toggleMode('gate');break;
  case 'cross':findCrossings(id,false);break;
  case 'brace':toggleMode('brace');break;
  case 'editFt':typeSel=id;gotoTab('types');break;
  case 'openJob':S.cur=id;selLine=null;selNode=null;if(mode!=='idle')cancelDraw();S.tab='build';changed();setTimeout(fitProject,50);break;
  case 'jobInfo':case 'jobPage':jobOpen=id;S.tab='jobs';renderAll();$('#panel').scrollTop=0;break;
  case 'goCrew':setSec='crew';gotoTab('settings');break;
  case 'setSec':setSec=d.k;renderPanel();$('#panel').scrollTop=0;break;
  case 'textSize':S.settings.textSize=+d.k;changed();break;
  case 'offNew':startOffSel();break;
  case 'offShow':{const a=offList.find(x=>x.id===id);if(!a)break;gotoTab('build');const [w,s2,e,n]=a.bbox;setTimeout(()=>{map.fitBounds([[s2,w],[n,e]]);if(!map.hasLayer(offAreas))offAreas.addTo(map)},60);break}
  case 'offDel':{const a=offList.find(x=>x.id===id);if(!a)break;if(await ask(`Delete the offline map "${a.name}" from this computer? You can download it again later.`)){try{await fetchT('api/off/areas/'+id+'/delete',{method:'POST'},20000)}catch(e){}loadOffAreas()}break}
  case 'offResume':{try{await fetchT('api/off/areas/'+id+'/resume',{method:'POST'},20000)}catch(e){}loadOffAreas();break}
  case 'jobBack':jobOpen=null;renderAll();break;
  case 'jobStage':jobStage=d.k;renderPanel();break;
  case 'jobClear':jobStage='all';jobQ='';renderPanel();break;
  case 'jobView':try{localStorage.setItem('fence-jobview',d.k)}catch(e){}renderPanel();break;
  case 'jobNext':{const p=S.projects.find(x=>x.id===id),k=STAGES[STAGES.findIndex(s=>s[0]===(p?.stage||'bid'))+1]?.[0];if(p&&k){setStage(p,k);changed();toast(`${p.name} moved to ${stageName(k)}`)}break}
  case 'jobPrev':{const p=S.projects.find(x=>x.id===id),i=STAGES.findIndex(s=>s[0]===(p?.stage||'bid'));if(p&&i>0){const k=STAGES[i-1][0];setStage(p,k);changed();toast(`${p.name} moved back to ${stageName(k)}`)}break}
  case 'jobSetStage':{const p=S.projects.find(x=>x.id===id);if(p){setStage(p,d.k);changed()}break}
  case 'jobBill':S.cur=id;selLine=null;selNode=null;if(mode!=='idle')cancelDraw();gotoTab('est');changed();break;
  case 'jobLog':{const p=S.projects.find(x=>x.id===id),t=$('#jobLogT')?.value.trim();if(p&&t){logJob(p,t);changed()}break}
  case 'jobCopy':{const p=S.projects.find(x=>x.id===id);if(!p)break;const c=JSON.parse(JSON.stringify(p));Object.assign(c,{id:uid('p'),name:p.name+' (copy)',stage:'bid',paid:0,est:undefined,log:[]});for(const l of c.lines)l.id=uid('l');logJob(c,'Copied from '+p.name);S.projects.push(c);jobOpen=c.id;changed();toast('Copied. This is the new job.');break}
  case 'jobDel':{const p=S.projects.find(x=>x.id===id);if(!p)break;if(await ask('Delete the job "'+p.name+'" and its fence lines? This cannot be undone.')){S.projects=S.projects.filter(x=>x.id!==p.id);if(S.cur===p.id)S.cur=S.projects[0]?.id||null;jobOpen=null;selLine=null;selNode=null;changed()}break}
  case 'saveSeed':{if(!serverOK)return toast('This needs the Fence Builder server running');
    try{const r=await fetch('api/seed',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({materials:S.materials,fenceTypes:S.fenceTypes,braces:S.braces,settings:S.settings,drawType:S.drawType})});const j=await r.json();if(!r.ok)throw 0;
      toast(`Saved as the starting setup: ${j.fenceTypes} fence types, ${j.braces} braces, ${j.materials} materials`)}catch(e){toast('Could not save the starting setup')}break}
  case 'checkUpd':sessionStorage.removeItem('fence-later');await checkUpdate(true);toast(upd?.available?upd.latest+' is out':upd?.reason||'You have the newest version');break;
  case 'installUpd':installUpdate();break;
  case 'addFee':(P().fees=P().fees||[]).push({name:'',amount:0});changed();setTimeout(()=>{const el=[...document.querySelectorAll('#body [data-f="fee.name"]')].pop();el?.focus()},50);break;
  case 'delFee':P().fees?.splice(i,1);changed();break;
  case 'laborSaveDefault':S.settings.laborDefaults={...LABOR_BASE,...(S.settings.laborDefaults||{}),...(P().labor||{})};delete P().labor;changed();toast('Saved as your usual labor rates. New jobs start with these.');break;
  case 'laborUseDefault':delete P().labor;changed();toast('This job is back on your usual labor rates');break;
  case 'laborReset':delete P().laborTotal;changed();break;
  case 'addCrew':(S.settings.crew=S.settings.crew||[]).push({id:uid('e'),name:'',wage:18});changed();setTimeout(()=>{const el=[...document.querySelectorAll('#body [data-f="crew.name"]')].pop();el?.focus()},50);break;
  case 'delCrew':{const c=S.settings.crew?.[i];if(c&&await ask('Remove '+(c.name||'this person')+' from the crew?')){S.settings.crew.splice(i,1);for(const p of S.projects)if(Array.isArray(p.crew))p.crew=p.crew.filter(x=>x!==c.id);changed()}break}
  case 'jobPriceReset':if(P().prices){delete P().prices[id];changed()}break;
  case 'jobPriceResetAll':P().prices={};changed();toast('This job is back on your normal prices');break;
  case 'addFromLink':addFromLink();break;
  case 'shop':openShopDlg();break;
  case 'matInfo':openMatDlg(id);break;
  case 'newJob':$('#newProj').click();break;
  case 'sel':selectLine(id);break;
  case 'back':selLine=null;selNode=null;renderAll();break;
  case 'zoom':map.fitBounds(L.latLngBounds(getLine(id).pts.map(ll)),{padding:[40,40],maxZoom:19});break;
  case 'cont':startDraw(id);break;
  case 'view3d':open3D(id);break;
  case 'rev':{const l=getLine(id);l.pts.reverse();flipCust(l);selNode=null;changed();break}
  case 'resetCust':delete getLine(id).cust;map.closePopup();changed();break;
  case 'addRun':{const l={id:uid('l'),name:'Run '+(P().lines.length+1),type:drawTypeId(),manual:true,len:0,corners:0,gates:0,closed:false,pts:[]};P().lines.push(l);selLine=null;changed();
    const el=$('#body').querySelector(`[data-f="line.len"][data-id="${l.id}"]`);if(el){el.focus();el.select()}break}
  case 'showMap':setMap(true);break;
  case 'delLine':if(getLine(id).manual||await ask('Delete this fence line?')){P().lines=P().lines.filter(l=>l.id!==id);selLine=null;selNode=null;changed()}break;
  case 'delPt':await deletePoint(id,i);break;
  case 'retryElev':{const l=getLine(id);if(!l)break;elevFail.delete(l.id+geomKey(l));ensureElev();renderPanel();break}
  case 'copyBill':copyBill();break;
  case 'print':window.print();break;
  case 'saveEst':saveEstimate();break;
  case 'quote':openQuote();break;
  case 'jobQuote':S.cur=id;selLine=null;selNode=null;if(mode!=='idle')cancelDraw();changed();openQuote();break;
  case 'tipDone':tipsSeen[d.k]=1;try{localStorage.setItem('fence-tips',JSON.stringify(tipsSeen))}catch(e){}renderPanel();break;
  case 'tipsReset':tipsSeen={};try{localStorage.removeItem('fence-tips')}catch(e){}toast('The how-to cards are back on every page');renderPanel();break;
  case 'useLaborRec':draftFt(id).labor=+d.k;renderPanel();toast('Labor set to '+money(+d.k)+' a foot. Press Save to keep it.');break;
  case 'bizLogo':pickLogo();break;
  case 'bizLogoDel':if(S.settings.biz)delete S.settings.biz.logo;changed();break;
  case 'addMat':addMatPick();break;
  case 'delMat':if(await ask('Remove '+matName(id)+'? Fence types and braces that use it will skip it.')){S.materials=S.materials.filter(m=>m.id!==id);changed()}break;
  case 'fetchPrice':await fetchPrice(id);break;
  case 'fetchAll':autoPrices(true);break;
  case 'selFt':typeSel=id;renderPanel();$('#panel').scrollTop=0;break;
  case 'typesBack':typeSel=null;renderPanel();$('#panel').scrollTop=0;break;
  case 'selKit':braceSel=id;renderPanel();$('#panel').scrollTop=0;break;
  case 'kitsBack':braceSel=null;renderPanel();$('#panel').scrollTop=0;break;
  case 'addFt':{const n=await askText('Name for the new fence type','New fence type');if(n===null)break;
    const t={...typeBase(),id:uid('ft'),name:n.trim()||'New fence type',color:'#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),wires:[],_new:true};
    drafts.ft[t.id]=t;typeSel=t.id;if(S.tab!=='types')gotoTab('types');else renderPanel();toast('Set it up, then press Save.');break}
  case 'dupFt':{const t={...JSON.parse(JSON.stringify(TYP(id))),id:uid('ft'),_new:true};t.name+=' (copy)';drafts.ft[t.id]=t;typeSel=t.id;renderPanel();toast('Copied. Press Save to keep it.');break}
  case 'saveFt':{const d=drafts.ft[id];if(!d)break;delete d._new;const ix=S.fenceTypes.findIndex(x=>x.id===id);if(ix>=0)S.fenceTypes[ix]=d;else S.fenceTypes.push(d);delete drafts.ft[id];changed();toast('Saved '+d.name);break}
  case 'discardFt':{const d=drafts.ft[id];delete drafts.ft[id];if(d?._new)typeSel=null;renderAll();toast('Changes thrown away');break}
  case 'saveKit':{const d=drafts.kit[id];if(!d)break;delete d._new;const ix=S.braces.findIndex(x=>x.id===id);if(ix>=0)S.braces[ix]=d;else S.braces.push(d);delete drafts.kit[id];changed();toast('Saved '+d.name);break}
  case 'discardKit':{const d=drafts.kit[id];delete drafts.kit[id];if(d?._new)braceSel=null;renderAll();toast('Changes thrown away');break}
  case 'addFtw':addWireDlg(id);break;
  case 'delFtw':draftFt(id).wires.splice(i,1);renderPanel();break;
  case 'ftwUp':case 'ftwDown':{const ws=draftFt(id).wires,j=a==='ftwUp'?i+1:i-1;if(j>=0&&j<ws.length){[ws[i],ws[j]]=[ws[j],ws[i]]}renderPanel();break}
  case 'ftwAltDel':{const w=draftFt(id).wires[i];w.alts=(w.alts||[]).filter(x=>x!==d.alt);renderPanel();break}
  case 'addFto':addPostDlg(id);break;
  case 'delFto':draftFt(id).posts.splice(i,1);renderPanel();break;
  case 'addFte':addExtraDlg(id);break;
  case 'delFte':draftFt(id).extras.splice(i,1);renderPanel();break;
  case 'delFt':if(drafts.ft[id]?._new){delete drafts.ft[id];typeSel=null;renderPanel();break}
    if(S.fenceTypes.length<2)return toast('Keep at least one fence type');if(await ask('Delete this fence type? Lines using it switch to the first type.')){S.fenceTypes=S.fenceTypes.filter(t=>t.id!==id);delete drafts.ft[id];typeSel=null;for(const p of S.projects)for(const l of p.lines)if(l.type===id)l.type=S.fenceTypes[0].id;if(S.drawType===id)S.drawType=S.fenceTypes[0].id;for(const p of S.projects)if(p.drawType===id)delete p.drawType;changed()}break;
  case 'addFti':draftFt(id).items.push({m:S.materials[0]?.id,q:'1'});renderPanel();break;
  case 'delFti':draftFt(id).items.splice(i,1);renderPanel();break;
  case 'addKit':{const n=await askText('Name for the new brace','New brace');if(n===null)break;const b={id:uid('b'),name:n.trim()||'New brace',items:[],_new:true};drafts.kit[b.id]=b;braceSel=b.id;renderPanel();$('#panel').scrollTop=0;toast('Set it up, then press Save.');break}
  case 'dupKit':{const b={...JSON.parse(JSON.stringify(KIT(id))),id:uid('b'),_new:true};b.name+=' (copy)';drafts.kit[b.id]=b;braceSel=b.id;renderPanel();$('#panel').scrollTop=0;toast('Copied. Press Save to keep it.');break}
  case 'delKit':if(drafts.kit[id]?._new){delete drafts.kit[id];braceSel=null;renderPanel();break}
    if(S.braces.length<2)return toast('Keep at least one brace');if(await ask('Remove this brace? Spots set to it go back to automatic.')){braceSel=null;S.braces=S.braces.filter(b=>b.id!==id);delete drafts.kit[id];const f=S.braces[0].id;for(const t of S.fenceTypes)for(const k of['braceEnd','braceCorner','bracePull','braceGate'])if(t[k]===id)t[k]=f;for(const p of S.projects)for(const l of p.lines)for(const pt of l.pts)if(pt.brace===id)pt.brace=null;changed()}break;
  case 'addKiti':draftKit(id).items.push({m:S.materials[0]?.id,q:1});renderPanel();break;
  case 'delKiti':draftKit(id).items.splice(i,1);renderPanel();break;
  case 'delProj':if(!S.projects.some(p=>p.id===S.cur))break;if(await ask('Delete the job "'+P().name+'" and its fence lines?')){S.projects=S.projects.filter(p=>p.id!==S.cur);S.cur=S.projects[0]?.id||null;selLine=null;changed();fitProject()}break;
  case 'export':{const a2=document.createElement('a');a2.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{type:'application/json'}));a2.download='fence-estimator-backup.json';a2.click();break}
  case 'import':$('#importFile').click();break;
  }
}
// Stores built on Shopify (kencove.com is one) publish each product as data at /products/<name>.js.
// That is read straight from this browser, so it works where the store turns away the server's request.
async function shopLookup(url){
  let u;try{u=new URL(url)}catch(e){return null}
  const m=u.pathname.match(/\/products\/([^\/?#]+)/);if(!m)return null;
  let d;try{const r=await fetch(u.origin+'/products/'+m[1].replace(/\.js(on)?$/,'')+'.js');if(!r.ok)return null;d=await r.json()}catch(e){return null}
  if(!d||!Array.isArray(d.variants)||!d.variants.length)return null;
  const vid=u.searchParams.get('variant'),v=d.variants.find(x=>String(x.id)===vid)||d.variants[0],vt=v.title&&v.title!=='Default Title'?v.title:'';
  return {price:v.price/100,name:d.title+(vt?', '+vt:''),sku:v.sku||'',source:u.hostname.replace(/^www\./,''),options:d.variants.length,image:imgOf(v.featured_image)||imgOf(d.featured_image)||imgOf((d.images||[])[0]),...shopParse(d.title,vt)};
}
function shopParse(title,vt){
  const text=(title+' '+vt).replace(/½/g,'.5').replace(/¼/g,'.25').replace(/¾/g,'.75').replace(/(\d+)-(\d+)\/(\d+)/g,(m,a,b,c)=>String(+a+b/c)),out={};   // "6-1/2'" reads as 6.5
  let x;
  if((x=text.replace(/,/g,'').match(/(\d+(?:\.\d+)?)\s*(?:"|in\.?)\s*x\s*(\d{3,5})\s*(?:'|ft)/i))){out.height=+x[1];out.roll=+x[2]}   // woven wire written 47" x 330'
  if(!out.roll&&(x=vt.replace(/,/g,'').match(/(\d+(?:\.\d+)?)\s*-?\s*(?:ft|feet|')/i))){out.roll=+x[1];out.rollSure=true}          // "660-ft" roll
  if((x=text.match(/(\d+(?:\.\d+)?)\s*-?\s*g(?:a|auge)?\b/i)))out.gauge=x[1];                                   // "12.5 Ga"
  if((x=text.match(/\b\d+\s*\/\s*(\d+)\s*"?\s*\/\s*\d+/)))out.height=+x[1];                           // woven wire "9/49/12": 49 in tall
  if(!out.roll&&(x=text.replace(/,/g,'').match(/(\d+(?:\.\d+)?)\s*-?\s*(?:ft|')\s*(?:roll|coil|spool)/i)))out.roll=+x[1];
  // wire sold by the roll with the length in the name, like "7/36/24 330'" or "Barbed Wire 1320 ft"
  if(!out.roll&&/\b\d+\s*\/\s*\d+\s*"?\s*\/\s*\d+|wire|barb/i.test(text)&&(x=text.replace(/,/g,'').match(/\b(\d{3,5})\s*(?:'|-?\s*ft\b|-?\s*feet\b)/i)))out.roll=+x[1];
  if((x=text.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:ft|')\s*(?:t-?post|post)/i))||(x=text.match(/(?:t-?post|post)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*-?\s*(?:ft|')/i)))out.len=+x[1];
  return out;
}
