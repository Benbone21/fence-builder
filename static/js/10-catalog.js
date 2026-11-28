/* ---------- starting catalog (sample prices, replace with yours) ---------- */
function typeBase(){return {color:'#ffffff',height:4.5,waste:3,laborHrs100:2.5,gateHrs:1.5,headache:0,laborMode:'hours',laborPost:0,laborBrace:0,laborGate:0,laborJob:0,wires:[],postM:'m_tpost',spacing:12,posts:[],clipM:'m_clip',clipsPer:0,pullEvery:660,pullBy:'auto',pullSlack:15,pullMode:'even',
  braceEnd:'b_h',braceCorner:'b_dh',bracePull:'b_h',braceGate:'b_h',gateM:'m_gate16',gateW:16,gateHw:'m_ghw',labor:0,extras:[],items:[]}}
/* fence types saved before the fence type form existed were lists of formulas */
const OLD_ITEMS={ft_fk:'[{"m":"m_fk","q":"ceil(L*W/roll)"},{"m":"m_barb","q":"ceil(L*strands*W/1320)"},{"m":"m_tpost","q":"tposts"},{"m":"m_clip","q":"tposts*(5+strands)"},{"m":"m_wpost","q":"woodposts"}]',
  ft_barb:'[{"m":"m_barb","q":"ceil(L*strands*W/roll)"},{"m":"m_tpost","q":"tposts"},{"m":"m_clip","q":"tposts*strands"},{"m":"m_wpost","q":"woodposts"}]',
  ft_field:'[{"m":"m_field","q":"ceil(L*W/roll)"},{"m":"m_barb","q":"ceil(L*strands*W/1320)"},{"m":"m_tpost","q":"tposts"},{"m":"m_clip","q":"tposts*(5+strands)"},{"m":"m_wpost","q":"woodposts"}]',
  ft_ht:'[{"m":"m_ht","q":"ceil(L*strands*W/roll)"},{"m":"m_tpost","q":"tposts"},{"m":"m_ins","q":"tposts*strands"},{"m":"m_strain","q":"sections*strands"},{"m":"m_energ","q":"1"}]'};
// Which added post (if any) takes spot j out of the n evenly spaced posts in a stretch; -1 means the normal line post.
// Added posts keep their own spacing through the middle of the stretch and the leftover is split
// evenly between the two ends, so the fence looks the same from either end.
const matOf=id=>S.materials.find(m=>m.id===id);
const rollOf=w=>{const m=matOf(w.m);return m&&m.roll!=null&&m.roll!==''?+m.roll||0:+w.roll||0};
const mainRoll=t=>{for(const w of t.wires||[]){const r=rollOf(w);if(r>0)return r}return 0};
// longest stretch of wire pulled in one go: a set length, or two rolls of the main wire joined
// How far one pull of each kind of wire normally goes. A wire's own "longest stretch" (Materials) overrides it.
const wireLook=m=>m?.look||(m?.kind==='rail'?'rail':m?.kind==='board'||/boards?|plank|[12]x[468]/i.test(m?.name||'')?'board':/woven|field|mesh|knot|net|hinge|panel|no.?climb/i.test(m?.name||'')?'mesh':/barb/i.test(m?.name||'')?'barbed':'smooth');
const PULL_USUAL={mesh:660,barbed:1320,smooth:2640,chain:500,board:0,picket:0,rail:0,log:0,panel:0};   // boards: no pull braces
const wirePull=m=>m&&m.maxPull!=null&&m.maxPull!==''?+m.maxPull||0:PULL_USUAL[wireLook(m)];
// automatic: the shortest of the fence type's wires decides, since they are all stretched between the same braces
function autoPull(t){let best=0;for(const w of t.wires||[]){const m=matOf(w.m);if(!m||!(+w.strands>0))continue;const v=wirePull(m);if(v>0&&(!best||v<best))best=v}return best||(+t.pullEvery||0)}   // no usable wire: fall back to the type's own number
const pullLimit=t=>t.pullBy==='ft'?(+t.pullEvery||0):t.pullBy==='roll2'?2*mainRoll(t):autoPull(t);
// where the "in between each post" posts go in a stretch (fractions of it), spread evenly in every gap:
// brace to post, post to post, and either side of a pull brace. [{f, i}] with i the post row
function midPosts(t,items,start,end,rpf){
  const slots=[];(t.posts||[]).forEach((r,i)=>{if(r.by==='between'&&+r.n>0)for(let k=0;k<Math.round(+r.n);k++)slots.push(i)});
  if(!slots.length)return [];
  const out=[],gap=(a,b)=>{if(b<=a)return;slots.forEach((i,k)=>out.push({f:a+(b-a)*(k+1)/(slots.length+1),i}))};
  let a=start;for(const it of items){if(it.k==='p'){gap(a,it.f-rpf);a=it.f+rpf}else{gap(a,it.f);a=it.f}}gap(a,end);
  return out;
}
const postHow=r=>r.by==='between'?`${+r.n||0} in between each post`:`every ${+r.n||0} ${r.by==='ft'?'ft':'posts'} in place of a line post`;
function postRule(t,j,gap,n){
  const rs=t.posts||[];
  for(let i=0;i<rs.length;i++){
    if(rs[i].by==='between')continue;   // added between posts, not in place of one
    const v=+rs[i].n||0;if(v<=0)continue;
    const N=rs[i].by==='ft'?Math.max(1,Math.round(v/(gap||1))):Math.floor(v);if(N<1)continue;
    if(!n){if(j%N===0)return i;continue}
    let m=Math.floor((n-1)/N)+1;                       // as many as fit at that spacing
    while(m>1&&(n+1-(m-1)*N)/2<N/3)m--;                // but not crowded up against the braces
    if((n+1)/2<N/3&&m===1)m=0;
    if(!m)continue;
    const j0=Math.round((n+1-(m-1)*N)/2),k=j-j0;
    if(k>=0&&k%N===0&&k/N<m)return i;
  }
  return -1;
}
// wire left on the rolls once the job is built (after the extra for sag and splices)
const leftNote=left=>left>=1?`, about ${fmtQ(Math.round(left))} ft left over`:', no wire left over';
// a wire and the other roll sizes it comes in, biggest first: [{m, roll, price}]
function wireSizes(w){
  const out=[],seen=new Set();
  for(const id of [w.m,...(w.alts||[])]){const m=matOf(id);if(!m||seen.has(id))continue;seen.add(id);const roll=rollOf({m:id});if(roll>0)out.push({m:id,roll,price:+m.price||0})}
  const main=out[0];return main?[main,...out.slice(1).sort((a,b)=>b.roll-a.roll)]:[];
}
// the rolls a wire is laid out from, in order: full rolls of the main size end to end (a roll carries on past braces),
// then the cheapest mix of its sizes for what's left at the end. [{m, roll}]
function rollPlan(w,need){
  const sizes=wireSizes(w);if(!sizes.length||!(need>1e-6))return [];
  const big=sizes[0],nb=Math.floor(need/big.roll+1e-9),rem=need-nb*big.roll,out=Array.from({length:nb},()=>big);
  if(rem>1e-6){const c=sizes.length>1?coverRolls(rem,sizes):[Math.ceil(rem/big.roll-1e-9)];sizes.map((z,j)=>[z,c[j]||0]).sort((a,b)=>b[0].roll-a[0].roll).forEach(([z,n])=>{for(let k=0;k<n;k++)out.push(z)})}
  return out;
}
// where each roll of the main wire (one strand) ends, in feet of fence along all fence of this type
function rollEnds(t){
  const w=(t.wires||[]).find(w=>rollOf(w)>0);if(!w)return [];
  const W=1+(+t.waste||0)/100;let a=0;return rollPlan(w,totalOfType(t)*W).map(z=>({roll:z.roll,end:(a+=z.roll)/W}));
}
// cheapest set of rolls that covers `need` feet in one piece of fence; ties go to fewer rolls
function coverRolls(need,sizes){
  const order=sizes.map((z,i)=>({...z,i})).sort((a,b)=>b.roll-a.roll),best={cost:Infinity,n:Infinity,cnt:null};
  const go=(k,left,cnt,cost,n)=>{
    if(left<=1e-6){if(cost<best.cost-1e-9||(Math.abs(cost-best.cost)<1e-9&&n<best.n))Object.assign(best,{cost,n,cnt:cnt.slice()});return}
    if(k===order.length||cost>=best.cost+1e-9)return;
    const z=order[k],max=Math.ceil(left/z.roll-1e-9);
    for(let c=(k===order.length-1?max:0);c<=max;c++){cnt[z.i]=c;go(k+1,left-c*z.roll,cnt,cost+c*(z.price||z.roll/1e6),n+c)}
    cnt[z.i]=0;
  };
  go(0,need,sizes.map(()=>0),0,0);
  return best.cnt||sizes.map((z,i)=>i===0?Math.ceil(need/z.roll-1e-9):0);
}
function migrateType(t,st){
  const r=migrateType0(t,st);
  // older saves had one "wood line post every Nth"; that is now the first row of the posts list
  if(!Array.isArray(t.posts))r.posts=(+r.woodEvery>0&&r.woodM)?[{m:r.woodM,by:'nth',n:+r.woodEvery}]:[];
  delete r.woodM;delete r.woodEvery;return r;
}
function migrateType0(t,st){
  if(Array.isArray(t.wires))return {...typeBase(),...t};
  const was={braceEnd:st.endBrace||'b_h',braceCorner:st.cornerBrace||'b_dh',bracePull:st.pullBrace||'b_h',braceGate:st.gateBrace||'b_h',gateM:st.gateMat||'m_gate16',gateW:+st.gateWidth||16,gateHw:st.gateHw??'m_ghw',labor:+st.labor||0};
  const keep={id:t.id,name:t.name,color:t.color,spacing:t.spacing,woodEvery:t.woodEvery,pullEvery:t.pullEvery,waste:t.waste};
  const d=defaults().fenceTypes.find(x=>x.id===t.id);
  if(d&&JSON.stringify(t.items)===OLD_ITEMS[t.id])return {...d,...keep,...was};
  // a type you built yourself: keep its formulas exactly, so the totals don't change
  return {...typeBase(),...keep,...was,roll:t.roll,strands:t.strands,postM:'',clipM:'',items:t.items||[]};
}
function defaults(){
  const M=(id,name,unit,price)=>({id,name,unit,price,url:'',checked:null,src:''});
  const I=(m,q)=>({m,q});
  const d={v:1,tab:'build',drawType:'ft_fk',
  settings:{tax:6,labor:0,crew:[{id:'e_1',name:'Crew lead',wage:25},{id:'e_2',name:'Hand',wage:18},{id:'e_3',name:'Hand',wage:18}],burden:15,dayHrs:8,laborDefaults:{mode:'hours',hrs100:2.5,braceHrs:2,gateHrs:1.5,perFt:0,perPost:0,perBrace:0,perGate:0,perJob:0},cornerAngle:25,useSurface:true,endBrace:'b_h',cornerBrace:'b_dh',pullBrace:'b_h',gateBrace:'b_h',gateHw:'m_ghw',gateMat:'m_gate16',gateWidth:16},
  materials:[
    M('m_fk','Fixed knot woven wire 47" (330 ft roll)','roll',420),
    M('m_field','Field fence 47" hinge joint (330 ft roll)','roll',230),
    M('m_barb','Barbed wire 12.5 ga 4-point (1,320 ft roll)','roll',95),
    M('m_ht','High-tensile smooth wire 12.5 ga (4,000 ft coil)','coil',160),
    M('m_tpost','T-post 6.5 ft','each',7.5),
    M('m_clip','T-post clip','each',0.12),
    M('m_wpost','Wood line post 5" x 7 ft','each',13),
    M('m_post','Wood brace post 6" x 8 ft','each',22),
    M('m_rail','Brace rail 4" x 8 ft','each',12),
    M('m_pin','Brace pin 3/8" x 8"','each',1.25),
    M('m_bwire','9 ga smooth brace wire','ft',0.08),
    M('m_ins','T-post insulator','each',0.45),
    M('m_strain','Inline wire strainer','each',4.5),
    M('m_energ','Fence energizer','each',260),
    M('m_gate12','Tube gate 12 ft','each',190),
    M('m_gate16','Tube gate 16 ft','each',240),
    M('m_ghw','Gate hinge and latch kit','kit',35)],
  fenceTypes:[
    {...typeBase(),id:'ft_fk',name:'Fixed knot + 1 barbed',color:'#f5c518',wires:[{m:'m_fk',strands:1,roll:330},{m:'m_barb',strands:1,roll:1320}],spacing:16,clipsPer:6,pullEvery:660},
    {...typeBase(),id:'ft_barb',name:'4-strand barbed wire',color:'#ff6a3d',wires:[{m:'m_barb',strands:4,roll:1320}],spacing:12,clipsPer:4},
    {...typeBase(),id:'ft_field',name:'Field fence + 2 barbed',color:'#3ad1c2',wires:[{m:'m_field',strands:1,roll:330},{m:'m_barb',strands:2,roll:1320}],spacing:10,posts:[{m:'m_wpost',by:'nth',n:5}],clipsPer:7},
    {...typeBase(),id:'ft_ht',name:'5-wire hi-tensile electric',color:'#c38bff',wires:[{m:'m_ht',strands:5,roll:4000}],spacing:25,clipM:'m_ins',clipsPer:5,pullEvery:2640,waste:2,extras:[{m:'m_strain',per:'stretch',q:5},{m:'m_energ',per:'job',q:1}]}],
  braces:[
    {id:'b_h',name:'H-brace',items:[I('m_post',2),I('m_rail',1),I('m_pin',2),I('m_bwire',25)]},
    {id:'b_dh',name:'Double H-brace',items:[I('m_post',3),I('m_rail',2),I('m_pin',4),I('m_bwire',50)]},
    {id:'b_n',name:'N-brace (diagonal)',items:[I('m_post',2),I('m_rail',1),I('m_pin',2),I('m_bwire',14)]},
    {id:'b_single',name:'Single post, no brace',items:[I('m_post',1)]}],
  projects:[{id:'p_1',name:'My fence',stage:'bid',lines:[]}],cur:'p_1'};
  addElk(d);addBoard(d);addMore(d);return d;
}
/* ---------- elk fence (Idaho domestic elk rules), added to every setup once ----------
   Idaho's rules for elk fence: at least 8 ft tall; line posts metal pipe at least 2-1/8" across (outside) with 3/16" walls,
   no more than 24 ft apart; corner posts at least 2-7/8" across with 7/32" walls. Line posts are driven 4 ft into the
   ground (13 ft pipe, 9 ft above); brace and corner posts are set 3 ft deep in concrete (12 ft pipe). Sample prices. */
function elkCatalog(){
  const M=(id,name,unit,price,more)=>({id,name,unit,price,url:'',checked:null,src:'',...more});
  const I=(m,q)=>({m,q});
  const materials=[
    M('m_elkwire','High-tensile fixed knot woven wire 96" tall, 20 line wires, 6" stays (330 ft roll)','roll',950,{kind:'wire',roll:330,height:96,gauge:12.5,look:'mesh'}),
    M('m_elkht','High-tensile smooth wire 12.5 ga (4,000 ft coil)','coil',160,{kind:'wire',roll:4000,gauge:12.5,look:'smooth'}),
    M('m_elkline','Pipe line post 2-1/8" OD, 3/16" wall, 13 ft','each',52,{kind:'post',len:13,dia:2.125,wall:0.1875,made:'pipe'}),
    M('m_elkcorner','Pipe brace and corner post 2-7/8" OD, 7/32" wall, 12 ft','each',78,{kind:'post',len:12,dia:2.875,wall:0.21875,made:'pipe'}),
    M('m_elkrail','Pipe brace rail 2-3/8" OD, 10 ft','each',48,{kind:'post',len:10,dia:2.375,made:'pipe'}),
    M('m_elkcap1','Post cap for 2-1/8" pipe','each',2.25,{kind:'hw'}),
    M('m_elkcap2','Post cap for 2-7/8" pipe','each',2.75,{kind:'hw'}),
    M('m_elktie','Wire tie for pipe posts, 9 ga','each',0.2,{kind:'hw'}),
    M('m_concrete','Concrete mix, 80 lb bag','bag',6.5,{kind:'other'}),
    M('m_elkstrain','Inline wire strainer','each',4.5,{kind:'hw'}),
    M('m_elkgate','Elk gate 16 ft wide x 8 ft tall, tube frame with wire mesh','each',650,{kind:'gate',width:16,height:96}),
    M('m_elkghw','Heavy hinge and latch kit for pipe gate posts','kit',55,{kind:'hw'})];
  const shape=bays=>({style:'h',span:10,h1:9,bury1:3,h2:1,bury2:3,dia:2.875,rail:2.375,bays,wire:false,steel:true});
  const braces=[
    {id:'b_elk_h',name:'Elk H-brace (welded pipe)',items:[I('m_elkcorner',2),I('m_elkrail',1),I('m_elkcap2',2),I('m_concrete',8)],shape:shape(1)},
    {id:'b_elk_dh',name:'Elk double H-brace (welded pipe)',items:[I('m_elkcorner',3),I('m_elkrail',2),I('m_elkcap2',3),I('m_concrete',12)],shape:shape(2)}];
  const type={...typeBase(),id:'ft_elk',name:'Elk fence 8 ft (Idaho)',color:'#d08a3c',height:8.5,rule:'idaho-elk',
    wires:[{m:'m_elkwire',strands:1,roll:330},{m:'m_elkht',strands:1,roll:4000}],postM:'m_elkline',spacing:20,
    clipM:'m_elktie',clipsPer:10,braceEnd:'b_elk_h',braceCorner:'b_elk_dh',bracePull:'b_elk_h',braceGate:'b_elk_h',
    gateM:'m_elkgate',gateW:16,gateHw:'m_elkghw',extras:[{m:'m_elkcap1',per:'tpost',q:1},{m:'m_elkstrain',per:'stretch',q:1}]};
  return {materials,braces,type};
}
// add the elk fence (and what goes into it) to a setup that doesn't have it yet; only once, so it stays deleted if you delete it
function addElk(s){
  if(s.elkAdded)return false;s.elkAdded=1;
  const c=elkCatalog();s.materials=s.materials||[];s.braces=s.braces||[];s.fenceTypes=s.fenceTypes||[];
  for(const m of c.materials)if(!s.materials.some(x=>x.id===m.id))s.materials.push(m);
  for(const b of c.braces)if(!s.braces.some(x=>x.id===b.id))s.braces.push(b);
  if(!s.fenceTypes.some(x=>x.id===c.type.id))s.fenceTypes.push(c.type);
  return true;
}
// a fence type set to follow Idaho's elk fence rules: what it doesn't meet, in plain words
function elkCheck(t){
  if(t?.rule!=='idaho-elk')return [];
  const out=[],m=matOf(t.postM),big=b=>(b?.items||[]).some(it=>{const mm=matOf(it.m);return mm&&+mm.dia>=2.875&&+mm.wall>=0.21875});
  if(+t.height<8)out.push(`the fence is ${fmtQ(+t.height||0)} ft tall; it needs at least 8 ft`);
  if(+t.spacing>24)out.push(`line posts are ${fmtQ(+t.spacing)} ft apart; no more than 24 ft`);
  if(!m||m.made!=='pipe'&&!/pipe/i.test(m.name)||!(+m.dia>=2.125)||!(+m.wall>=0.1875))out.push('line posts need to be metal pipe at least 2-1/8" across with 3/16" walls (set the thickness and wall on the post in Materials)');
  for(const id of new Set([t.braceCorner,t.braceEnd])){const b=S.braces.find(x=>x.id===id);if(b&&!big(b))out.push(`${b.name}: corner posts need to be pipe at least 2-7/8" across with 7/32" walls`)}
  return out;
}
// Government standard (wildlife friendly) barbed wire for cattle: top wire 40" or lower, bottom wire barbless and at
// least 18" up, at least 12" between the top two wires (BLM; Wyoming Game and Fish landowner's handbook)
function wildlifeCheck(t){
  const hs=[];let unset=false;
  for(const w of t.wires||[]){const n=Math.round(+w.strands||0);if(!n)continue;
    if(w.start===undefined||w.start===''||(n>1&&!(+w.gap>0))){unset=true;continue}
    for(let k=0;k<n;k++)hs.push({h:+w.start+k*(+w.gap||0),barbed:wireLook(matOf(w.m))==='barbed'})}
  if(unset)return ['set where each wire goes ("starts at" and "apart", in inches) so it can be checked'];
  hs.sort((a,b)=>a.h-b.h);if(!hs.length)return ['no wires'];
  const out=[],top=hs[hs.length-1],bot=hs[0];
  if(top.h>40)out.push(`the top wire is ${fmtQ(top.h)}"; it should be 40" or lower`);
  if(bot.h<18)out.push(`the bottom wire is ${fmtQ(bot.h)}"; it should be at least 18" up`);
  if(bot.barbed)out.push('the bottom wire should be barbless (smooth or twisted)');
  if(hs.length>1&&top.h-hs[hs.length-2].h<12)out.push(`the top two wires are ${fmtQ(top.h-hs[hs.length-2].h)}" apart; they should be at least 12" apart`);
  return out;
}
function elkNote(t){
  if(t?.rule==='wildlife-cattle'){const bad=wildlifeCheck(t);
    return `<div class="note${bad.length?' warnbox':''}"><b>Government standard, wildlife friendly:</b> wires at 18", 22", 28" and 40"; a barbless bottom wire at least 18" up; at least 12" between the top two wires; top wire 40" or lower.
      ${bad.length?`<br><b>Not met:</b> ${bad.map(esc).join('; ')}.`:'<br>This fence type meets it.'}</div>`}
  if(t?.rule!=='idaho-elk')return '';const bad=elkCheck(t);
  return `<div class="note${bad.length?' warnbox':''}"><b>Idaho elk fence rules:</b> at least 8 ft tall; line posts metal pipe at least 2-1/8" across with 3/16" walls, no more than 24 ft apart; corner posts at least 2-7/8" across with 7/32" walls.
    ${bad.length?`<br><b>Not met:</b> ${bad.map(esc).join('; ')}.`:'<br>This fence type meets them.'}</div>`;
}
/* ---------- wood board fence (a 4-board ranch or horse fence), added to every setup once ----------
   Boards are counted like a roll of wire: each row of boards runs the whole fence, one board is 16 ft long, so a job
   needs (feet x rows, plus extra) / 16 boards. Boards meet on every other post (posts 8 ft apart). Line posts are round
   treated posts; corners, ends and gate posts are 6x6 set in concrete. No pull braces: boards don't stretch.
   Prices: LOCAL_PRICES below (see the note on each material). */
const BOARD_PRICES={board:12.98,post:16.99,post6x6:39.98,screw:0.08,gate:299,ghw:35};
// local prices and store links for the starter fences (D&B Supply, Emmett / Treasure Valley), checked Nov 27, 2026
const LOCAL_PRICES={"m_bd16": {"price": 17, "notes": "Estimate: no local price found. Get a quote. 16 ft rough-sawn boards are hard to find off the shelf; ask Emmett-area mills (Woodgrain, Emerald Forest Products)."}, "m_bdpost": {"name": "Treated round post 4-1/2\" x 8 ft, blunt (Parma Post & Pole)", "price": 15.99, "dia": 4.5, "url": "https://www.dbsupply.com/8ft-4-5in-cac-blunt-wood-post-917743.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_bd6x6": {"name": "Treated timber 6x6 x 8 ft (Parma Post & Pole)", "price": 47.99, "url": "https://www.dbsupply.com/cac-treated-timber-6-x6-x8.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_bdscrew": {"name": "Exterior deck screw #10 x 3\", each (Deck Plus, box of 310 for $36.99)", "price": 0.12, "url": "https://www.dbsupply.com/deck-plus-48433-deck-screw-10-thread-3-in-l-flat-head-star-drive-type-17-point-ceramic-coated-310-pk.html", "notes": "D&B Supply price, checked Nov 27, 2026. Priced per screw from the box."}, "m_bdgate": {"price": 300, "notes": "Estimate: no local price found. Get a quote. No board-style wood gate found for sale locally; a 12 ft tube gate is about $140 at D&B."}, "m_bdghw": {"price": 35, "notes": "Estimate: no local price found. Get a quote."}, "m_concrete": {"name": "Pre-mix concrete, 80 lb bag", "price": 9.49, "url": "https://www.dbsupply.com/handy-products-pre-mix-concrete-80-lb.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_fab": {"price": 159.99, "url": "https://www.dbsupply.com/bfc-chain-link-fence-fabric-11-5-ga-72-x-50.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_rail": {"name": "Chain link top rail 1-3/8\" x 10.6 ft (16 ga)", "price": 24.99, "roll": 10.5, "dia": 1.375, "url": "https://www.dbsupply.com/bfc-22200-126-fence-tubing-1-3-8-in-dia-10-6-ft-l-16-ga-thick-material-polyester-coated.html", "notes": "D&B Supply price, checked Nov 27, 2026. D&B stocks residential sizes (1-3/8\" rail)."}, "m_cl_line": {"name": "Chain link line post 1-5/8\" x 8 ft (16 ga)", "price": 20.99, "dia": 1.625, "url": "https://www.dbsupply.com/bfc-22300-096-tubing-post-8-ft-l-1-5-8-in-w-16-ga-thick-material-galvanized.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_term": {"name": "Chain link terminal post 2-3/8\" x 8 ft", "price": 27.99, "len": 8, "url": "https://www.dbsupply.com/2-38-x-8ft-cl-gv-end-post-933704.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_band": {"price": 2.99, "url": "https://www.dbsupply.com/stephens-pipe-steel-hd11040rp-tension-band-for-chain-link-fencing.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_brace": {"price": 2.29, "url": "https://www.dbsupply.com/stephens-pipe-steel-hd13040rp-brace-band.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_bar": {"price": 5.99, "url": "https://www.dbsupply.com/6ft-cl-gv-tension-bar-933700.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_cup": {"name": "Rail end cup 1-3/8\"", "price": 3.49, "url": "https://www.dbsupply.com/1-38in-rail-end-914202.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_cap": {"price": 3.29, "url": "https://www.dbsupply.com/2-3-8-heavy-d-c-post-cap-50.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_loop": {"name": "Loop cap (eye top) 1-5/8\" x 1-3/8\"", "price": 4.29, "url": "https://www.dbsupply.com/stephens-pipe-steel-hd04021rp-eyetop.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_tie": {"name": "Aluminum fence tie 6-1/2\", each (pack of 100 for $12.99)", "price": 0.13, "url": "https://www.dbsupply.com/bfc-aluminum-fence-ties-cut-hooked-9-ga-1-7-8-x-6-1-2-100-pk.html", "notes": "D&B Supply price, checked Nov 27, 2026. Priced per tie from the pack."}, "m_cl_gate": {"price": 149.99, "url": "https://www.dbsupply.com/bfc-26515-residential-gate-6-ft-h-gate.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_ghw": {"price": 27.99, "url": "https://www.dbsupply.com/stephens-pipe-steel-hd07110rp-gate-hardware-kit-single-drive-for-chain-link-gate.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_cl_bolt": {"price": 0.35, "notes": "Estimate: no local price found. Get a quote."}, "m_pv_picket": {"price": 3.9, "notes": "Home Depot and Alta Forest prices ($3.75 to $4.28) from web listings, store not confirmed."}, "m_pv_rail": {"price": 8, "notes": "Estimate: no local price found. Get a quote."}, "m_pv_post": {"name": "Treated post 4x4 x 8 ft (Parma Post & Pole)", "price": 19.99, "url": "https://www.dbsupply.com/wood-post-sharp-8-x-2-1-10.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_pv_nail": {"name": "Galvanized spiral-shank nail 8d 2-1/2\", each (1 lb, about 100, for $7.29)", "price": 0.07, "notes": "D&B Supply price, checked Nov 27, 2026. Priced per nail."}, "m_pv_gate": {"price": 150, "notes": "Estimate: no local price found. Get a quote. Or build one from pickets with a gate frame kit."}, "m_pv_gatekit": {"name": "Adjust-A-Gate gate frame kit (Jewett-Cameron)", "price": 79.99, "url": "https://www.dbsupply.com/jewett-cameron-fence-adjust-a-gate-unlimited-low-profile-complete-gate-kit.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_pv_bracket": {"price": 1.5, "notes": "Estimate: no local price found. Get a quote."}, "m_pv_bscrew": {"price": 0.05, "notes": "Estimate: no local price found. Get a quote."}, "m_sr_rail": {"price": 25, "notes": "Estimate: no local price found. Get a quote. D&B has a doweled rail 8 ft x 3-1/2\" for $15.99 instead."}, "m_sr_line": {"name": "Split rail line post, 3-hole, 7 ft x 5-1/2\" (Parma Post & Pole)", "price": 25.99, "len": 7, "dia": 5.5, "url": "https://www.dbsupply.com/wood-post-sharp-8-x-2-1-5.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_sr_end": {"name": "Split rail end post, 3-hole, 7 ft x 6-1/2\" (Parma Post & Pole)", "price": 32.99, "len": 7, "dia": 6.5, "url": "https://www.dbsupply.com/wood-post-sharp-8-x-2-1-4.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_sr_corner": {"name": "Split rail corner post, 3-hole, 7 ft x 6-1/2\" (Parma Post & Pole)", "price": 32.99, "len": 7, "dia": 6.5, "url": "https://www.dbsupply.com/wood-post-sharp-8-x-2-1-3.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_sr_gate": {"price": 180, "notes": "Estimate: no local price found. Get a quote."}, "m_nc_wire": {"name": "Red Brand Square Deal 2\"x4\" non-climb horse fence, 60\" x 200 ft", "price": 549.99, "url": "https://www.dbsupply.com/redbrand-non-climb-horse-fence-48-x-201.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_nc_bpost": {"name": "Treated round post 6-1/2\" x 8 ft, blunt (Parma Post & Pole)", "price": 27.99, "url": "https://www.dbsupply.com/8ft-x-6in-cac-blunt-wood-post-808020.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_nc_brail": {"name": "Doweled brace rail 8 ft x 3-1/2\" (Parma Post & Pole)", "price": 15.99, "dia": 3.5, "url": "https://www.dbsupply.com/wood-post-sharp-8-x-2-1-6.html", "notes": "D&B Supply price, checked Nov 27, 2026."}, "m_nc_pin": {"price": 1.25, "notes": "Estimate: no local price found. Get a quote."}, "m_nc_bwire": {"price": 0.08, "notes": "Estimate: no local price found. Get a quote."}, "m_nc_staple": {"name": "Fence staple 1-1/2\", each (OK Brand 8 lb tub, about 575, for $19.99)", "price": 0.035, "url": "https://www.dbsupply.com/1-12in-8lb-bucket-of-staples-844187.html", "notes": "D&B Supply price, checked Nov 27, 2026. Priced per staple."}, "m_tube12": {"name": "Utility gate 12 ft (Behlen Country, 20 ga)", "price": 139.99, "url": "https://www.dbsupply.com/behlen-country-40130127-utility-gate-12-ft-w-gate-50-in-h-gate-20-ga-frame-tube-channel-gray.html", "notes": "D&B Supply price, checked Nov 27, 2026. Regular price; was on sale for $104.99. Heavy 16 ga tube gates run about $290."}, "m_tubehw": {"price": 35, "notes": "Estimate: no local price found. Get a quote."}, "m_pr_post": {"name": "Used pipe 2-7/8\" OD, cut 8 ft", "price": 20, "notes": "Estimate: no local price found. Get a quote. About $2.50 a foot for used oilfield pipe; call local pipe yards and add freight."}, "m_pr_rail": {"name": "Used pipe 2-3/8\" OD, 31 ft joint", "price": 70, "notes": "Estimate: no local price found. Get a quote. About $2.25 a foot for used oilfield pipe."}, "m_pr_rod": {"price": 5, "notes": "Estimate: no local price found. Get a quote."}, "m_vy_panel": {"price": 110.01, "notes": "Home Depot Veranda Linden price from a web listing; Boise store not confirmed. D&B has no vinyl."}, "m_vy_line": {"price": 53.48, "notes": "Home Depot web listing; Boise store not confirmed."}, "m_vy_end": {"price": 55, "notes": "Estimate: no local price found. Get a quote."}, "m_vy_corner": {"price": 55, "notes": "Estimate: no local price found. Get a quote."}, "m_vy_cap": {"price": 5, "notes": "Estimate: no local price found. Get a quote."}, "m_vy_gate": {"price": 295, "notes": "Home Depot Veranda web listing; Boise store not confirmed."}, "m_vy_stiff": {"price": 15, "notes": "Estimate: no local price found. Get a quote."}, "m_sleeve": {"price": 0.25, "notes": "Estimate: no local price found. Get a quote."}, "m_gs_twist": {"price": 85, "notes": "Estimate: no local price found. Get a quote."}, "m_gs_barb": {"price": 90, "notes": "Estimate: no local price found. Get a quote."}, "m_gs_tpost": {"price": 6.5, "notes": "Estimate: no local price found. Get a quote."}, "m_gs_clip": {"price": 0.12, "notes": "Estimate: no local price found. Get a quote."}, "m_elkcap2": {"price": 2.75, "notes": "Estimate: no local price found. Get a quote."}};
const withLocal=ms=>ms.map(m=>({...m,...(LOCAL_PRICES[m.id]||{})}));
function boardCatalog(){
  const M=(id,name,unit,price,more)=>({id,name,unit,price,url:'',checked:null,src:'',...more}),I=(m,q)=>({m,q}),P=BOARD_PRICES;
  const materials=[
    M('m_bd16','Rough-sawn fence board 1x6 x 16 ft','each',P.board,{kind:'board',roll:16,height:5.5,look:'board'}),
    M('m_bdpost','Treated round post 5-6" x 8 ft','each',P.post,{kind:'post',len:8,dia:5.5,made:'wood'}),
    M('m_bd6x6','Treated post 6x6 x 8 ft','each',P.post6x6,{kind:'post',len:8,dia:5.5,made:'woodsq'}),
    M('m_bdscrew','Exterior fence screw 3", each','each',P.screw,{kind:'hw'}),
    M('m_concrete','Concrete mix, 80 lb bag','bag',6.5,{kind:'other'}),
    M('m_bdgate','Wood ranch gate 12 ft, board style','each',P.gate,{kind:'gate',width:12,height:54}),
    M('m_bdghw','Gate hinge and latch kit for wood posts','kit',P.ghw,{kind:'hw'})];
  const braces=[{id:'b_bd_corner',name:'Board fence corner post (6x6 in concrete)',items:[I('m_bd6x6',1),I('m_concrete',2),I('m_bdscrew',8)],
    shape:{style:'single',span:8,h1:4.75,bury1:3,h2:1,bury2:3,dia:5.5,rail:4,bays:1,wire:false,steel:false,square:true}}];
  const type={...typeBase(),id:'ft_board',name:'Wood board fence, 4 boards',color:'#e2c79a',height:4.5,
    wires:[{m:'m_bd16',strands:4,roll:16,start:18,gap:12}],postM:'m_bdpost',spacing:8,clipM:'m_bdscrew',clipsPer:8,
    pullBy:'ft',pullEvery:0,braceEnd:'b_bd_corner',braceCorner:'b_bd_corner',bracePull:'b_bd_corner',braceGate:'b_bd_corner',
    gateM:'m_bdgate',gateW:12,gateHw:'m_bdghw',waste:5,hillGrade:20};
  return {materials:withLocal(materials),braces,type};
}
function addBoard(s){
  if(s.boardAdded)return false;s.boardAdded=1;
  const c=boardCatalog();s.materials=s.materials||[];s.braces=s.braces||[];s.fenceTypes=s.fenceTypes||[];
  for(const m of c.materials)if(!s.materials.some(x=>x.id===m.id))s.materials.push(m);
  for(const b of c.braces)if(!s.braces.some(x=>x.id===b.id))s.braces.push(b);
  if(!s.fenceTypes.some(x=>x.id===c.type.id))s.fenceTypes.push(c.type);
  return true;
}
/* ---------- more standard fences, added to every setup once: chain link, wood privacy, split rail, no-climb horse
   fence, steel pipe rail and vinyl privacy. Each row in "wire" is counted like a roll: rails and boards by their length,
   pickets by their width (a picket "covers" 5-1/2" of fence), panels by their width (8 ft). Prices: LOCAL_PRICES. */
const PRICES2={clFab:0,clRail:0,clLine:0,clTerm:0,clBand:0,clBrace:0,clBar:0,clCup:0,clCap:0,clLoop:0,clTie:0,clGate:0,clGhw:0,
  pvPicket:0,pvRail:0,pvPost:0,pvNail:0,pvGate:0,srRail:0,srLine:0,srEnd:0,srCorner:0,srGate:0,
  ncWire:0,ncBpost:0,ncBrail:0,ncPin:0,ncBwire:0,ncStaple:0,tube12:0,tubeHw:0,prPipe:0,prRail:0,prRod:0,
  vyPanel:0,vyLine:0,vyEnd:0,vyCorner:0,vyCap:0,vyGate:0,clBolt:0,pvBracket:0,pvBscrew:0,pvGateKit:0,vyStiff:0,sleeve:0,
  gsTwist:0,gsBarb:0,gsTpost:0,gsClip:0};
function morePack(){
  const M=(id,name,unit,price,more)=>({id,name,unit,price,url:'',checked:null,src:'',...more}),I=(m,q)=>({m,q}),P=PRICES2;
  const single=more=>({style:'single',span:8,h1:5,bury1:3,h2:1,bury2:3,dia:4,rail:3,bays:1,wire:false,steel:false,...more});
  const materials=[
    // chain link
    M('m_cl_fab','Chain link fabric 6 ft, 11.5 ga galvanized (50 ft roll)','roll',P.clFab,{kind:'wire',roll:50,height:72,gauge:11.5,look:'chain'}),
    M('m_cl_rail','Chain link top rail 1-5/8" galvanized, 21 ft','each',P.clRail,{kind:'rail',roll:21,dia:1.625,look:'rail'}),
    M('m_cl_line','Chain link line post 1-7/8" x 8 ft','each',P.clLine,{kind:'post',len:8,dia:1.875,made:'pipe'}),
    M('m_cl_term','Chain link terminal post 2-3/8" x 9 ft','each',P.clTerm,{kind:'post',len:9,dia:2.375,made:'pipe'}),
    M('m_cl_band','Tension band 2-3/8"','each',P.clBand,{kind:'hw'}),
    M('m_cl_brace','Brace band 2-3/8"','each',P.clBrace,{kind:'hw'}),
    M('m_cl_bar','Tension bar 6 ft','each',P.clBar,{kind:'hw'}),
    M('m_cl_cup','Rail end cup 1-5/8"','each',P.clCup,{kind:'hw'}),
    M('m_cl_cap','Dome cap 2-3/8"','each',P.clCap,{kind:'hw'}),
    M('m_cl_loop','Loop cap 1-7/8" x 1-5/8"','each',P.clLoop,{kind:'hw'}),
    M('m_cl_tie','Aluminum fence tie 6-1/2"','each',P.clTie,{kind:'hw'}),
    M('m_cl_gate','Chain link walk gate 4 ft wide x 6 ft tall','each',P.clGate,{kind:'gate',width:4,height:72}),
    M('m_cl_ghw','Chain link gate hinge and latch set','kit',P.clGhw,{kind:'hw'}),
    // wood privacy
    M('m_pv_picket','Dog-ear cedar picket 5/8" x 5-1/2" x 6 ft','each',P.pvPicket,{kind:'board',roll:5.5/12,height:72,look:'picket'}),
    M('m_pv_rail','Treated 2x4 x 8 ft rail','each',P.pvRail,{kind:'board',roll:8,height:3.5,look:'board'}),
    M('m_pv_post','Treated post 4x4 x 8 ft','each',P.pvPost,{kind:'post',len:8,dia:3.5,made:'woodsq'}),
    M('m_pv_nail','Galvanized ring-shank fence nail 2-1/2", each','each',P.pvNail,{kind:'hw'}),
    M('m_pv_gate','Wood privacy walk gate 4 ft wide x 6 ft tall','each',P.pvGate,{kind:'gate',width:4,height:72}),
    // split rail
    M('m_sr_rail','Split rail 11 ft (cedar)','each',P.srRail,{kind:'rail',roll:10,height:4,dia:4,look:'log'}),
    M('m_sr_line','Split rail line post, 3-hole, 6-1/2 ft','each',P.srLine,{kind:'post',len:6.5,dia:5,made:'wood'}),
    M('m_sr_end','Split rail end post, 3-hole, 6-1/2 ft','each',P.srEnd,{kind:'post',len:6.5,dia:5,made:'wood'}),
    M('m_sr_corner','Split rail corner post, 3-hole, 6-1/2 ft','each',P.srCorner,{kind:'post',len:6.5,dia:5,made:'wood'}),
    M('m_sr_gate','Split rail walk gate 4 ft, wood','each',P.srGate,{kind:'gate',width:4,height:42}),
    // no-climb horse fence
    M('m_nc_wire','No-climb horse fence 2"x4" mesh, 60" tall (200 ft roll)','roll',P.ncWire,{kind:'wire',roll:200,height:60,gauge:12.5,look:'mesh'}),
    M('m_nc_bpost','Treated round brace post 6-7" x 8 ft','each',P.ncBpost,{kind:'post',len:8,dia:6.5,made:'wood'}),
    M('m_nc_brail','Treated brace rail 4" x 8 ft','each',P.ncBrail,{kind:'post',len:8,dia:4,made:'wood'}),
    M('m_nc_pin','Brace pin 3/8" x 8"','each',P.ncPin,{kind:'hw'}),
    M('m_nc_bwire','9 ga smooth brace wire, per ft','ft',P.ncBwire,{kind:'hw'}),
    M('m_nc_staple','Galvanized fence staple 1-3/4", each','each',P.ncStaple,{kind:'hw'}),
    M('m_tube12','Tube gate 12 ft','each',P.tube12,{kind:'gate',width:12,height:50}),
    M('m_tubehw','Gate hinge and latch kit','kit',P.tubeHw,{kind:'hw'}),
    // steel pipe rail
    M('m_pr_post','Pipe post 2-7/8" OD x 8 ft','each',P.prPipe,{kind:'post',len:8,dia:2.875,made:'pipe'}),
    M('m_pr_rail','Pipe rail 2-3/8" OD x 31 ft, welded on','each',P.prRail,{kind:'rail',roll:31,dia:2.375,look:'rail'}),
    M('m_pr_rod','Welding rod 1/8" 6011, per lb','lb',P.prRod,{kind:'hw'}),
    // vinyl privacy
    M('m_vy_panel','Vinyl privacy panel 6 ft tall x 8 ft wide, white','each',P.vyPanel,{kind:'rail',roll:8,height:72,look:'panel'}),
    M('m_vy_line','Vinyl line post 5"x5" x 9 ft','each',P.vyLine,{kind:'post',len:9,dia:5,made:'vinyl'}),
    M('m_vy_end','Vinyl end post 5"x5" x 9 ft','each',P.vyEnd,{kind:'post',len:9,dia:5,made:'vinyl'}),
    M('m_vy_corner','Vinyl corner post 5"x5" x 9 ft','each',P.vyCorner,{kind:'post',len:9,dia:5,made:'vinyl'}),
    M('m_vy_cap','Vinyl post cap 5"','each',P.vyCap,{kind:'hw'}),
    M('m_vy_gate','Vinyl privacy walk gate 4 ft wide x 6 ft tall','each',P.vyGate,{kind:'gate',width:4,height:72}),
    M('m_cl_bolt','Carriage bolt 5/16" x 1-1/4" with nut (for tension and brace bands)','each',P.clBolt,{kind:'hw'}),
    M('m_pv_bracket','Fence rail bracket for 2x4 (galvanized)','each',P.pvBracket,{kind:'hw'}),
    M('m_pv_bscrew','Structural screw 1-1/2" for rail brackets, each','each',P.pvBscrew,{kind:'hw'}),
    M('m_pv_gatekit','Wood gate frame kit (corner brackets and anti-sag)','kit',P.pvGateKit,{kind:'hw'}),
    M('m_vy_stiff','Aluminum bottom-rail stiffener for vinyl panel, 8 ft','each',P.vyStiff,{kind:'hw'}),
    M('m_sleeve','Wire crimp sleeve 12.5 ga','each',P.sleeve,{kind:'hw'}),
    // government standard (wildlife friendly) barbed wire
    M('m_gs_twist','Barbless twisted smooth wire 12.5 ga, 2 strands (1,320 ft roll)','roll',P.gsTwist,{kind:'wire',roll:1320,gauge:12.5,look:'smooth'}),
    M('m_gs_barb','Barbed wire 12.5 ga 4-point (1,320 ft roll)','roll',P.gsBarb,{kind:'wire',roll:1320,gauge:12.5,look:'barbed'}),
    M('m_gs_tpost','Steel T-post 1.33 lb/ft, 5-1/2 ft','each',P.gsTpost,{kind:'post',len:5.5,made:'tpost'}),
    M('m_gs_clip','T-post clip','each',P.gsClip,{kind:'hw'}),
    M('m_concrete','Concrete mix, 80 lb bag','bag',6.5,{kind:'other'}),
    M('m_bdghw','Gate hinge and latch kit for wood posts','kit',35,{kind:'hw'}),
    M('m_elkcap2','Post cap for 2-7/8" pipe','each',2.75,{kind:'hw'})];
  const braces=[
    {id:'b_cl_end',name:'Chain link end or gate post (in concrete)',items:[I('m_cl_term',1),I('m_cl_band',5),I('m_cl_brace',1),I('m_cl_bolt',6),I('m_cl_bar',1),I('m_cl_cup',1),I('m_cl_cap',1),I('m_concrete',2)],shape:single({dia:2.375,h1:6.2,steel:true})},
    {id:'b_cl_corner',name:'Chain link corner post (in concrete)',items:[I('m_cl_term',1),I('m_cl_band',10),I('m_cl_brace',2),I('m_cl_bolt',12),I('m_cl_bar',2),I('m_cl_cup',2),I('m_cl_cap',1),I('m_concrete',2)],shape:single({dia:2.375,h1:6.2,steel:true})},
    {id:'b_pv_post',name:'Privacy fence 4x4 post (in concrete)',items:[I('m_pv_post',1),I('m_concrete',2),I('m_pv_bracket',6),I('m_pv_bscrew',36)],shape:single({dia:3.5,h1:6.1,square:true})},
    {id:'b_sr_end',name:'Split rail end post',items:[I('m_sr_end',1)],shape:single({dia:5,h1:4})},
    {id:'b_sr_corner',name:'Split rail corner post',items:[I('m_sr_corner',1)],shape:single({dia:5,h1:4})},
    {id:'b_nc_h',name:'Wood H-brace (treated posts)',items:[I('m_nc_bpost',2),I('m_nc_brail',1),I('m_nc_pin',2),I('m_nc_bwire',25)],shape:{style:'h',span:8,h1:5.75,bury1:3,h2:1,bury2:3,dia:6.5,rail:4,bays:1,wire:true,steel:false}},
    {id:'b_nc_dh',name:'Wood double H-brace (treated posts)',items:[I('m_nc_bpost',3),I('m_nc_brail',2),I('m_nc_pin',4),I('m_nc_bwire',50)],shape:{style:'h',span:8,h1:5.75,bury1:3,h2:1,bury2:3,dia:6.5,rail:4,bays:2,wire:true,steel:false}},
    {id:'b_pr_corner',name:'Pipe corner post 2-7/8" (in concrete)',items:[I('m_pr_post',1),I('m_elkcap2',1),I('m_concrete',2)],shape:single({dia:2.875,h1:5.2,steel:true})},
    {id:'b_vy_end',name:'Vinyl end or gate post (in concrete)',items:[I('m_vy_end',1),I('m_vy_cap',1),I('m_concrete',2)],shape:single({dia:5,h1:6.2,square:true,vinyl:true})},
    {id:'b_vy_corner',name:'Vinyl corner post (in concrete)',items:[I('m_vy_corner',1),I('m_vy_cap',1),I('m_concrete',2)],shape:single({dia:5,h1:6.2,square:true,vinyl:true})}];
  const T=(id,name,color,more)=>({...typeBase(),id,name,color,pullBy:'ft',pullEvery:0,...more});
  const types=[
    T('ft_chain','Chain link 6 ft','#b9c2c9',{height:6,wires:[{m:'m_cl_fab',strands:1,roll:50,start:2},{m:'m_cl_rail',strands:1,roll:21,start:73}],postM:'m_cl_line',spacing:10,
      clipM:'m_cl_tie',clipsPer:6,pullBy:'auto',braceEnd:'b_cl_end',braceCorner:'b_cl_corner',bracePull:'b_cl_end',braceGate:'b_cl_end',gateM:'m_cl_gate',gateW:4,gateHw:'m_cl_ghw',
      extras:[{m:'m_cl_loop',per:'tpost',q:1},{m:'m_cl_tie',per:'ft',q:0.5},{m:'m_concrete',per:'tpost',q:1}]}),
    T('ft_privacy','Wood privacy fence 6 ft','#b07c4f',{height:6,wires:[{m:'m_pv_rail',strands:3,roll:8,start:12,gap:28},{m:'m_pv_picket',strands:1,roll:5.5/12,start:2}],postM:'m_pv_post',spacing:8,
      clipM:'m_bdscrew',clipsPer:6,waste:5,braceEnd:'b_pv_post',braceCorner:'b_pv_post',bracePull:'b_pv_post',braceGate:'b_pv_post',gateM:'m_pv_gate',gateW:4,gateHw:'m_bdghw',
      extras:[{m:'m_pv_nail',per:'ft',q:13},{m:'m_concrete',per:'tpost',q:2},{m:'m_pv_bracket',per:'tpost',q:6},{m:'m_pv_bscrew',per:'tpost',q:36},{m:'m_pv_gatekit',per:'gate',q:1}]}),
    T('ft_split','Split rail fence, 3 rails','#9c7a55',{height:4,wires:[{m:'m_sr_rail',strands:3,roll:10,start:14,gap:12}],postM:'m_sr_line',spacing:10,clipsPer:0,waste:0,
      braceEnd:'b_sr_end',braceCorner:'b_sr_corner',bracePull:'b_sr_end',braceGate:'b_sr_end',gateM:'m_sr_gate',gateW:4,gateHw:'m_bdghw'}),
    T('ft_noclimb','No-climb horse fence 5 ft + top board','#e8e1d0',{height:5.5,wires:[{m:'m_nc_wire',strands:1,roll:200,start:3},{m:'m_bd16',strands:1,roll:16,start:66}],postM:'m_bdpost',spacing:10,
      clipM:'m_nc_staple',clipsPer:8,pullBy:'auto',braceEnd:'b_nc_h',braceCorner:'b_nc_dh',bracePull:'b_nc_h',braceGate:'b_nc_h',gateM:'m_tube12',gateW:12,gateHw:'m_tubehw',
      extras:[{m:'m_bdscrew',per:'tpost',q:2},{m:'m_sleeve',per:'stretch',q:2}]}),
    T('ft_piperail','Steel pipe rail fence, 3 rails','#9aa3ab',{height:5,wires:[{m:'m_pr_rail',strands:3,roll:31,start:18,gap:18}],postM:'m_pr_post',spacing:10,clipsPer:0,waste:3,
      braceEnd:'b_pr_corner',braceCorner:'b_pr_corner',bracePull:'b_pr_corner',braceGate:'b_pr_corner',gateM:'m_tube12',gateW:12,gateHw:'m_tubehw',
      extras:[{m:'m_elkcap2',per:'tpost',q:1},{m:'m_pr_rod',per:'tpost',q:0.25}]}),
    T('ft_vinyl','Vinyl privacy fence 6 ft','#f2f2ef',{height:6,wires:[{m:'m_vy_panel',strands:1,roll:8,start:2}],postM:'m_vy_line',spacing:8,clipsPer:0,waste:0,
      braceEnd:'b_vy_end',braceCorner:'b_vy_corner',bracePull:'b_vy_end',braceGate:'b_vy_end',gateM:'m_vy_gate',gateW:4,gateHw:'m_bdghw',
      extras:[{m:'m_vy_cap',per:'tpost',q:1},{m:'m_concrete',per:'tpost',q:2},{m:'m_vy_stiff',per:'ft',q:0.125}]}),
    // Government standard 4-strand barbed wire for cattle, built so wildlife can pass (BLM / Wyoming Game and Fish
    // landowner's handbook): wires at 18", 22", 28" and 40"; a barbless twisted bottom wire; 12" between the top two
    T('ft_govbarb','Government standard barbed wire, 4 strands (wildlife friendly)','#c9772f',{height:3.5,rule:'wildlife-cattle',
      wires:[{m:'m_gs_twist',strands:1,roll:1320,start:18},{m:'m_gs_barb',strands:2,roll:1320,start:22,gap:6},{m:'m_gs_barb',strands:1,roll:1320,start:40}],
      postM:'m_gs_tpost',spacing:16.5,clipM:'m_gs_clip',clipsPer:4,pullBy:'auto',braceEnd:'b_nc_h',braceCorner:'b_nc_dh',bracePull:'b_nc_h',braceGate:'b_nc_h',
      gateM:'m_tube12',gateW:12,gateHw:'m_tubehw',extras:[{m:'m_sleeve',per:'stretch',q:4}]})];
  return {materials:withLocal(materials),braces,types};
}
function addMore(s){
  if(s.moreAdded)return false;s.moreAdded=1;
  const c=morePack();s.materials=s.materials||[];s.braces=s.braces||[];s.fenceTypes=s.fenceTypes||[];
  for(const m of c.materials)if(!s.materials.some(x=>x.id===m.id))s.materials.push(m);
  for(const b of c.braces)if(!s.braces.some(x=>x.id===b.id))s.braces.push(b);
  for(const t of c.types)if(!s.fenceTypes.some(x=>x.id===t.id))s.fenceTypes.push(t);
  return true;
}
