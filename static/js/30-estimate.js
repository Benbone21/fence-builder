/* ---------- geometry ---------- */
const ll=p=>L.latLng(p.lat,p.lng);
const key=p=>p.lat.toFixed(6)+','+p.lng.toFixed(6);
const geomKey=l=>l.pts.map(key).join('|');
// the ground a closed fence line (its last point back on its first) goes around, in square feet; 0 for an open line
function loopSqFt(l){
  const p=l.pts||[];if(p.length<4||key(p[0])!==key(p[p.length-1]))return 0;
  const lat0=p[0].lat,lng0=p[0].lng,kx=111320*Math.cos(lat0*Math.PI/180),ky=110574,X=q=>(q.lng-lng0)*kx,Y=q=>(q.lat-lat0)*ky;
  let s=0;for(let i=1;i<p.length;i++)s+=X(p[i-1])*Y(p[i])-X(p[i])*Y(p[i-1]);
  return Math.abs(s)/2*10.7639104;   // square meters to square feet
}
// the middle of the ground inside a closed line, for its label on the map
function loopMiddle(l){
  const p=l.pts,lat0=p[0].lat,lng0=p[0].lng;let a=0,cx=0,cy=0;
  for(let i=1;i<p.length;i++){const x0=p[i-1].lng-lng0,y0=p[i-1].lat-lat0,x1=p[i].lng-lng0,y1=p[i].lat-lat0,c=x0*y1-x1*y0;a+=c;cx+=(x0+x1)*c;cy+=(y0+y1)*c}
  return a?{lat:lat0+cy/(3*a),lng:lng0+cx/(3*a)}:p[0];
}
const sqftAcres=sf=>{const ac=sf/43560;return ac>=100?Math.round(ac).toLocaleString('en-US'):ac.toFixed(ac>=10?1:2)};
const fmtAcres=sf=>sqftAcres(sf)+(Math.abs(sf/43560-1)<0.005?' acre':' acres');
const fmtSqFt=sf=>Math.round(sf).toLocaleString('en-US')+' sq ft';
// stored ground heights for a line: evOf only when they match the line as it is now (used for pricing),
// evAny also returns the last good ones from before the line was moved (shown while new ones load)
// EV is the newest way of working the numbers out. Older (v2) numbers still count, so a copy of the app
// still running the old version on another computer doesn't make the two keep redoing each other's work;
// this copy just redoes them once (see ensureElev).
const EV=3;
const evOf=l=>l.elev&&l.elev.v>=2&&l.elev.key===geomKey(l)?l.elev:null;
const evAny=l=>l.elev&&Array.isArray(l.elev.prof)&&isFinite(l.elev.surface)?l.elev:null;
const rad=d=>d*Math.PI/180;
function bearing(a,b){const f1=rad(a.lat),f2=rad(b.lat),dl=rad(b.lng-a.lng);return Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl))*180/Math.PI}
function deflect(a,b,c){let d=Math.abs(bearing(b,c)-bearing(a,b))%360;return d>180?360-d:d}
function flatLen(pts){let s=0;for(let i=1;i<pts.length;i++)s+=ll(pts[i-1]).distanceTo(ll(pts[i]));return s*FT}

/* ---------- quantity formulas ---------- */
const fnCache={};
const VARS=['L','W','roll','spacing','strands','waste','posts','tposts','woodposts','sections','pulls','lines','gates','braces'];
// A formula is read as plain arithmetic, never run as code: numbers, the names above, + - * / % **, brackets,
// commas, and ceil floor round max min (or Math.something). It gives the same answer JavaScript would (++ and --
// are not allowed: in a formula they could only be a typing mistake).
const QFN={ceil:Math.ceil,floor:Math.floor,round:Math.round,max:Math.max,min:Math.min};
function compileQ(expr){
  const t=expr.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|\*\*|\+\+|--|\S/gi)||[];
  let i=0;const peek=()=>t[i],bad=()=>{throw Error('bad')},need=x=>{if(t[i++]!==x)bad()};
  const seq=()=>{let f=add();while(peek()===','){i++;const a=f,b=add();f=v=>(a(v),b(v))}return f};
  const add=()=>{let f=mul();for(let o;(o=peek())==='+'||o==='-';){i++;const a=f,b=mul();f=o==='+'?v=>a(v)+b(v):v=>a(v)-b(v)}return f};
  const mul=()=>{let f=expo();for(let o;(o=peek())==='*'||o==='/'||o==='%';){i++;const a=f,b=expo();f=o==='*'?v=>a(v)*b(v):o==='/'?v=>a(v)/b(v):v=>a(v)%b(v)}return f};
  const unary=()=>{const o=t[i++],a=peek()==='-'||peek()==='+'?unary():prim();return o==='-'?v=>-a(v):v=>+a(v)};
  const expo=()=>{if(peek()==='-'||peek()==='+'){const f=unary();if(peek()==='**')bad();return f}
    const a=prim();if(peek()!=='**')return a;i++;const b=expo();return v=>a(v)**b(v)};
  const prim=()=>{const x=t[i++];let f;
    if(x==='('){f=seq();need(')')}
    else if(/^[\d.]/.test(x||'')){const n=Number(x);if(isNaN(n))bad();f=()=>n}
    else if(/^[A-Za-z_]/.test(x||'')){if(x.startsWith('Math.')){const m=Math[x.slice(5)];f=()=>m}else if(QFN[x]){const q=QFN[x];f=()=>q}else if(VARS.includes(x))f=v=>v[x];else bad()}
    else bad();
    while(peek()==='('){i++;const args=[];while(peek()!==')'){args.push(add());if(peek()===',')i++;else break}need(')');
      const g=f;f=v=>{const fn=g(v);if(typeof fn!=='function')bad();return fn(...args.map(h=>h(v)))}}
    return f};
  const f=seq();if(i<t.length)bad();return f;
}
function evalQ(expr,vars){
  expr=String(expr??'').trim()||'0';
  if(!/^[\w\s+\-*/().,%]*$/.test(expr))throw Error('bad');
  const f=fnCache[expr]||(fnCache[expr]=compileQ(expr));
  const v=f(vars);
  if(typeof v!=='number'||!isFinite(v))throw Error('bad');
  return Math.max(0,v);
}

/* ---------- the estimate ---------- */
function analyze(proj){
  const st=S.settings, kitById=Object.fromEntries(S.braces.map(b=>[b.id,b])), matById=Object.fromEntries(S.materials.map(m=>[m.id,m]));
  const typeOf=id=>S.fenceTypes.find(x=>x.id===id)||S.fenceTypes[0];
  const plines=proj.lines.filter(l=>l.pts.length>=2);
  const nodes=new Map();
  for(const l of plines){const n=l.pts.length;l.pts.forEach((p,i)=>{const k=key(p);let o=nodes.get(k);if(!o)nodes.set(k,o={refs:[],ends:0,explicit:null,pt:p});o.refs.push({l,i});if(i===0||i===n-1)o.ends++;if(p.brace!=null&&o.explicit==null){o.explicit=p.brace;o.pt=p}})}
  for(const o of nodes.values()){
    let corner=o.refs.length>1;
    for(const {l,i} of o.refs){const p=l.pts;if(i>0&&i<p.length-1&&deflect(p[i-1],p[i],p[i+1])>1)corner=true}   // fences are straight runs: any jog or bend is a corner and gets a brace
    const t=o.t=typeOf(o.refs[0].l.type);
    // "Brace at every click" (on to start): every point you clicked on a line gets a brace, not just ends and corners
    const every=!corner&&!o.ends;   // a point you clicked on a straight run is a brace too
    o.role=corner?'Corner':o.ends?'End':every?'Brace':'Line';
    // a point right beside a gate opening (from drawing a gate with G) is the gate's post
    if(o.refs.some(({l,i})=>l.pts[i-1]?.brace==='gate'||l.pts[i+1]?.brace==='gate'))o.role='Gate post';
    o.auto=corner?(t?.braceCorner||'none'):o.ends?(t?.braceEnd||'none'):every?([t?.bracePull,t?.braceCorner,t?.braceEnd].find(b=>b&&b!=='none')||'none'):'none';
    o.brace=o.explicit??o.auto;
  }
  const types={},lines=[];
  const TT=t=>types[t.id]||(types[t.id]={t,L:0,posts:0,wood:0,tposts:0,sections:0,pulls:0,lines:0,kits:0,gates:0,kitBy:{},parts:[],other:(t.posts||[]).map(()=>0)});
  // how far a brace reaches into the fence from its main post: its outer post is where the line posts start counting.
  // A Rance brace ends in a short ground post that doesn't hold the wire, so its line posts
  // count from the main post, the same as a single post.
  const reachOf=id=>{const b=kitById[id];if(!b)return 0;const sh=braceShape(b);if(['single','a','aa'].includes(sh.style))return 0;return Math.max(1,+sh.span||8)*Math.max(1,Math.round(+sh.bays||1))};
  const endKit=(k,t)=>{const b=nodes.get(k)?.brace;return b==='gate'?t.braceGate:b&&b!=='none'?b:null};
  // how many line posts fit in a gap: closest to the spacing, never wider than it, or never closer than it
  const postsIn=(len,sp,fit)=>Math.max(0,(fit==='tight'?Math.ceil(len/sp-1e-9):fit==='wide'?Math.floor(len/sp+1e-9):Math.round(len/sp))-1);
  function tally(l,t,secs,o,keys){
    const sp=Math.max(1,+t.spacing||12),pe=pullLimit(t),slack=(t.pullSlack==null?15:Math.max(0,+t.pullSlack||0))/100,other=(t.posts||[]).map(()=>0);
    let posts=0,wood=0,pulls=0;
    const stretches=[];
    secs.forEach((s,si)=>{
      // items: every post and pull brace in the stretch, as a fraction of the way along it.
      // k is -1 for a normal line post, 0+ for one of the added posts, 'p' for a pull brace.
      const kk=keys?.[si],cust=kk&&l.cust?.[kk];let items;
      // the braces at each end of this stretch take up some of it; line posts are spaced between their outer posts
      const [ka,kb]=(kk||'>').split('>'),rp=reachOf(t.bracePull);
      let ra=reachOf(endKit(ka,t)),rb=reachOf(endKit(kb,t));if(ra+rb>s*0.9){const k=s*0.9/(ra+rb||1);ra*=k;rb*=k}
      if(Array.isArray(cust))items=cust.map(x=>({f:Math.min(1,Math.max(0,+x.f||0)),k:x.k==='p'?'p':(+x.k>=0&&t.posts?.[+x.k]?+x.k:-1)}));
      else{
        // automatic: a run longer than the stretch limit (plus the allowed run-over) gets pull braces,
        // then posts are spread evenly inside each stretch
        items=[];const cuts=[];
        if(pe>0&&s>pe*(1+slack)){
          if(t.pullMode==='full'){const nf=Math.floor(s/pe);for(let i=1;i<=nf;i++)cuts.push(i*pe/s);if(s-nf*pe<Math.max(1,pe*slack))cuts.pop()}
          else{const parts=Math.ceil(s/(pe*(1+slack)));for(let i=1;i<parts;i++)cuts.push(i/parts)}
        }
        const bs=[0,...cuts,1];
        for(let q=0;q<bs.length-1;q++){
          // from the outer post of the brace at one end to the outer post of the brace at the other
          const a=s*bs[q]+(q===0?ra:Math.min(rp,s*(bs[q+1]-bs[q])*0.45)),b=s*bs[q+1]-(q===bs.length-2?rb:Math.min(rp,s*(bs[q+1]-bs[q])*0.45));
          const Lq=Math.max(0,b-a),n=postsIn(Lq,sp,t.postFit),gap=Lq/(n+1);
          if(q)items.push({f:bs[q],k:'p'});for(let j=1;j<=n;j++)items.push({f:(a+gap*j)/s,k:postRule(t,j,gap,n)})}
      }
      // gaps between posts, counted from each brace's outer post (and around pull braces the same way)
      let last=ra/s,gmin=Infinity,gmax=0,np=0;
      for(const it of items){if(it.k==='p'){const g=(it.f-last)*s-rp;gmin=Math.min(gmin,g);gmax=Math.max(gmax,g);last=it.f+rp/s;pulls++;continue}
        const g=(it.f-last)*s;last=it.f;gmin=Math.min(gmin,g);gmax=Math.max(gmax,g);posts++;np++;if(it.k>=0){other[it.k]++;wood++}}
      if(items.length){const g=(1-rb/s-last)*s;gmin=Math.min(gmin,g);gmax=Math.max(gmax,g)}
      // posts set "in between each post": that many in every gap, brace to post and post to post
      (t.posts||[]).forEach((r,i)=>{if(r.by==='between'&&+r.n>0)other[i]+=Math.round(+r.n)*(np+items.filter(x=>x.k==='p').length+1)});
      stretches.push({len:s,key:kk,items,custom:Array.isArray(cust),n:np,gmin,gmax,mids:midPosts(t,items,ra/s,1-rb/s,rp/s)});
    });
    const len=secs.reduce((a,b)=>a+b,0);
    lines.push({l,t,...o,len,posts,wood,other,tposts:posts-wood,pulls,sections:secs.length+pulls,stretches,area:loopSqFt(l)});
    // every stretch of wire (brace to brace, split at pull braces) on this line
    for(const st of stretches){const bs=[0,...st.items.filter(x=>x.k==='p').map(x=>x.f),1];for(let q=0;q<bs.length-1;q++){const pl=st.len*(bs[q+1]-bs[q]);if(pl>0)TT(t).parts.push(pl)}}
    const T=TT(t);T.L+=len;T.posts+=posts;T.wood+=wood;T.tposts+=posts-wood;T.sections+=secs.length+pulls;T.pulls+=pulls;T.lines++;other.forEach((n,i)=>T.other[i]=(T.other[i]||0)+n);
  }
  for(const l of plines){
    const t=typeOf(l.type);if(!t)continue;
    const flat=flatLen(l.pts), ev=evOf(l);
    const scale=st.useSurface&&ev&&ev.flat>0?ev.surface/ev.flat:1;
    const secs=[],keys=[];let cur=0,gateW=0,from=0;
    for(let i=0;i<l.pts.length;i++){
      if(i)cur+=ll(l.pts[i-1]).distanceTo(ll(l.pts[i]))*FT*scale;
      const o=nodes.get(key(l.pts[i]));const g=o.brace==='gate'?Math.max(0,+o.pt.gw||0):0;gateW+=g/2*(i===0||i===l.pts.length-1?1:2);
      if(i===0){cur=-g/2;continue}
      if(i===l.pts.length-1||o.brace!=='none'){secs.push(Math.max(0,cur-g/2));keys.push(key(l.pts[from])+'>'+key(l.pts[i]));from=i;cur=-g/2}
    }
    tally(l,t,secs,{flat,ev,gateW},keys);
  }
  // runs typed in by length: evenly split between ends, corners and gates
  const extraKits=[],extraGates=[];
  for(const l of proj.lines.filter(l=>l.manual)){
    const t=typeOf(l.type);if(!t)continue;
    const total=Math.max(0,+l.len||0),nC=Math.max(0,Math.floor(+l.corners||0)),nG=Math.max(0,Math.floor(+l.gates||0));
    const gateW=Math.min(total,nG*(+t.gateW||16)),nSec=(l.closed?Math.max(1,nC):nC+1)+nG;
    tally(l,t,new Array(nSec).fill((total-gateW)/nSec),{flat:total,ev:null,gateW,manual:true});
    if(!l.closed)extraKits.push([t,t.braceEnd,2]);
    extraKits.push([t,t.braceCorner,nC],[t,t.braceGate,2*nG]);
    if(nG)extraGates.push([t,l.gm||t.gateM,nG]);
  }
  const bill=new Map();
  const add=(mid,q,grp,why)=>{if(!q||!matById[mid])return;const b=bill.get(mid)||{m:matById[mid],q:0,grp,why:[],by:{}};b.q+=q;b.by[grp]=(b.by[grp]||0)+q;if(why)b.why.push([why,q]);bill.set(mid,b)};
  // braces and gates first, so extras "per brace" and "per gate" know the counts
  const kits={};const addKit=(t,id,n)=>{if(kitById[id]&&n>0){kits[id]=(kits[id]||0)+n;const T=TT(t);T.kits+=n;T.kitBy[id]=(T.kitBy[id]||0)+n}};
  let gates=0;
  for(const o of nodes.values()){
    const t=o.t;if(!t)continue;
    if(o.brace==='gate'){gates++;TT(t).gates++;addKit(t,t.braceGate,2);add(o.pt.gm||t.gateM,1,'Gates','gate');add(t.gateHw,1,'Gates','hardware for a gate')}
    else if(o.brace!=='none')addKit(t,o.brace,1);
  }
  for(const [t,id,n] of extraKits)addKit(t,id,n);
  for(const [t,m,n] of extraGates){gates+=n;TT(t).gates+=n;add(m,n,'Gates','gate');add(t.gateHw,n,'Gates','hardware for a gate')}
  for(const T of Object.values(types))addKit(T.t,T.t.bracePull,T.pulls);
  for(const [id,n] of Object.entries(kits))for(const it of kitById[id].items)add(it.m,(+it.q||0)*n,'Braces',`${+it.q||0} each for ${n} ${kitById[id].name}`);
  // what each fence type takes
  const bad={};let labor=0;
  for(const T of Object.values(types)){
    const t=T.t,W=1+(+t.waste||0)/100,q={wires:[],left:[],extras:[],items:[]};T.q=q;
    // rows of the same wire (like barbed wire at 22" and 28" and again at 40") are added together before rounding to rolls
    const sameM={},doneM=new Set();for(const w of t.wires||[])if(wireSizes(w).length<=1)sameM[w.m]=(sameM[w.m]||0)+(+w.strands||0);
    for(const w of t.wires||[]){
      const sizes=wireSizes(w);
      if(sizes.length>1){
        // other roll sizes of this wire are set: full rolls of the main size, then the cheapest way to finish
        const st=Math.max(0,Math.round(+w.strands||0)),used=T.L*W*st,plan=rollPlan(w,used),cnt=sizes.map(z=>plan.filter(x=>x.m===z.m).length);
        const bought=plan.reduce((a,z)=>a+z.roll,0),left=Math.max(0,bought-used),first=cnt.findIndex(c=>c>0);
        sizes.forEach((z,j)=>{if(cnt[j])add(z.m,cnt[j],t.name,`${fmtQ(z.roll)} ft rolls ${j===0?'laid end to end':'to finish the end'} for ${st} strand${st===1?'':'s'} along ${fmtFt(T.L)} (${fmtQ(Math.round(used))} ft of wire with extra${j===first?leftNote(left):''})`)});
        q.wires.push(cnt[0]);q.left.push({m:w.m,used,bought,left,roll:sizes[0].roll,mix:sizes.map((z,j)=>cnt[j]?`${cnt[j]} × ${fmtQ(z.roll)} ft`:'').filter(Boolean).join(' + ')});continue;
      }
      if(doneM.has(w.m)){q.wires.push(null);q.left.push(null);continue}   // counted with the first row of this wire
      doneM.add(w.m);const stn=sameM[w.m]??(+w.strands||0);
      const ft=T.L*stn*W,rl=rollOf(w),n=rl>0?Math.ceil(ft/rl-1e-9):ft,left=rl>0?Math.max(0,n*rl-ft):0;add(w.m,n,t.name,`${stn} strand${stn===1?'':'s'} along ${fmtFt(T.L)}${rl>0?` (${fmtQ(Math.round(ft))} ft of wire with extra, ${fmtQ(rl)} ft rolls${leftNote(left)})`:''}`);q.wires.push(n);q.left.push(rl>0?{m:w.m,used:ft,bought:n*rl,left,roll:rl}:null)}
    add(t.postM,T.tposts,t.name,`line posts every ${+t.spacing||12} ft`);(t.posts||[]).forEach((r,i)=>add(r.m,T.other[i]||0,t.name,postHow(r)));
    q.clips=T.tposts*(+t.clipsPer||0);add(t.clipM,q.clips,t.name,`${+t.clipsPer||0} per line post`);
    const per={ft:T.L,post:T.posts,tpost:T.tposts,woodpost:T.wood,stretch:T.sections,brace:T.kits,gate:T.gates,line:T.lines,job:1};
    for(const e of t.extras||[]){const n=(+e.q||0)*(per[e.per]??0);add(e.m,n,t.name,`${+e.q||0} ${(PER.find(x=>x[0]===e.per)||['',''])[1]}`);q.extras.push(n)}
    const vars={L:T.L,W,roll:+t.roll||mainRoll(t)||1,spacing:+t.spacing||1,strands:+t.strands||0,waste:+t.waste||0,posts:T.posts,tposts:T.tposts,woodposts:T.wood,sections:T.sections,pulls:T.pulls,lines:T.lines,gates:T.gates,braces:T.kits};
    q.items=(t.items||[]).map((it,i)=>{try{const n=evalQ(it.q,vars);add(it.m,n,t.name,'formula: '+it.q);return n}catch(e){bad[t.id+':'+i]=1;return null}});
  }
  const order=g=>g==='Braces'?1:g==='Gates'?2:0;
  const jp=proj.prices||{};
  const rows=[...bill.values()].map(b=>{const q=roundQ(b.q,b.m.unit),base=+b.m.price||0,has=jp[b.m.id]!=null&&+jp[b.m.id]!==base,price=has?+jp[b.m.id]||0:base;return{...b,q,base,price,custom:has,cost:q*price}}).sort((a,b)=>order(a.grp)-order(b.grp)||a.grp.localeCompare(b.grp));
  const totalFt=lines.reduce((a,r)=>a+r.len,0), sub=rows.reduce((a,r)=>a+r.cost,0);
  const tax=sub*(+st.tax||0)/100;
  // ---- labor: each fence type's feet x its labor $ per foot; headache and fees are set on this job's Final bill ----
  const lab={site:+proj.site||0,byType:[]};
  for(const T of Object.values(types)){const rate=+T.t.labor||0;if(T.L>0)lab.byType.push({t:T.t,ft:T.L,rate,cost:T.L*rate})}
  // each brace's labor charge, times how many of that brace the job has
  lab.byBrace=Object.entries(kits).map(([id,n])=>({b:kitById[id],n,rate:+kitById[id]?.labor||0})).filter(x=>x.b&&x.n>0).map(x=>({...x,cost:x.n*x.rate}));
  lab.base=lab.byType.reduce((a,x)=>a+x.cost,0)+lab.byBrace.reduce((a,x)=>a+x.cost,0);lab.siteHead=lab.base*lab.site/100;lab.figured=lab.base+lab.siteHead;
  lab.override=proj.laborTotal!=null&&proj.laborTotal!==''?Math.max(0,+proj.laborTotal||0):null;
  lab.cost=lab.override??lab.figured;
  // headache charges on fussy materials, set per material on this job
  const hd=proj.headache||{};
  lab.matHeadRows=rows.filter(r=>+hd[r.m.id]>0).map(r=>({id:r.m.id,name:r.m.name,q:r.q,unit:r.m.unit,each:+hd[r.m.id],cost:r.q*(+hd[r.m.id])}));
  lab.matHead=lab.matHeadRows.reduce((a,x)=>a+x.cost,0);
  // other fees on this job: travel, permits, rough ground, anything
  lab.fees=(proj.fees||[]).filter(f=>+f.amount);lab.feeTotal=lab.fees.reduce((a,f)=>a+(+f.amount||0),0);
  const extra=lab.cost+lab.matHead+lab.feeTotal;
  const area=lines.reduce((a,r)=>a+(r.area||0),0);   // square feet inside closed fence lines
  return {nodes,lines,types,kits,kitById,gates,rows,bad,totalFt,area,sub,tax,labor:lab.cost,lab,total:sub+tax+extra};
}

