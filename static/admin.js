/* Fence Builder accounts page, for admins: add people, reset passwords, turn accounts off, see sign-ins. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const when = t => { if (!t) return 'never'; const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}); };
  const day = t => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString(undefined, {dateStyle: 'medium'}); };
  let csrf = '', me = '', users = [], onlyFails = false;
  let toastT;
  const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3500); };

  async function api(path, body) {
    const opt = body === undefined ? {cache: 'no-store'} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(body)};
    const r = await fetch('api/' + path, opt);
    if (r.status === 401) { location.replace('login'); throw Error('Please sign in again.'); }
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw Error(j.error || j.message || 'That did not work. Please try again.');
    return j;
  }

  // ----- a window with a form or a question -----
  function dialog(html, onOk) {
    return new Promise(res => {
      const d = $('#dlg');
      d.innerHTML = html;
      let done = false;
      const fin = v => { if (done) return; done = true; d.close(); res(v); };
      d.onclick = async e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'copy') { const t = d.querySelector('#secret')?.textContent || ''; navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Select it and copy it by hand')); return; }
        if (b.dataset.a !== 'ok' || !onOk) return fin(b.dataset.a === 'ok');
        const err = d.querySelector('.err');
        b.disabled = true;
        try { const v = await onOk(d); if (v !== false) fin(v); } catch (e2) { if (err) { err.textContent = e2.message; err.hidden = false; } } finally { b.disabled = false; }
      };
      d.onsubmit = e => { e.preventDefault(); d.querySelector('[data-a="ok"]')?.click(); };
      d.oncancel = e => { e.preventDefault(); fin(null); };
      d.showModal();
      d.querySelector('input,select,[data-a="ok"]')?.focus();
    });
  }
  const buttons = (ok, cls = 'pri') => `<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn big" type="button" data-a="no">Cancel</button><button class="btn big ${cls}" type="button" data-a="ok">${esc(ok)}</button></div>`;
  const howPick = (verb) => `<fieldset class="how"><legend class="f">How will they ${verb}?</legend>
      <label class="check"><input type="radio" name="how" value="temp" checked> With a temporary password I give them. They pick their own when they first sign in.</label>
      <label class="check"><input type="radio" name="how" value="link"> With a one-time link I send them. It works for 7 days.</label></fieldset>`;

  function showSecret(u, j, what) {
    const isLink = !!j.link, secret = j.link || j.password;
    return dialog(`<h2>${esc(what)}</h2>
      <p>${isLink ? `Send this link to <b>${esc(u.name)}</b>. It works once, for ${j.days || 7} days. Opening it lets them pick their password.` : `Give this temporary password to <b>${esc(u.name)}</b>. Their user name is <b>${esc(u.username)}</b>. When they sign in, they pick their own password.`}</p>
      <p class="secret" id="secret">${esc(secret)}</p>
      <p class="mut small">It is shown only now. Fence Builder keeps only a scrambled copy that can't be read back. Best given in person or by phone.</p>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn big" type="button" data-a="copy">Copy</button><button class="btn pri big" type="button" data-a="ok">Done</button></div>`);
  }

  async function addPerson() {
    const u = await dialog(`<form><h2>Add a person</h2>
      <label class="f" for="an">Their name</label><input id="an" autocomplete="off" required>
      <label class="f" for="au">User name (what they type to sign in)</label><input id="au" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="for example: maria">
      <p class="small mut" style="margin:4px 0 0">Small letters and numbers, no spaces. You can use . _ - or @ too.</p>
      <label class="f" for="ar">What they can do</label><select id="ar"><option value="user">Use Fence Builder</option><option value="admin">Use Fence Builder and manage accounts (admin)</option></select>
      ${howPick('sign in the first time')}
      <p class="err" hidden></p>${buttons('Add this person')}</form>`, async d => {
      const name = d.querySelector('#an').value.trim(), username = d.querySelector('#au').value.trim().toLowerCase();
      if (!name || !username) throw Error('Type their name and a user name.');
      const j = await api('admin/users', {name, username, role: d.querySelector('#ar').value, how: d.querySelector('[name=how]:checked').value});
      return j;
    });
    if (u) { await load(); showSecret(u.user, u, 'Account made for ' + u.user.name); }
  }

  async function act(id, what) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    try {
      if (what === 'reset') {
        const j = await dialog(`<form><h2>New password for ${esc(u.name)}</h2><p>Their old password stops working and they are signed out everywhere.</p>${howPick('sign in again')}<p class="err" hidden></p>${buttons('Reset the password')}</form>`,
          d => api(`admin/users/${id}/reset`, {how: d.querySelector('[name=how]:checked').value}));
        if (j) { await load(); showSecret(u, j, 'New password for ' + u.name); }
      } else if (what === 'disable') {
        if (await dialog(`<h2>Turn off ${esc(u.name)}'s account?</h2><p>They are signed out at once and can't sign in until you turn the account back on. Their jobs and prices are kept.</p><p class="err" hidden></p>${buttons('Turn it off', 'del')}`,
          () => api(`admin/users/${id}/disable`, {}))) toast(u.name + "'s account is turned off");
      } else if (what === 'enable') {
        await api(`admin/users/${id}/enable`, {}); toast(u.name + "'s account is on again");
      } else if (what === 'admin' || what === 'user') {
        await api(`admin/users/${id}/role`, {role: what});
        toast(what === 'admin' ? u.name + ' is now an admin' : u.name + ' is no longer an admin');
      } else if (what === 'rename') {
        await dialog(`<form><h2>Change the name</h2><label class="f" for="rn">Name</label><input id="rn" value="${esc(u.name)}"><p class="err" hidden></p>${buttons('Save')}</form>`,
          d => api(`admin/users/${id}/rename`, {name: d.querySelector('#rn').value}));
      } else if (what === 'delete') {
        const j = await dialog(`<form><h2>Delete ${esc(u.name)}'s account?</h2><p>They can't sign in any more, and their jobs, prices and settings are taken off this server. A copy is kept in the server's data folder, under <b>deleted</b>, in case it was a mistake.</p>
          <label class="f" for="dc">To be sure, type their user name: <b>${esc(u.username)}</b></label><input id="dc" autocomplete="off" autocapitalize="none" spellcheck="false">
          <p class="err" hidden></p>${buttons('Delete the account', 'del')}</form>`, d => api(`admin/users/${id}/delete`, {confirm: d.querySelector('#dc').value}));
        if (j) toast(u.name + "'s account is deleted" + (j.kept ? '. A copy is in ' + j.kept : ''));
      }
    } catch (e) { toast(e.message); }
    load();
  }

  const roleName = u => u.role === 'admin' ? 'Admin' : 'User';
  const stateOf = u => !u.active ? '<span class="tag warnt">Turned off</span>' : u.invite ? '<span class="tag">Waiting for them to use their link</span>' : u.must_change ? '<span class="tag">Has a temporary password</span>' : '<span class="tag okt">Active</span>';

  function renderPeople() {
    $('#people').innerHTML = users.length ? `<table class="ptable"><thead><tr><th>Name</th><th>User name</th><th>Role</th><th>Status</th><th>Added</th><th>Last signed in</th><th></th></tr></thead><tbody>${users.map(u => {
      const self = u.id === me;
      return `<tr><td><b>${esc(u.name)}</b>${self ? ' <span class="mut">(you)</span>' : ''}</td><td>${esc(u.username)}</td><td>${roleName(u)}</td><td>${stateOf(u)}${u.sessions ? `<div class="small mut">signed in on ${u.sessions} device${u.sessions > 1 ? 's' : ''}</div>` : ''}</td>
        <td>${esc(day(u.created))}</td><td>${esc(when(u.last_login))}</td>
        <td class="pbtns"><button class="btn" data-id="${u.id}" data-do="reset">Reset password</button><button class="btn" data-id="${u.id}" data-do="rename">Change name</button>
        ${self ? '' : `${u.active ? `<button class="btn" data-id="${u.id}" data-do="disable">Turn off</button>` : `<button class="btn pri" data-id="${u.id}" data-do="enable">Turn on</button>`}
        <button class="btn" data-id="${u.id}" data-do="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
        <button class="btn del" data-id="${u.id}" data-do="delete">Delete</button>`}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="mut">No accounts.</p>';
  }

  const EV = {
    signin: 'Signed in', signout: 'Signed out', signin_failed: 'Wrong user name or password', signin_blocked: 'Sign-in refused: too many tries',
    signin_refused: 'Sign-in refused: account turned off', password_changed: 'Changed their password', password_change_failed: 'Wrong password when changing it',
    user_created: 'Added an account', user_disabled: 'Turned an account off', user_enabled: 'Turned an account on', user_deleted: 'Deleted an account',
    user_renamed: 'Changed a name', role_changed: 'Changed what someone can do', password_reset_by_admin: 'Reset a password',
    invite_link_used: 'Used their one-time link', invite_link_bad: 'Tried a link that does not work', first_admin_created: 'First admin made',
    setup_code_wrong: 'Wrong setup code', data_moved_into_account: 'Jobs from before accounts moved into this account', starting_setup_saved: 'Saved the starting setup',
    blocked_cross_site_request: 'Blocked a request from another website', blocked_request_without_token: 'Blocked a request without its safety code',
    blocked_admin_request: 'Someone who is not an admin tried an admin action',
  };
  const PROBLEM = /failed|blocked|refused|wrong|bad/;
  async function loadEvents() {
    try {
      const j = await api('admin/events?n=300');
      const evs = j.events.filter(e => !onlyFails || PROBLEM.test(e.ev));
      $('#events').innerHTML = evs.length ? `<table class="ptable small"><thead><tr><th>When</th><th>What</th><th>Account</th><th>By</th><th>From</th></tr></thead><tbody>${evs.map(e =>
        `<tr${PROBLEM.test(e.ev) ? ' class="custp"' : ''}><td>${esc(when(e.t))}</td><td>${esc(EV[e.ev] || e.ev)}${e.role ? ' (' + esc(e.role) + ')' : ''}${e.locked ? ' <b>locked for a while</b>' : ''}</td><td>${esc(e.user || '')}</td><td>${esc(e.by || '')}</td><td class="mut">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="mut">Nothing yet.</p>';
    } catch (e) { $('#events').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function loadInfo() {
    try {
      const j = await api('admin/info');
      const w = $('#warn');
      if (j.warn_plain) { w.innerHTML = '<b>Passwords are travelling unencrypted.</b> You opened this page from outside your own network over plain http://. Anyone along the way could read passwords and jobs. Set up https (the steps are in the guide, "A domain name and https") before people sign in from outside.'; w.hidden = false; }
      else if (!j.https) { w.innerHTML = 'This server is used over plain http://. That is fine inside your own network. Before people sign in from outside it, set up https (the steps are in the guide, "A domain name and https").'; w.hidden = false; w.classList.remove('warnbox'); }
      const gb = j.disk_free == null ? '' : (j.disk_free / 1e9).toFixed(1) + ' GB';
      $('#info').innerHTML = `<table class="ptable"><tbody>
        <tr><td>Version</td><td>Fence Builder ${esc(j.version)}</td></tr>
        <tr><td>Connection</td><td>${j.https ? 'https (private)' : 'plain http'}</td></tr>
        <tr><td>Data folder (inside the server)</td><td><code>${esc(j.data_folder)}</code></td></tr>
        ${gb ? `<tr><td>Free disk space</td><td>${esc(gb)}</td></tr>` : ''}
        <tr><td>A sign-in lasts</td><td>${j.session_hours} hours, or ${j.remember_days} days with "Keep me signed in"</td></tr>
        <tr><td>Saving maps for offline</td><td>${j.offline === 'all' ? 'Everyone' : j.offline === 'admin' ? 'Admins only' : 'Turned off'}</td></tr>
        <tr><td>Your address, as the server sees it</td><td>${esc(j.your_ip)}</td></tr></tbody></table>`;
    } catch (e) { $('#info').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function load() {
    try { const j = await api('admin/users'); users = j.users; me = j.me; renderPeople(); } catch (e) { $('#people').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    loadEvents();
  }

  async function start() {
    try {
      const r = await fetch('api/auth/me', {cache: 'no-store'});
      if (!r.ok) return location.replace('login');
      const j = await r.json();
      if (j.mode !== 'multi') return location.replace('./');
      if (j.user.role !== 'admin') return location.replace('./');
      csrf = j.csrf;
    } catch (e) { $('#people').innerHTML = '<p class="err">Fence Builder is not answering. Reload this page in a moment.</p>'; return; }
    $('#people').onclick = e => { const b = e.target.closest('[data-do]'); if (b) act(b.dataset.id, b.dataset.do); };
    $('#bAdd').onclick = addPerson;
    $('#bLog').onclick = () => { onlyFails = false; loadEvents(); };
    $('#bLogFails').onclick = () => { onlyFails = true; loadEvents(); };
    $('#bOut').onclick = async () => {
      try { await fetch('api/auth/logout', {method: 'POST', headers: {'X-CSRF-Token': csrf}}); } catch (e) {}
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('fence')) localStorage.removeItem(k); sessionStorage.clear(); } catch (e) {}
      location.replace('login');
    };
    load(); loadInfo();
  }
  start();
})();
