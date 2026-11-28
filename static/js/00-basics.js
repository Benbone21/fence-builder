const $=s=>document.querySelector(s);
const uid=p=>p+'_'+Math.random().toString(36).slice(2,9);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FT=3.28084;
const money=n=>'$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtFt=n=>Math.round(n||0).toLocaleString('en-US')+' ft';
const fmtQ=q=>Number.isInteger(q)?q.toLocaleString('en-US'):q.toLocaleString('en-US',{maximumFractionDigits:1});
const roundQ=(q,u)=>/^(ft|feet|foot|lb|lbs|gal|yd)$/i.test(u||'')?Math.ceil(q*10-1e-9)/10:Math.ceil(q-1e-9);

