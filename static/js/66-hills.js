/* ---------- braces added for you: gates at roads, braces at rivers, at hilltops and at the bottoms of hills ---------- */
// Roads and rivers used to share one switch (autoCross); old saves keep what it was set to.
const AUTO_KINDS=[
  ['autoRoads','Gates at roads','Where a fence crosses a road or driveway'],
  ['autoRivers','Braces at rivers and creeks','A brace on each bank'],
  ['hillTop','Braces at hilltops','Where the ground goes over the top of a hill'],
  ['hillLow','Braces at the bottoms of hills','Where the ground dips and comes back up'],
];
const autoOn=k=>k==='hillTop'||k==='hillLow'?!!S.settings[k]:(S.settings[k]??S.settings.autoCross)!==false;
const crossOn=()=>autoOn('autoRoads')||autoOn('autoRivers');
function autoSwitches(cls){
  return AUTO_KINDS.map(([k,n,h])=>{const on=autoOn(k);
    return `<label class="setcheck ${cls}"><span><b>${n}</b><span>${h}</span></span><span class="switch"><input type="checkbox" role="switch" ${on?'checked':''} data-f="set.${k}" aria-label="${esc(n)}"><i></i><em>${on?'On':'Off'}</em></span></label>`}).join('');
}
// Where the slope along a line bends by at least the fence type's limit, over 50 ft each way:
// over the top of a hill ('top') or through a dip ('low'). From the ground heights already loaded for the line.
const HILL_SPAN=50;
function hillSpots(l,t){
  const pr=evOf(l)?.prof;if(!pr||pr.length<3)return [];
  const lim=Math.max(3,+(t.hillGrade??15)||15)/100,W=HILL_SPAN,total=pr[pr.length-1][0];if(total<2*W+10)return [];
  let j=0;
  const zAt=d=>{while(j>0&&pr[j][0]>d)j--;while(j<pr.length-2&&pr[j+1][0]<d)j++;const a=pr[j],b=pr[j+1]||a,f=(d-a[0])/((b[0]-a[0])||1);return a[1]+(b[1]-a[1])*Math.min(1,Math.max(0,f))};
  const bend=[];
  for(let d=W;d<=total-W;d+=10){const z=zAt(d),before=(z-zAt(d-W))/W,after=(zAt(d+W)-z)/W;bend.push({d,c:after-before})}
  const out=[];
  bend.forEach((b,i)=>{
    if(Math.abs(b.c)<lim)return;
    // only the sharpest bend of its kind within 50 ft either way
    if(bend.some((o,k)=>k!==i&&Math.abs(o.d-b.d)<=W&&Math.sign(o.c)===Math.sign(b.c)&&(Math.abs(o.c)>Math.abs(b.c)||(Math.abs(o.c)===Math.abs(b.c)&&k<i))))return;
    out.push({d:b.d,kind:b.c<0?'top':'low'});
  });
  return out;
}
// put braces at those spots on the line (skipping any near a corner, brace or gate); returns how many went in
function hillBraces(l){
  if(!l||l.manual||l.pts.length<2||walkingNow(l)||!(autoOn('hillTop')||autoOn('hillLow'))||!evOf(l))return 0;
  const t=S.fenceTypes.find(x=>x.id===l.type)||S.fenceTypes[0],kit=braceFor(t);if(!kit)return 0;
  const spots=hillSpots(l,t).filter(s=>autoOn(s.kind==='top'?'hillTop':'hillLow')).sort((a,b)=>b.d-a.d);   // far end first
  let n=0;
  for(const s of spots){
    const cum=[0];for(let i=1;i<l.pts.length;i++)cum[i]=cum[i-1]+ll(l.pts[i-1]).distanceTo(ll(l.pts[i]))*FT;
    if(l.pts.some((p,i)=>Math.abs(cum[i]-s.d)<40&&(i===0||i===l.pts.length-1||p.brace!=='none')))continue;
    let i=1;while(i<l.pts.length-1&&cum[i]<s.d)i++;
    const a=l.pts[i-1],b=l.pts[i],f=Math.min(1,Math.max(0,(s.d-cum[i-1])/((cum[i]-cum[i-1])||1)));
    l.pts.splice(i,0,{lat:a.lat+(b.lat-a.lat)*f,lng:a.lng+(b.lng-a.lng)*f,brace:kit,auto:'hill',hill:s.kind,autoName:s.kind==='top'?'the top of a hill':'the bottom of a hill'});
    n++;
  }
  if(n)l.elev.key=geomKey(l);   // the new points sit on the line, so its shape and ground heights are the same
  return n;
}
// one of the four switches was turned: off takes out what it added on this job's lines; on adds them now
async function applyAuto(k,on){
  const lines=P().lines.filter(l=>!l.manual&&l.pts.length>1),name=(AUTO_KINDS.find(x=>x[0]===k)||[,k])[1];
  const mine=p=>k==='autoRoads'?p.auto==='road':k==='autoRivers'?p.auto==='water':p.auto==='hill'&&p.hill===(k==='hillTop'?'top':'low');
  if(!on){let n=0;for(const l of lines){const keep=l.pts.filter(p=>!mine(p));if(keep.length>=2&&keep.length<l.pts.length){n+=l.pts.length-keep.length;l.pts=keep}}
    changed();toast(n?`${name}: off. Took out ${n} point${n===1?'':'s'} it added. Turn it back on to add them again.`:`${name}: off.`);return}
  changed();
  if(!lines.length)return toast(`${name}: on. They are added when you draw a fence.`);
  if(k==='autoRoads'||k==='autoRivers'){toast(`Looking for ${k==='autoRoads'?'roads':'rivers and creeks'} along the fence…`);for(const l of lines)await findCrossings(l.id,true);return}
  let n=0,wait=0;for(const l of lines){if(!evOf(l)){wait++;continue}n+=hillBraces(l)}
  if(n)changed();if(wait)scheduleElev();
  toast(n?`Added ${n} brace${n===1?'':'s'} on hills. Drag them to where you want them.`:wait?'Checking the ground heights along the fence…':'No hills steep enough for a brace on this job. The rule is on each fence type, under Braces.');
}
