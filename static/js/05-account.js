/* ---------- accounts: who is signed in on a shared server, and the desktop app's server choice ---------- */
// On a shared Fence Builder server everyone signs in and has their own jobs, prices and settings. ME says who
// is signed in; CSRF is this sign-in's own token, sent with every change, so another website can't make
// changes in your name. The Windows app and a single-user server have no sign-in (ME.mode is 'single').
let ME={mode:'single'},CSRF='';
const isMulti=()=>ME.mode==='multi';
const isAdmin=()=>isMulti()&&ME.user?.role==='admin';
// the Windows app showing a Fence Builder server's pages can go back to its own copy
const inApp=()=>!!window.pywebview?.api?.use_local;
{
  const nativeFetch=window.fetch.bind(window);
  const own=u=>{try{return new URL(u,location.href).origin===location.origin}catch(e){return false}};
  window.fetch=(u,o={})=>{
    const url=typeof u==='string'?u:u instanceof URL?u.href:u?.url||'',mine=own(url);
    if(mine&&CSRF&&!/^(GET|HEAD)$/i.test(o.method||'GET')){const h=new Headers(o.headers||{});h.set('X-CSRF-Token',CSRF);o={...o,headers:h}}
    const p=nativeFetch(u,o);
    if(mine&&isMulti())p.then(r=>{if(r.status===401)signedOut()},()=>{});
    return p;
  };
}
async function whoami(){
  try{
    const r=await fetch('api/auth/me',{cache:'no-store'});
    if(r.ok){const j=await r.json();if(j&&j.mode){ME=j;CSRF=j.csrf||''}}
    else if(r.status===401){location.replace('login');return new Promise(()=>{})}
  }catch(e){}
  return ME;
}
const mePromise=whoami();
// everything this browser kept for the person signing out: on a shared computer nothing of theirs stays behind
function forgetHere(){
  try{for(const k of Object.keys(localStorage))if(k.startsWith('fence'))localStorage.removeItem(k)}catch(e){}
  try{sessionStorage.clear()}catch(e){}
  try{indexedDB.deleteDatabase('fence3d')}catch(e){}
}
async function signOut(){
  if(saveT){clearTimeout(saveT);saveT=null;await pushSave()}   // your last change goes to the server first
  for(let i=0;i<40&&saving;i++)await new Promise(r=>setTimeout(r,100));
  try{await fetch('api/auth/logout',{method:'POST'})}catch(e){}
  forgetHere();location.replace('login');
}
// the sign-in ran out (or an admin turned the account off) while the page was open
let outShown=false;
function signedOut(){
  if(outShown)return;outShown=true;
  // a change that did not reach the server is kept here, to be saved after you sign in again
  try{if(S&&ME.user&&(saveT||saving||saveAgain))localStorage.setItem('fence-pending:'+ME.user.id,JSON.stringify({rev:baseRev,body:JSON.stringify(S)}))}catch(e){}
  clearTimeout(saveT);saveT=null;
  const d=$('#askDlg');if(d.open)d.close();
  d.innerHTML=`<h2 style="margin:0 0 10px">You were signed out</h2><p style="font-size:16px;margin:0 0 18px">To keep working, please sign in again. Any change that was not saved yet is kept on this computer and saved after you sign in.</p><div class="row" style="justify-content:flex-end"><button class="btn pri big" id="outGo">Sign in again</button></div>`;
  d.oncancel=e=>e.preventDefault();$('#outGo').onclick=()=>location.replace('login');d.showModal();
}
// after signing in again: save what was kept, if nothing else changed on the server meanwhile
function pendingChange(serverRev){
  if(!isMulti()||!ME.user)return null;
  const k='fence-pending:'+ME.user.id;let p=null;
  try{p=JSON.parse(localStorage.getItem(k)||'null');localStorage.removeItem(k)}catch(e){}
  if(!p)return null;
  if(+p.rev!==+serverRev){setTimeout(()=>toast('A change made just before you were signed out could not be kept, because your jobs were changed somewhere else meanwhile.'),1500);return null}
  try{const j=JSON.parse(p.body);return j&&j.materials?j:null}catch(e){return null}
}
const privateHost=h=>/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|169\.254\.)/i.test(h)||/\.(local|lan|home|internal)$/i.test(h)||!h.includes('.');
async function useServer(){
  const v=($('#srvUrl')?.value||'').trim();if(!v)return toast('Type the address of the Fence Builder server first');
  let u;try{u=new URL(/^https?:\/\//i.test(v)?v:'http://'+v)}catch(e){return toast('That does not look like a web address')}
  if(u.protocol==='http:'&&!privateHost(u.hostname)&&!await ask('This address starts with http://, not https://. Your password would travel over the internet unencrypted, where others could see it.\n\nUse it anyway?'))return;
  toast('Checking '+u.host+'…');
  try{const r=await fetch('api/app/server',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:v})});const j=await r.json();if(!r.ok)throw Error(j.error||'');
    flush();toast('Opening '+j.url+'…');setTimeout(()=>{location.href=j.url+'/login'},600)}
  catch(e){toast(e.message||'Could not use that server')}
}
async function useLocalCopy(){
  try{await fetch('api/app/server',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:''})});ME.server_url='';renderPanel();toast('The app opens the copy on this computer from now on.')}catch(e){toast('Could not change that')}
}
async function changePassword(){
  const old=$('#pwOld')?.value||'',nw=$('#pwNew')?.value||'',nw2=$('#pwNew2')?.value||'';
  if(!old||!nw)return toast('Type your password now, and the new one');
  if(nw!==nw2)return toast('The two new passwords are not the same. Type them again.');
  try{const r=await fetch('api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({old,new:nw})});const j=await r.json();
    if(!r.ok)throw Error(j.error||'The password was not changed');CSRF=j.csrf||CSRF;
    for(const id of ['pwOld','pwNew','pwNew2'])if($('#'+id))$('#'+id).value='';
    toast('Your password is changed. You were signed out everywhere else.')}
  catch(e){toast(e.message)}
}
function accountBar(){
  const b=$('#bMe');if(!b)return;
  b.hidden=!isMulti();if(!isMulti())return;
  b.textContent=ME.user?.name||ME.user?.username||'Account';b.title='Signed in as '+(ME.user?.username||'')+'. Your account and signing out.';
}
addEventListener('pywebviewready',()=>{if(S?.tab==='settings')renderPanel()});
