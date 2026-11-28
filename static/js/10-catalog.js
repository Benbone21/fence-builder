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
const wireLook=m=>m?.look||(/woven|field|mesh|knot|net|hinge|panel|no.?climb/i.test(m?.name||'')?'mesh':/barb/i.test(m?.name||'')?'barbed':'smooth');
const PULL_USUAL={mesh:660,barbed:1320,smooth:2640};
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
  return {v:1,tab:'build',drawType:'ft_fk',
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
}

