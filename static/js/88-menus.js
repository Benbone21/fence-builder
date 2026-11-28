/* ---------- the small drop-down menus on the map toolbar (Show, More) ---------- */
// They are <details> boxes: a click on the button opens one. Only one is open at a time, and it closes when you pick
// something in it (except the on/off choices, so you see them change), click anywhere else, or press Esc.
{
  const menus=()=>[...document.querySelectorAll('details.menu')];
  const closeAll=keep=>{for(const m of menus())if(m!==keep&&m.open)m.open=false};
  for(const m of menus()){
    m.addEventListener('toggle',()=>{if(m.open)closeAll(m)});
    m.querySelector('.menupop')?.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.classList.contains('check'))setTimeout(()=>{m.open=false},0)});
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('details.menu'))closeAll(null)});
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;const m=menus().find(x=>x.open);if(!m)return;
    e.stopPropagation();m.open=false;m.querySelector('summary')?.focus();
  },true);
  // the on/off choices say whether they are on, for screen readers too
  const sync=()=>{for(const b of document.querySelectorAll('.menupop .check'))b.setAttribute('aria-pressed',b.classList.contains('on')?'true':'false')};
  const mo=new MutationObserver(sync);for(const b of document.querySelectorAll('.menupop .check'))mo.observe(b,{attributes:true,attributeFilter:['class']});sync();
}
