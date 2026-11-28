/* ---------- find products in a store's catalog and add them as materials ---------- */
// Kencove is a Shopify store: its public product list is read in this browser.
// D&B Supply is an Adobe Commerce store: its public product search (/graphql) is also asked from this browser.
// The Fence Builder server is not needed for either one.
const STORES=[{host:'kencove.com',name:'Kencove',kind:'shopify'},{host:'www.dbsupply.com',name:'D&B Supply (fencing only)',kind:'magento',catPath:'shop/farm-ranch'}];
const storeList=()=>{const own=String(S.settings.shop||'').trim().replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase();
  return own&&!STORES.some(x=>x.host.replace(/^www\./,'')===own.replace(/^www\./,''))?[...STORES,{host:own,name:own,kind:'shopify'}]:STORES};
const shop={sel:0,cols:null,cat:null,all:null,items:[],title:'',msg:'',q:'',added:{}};
const curStore=()=>storeList()[shop.sel]||STORES[0];
const shopHost=()=>curStore().host;
const imgOf=x=>{const u=typeof x==='string'?x:(x?.src||x?.url||'');return u?(u.startsWith('//')?'https:'+u:u):''};
const shopSlim=p=>{const im=(p.images||[]);return {title:p.title,handle:p.handle,image:imgOf(im[0]),variants:(p.variants||[]).map(v=>({id:v.id,title:v.title==='Default Title'?'':(v.title||''),price:+v.price||0,sku:v.sku||'',image:imgOf(im.find(i=>(i.variant_ids||[]).includes(v.id)))||imgOf(v.featured_image)}))}};
const magSlim=it=>({title:it.name,handle:it.sku,url:it.url,image:it.image||'',variants:[{id:it.sku,title:'',price:+it.price||0,sku:it.sku}]});
// Going easy on the stores: one request at a time to each store, a pause after each one, and when a store
// says "too many requests" (429) a longer wait before trying again. After the third 429 that store is left
// alone for 5 minutes.
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const storeLine={},storeBusy={};
function storeFetch(url,opt,gap){
  const host=new URL(url).hostname;
  const go=async()=>{for(let n=0;;n++){
    if(Date.now()<(storeBusy[host]||0))return new Response(null,{status:429});
    const r=await fetch(url,opt);if(r.status!==429)return r;
    if(n>=2){storeBusy[host]=Date.now()+5*60e3;return r}
    await nap(4e3*2**n)}};   // 4 s, then 8 s
  const p=(storeLine[host]||Promise.resolve()).then(go);
  storeLine[host]=p.then(()=>nap(gap||0),()=>nap(gap||0));
  return p;
}
const storeErr=r=>Error(r.status===429?'The store is busy (too many requests). Try again in a few minutes.':'The store answered with error '+r.status);
async function shopGet(path){const r=await storeFetch('https://'+shopHost()+path,{},250);if(!r.ok)throw storeErr(r);return r.json()}
// Adobe Commerce stores (D&B Supply): only these fixed questions are asked of the store's /graphql.
const MAG_ITEMS='total_count items { name sku url_key url_suffix small_image { url } price_range { minimum_price { final_price { value } } } }';
const MAG_Q={
  // one branch of the store only (for example "shop/farm-ranch"); the whole tree is too slow to ask for
  cats:'query($path: String!) { categories(filters: {url_path: {eq: $path}}) { items { children { uid name product_count children { uid name product_count } } } } }',
  topcats:'{ categories { items { children { uid name product_count } } } }',
  cat:'query($uid: String!) { products(filter: {category_uid: {eq: $uid}}, pageSize: 80) { '+MAG_ITEMS+' } }',
  search:'query($q: String!, $uids: [String]) { products(search: $q, filter: {category_uid: {in: $uids}}, pageSize: 50) { '+MAG_ITEMS+' } }',
  // one product, by the last part of its page address
  key:'query($uid: String!) { products(filter: {url_key: {eq: $uid}}, pageSize: 1) { '+MAG_ITEMS+' } }',
};
async function magGQL(host,op,variables){
  const r=await storeFetch('https://'+host+'/graphql',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Store:'default'},
    body:JSON.stringify({query:MAG_Q[op],variables})},300);
  if(!r.ok)throw storeErr(r);
  let j;try{j=await r.json()}catch(e){throw Error('The store did not answer')}
  if(!j?.data&&j?.errors?.length)throw Error('The store did not answer ('+String(j.errors[0].message||'').slice(0,120)+')');
  return j?.data||{};
}
// the categories in a store's answer, each named with its parent: "Fencing › Gates"
function magCats(data){
  const out=[],walk=(nodes,trail)=>{for(const c of nodes||[]){const name=[...trail,c.name||''];
    if(c.product_count)out.push({uid:c.uid,title:name.slice(-2).join(' › '),n:c.product_count});walk(c.children,name)}};
  for(const top of data.categories?.items||[])walk(top.children,[]);
  return out;
}
// Only the fencing part of a general farm store is shown: categories whose name matches this,
// found under the branch given (D&B Supply: Farm & Ranch). Everything else in the store is left out.
// The list is kept in this browser for a week, so it is asked for only now and then.
const FENCE_CATS=/fenc|gate|panel/i,fenceMem={};
async function fenceUids(host,path){
  const k='fb-store-cats:'+host+'|'+path;if(fenceMem[k])return fenceMem[k];
  let keep=null;
  try{const c=JSON.parse(localStorage.getItem(k)||'null');if(c&&Array.isArray(c.cats)&&c.cats.length&&Date.now()-c.at<7*864e5)keep=c.cats}catch(e){}
  if(!keep){
    keep=magCats(await magGQL(host,'cats',{uid:'',q:'',path:path.slice(0,120)})).filter(c=>FENCE_CATS.test(c.title.split(' › ')[0]));
    if(keep.length)try{localStorage.setItem(k,JSON.stringify({at:Date.now(),cats:keep}))}catch(e){}
  }
  const tops=keep.filter(c=>!c.title.includes(' › ')&&FENCE_CATS.test(c.title));
  return fenceMem[k]={tops:tops.map(c=>c.uid),all:new Set(keep.map(c=>c.uid)),cats:keep};
}
async function magApi(host,op,{uid='',q='',path=''}={}){
  if(!MAG_Q[op])throw Error('That store or request is not allowed');
  if(op==='cats'&&!path)op='topcats';
  let fence=null;
  if(path){fence=await fenceUids(host,path);
    if(op==='cats')return {cats:fence.cats};
    if(op==='cat'&&!fence.all.has(uid))throw Error('That category is not part of fencing')}
  // a page address (op "key") can be long, like D&B's "bfc-22200-126-fence-tubing-…-polyester-coated"
  const v={uid:String(uid).slice(0,op==='key'?255:80),q:String(q).slice(0,120),path:String(path).slice(0,120)};
  if(op==='search')v.uids=fence?fence.tops:null;
  const data=await magGQL(host,op,v);
  if(op==='topcats')return {cats:magCats(data)};
  const prods=data.products||{};
  const items=(prods.items||[]).map(it=>({name:it.name||'',sku:it.sku||'',price:it.price_range?.minimum_price?.final_price?.value||0,
    image:it.small_image?.url||'',url:'https://'+host+'/'+(it.url_key||'')+(it.url_suffix||'')}));
  return {items,total:prods.total_count||items.length};
}
function storeApi(op,params){const st=curStore();return magApi(st.host,op,{path:st.catPath||'',...params})}
const FENCEY=/wire|fenc|post|gate|brace|insul|clip|staple|energ|strain|tension|ground|netting|panel/i;
function shopRender(){
  const dlg=$('#shopDlg'),st=curStore(),host=st.host;
  const cols=(shop.cols||[]).filter(c=>c.n>0).sort((a,b)=>(FENCEY.test(b.title)-FENCEY.test(a.title))||a.title.localeCompare(b.title));
  const list=shop.items.map((p,pi)=>`<div class="sprod"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div class="mrow">${thumb(p.image||p.variants[0]?.image,56)}<b>${esc(p.title)}</b></div><a class="small" style="white-space:nowrap" href="${esc(p.url||'https://'+host+'/products/'+p.handle)}" target="_blank" rel="noopener">Open page</a></div>
    <table><tbody>${p.variants.map((v,vi)=>{const d=shopParse(p.title,v.title),spec=[d.gauge&&d.gauge+' ga',d.roll&&fmtQ(d.roll)+' ft roll',d.height&&d.height+' in tall',d.len&&d.len+' ft long'].filter(Boolean).join(' · ');
      return `<tr><td>${esc(v.title||'One size')}</td><td class="small mut">${esc(spec)}</td><td class="small mut">${esc(v.sku)}</td><td class="num">${v.price?money(v.price):'<span class="mut">see page</span>'}</td>
      <td style="width:1%"><button class="btn sm${shop.added[host+v.id]?'':' pri'}" data-add="${pi}" data-v="${vi}">${shop.added[host+v.id]?'Added':'Add'}</button></td></tr>`}).join('')}</tbody></table></div>`).join('');
  const keepQ=dlg.querySelector('#shopQ')?.value??shop.q,hadFocus=document.activeElement?.id==='shopQ';
  dlg.innerHTML=`<div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">Find materials in a store</h2><button class="btn sm" data-x="close">Close</button></div>
    <div class="row" style="margin-bottom:10px">${storeList().map((x,i)=>`<button class="btn${i===shop.sel?' on':''}" data-store="${i}">${esc(x.name)}</button>`).join('')}
      <form id="shopF" class="pick" style="flex:1;min-width:260px"><input type="search" id="shopQ" value="${esc(keepQ)}" placeholder="Search ${esc(st.name)}, for example: t-post, fixed knot, barbed wire"><button class="btn pri">Search</button></form>
      <a class="btn" href="https://${esc(host)}" target="_blank" rel="noopener">Open the website</a></div>
    <div class="shopgrid"><div class="scol"><div class="small mut" style="margin:0 0 6px 8px">Categories</div>${shop.cols?(cols.length?cols.map(c=>`<button class="tli${shop.cat===c.handle?' on':''}" data-cat="${esc(c.handle)}"><span class="grow"><b>${esc(c.title)}</b></span><span class="small mut">${c.n}</span></button>`).join(''):'<p class="small mut" style="margin:8px">No categories.</p>'):'<p class="small mut" style="margin:8px">Loading…</p>'}</div>
      <div class="scol">${shop.msg?`<p class="mut" style="margin:8px">${esc(shop.msg)}</p>`:''}${shop.title&&!shop.msg?`<div class="small mut" style="margin:0 0 6px">${esc(shop.title)}</div>`:''}${list||(!shop.msg?'<p class="mut" style="margin:8px">Pick a category on the left, or search above. Click Add to put a product in your materials with its price and details.</p>':'')}</div></div>
    <p class="small mut" style="margin:8px 0 0">Prices come from each store's public product list. Details like gauge, roll length and post length are read from the product name, so check them after adding.</p>`;
  if(hadFocus){const q=dlg.querySelector('#shopQ');q.focus();q.setSelectionRange(q.value.length,q.value.length)}
}
async function shopLoadCats(){
  const st=curStore();
  try{
    if(st.kind==='magento'){const j=await storeApi('cats',{});shop.cols=(j.cats||[]).map(c=>({handle:c.uid,title:c.title,n:c.n||0}))}
    else{const j=await shopGet('/collections.json?limit=250');shop.cols=(j.collections||[]).map(c=>({handle:c.handle,title:c.title,n:c.products_count||0}))}
  }catch(e){shop.cols=[];shop.msg='Could not reach '+st.name+'. '+(e.message||'')}
  if(curStore()===st)shopRender();
}
async function shopCat(handle){
  const st=curStore(),c=shop.cols.find(x=>x.handle===handle);shop.cat=handle;shop.items=[];shop.msg='Loading '+(c?.title||'')+'…';shopRender();
  try{
    if(st.kind==='magento'){const j=await storeApi('cat',{uid:handle});shop.items=(j.items||[]).map(magSlim);shop.title=(c?.title||'')+': '+shop.items.length+(j.total>shop.items.length?' of '+j.total:'')+' products'}
    else{const j=await shopGet('/collections/'+encodeURIComponent(handle)+'/products.json?limit=250');shop.items=(j.products||[]).map(shopSlim);shop.title=(c?.title||'')+': '+shop.items.length+' products'}
    shop.msg=shop.items.length?'':'Nothing in this category.';
  }catch(e){shop.msg=e.message||'Could not load that category'}
  shopRender();
}
async function shopSearch(q){
  q=q.trim();shop.q=q;if(!q)return;const st=curStore();shop.cat=null;shop.items=[];
  try{
    if(st.kind==='magento'){shop.msg='Searching '+st.name+'…';shopRender();const j=await storeApi('search',{q});shop.items=(j.items||[]).map(magSlim);
      shop.title=shop.items.length+(j.total>shop.items.length?' of '+j.total:'')+' products matching "'+q+'"'}
    else{
      if(!shop.all){const all=[];
        // the store's product list, 250 at a time, read once and kept until the page is closed
        for(let pg=1;pg<=20;pg++){shop.msg='Loading the store\'s product list… '+all.length+' so far';shopRender();const j=await shopGet('/products.json?limit=250&page='+pg);const ps=j.products||[];all.push(...ps.map(shopSlim));if(ps.length<250)break}
        shop.all=all}
      const words=q.toLowerCase().replace(/½/g,'.5').split(/\s+/).filter(Boolean);
      shop.items=shop.all.filter(p=>{const hay=(p.title+' '+p.variants.map(v=>v.title+' '+v.sku).join(' ')).toLowerCase().replace(/½/g,'.5');return words.every(w=>hay.includes(w))}).slice(0,80);
      shop.title=shop.items.length+' product'+(shop.items.length===1?'':'s')+' matching "'+q+'"'+(shop.items.length===80?' (first 80)':'')}
    shop.msg=shop.items.length?'':'Nothing in the store matches "'+q+'". Try fewer or different words.';
  }catch(e){shop.msg=e.message||'Could not search the store'}
  shopRender();
}
// a first guess at what kind of material a store product is, from its name
function kindGuess(name,d){const t=String(name||'').toLowerCase();
  return d?.roll||/wire|woven|netting|mesh|field fence/.test(t)&&!/insulator|clip|strainer|tensioner|tool/.test(t)?'wire':/gate/.test(t)&&!/latch|hinge|handle|wheel/.test(t)?'gate':/post/.test(t)&&!/driver|puller|insulator|clip|cap|pounder/.test(t)?'post':/insulator|clip|staple|strainer|tensioner|crimp|sleeve|latch|hinge|bracket/.test(t)?'hw':undefined}
function shopAdd(pi,vi){
  const p=shop.items[pi],v=p?.variants[vi];if(!v)return;
  const st=curStore(),host=st.host,d=shopParse(p.title,v.title),now=new Date().toISOString(),t=p.title.toLowerCase();
  const kind=kindGuess(p.title,d);
  S.materials.unshift({id:uid('m'),image:v.image||p.image||'',name:p.title+(v.title?', '+v.title:''),unit:d.roll?'roll':'each',price:v.price,url:p.url||('https://'+host+'/products/'+p.handle+'?variant='+v.id),checked:now,updated:now,src:host.replace(/^www\./,'')+(v.sku?' · '+v.sku:''),kind,...d,rollSure:undefined});
  shop.added[host+v.id]=1;changed();toast('Added '+p.title+(v.title?', '+v.title:'')+' at '+money(v.price));shopRender();
}
function shopPick(i){if(i===shop.sel&&shop.cols)return;Object.assign(shop,{sel:i,cols:null,cat:null,all:null,items:[],title:'',msg:'',q:''});const q=$('#shopDlg').querySelector('#shopQ');if(q)q.value='';shopRender();shopLoadCats()}
async function openShopDlg(){
  const dlg=$('#shopDlg');if(shop.sel>=storeList().length)shop.sel=0;
  dlg.onclick=e=>{const t=e.target;if(t===dlg||t.closest('[data-x="close"]'))return dlg.close();
    const s2=t.closest('[data-store]');if(s2)return shopPick(+s2.dataset.store);
    const c=t.closest('[data-cat]');if(c)return shopCat(c.dataset.cat);
    const a=t.closest('[data-add]');if(a)shopAdd(+a.dataset.add,+a.dataset.v)};
  dlg.onsubmit=e=>{if(e.target.id==='shopF'){e.preventDefault();shopSearch(dlg.querySelector('#shopQ').value)}};
  shopRender();if(!dlg.open)dlg.showModal();
  if(!shop.cols)shopLoadCats();
}
// Stores that only let people (not programs) see their pages. Use the bookmark on those.
const PEOPLE_ONLY=/(^|\.)premier1supplies\.com$/i;
const GRAB_JS="(()=>{const q=s=>[...document.querySelectorAll(s)],p={specs:{}}; const vid=new URLSearchParams(location.search).get('variant'),offerOf=x=>{let os=[].concat(x.offers||[]);os=[].concat(...os.map(o=>o&&o.offers?[].concat(o.offers):[o]));return os.find(o=>vid&&String(o&&(o.url||o.sku||'')).includes(vid))||os[0]};for(const s of q('script[type=\"application/ld+json\"]')){try{const j=JSON.parse(s.textContent.replace(/\\s+/g,' '));for(const x of [].concat(j['@graph']||j)){const t=[].concat(x['@type']).join();if(!/Product/.test(t))continue;p.name=p.name||x.name;let v=x;if(x.hasVariant){const vs=[].concat(x.hasVariant);v=vs.find(y=>vid&&JSON.stringify(y).includes(vid))||vs[0]||x;if(v.name&&v.name!==x.name)p.option=v.name}p.sku=p.sku||v.sku||x.sku;const o=offerOf(v)||offerOf(x);if(o&&!p.price)p.price=+(o.price||o.lowPrice||0)}}catch(e){}} const mt=n=>(document.querySelector('meta[property=\"'+n+'\"],meta[name=\"'+n+'\"],meta[itemprop=\"'+n+'\"]')||{}).content; p.name=p.name||mt('og:title')||(document.querySelector('h1')||{}).innerText||document.title; if(!p.price){const e=[...document.querySelectorAll('[class*=price],[id*=price],[itemprop=price]')].find(e=>/\\$\\s?\\d/.test(e.innerText||''));const m=e&&e.innerText.match(/\\$\\s?(\\d{1,6}(?:,\\d{3})*(?:\\.\\d{2})?)/);if(m)p.price=+m[1].replace(/,/g,'')} p.price=p.price||+(mt('product:price:amount')||mt('og:price:amount')||mt('price')||0); const add=(k,v)=>{k=(k||'').replace(/\\s+/g,' ').replace(/:$/,'').trim();v=(v||'').replace(/\\s+/g,' ').trim();if(k&&v&&k.length<50&&v.length<120&&Object.keys(p.specs).length<40)p.specs[k]=v}; q('table tr').forEach(r=>{const c=r.querySelectorAll('th,td');if(c.length==2)add(c[0].innerText,c[1].innerText)}); q('dl').forEach(d=>{const t=d.querySelectorAll('dt'),v=d.querySelectorAll('dd');t.forEach((x,i)=>v[i]&&add(x.innerText,v[i].innerText))}); q('li').forEach(l=>{const m=l.innerText.match(/^([A-Za-z][\\w ()\\/-]{1,40}):\\s*(.{1,100})$/);if(m)add(m[1],m[2])}); p.image=mt('og:image')||(document.querySelector('[itemprop=image]')||{}).src||'';if(p.image&&p.image.startsWith('//'))p.image='https:'+p.image;p.url=location.href.split('#')[0];p.host=location.hostname.replace(/^www\\./,''); window.open('__APP__/#add='+encodeURIComponent(JSON.stringify(p)),'fence-estimator')})()";
const grabHref=()=>'javascript:'+encodeURIComponent(GRAB_JS.replace('__APP__',location.origin));
// specs read off a store page, turned into the details this app uses
function specDetails(sp,name){
  const out={...shopParse(name||'','')},num=v=>{const m=String(v).replace(/,/g,'').replace(/(\d+)-(\d+)\/(\d+)/,(a,b,c,d)=>String(+b+c/d)).match(/\d+(?:\.\d+)?/);return m?+m[0]:null};
  for(const [k0,v] of Object.entries(sp||{})){const k=k0.toLowerCase(),n=num(v);if(n==null)continue;
    if(/gauge|\bga\b/.test(k))out.gauge=String(n);
    else if(/roll|spool|coil|footage/.test(k)&&/length|ft|feet|footage/.test(k+' '+v))out.roll=n;
    else if(/height/.test(k))out.height=/ft|feet|'/.test(v)&&!/in/.test(v)?n*12:n;
    else if(/diameter|thickness/.test(k))out.dia=n;
    else if(/length/.test(k)&&!out.len)out.len=/in(ch)?\b|"/.test(v)&&!/ft|feet|'/.test(v)?Math.round(n/12*100)/100:n;
  }
  return out;
}
// a product sent here by the bookmark (the page address ends in #add=...)
function takeGrab(){
  const m=location.hash.match(/^#add=(.+)$/);if(!m||!S)return;
  history.replaceState(null,'',location.pathname+location.search);
  let g;try{g=JSON.parse(decodeURIComponent(m[1]))}catch(e){return toast('Could not read what the bookmark sent')}
  if(g.option&&g.option!==g.name)g.name=g.option;   // the size or option picked on the page
  const det=specDetails(g.specs,g.name),now=new Date().toISOString();
  const specTxt=Object.entries(g.specs||{}).map(([k,v])=>k+': '+v).join('\n');
  const same=S.materials.find(x=>x.url&&g.url&&x.url.split('#')[0]===g.url);
  const info={price:+g.price||0,checked:now,src:(g.host||'')+(g.sku?' · '+g.sku:'')};
  if(same){
    // a material you already have from this page: open it with the new price, for you to save
    if(Math.abs((+same.price||0)-info.price)>0.004&&+same.price>0)Object.assign(info,{prevPrice:+same.price,priceMoved:now,updated:now});
    if(g.image&&!same.image)info.image=g.image;gotoTab('prices');openMatDlg(same.id,info);toast(info.price?'New price from the page: '+money(info.price)+'. Press Save to keep it.':'No price found on that page.');
  }else{
    gotoTab('prices');
    openMatDlg(null,{image:g.image||'',name:(g.name||'').trim(),url:g.url,unit:det.roll?'roll':'each',kind:kindGuess(g.name,det),...det,...info,specs:g.specs,notes:specTxt?'From the store page:\n'+specTxt:''});
    toast('Read from '+(g.host||'the page')+'. Check it over, then Save.');
  }
}
addEventListener('hashchange',takeGrab);
const BOOKMARK_TIP=' Or open the page and click your "Add to Fence Builder" bookmark (see "Add from Premier 1 or any store page" on the Materials page).';
const sameHost=(u,h)=>u.hostname.replace(/^www\./,'').toLowerCase()===h.replace(/^www\./,'').toLowerCase();
const shortName=st=>st.name.replace(/\s*\(.*\)$/,'');
// Stores built on Shopify (kencove.com is one) publish each product as data at /products/<name>.js.
// That is read straight from this browser. For a store in the list (Kencove, your own shop) a problem is
// reported; for any other store null is returned, and the price is asked through the server instead.
async function shopLookup(url,known){
  let u;try{u=new URL(url)}catch(e){return null}
  const name=known?shortName(known):u.hostname.replace(/^www\./,'');
  const m=u.pathname.match(/\/products\/([^\/?#]+)/);
  if(!m){if(known)throw Error('That '+name+' link is not a product page. Open the product, pick the size, and copy the link from there.'+BOOKMARK_TIP);return null}
  let r;try{r=await storeFetch(u.origin+'/products/'+m[1].replace(/\.js(on)?$/,'')+'.js',{},1000)}
  catch(e){if(known)throw Error('Could not reach '+name+'. Check the internet connection.'+BOOKMARK_TIP);return null}
  if(!r.ok){if(!known)return null;
    throw Error(r.status===429?name+' is busy (too many price checks). Try again in a few minutes.'+BOOKMARK_TIP:r.status===404?name+' does not have that product any more, so the link may be old.'+BOOKMARK_TIP:name+' answered with error '+r.status+'.'+BOOKMARK_TIP)}
  let d=null;try{d=await r.json()}catch(e){}
  if(!d||!Array.isArray(d.variants)||!d.variants.length){if(known)throw Error('No price found for that product at '+name+'.'+BOOKMARK_TIP);return null}
  const vid=u.searchParams.get('variant'),v=d.variants.find(x=>String(x.id)===vid)||d.variants[0],vt=v.title&&v.title!=='Default Title'?v.title:'';
  return {price:v.price/100,name:d.title+(vt?', '+vt:''),sku:v.sku||'',source:u.hostname.replace(/^www\./,''),options:d.variants.length,image:imgOf(v.featured_image)||imgOf(d.featured_image)||imgOf((d.images||[])[0]),...shopParse(d.title,vt)};
}
// The price (and details) for a store link. D&B Supply and Kencove (and your own Shopify shop) are asked
// straight from this browser. Only links to other stores are read through the Fence Builder server (api/price).
async function lookupLink(url){
  let u;try{u=new URL(url)}catch(e){throw Error('That does not look like a web link. Paste the whole address of the product page.')}
  if(PEOPLE_ONLY.test(u.hostname))throw Error('This store only lets people see its pages, so the app cannot read it. Open the page and click your "Add to Fence Builder" bookmark instead.');
  // a product page on D&B Supply (or another Adobe Commerce store in the list): ask the store for that one product
  const mag=STORES.find(x=>x.kind==='magento'&&sameHost(u,x.host));
  if(mag){
    const name=shortName(mag),key=u.pathname.split('/').filter(Boolean).pop()?.replace(/\.html?$/,'');
    if(!key)throw Error('That '+name+' link is not a product page. Open the product and copy the link from there.'+BOOKMARK_TIP);
    let it;try{it=(await magApi(mag.host,'key',{uid:key})).items[0]}catch(e){throw Error('Could not reach '+name+'. '+(e.message||'')+BOOKMARK_TIP)}
    if(!it||!it.price)throw Error('No price found for that product at '+name+'.'+BOOKMARK_TIP);
    return {price:+it.price,name:it.name,sku:it.sku,image:it.image||'',source:mag.host.replace(/^www\./,''),...shopParse(it.name,'')};
  }
  const sh=await shopLookup(url,storeList().find(x=>x.kind==='shopify'&&sameHost(u,x.host)));if(sh)return sh;
  // any other store: the server reads the page (stores don't let other websites read their pages)
  const r=await fetch('api/price?url='+encodeURIComponent(url));
  let j={};try{j=await r.json()}catch(e){throw Error('Price links need the Fence Builder server running.'+BOOKMARK_TIP)}
  if(!r.ok||!j.price)throw Error((j.error||'No price found on that page.').replace(/([^.])$/,'$1.')+BOOKMARK_TIP);
  return {price:j.price,name:(j.title||'').split(/\s[|–-]\s/)[0].trim(),source:j.source};
}
// fill in details the store gave us, without overwriting anything you typed
function applyLookup(m,j){
  const now=new Date().toISOString();
  if(Math.abs((+m.price||0)-(+j.price||0))>0.004&&+m.price>0){m.prevPrice=+m.price;m.priceMoved=now;m.updated=now}
  m.price=j.price;m.checked=now;m.src=j.source+(j.sku?' · '+j.sku:'');
  for(const k of ['roll','gauge','height','len','image'])if(j[k]!=null&&j[k]!==''&&(m[k]==null||m[k]===''))m[k]=j[k];
  // the roll length in the store's product option (like "660-ft") is what you buy, so it wins over a wrong saved one
  if(+j.roll>0&&j.rollSure&&+m.roll!==+j.roll){m.rollWas=+m.roll||null;m.roll=+j.roll;m.updated=now}
  if(j.roll&&!m.kind)m.kind='wire';
}
/* ---------- automatic price updates from the stores ---------- */
// Runs in the app window (Kencove only answers a browser). When the app opens and then every hour,
// if the last run is older than your setting, every material with a store link is checked again.
const AUTO_EVERY={day:20*3600e3,week:6.5*86400e3,off:0};
let autoBusy=false;
async function autoPrices(manual){
  if(autoBusy||!S)return;
  const every=AUTO_EVERY[S.settings.autoPrices??'day'];
  if(!manual){if(!every||!serverOK||document.hidden||netDown||navigator.onLine===false)return;
    const last=Date.parse(S.settings.priceRunAt||0)||0;if(Date.now()-last<every)return;
    if(document.querySelector('dialog[open]')||mode!=='idle')return;}   // not while you are editing something
  const isPO=m=>{try{return PEOPLE_ONLY.test(new URL(m.url).hostname)}catch(e){return false}};
  const ms=S.materials.filter(m=>/^https?:\/\//i.test(m.url||'')&&!isPO(m)),po=S.materials.filter(m=>m.url&&isPO(m)).length;
  if(!ms.length){if(manual)toast('No materials have store links yet');return}
  autoBusy=true;S.settings.priceRunAt=new Date().toISOString();save();   // claim the run so another open window skips it
  if(manual)toast('Checking '+ms.length+' store prices…');
  const moved=[],failed=[];
  for(const m0 of ms){
    try{
      const j=await lookupLink(m0.url);
      const m=matOf(m0.id);if(!m)continue;   // deleted meanwhile
      const before=+m.price||0;applyLookup(m,j);delete errs[m.id];
      if(Math.abs(before-(+m.price||0))>0.004)moved.push({name:m.name,from:before,to:+m.price});
    }catch(e){failed.push(m0.name);errs[m0.id]=e.message||String(e)}
    await new Promise(r=>setTimeout(r,400));   // go easy on the stores
  }
  S.settings.priceRun={at:new Date().toISOString(),checked:ms.length,moved:moved.length,failed:failed.length,byHand:po,list:moved.slice(0,30)};
  autoBusy=false;changed();
  if(moved.length)toast(moved.length+' store price'+(moved.length>1?'s':'')+' changed: '+moved.slice(0,3).map(x=>x.name.slice(0,28)+' '+money(x.from)+' → '+money(x.to)).join('; ')+(moved.length>3?'…':''));
  else if(manual)toast('Checked '+ms.length+' prices. None changed'+(failed.length?', '+failed.length+' could not be read':'')+'.');
}
async function fetchPrice(id,quiet){
  const m=S.materials.find(x=>x.id===id);if(!m)return;
  if(!m.url){errs[id]='Paste a product link first';return renderPanel()}
  busy[id]=1;delete errs[id];renderPanel();
  try{const j=await lookupLink(m.url);applyLookup(m,j);if(!quiet)toast(m.name+' is now '+money(j.price))}
  catch(e){errs[id]=e.message||String(e)}
  delete busy[id];changed();
}
async function addFromLink(){
  const url=(await askText('Paste the product link (for example a kencove.com product page).\nPick the size or length on the store page first, so the link has the right option.')||'').trim();if(!url)return;
  toast('Reading that page…');
  try{
    const j=await lookupLink(url);
    const m={name:j.name||'',unit:j.roll?'roll':'each',price:0,url};applyLookup(m,j);if(!m.kind)m.kind=kindGuess(m.name,j);
    openMatDlg(null,m);   // check it over, then Save adds it
  }catch(e){toast(e.message||'Could not read that page')}
}
