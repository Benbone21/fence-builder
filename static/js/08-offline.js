/* ---------- working with no signal (a phone out in a field) ----------
   On a phone (or the app added to its home screen) this keeps, in the phone's own storage (IndexedDB "fence-offline"),
   for the person signed in there only, and never a password or a sign-in token:
     me              who signed in last on this phone (name, user name), so the app opens with no signal
     copy:<who>      the last copy of their jobs, fence types and prices that came from the server
     pending:<who>   a change that has not reached the server yet (points dropped with no signal), with the copy it
                     was made on, so it can be added on top of whatever changed on the server meanwhile
   It goes out through the normal save as soon as the server answers again. Signing out deletes all of it.
   sw.js keeps the app's own files so the page opens with no signal (registered only here, on a phone). */
const PHONE_Q='(max-width:640px), (max-width:950px) and (max-height:500px)';   // the same test as the phone part of app.css
const NOSIG="No signal: your points are saved on this phone and will be sent when you're back in range.";
let netDown=false,offSent=false;   // netDown: the last save could not reach the server
function offWanted(){try{return matchMedia(PHONE_Q).matches||matchMedia('(display-mode: standalone)').matches}catch(e){return false}}
const offWho=()=>isMulti()?'u:'+(ME.user?.id||''):'single';
let offDbP=null;
function offDb(){
  return offDbP??=new Promise((res,rej)=>{let r;try{r=indexedDB.open('fence-offline',1)}catch(e){return rej(e)}
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('blocked'))})
    .catch(e=>{offDbP=null;throw e});
}
async function offGet(k){try{const db=await offDb();return await new Promise((res,rej)=>{const q=db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result??null);q.onerror=()=>rej(q.error)})}catch(e){return null}}
async function offPut(k,v){try{const db=await offDb();await new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)});return true}catch(e){return false}}
async function offDel(k){try{const db=await offDb();await new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').delete(k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}catch(e){}}
// signing out: nothing of this person's stays on the phone
function offForget(){
  try{if(offDbP)offDbP.then(db=>db.close(),()=>{})}catch(e){}offDbP=null;
  try{indexedDB.deleteDatabase('fence-offline')}catch(e){}
  try{caches.delete('fb-tiles')}catch(e){}
}
// who signed in (kept when there is a connection; used when there isn't)
function offMeSeen(j){
  if(j?.mode==='multi'){try{localStorage.setItem('fb-server','multi')}catch(e){}}   // not personal: this is a server with sign-in
  if(j?.mode==='multi'&&j.user&&offWanted())offPut('me',{mode:'multi',user:j.user});
}
async function offMe(){
  const m=await offGet('me');
  if(m?.mode==='multi'&&m.user)return {...m,offline:true};
  let multi=false;try{multi=localStorage.getItem('fb-server')==='multi'}catch(e){}
  if(multi){   // a server with sign-in, and nobody has signed in on this phone yet: nothing to show
    document.body.innerHTML=`<div class="authbox" style="margin:10vh auto;max-width:460px"><h2>No signal</h2><p class="lead">Fence Builder can't reach the server, and nobody has signed in on this phone yet. Sign in once while you have signal; after that it works out of range too.</p><button class="btn pri wide" id="offRetry">Try again</button></div>`;
    document.getElementById('offRetry').onclick=()=>location.reload();
    return new Promise(()=>{});
  }
  return null;
}
// opened with a connection: put back a change made with no signal, on top of what changed on the server meanwhile
async function offRestore(j){
  if(!j?.materials)return null;
  const p=await offGet('pending:'+offWho());if(!p)return null;
  let mine;try{mine=JSON.parse(p.body)}catch(e){}
  if(!mine?.materials){offDel('pending:'+offWho());return null}
  const theirs=JSON.stringify(j);let out=mine;
  if(+p.rev!==+j.rev){let base=null;try{base=JSON.parse(p.base)}catch(e){}
    out=merge3(base||{},mine,j);for(const k of ['tab','cur','drawType'])if(k in mine)out[k]=mine[k]}
  baseJSON=theirs;baseRev=+j.rev||0;offSent=true;
  setTimeout(()=>{save();toast('Sending what you did with no signal…')},800);
  return out;
}
// opened with no connection: the copy kept on this phone (with any change not sent yet)
async function offLoad(){
  if(isMulti()&&!ME.user)return null;
  const p=await offGet('pending:'+offWho()),c=p||await offGet('copy:'+offWho());if(!c)return null;
  let j=null;try{j=JSON.parse(c.body)}catch(e){}
  if(!j?.materials)return null;
  serverOK=true;netDown=true;baseRev=+c.rev||0;baseJSON=c.base||c.body;
  setTimeout(()=>{setStatus('No signal: saved on this phone');toast('No signal: showing what was last saved on this phone.')},300);
  return j;
}
// before each save: kept on the phone first, in case it doesn't get through (or the battery runs out)
async function offBeforeSave(body){if(offWanted())await offPut('pending:'+offWho(),{rev:baseRev,base:baseJSON,body,at:Date.now()})}
function offSaved(body){
  const was=netDown;netDown=false;offDel('pending:'+offWho());
  if(offWanted())offPut('copy:'+offWho(),{rev:baseRev,body});
  const sent=offSent;offSent=false;
  if(sent||was)toast('Back in range: everything you did with no signal is saved.');
  if(was)offBack();
  if(typeof updWalk==='function')updWalk();
}
function offFailed(){netDown=true;if(offWanted())setStatus('No signal: saved on this phone');if(typeof updWalk==='function')updWalk()}
// back in range: the heights, the ground, and roads and rivers that could not be looked up out there
function offBack(){elevFail.clear();scheduleElev();scheduleGround();crossLater()}
// the phone says it is back in range: (opened with no signal: this sign-in's safety token first) send what is waiting
addEventListener('online',async()=>{
  if(!S)return;
  if(isMulti()&&!CSRF)await whoami();
  if(netDown)save();else offBack();   // after a save that gets through, offSaved does the rest
  if(typeof updWalk==='function')updWalk();
});
addEventListener('offline',()=>{if(typeof updWalk==='function')updWalk()});
// gates at roads and braces at rivers for lines finished out of range: looked for once the phone is back in range
function crossLater(add){
  let ids=[];try{ids=JSON.parse(localStorage.getItem('fence-cross-later')||'[]')}catch(e){}
  if(add){ids=[...new Set([...ids,add])];try{localStorage.setItem('fence-cross-later',JSON.stringify(ids))}catch(e){}return}
  if(!ids.length||navigator.onLine===false)return;
  try{localStorage.removeItem('fence-cross-later')}catch(e){}
  (async()=>{for(const id of ids)if(getLine(id)&&crossOn())await findCrossings(id,true)})();
}
// the app's own files on this phone, so it opens with no signal (https or localhost only, as browsers require)
if('serviceWorker' in navigator&&window.isSecureContext&&offWanted())
  addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(e=>console.warn('offline copy of the app',e)));
