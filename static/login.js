/* Fence Builder sign-in page: sign in, pick a new password, use a one-time invite link, or set up the first admin. */
(() => {
  const $ = s => document.querySelector(s);
  const show = id => { for (const f of ['#fSignin', '#fNew', '#fSetup', '#wait']) $(f).hidden = f !== id; };
  const say = t => { const m = $('#msg'); m.textContent = t || ''; m.hidden = !t; if (t) m.scrollIntoView({block: 'nearest'}); };
  const invite = (location.hash.match(/^#invite=([\w-]{20,200})$/) || [])[1];
  if (invite) history.replaceState(null, '', location.pathname);   // the link's code does not stay in the address bar
  let oldPw = '', csrf = '';
  // a product sent by the "Add to Fence Builder" bookmark (#add=...) goes on to the app after signing in
  const carry = /^#add=/.test(location.hash) ? location.hash : '';
  const go = () => location.replace('./' + carry);

  async function post(path, body, headers = {}) {
    const r = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  const busy = (form, on) => { const b = form.querySelector('button:not([type])'); if (b) { b.disabled = on; } };

  function newPasswordForm(kind) {
    show('#fNew');
    $('#oldBox').hidden = kind === 'invite' || !!oldPw;
    if (kind === 'invite') {
      $('#newT').textContent = 'Choose your password';
      $('#newL').textContent = 'Welcome to Fence Builder. Pick a password only you know. You will use it with your user name to sign in.';
    }
    (kind === 'invite' || oldPw ? $('#n1') : $('#old')).focus();
  }

  async function start() {
    let st = {};
    try { st = await (await fetch('api/auth/status', {cache: 'no-store'})).json(); } catch (e) {
      show('#wait'); $('#wait').textContent = 'Fence Builder is not answering. Check the server is running, then reload this page.'; return;
    }
    if (st.mode !== 'multi') return go();          // a single-user copy has no sign-in
    $('#warn').hidden = !st.warn_plain;
    if (invite) return newPasswordForm('invite');
    if (st.setup) { show('#fSetup'); $('#code').focus(); return; }
    if (st.signed_in && st.must_change) {
      try { csrf = (await (await fetch('api/auth/me', {cache: 'no-store'})).json()).csrf || ''; } catch (e) {}
      return newPasswordForm('change');
    }
    if (st.signed_in) return go();
    show('#fSignin'); $('#u').focus();
  }

  $('#fSignin').onsubmit = async e => {
    e.preventDefault(); say(''); busy(e.target, true);
    try {
      const pw = $('#p').value;
      const j = await post('api/auth/login', {username: $('#u').value, password: pw, remember: $('#remember').checked});
      if (j.must_change) {
        oldPw = pw;
        try { csrf = (await (await fetch('api/auth/me', {cache: 'no-store'})).json()).csrf || ''; } catch (e2) {}
        return newPasswordForm('change');
      }
      go();
    } catch (err) { say(err.message); $('#p').select(); } finally { busy(e.target, false); }
  };

  $('#fNew').onsubmit = async e => {
    e.preventDefault(); say('');
    const n1 = $('#n1').value, n2 = $('#n2').value;
    if (n1 !== n2) return say('The two passwords are not the same. Type them again.');
    busy(e.target, true);
    try {
      if (invite) await post('api/auth/invite', {code: invite, password: n1});
      else await post('api/auth/password', {old: oldPw || $('#old').value, new: n1}, {'X-CSRF-Token': csrf});
      go();
    } catch (err) { say(err.message); } finally { busy(e.target, false); }
  };

  $('#fSetup').onsubmit = async e => {
    e.preventDefault(); say('');
    if ($('#s1').value !== $('#s2').value) return say('The two passwords are not the same. Type them again.');
    busy(e.target, true);
    try {
      await post('api/auth/setup', {code: $('#code').value, name: $('#sn').value, username: $('#su').value, password: $('#s1').value});
      go();
    } catch (err) { say(err.message); } finally { busy(e.target, false); }
  };

  // the Windows app showing this server can go back to the jobs kept on that computer
  const inApp = () => !!(window.pywebview && window.pywebview.api && window.pywebview.api.use_local);
  const showLocal = () => { $('#local').hidden = !inApp(); };
  $('#bLocal').onclick = () => { try { window.pywebview.api.use_local(); } catch (e) { say('Could not switch back.'); } };
  addEventListener('pywebviewready', showLocal);
  showLocal();
  start();
})();
