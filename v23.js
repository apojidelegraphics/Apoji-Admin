// Apoji Admin 2.3 (needs supabase/nexus-v3.8.sql from the Nexus repo):
//   • permissions + access requests — mods and admins ask for one thing; the Owner and the high-admins they picked approve
//   • "active on" — which apps someone uses right now (Mac app, Windows app, Test Run, N28C, Apoji Admin), and when a
//     Test Run person gets the app
//   • 🧪 Testing — "needs testing" checklists that beta testers tick off in Nexus and Test Run
//   • 🧠 Training — the data beta testers share to train Nexus models, a mind map of the plan, and a JSONL export
//   • ⬇ Save image — for pictures in chats and bug reports
(function () {
  const { sb, $, esc, ago, when, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL38 = 'Run supabase/nexus-v3.8.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';
  const needSql = m => /admin_my_perms|user_presence|test_items|training_|admin_perm|presence_ping|PGRST20|42P01|42883|does not exist/i.test(String(m || ''));
  const sqlMsg = m => needSql(m) ? SQL38 : m;

  // =========================================================== permissions
  const PERMS = {
    users_edit: ['✏️ Edit user accounts', 'Change names, usernames, pictures, emails and passwords of regular accounts'],
    users_create: ['＋ Make new profiles', 'Create Nexus accounts from the Users page'],
    changelog: ['✉ Email the changelog', 'Send release emails from Releases'],
    axiom: ['🔺 Axiom', 'See and change Axiom (Apex) settings'],
    testing: ['🧪 Manage test checklists', 'Add, edit and archive what testers check'],
    training: ['🧠 Training data', 'See and export the examples beta testers share'],
    roles: ['🛡 Admin roles', 'Give and take admin roles'],
    maintenance: ['🛠 Maintenance', 'Turn parts of Nexus off for everyone'],
    flags: ['⚑ Feature flags', 'Move features between admins, beta testers and everyone']
  };
  NX.PERMS = PERMS;
  A.perms = { all: A.level === 'high-admin', approve: false, perms: [], pending: [] };
  NX.can = perm => !!(A.perms?.all || A.owner || (A.perms?.perms || []).some(p => p.perm === perm));
  NX.loadPerms = async () => {
    try { const { data, error } = await sb.rpc('admin_my_perms'); if (error) throw error; A.perms = data || A.perms; A.perms38 = true; }
    catch { A.perms = { all: A.level === 'high-admin' && !A.viewer, approve: !!A.owner, perms: [], pending: [] }; A.perms38 = false; }
    return A.perms;
  };
  // ask for one permission (a small sheet with a reason)
  NX.requestPerm = async (perm) => {
    const [label, what] = PERMS[perm] || [perm, ''];
    if ((A.perms?.pending || []).includes(perm)) return toast('You already asked. The Owner or an approver will decide.');
    const why = await NX.ask(`Ask for access: ${label}`, { note: `${what}. The Owner (or a high-admin they picked) gets your request and can give it for a while or for good.`, placeholder: 'Why do you need it? (optional)', ok: 'Send request', multiline: true });
    if (why === null) return;
    const { data, error } = await sb.rpc('admin_request_perm', { p_perm: perm, p_why: why || '' });
    if (error || !data?.ok) return toast(error ? sqlMsg(error.message) : data?.error || 'Couldn’t send it.', true);
    await NX.loadPerms(); toast('✓ Request sent');
  };
  const reqButton = perm => `<button class="btn sm" data-reqperm="${perm}">${(A.perms?.pending || []).includes(perm) ? '⏳ Asked for access' : '🔑 Request access'}</button>`;
  NX.reqButton = reqButton;
  document.addEventListener('click', e => { const b = e.target.closest('[data-reqperm]'); if (b) { e.preventDefault(); NX.requestPerm(b.dataset.reqperm).then(() => { b.textContent = '⏳ Asked for access'; }); } });

  // =========================================================== "active on"
  const SURF = { mac: ['🍎', 'Mac app'], windows: ['🪟', 'Windows app'], linux: ['🐧', 'Linux app'], test_run: ['🧪', 'Test Run'], phone: ['📱', 'N28C'], admin: ['🛡', 'Apoji Admin'] };
  const LIVE = 4 * 60e3;
  NX.SURF = SURF;
  NX.presenceFor = async ids => {
    if (!ids.length) return {};
    const { data, error } = await sb.from('user_presence').select('user_id,surface,version,seen_at,first_seen').in('user_id', ids);
    if (error) return {};
    const out = {}; for (const r of data || []) (out[r.user_id] ||= []).push(r); return out;
  };
  // chips: 🟢 when they're using it right now
  NX.surfaceChips = (rows = [], { full = false } = {}) => (rows || []).slice().sort((a, b) => new Date(b.seen_at) - new Date(a.seen_at)).map(r => {
    const [ic, name] = SURF[r.surface] || ['•', r.surface], live = Date.now() - new Date(r.seen_at) < LIVE;
    return `<span class="surf ${live ? 'live' : ''}" title="${esc(name)}${r.version ? ' ' + esc(r.version) : ''} · ${live ? 'active now' : 'last seen ' + ago(r.seen_at)}">${ic}${full ? ' ' + esc(name) : ''}${full && r.version ? ` <small>${esc(r.version)}</small>` : ''}${live ? '<i></i>' : ''}</span>`;
  }).join('') || '<span class="muted">—</span>';
  // the Software card in someone's profile
  NX.softwareCard = async uid => {
    const [{ data: rows, error }, { data: ev }] = await Promise.all([
      sb.from('user_presence').select('surface,version,seen_at,first_seen').eq('user_id', uid),
      sb.from('user_events').select('kind,detail,created_at').eq('user_id', uid).order('created_at', { ascending: true }).limit(30)]);
    if (error) return `<div class="card"><h3>💻 What they use</h3><p class="muted" style="margin:0">${esc(sqlMsg(error.message))}</p></div>`;
    const list = (rows || []).slice().sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen));
    const live = list.filter(r => Date.now() - new Date(r.seen_at) < LIVE);
    const story = list.map(r => `${SURF[r.surface]?.[1] || r.surface} (${new Date(r.first_seen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`).join(' → ');
    const got = (ev || []).find(e => e.kind === 'got_app');
    return `<div class="card"><h3>💻 What they use ${live.length ? `<span class="pill p-approved">ACTIVE NOW · ${live.map(r => SURF[r.surface]?.[1]).join(', ').toUpperCase()}</span>` : ''}</h3>
      ${list.length ? `<table class="cards"><tr><th>App</th><th>Version</th><th>Last seen</th><th>Since</th></tr>${list.map(r => `<tr><td>${SURF[r.surface]?.[0] || ''} ${esc(SURF[r.surface]?.[1] || r.surface)}</td><td class="muted">${esc(r.version || '—')}</td><td>${Date.now() - new Date(r.seen_at) < LIVE ? '<b class="ok">now</b>' : ago(r.seen_at)}</td><td class="muted">${when(r.first_seen).split(',')[0]}</td></tr>`).join('')}</table>
        <p class="muted" style="margin:8px 0 0">${esc(story)}${got ? ` · 🎉 got the ${got.detail?.surface === 'windows' ? 'Windows' : 'Mac'} app ${ago(got.created_at)}` : ''}</p>` : '<p class="muted" style="margin:0">Nothing yet. Apps report in once they’re on Nexus 3.8, Test Run 3.8 or Apoji Admin 2.3.</p>'}</div>`;
  };
  // this portal reports in too, every 2 minutes while open
  const ping = () => { if (A.user) sb.rpc('presence_ping', { p_surface: 'admin', p_version: (window.apojiDesktop ? 'app ' : 'web ') + (NX.VERSION || '2.3.0') }).then(() => {}, () => {}); };
  setTimeout(ping, 4000); setInterval(ping, 120e3);
  // 🎉 a Test Run person just installed the app; 🔑 someone asked for admin access
  setTimeout(() => {
    try {
      sb.channel('v23-events').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_events' }, async p => {
        if (p.new?.kind !== 'got_app') return;
        const { data } = await sb.from('profiles').select('username,nickname').eq('id', p.new.user_id).maybeSingle();
        NX.notify?.({ kind: 'requests', title: `🎉 ${data?.nickname || data?.username || 'A Test Run user'} got the ${p.new.detail?.surface === 'windows' ? 'Windows' : 'Mac'} app`, body: 'They moved from Test Run to the desktop app.', onClick: () => NX.go('users', { arg: p.new.user_id }) });
      }).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_perm_requests' }, p => {
        if (!A.perms?.approve) return;
        const who = NX.adminById?.(p.new.user_id);
        NX.notify?.({ kind: 'requests', title: '🔑 Admin access request', body: `${who ? NX.nameOf(who) : 'An admin'} asked for ${PERMS[p.new.perm]?.[0] || p.new.perm}${p.new.why ? ': ' + p.new.why : ''}`, tab: 'perms' });
      }).subscribe();
    } catch {}
  }, 3000);

  // =========================================================== ⬇ save image
  NX.saveImage = async (src, name = 'image') => {
    try {
      const blob = src.startsWith('blob:') || src.startsWith('data:') || /^https?:/.test(src) ? await (await fetch(src)).blob() : null;
      if (!blob) throw new Error('nothing to save');
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `${String(name).replace(/[^\w .-]+/g, '').slice(0, 60) || 'image'}.${ext}`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); toast('⬇ Saved');
    } catch (e) { toast('Couldn’t save that picture: ' + e.message, true); }
  };
  document.addEventListener('click', e => { const b = e.target.closest('[data-saveimg]'); if (!b) return; e.preventDefault(); e.stopPropagation(); const img = b.dataset.saveimg ? { src: b.dataset.saveimg } : b.closest('.ph, .lightbox, .fb-pic')?.querySelector('img'); if (img?.src) NX.saveImage(img.src, b.dataset.name || 'nexus-image'); }, true);

  // =========================================================== 🔐 Admin access (requests, grants, approvers)
  P.perms = async () => {
    await NX.loadPerms();
    if (!A.perms38) return NX.main(`<h1>🔐 Admin access</h1><div class="card">${SQL38}</div>`);
    const approve = A.perms.approve;
    const [{ data: reqs }, { data: grants }, { data: apprs }] = await Promise.all([
      sb.from('admin_perm_requests').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('admin_permissions').select('*').order('granted_at', { ascending: false }),
      sb.from('admin_perm_approvers').select('user_id')]);
    const name = id => { const a = NX.adminById?.(id); return a ? NX.nameOf(a) : 'someone'; };
    const pend = (reqs || []).filter(r => r.status === 'pending'), mine = (reqs || []).filter(r => r.user_id === A.user.id);
    const myPerms = A.perms.all ? Object.keys(PERMS) : (A.perms.perms || []).map(p => p.perm);
    const highs = (A.admins || []).filter(a => a.level === 'high-admin' && (A.tiers || {})[a.id] !== 'owner');
    NX.main(`<h1>🔐 Admin access</h1><p>The Owner and high-admins can do everything. Mods and admins ask for one thing at a time here, and the Owner (or a high-admin they picked as an approver) says yes, for a while or for good.</p>
      ${approve && pend.length ? `<div class="card"><h3>Waiting for you <span class="pill p-pending">${pend.length}</span></h3>${pend.map(r => `<div class="perm-req"><div><b>${esc(name(r.user_id))}</b> wants <b>${esc(PERMS[r.perm]?.[0] || r.perm)}</b><div class="muted">${esc(r.why || 'No reason given')} · ${ago(r.created_at)}</div></div>
        <select class="field sm" data-days="${r.id}"><option value="7">for 7 days</option><option value="30">for 30 days</option><option value="0">for good</option></select><button class="btn sm primary" data-ok="${r.id}">Approve</button><button class="btn sm" data-no="${r.id}">Decline</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>What you can do</h3>${A.perms.all ? '<p class="muted" style="margin:0">Everything (you’re the Owner or a high-admin).</p>' : `<div class="perm-grid">${Object.entries(PERMS).map(([k, [l, w]]) => { const has = myPerms.includes(k), g = (A.perms.perms || []).find(p => p.perm === k);
          return `<div class="perm ${has ? 'has' : ''}"><b>${esc(l)}</b><span class="muted">${esc(w)}</span>${has ? `<span class="pill p-approved">YES${g?.expires_at ? ' · until ' + new Date(g.expires_at).toLocaleDateString() : ''}</span>` : reqButton(k)}</div>`; }).join('')}</div>`}
        ${mine.length ? `<p class="muted" style="margin:10px 0 0">Your requests: ${mine.slice(0, 6).map(r => `${esc(PERMS[r.perm]?.[0] || r.perm)} <span class="pill p-${r.status === 'approved' ? 'approved' : r.status === 'declined' ? 'declined' : 'pending'}">${r.status.toUpperCase()}</span>`).join(' · ')}</p>` : ''}</div>
      ${approve ? `<div class="card"><h3>Who has extra access</h3>${(grants || []).length ? `<table class="cards"><tr><th>Admin</th><th>Access</th><th>Until</th><th></th></tr>${grants.map(g => `<tr><td>${esc(name(g.user_id))}</td><td>${esc(PERMS[g.perm]?.[0] || g.perm)}</td><td class="muted">${g.expires_at ? when(g.expires_at) : 'for good'}</td><td><button class="btn sm ghost" data-revoke="${g.user_id}|${g.perm}">Take away</button></td></tr>`).join('')}</table>` : '<p class="muted" style="margin:0">Nobody yet.</p>'}
        <div class="row" style="margin-top:10px"><select class="field" id="gWho">${(A.admins || []).filter(a => a.level !== 'high-admin').map(a => `<option value="${a.id}">${esc(NX.nameOf(a))} (${a.level})</option>`).join('')}</select><select class="field" id="gPerm">${Object.entries(PERMS).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select><select class="field" id="gDays"><option value="7">7 days</option><option value="30">30 days</option><option value="0">for good</option></select><button class="btn primary" id="gGo">Give access</button></div></div>` : ''}
      ${A.owner ? `<div class="card"><h3>Approvers <span class="muted">(only you can change this)</span></h3><p class="muted">High-admins who can approve requests and give access, besides you.</p>${highs.map(a => `<label class="row" style="gap:8px;padding:3px 0"><input type="checkbox" data-appr="${a.id}" ${(apprs || []).some(x => x.user_id === a.id) ? 'checked' : ''}> ${esc(NX.nameOf(a))}</label>`).join('') || '<p class="muted">No other high-admins yet.</p>'}</div>` : ''}`, { cards: false });
    const done = (r, ok = '✓ Done') => { const d = r.data; if (r.error || !d?.ok) return toast(r.error ? sqlMsg(r.error.message) : d?.error || 'Couldn’t do that.', true); toast(ok); P.perms(); };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ok) return done(await sb.rpc('admin_decide_perm', { p_id: +b.dataset.ok, p_ok: true, p_days: +document.querySelector(`[data-days="${b.dataset.ok}"]`).value || null }), '✓ Approved');
      if (b.dataset.no) return done(await sb.rpc('admin_decide_perm', { p_id: +b.dataset.no, p_ok: false }), 'Declined');
      if (b.dataset.revoke) { const [u, p] = b.dataset.revoke.split('|'); if (!confirm('Take this access away?')) return; return done(await sb.rpc('admin_revoke_perm', { p_user: u, p_perm: p }), 'Taken away'); }
      if (b.id === 'gGo') return done(await sb.rpc('admin_grant_perm', { p_user: $('gWho').value, p_perm: $('gPerm').value, p_days: +$('gDays').value || null }), '✓ Access given');
    };
    $('main').onchange = async e => { const c = e.target.closest('[data-appr]'); if (c) done(await sb.rpc('admin_set_approver', { p_user: c.dataset.appr, p_on: c.checked }), c.checked ? '✓ Approver added' : 'Approver removed'); };
  };

  // =========================================================== 🧪 Testing ("needs testing" checklists)
  const PLAT = { all: '🌐 Everywhere', mac: '🍎 Mac', windows: '🪟 Windows', web: '🧪 Test Run', phone: '📱 N28C', admin: '🛡 Apoji Admin' };
  const ST = { pass: ['✅', 'Pass'], fail: ['❌', 'Fail'], skip: ['⏭', 'Skip'] };
  A.testRel = A.testRel || '';
  P.testing = async () => {
    const [{ data: items, error }, { data: res }] = await Promise.all([
      sb.from('test_items').select('*').eq('archived', false).order('release', { ascending: false }).order('sort').order('id'),
      sb.from('test_results').select('*')]);
    if (error) return NX.main(`<h1>🧪 Testing</h1><div class="card">${esc(sqlMsg(error.message))}</div>`);
    const rels = [...new Set((items || []).map(i => i.release))];
    if (!A.testRel || !rels.includes(A.testRel)) A.testRel = rels[0] || '';
    const list = (items || []).filter(i => i.release === A.testRel), byItem = {};
    for (const r of res || []) (byItem[r.item_id] ||= []).push(r);
    const can = NX.can('testing'), people = id => { const a = NX.adminById?.(id); return a ? NX.nameOf(a) : 'a tester'; };
    const tally = rs => ({ pass: rs.filter(r => r.status === 'pass').length, fail: rs.filter(r => r.status === 'fail').length, skip: rs.filter(r => r.status === 'skip').length });
    const all = tally(list.flatMap(i => byItem[i.id] || [])), untested = list.filter(i => !(byItem[i.id] || []).length).length;
    const plats = Object.keys(PLAT).filter(p => list.some(i => i.platform === p) || (byItem && list.some(i => (byItem[i.id] || []).some(r => r.platform === p))));
    NX.main(`<h1>🧪 Testing</h1><p>What beta testers should check for each release. They tick items off in Nexus (Settings → Beta → Needs testing) and in Test Run (⋯ → Needs testing), with a note and a screenshot if something's wrong.</p>
      <div class="row" style="margin-bottom:10px"><select class="field" id="tRel">${rels.map(r => `<option ${r === A.testRel ? 'selected' : ''}>${esc(r)}</option>`).join('') || '<option value="">No releases yet</option>'}</select>
        <span class="sp"></span>${can ? '<button class="btn" id="tFill">✨ Fill from the release notes</button><button class="btn primary" id="tAdd">＋ Add an item</button>' : reqButton('testing')}</div>
      ${list.length ? `<div class="stats4"><div class="stat"><b>${list.length}</b><span>to test</span></div><div class="stat"><b class="ok">${all.pass}</b><span>passes</span></div><div class="stat ${all.fail ? 'hot' : ''}"><b>${all.fail}</b><span>fails</span></div><div class="stat"><b>${untested}</b><span>not tested yet</span></div></div>` : ''}
      ${list.length ? `<div class="card"><h3>By platform</h3><table class="cards test-grid"><tr><th>Item</th>${plats.map(p => `<th>${PLAT[p]}</th>`).join('')}</tr>${list.map(i => { const rs = byItem[i.id] || [];
          return `<tr class="click" data-titem="${i.id}"><td><b>${esc(i.title)}</b>${i.platform !== 'all' ? ` <span class="muted">${PLAT[i.platform]}</span>` : ''}</td>${plats.map(p => { const here = rs.filter(r => (r.platform || 'all') === p || (p === i.platform && !r.platform)); const t = tally(here);
            return `<td>${!here.length ? '<span class="muted">·</span>' : `${t.pass ? `<span class="tg pass">✅${t.pass}</span>` : ''}${t.fail ? `<span class="tg fail">❌${t.fail}</span>` : ''}${t.skip ? `<span class="tg skip">⏭${t.skip}</span>` : ''}`}</td>`; }).join('')}</tr>`; }).join('')}</table></div>` : `<div class="card empty">Nothing to test yet${can ? '. Add items, or fill them from the release notes.' : '.'}</div>`}
      <div id="tDetail"></div>`, { cards: false });
    const detail = id => {
      const i = list.find(x => x.id === +id); if (!i) return; const rs = byItem[i.id] || [];
      $('tDetail').innerHTML = `<div class="card"><div class="row"><h3 style="margin:0">${esc(i.title)}</h3><span class="muted">${PLAT[i.platform]}</span><span class="sp"></span>${can ? `<button class="btn sm" data-tedit="${i.id}">Edit</button><button class="btn sm ghost" data-tarch="${i.id}">Archive</button>` : ''}</div>
        ${i.steps ? `<p style="white-space:pre-wrap">${esc(i.steps)}</p>` : ''}
        ${rs.length ? rs.map(r => `<div class="test-res ${r.status}"><span>${ST[r.status][0]} <b>${esc(people(r.user_id))}</b> <span class="muted">${esc(PLAT[r.platform] || r.platform || '')} · ${ago(r.updated_at)}</span></span>${r.note ? `<div>${esc(r.note)}</div>` : ''}${r.image ? `<div class="fb-pic" data-fbimg="${esc(r.image)}"><span class="spinner"></span></div>` : ''}<div class="test-acts">${r.status === 'fail' ? `<button class="btn sm" data-tbug="${i.id}|${r.user_id}">🐞 Make it a bug report</button>` : ''}${can && !r.reply ? `<button class="btn sm ghost" data-treply="${i.id}|${r.user_id}">Reply</button>` : ''}</div>
          ${r.reply ? `<div class="test-reply"><span class="muted">${esc((r.reply_by && NX.adminById?.(r.reply_by) ? NX.nameOf(NX.adminById(r.reply_by)) : 'The Apoji Team'))} replied · ${ago(r.reply_at)}</span><div>${esc(r.reply)}</div>${can ? `<div class="row"><button class="btn sm ghost" data-treply="${i.id}|${r.user_id}">Edit</button><button class="btn sm ghost" data-tunreply="${i.id}|${r.user_id}">Remove</button></div>` : ''}</div>` : ''}</div>`).join('') : '<p class="muted">No results yet.</p>'}</div>`;
      loadPics($('tDetail'));
    };
    const editItem = async it => {
      const { el, close } = NX.modal(`<h3>${it ? 'Edit item' : 'Add a test item'}</h3><div class="acct-grid"><label>Release</label><input class="field" id="tiR" value="${esc(it?.release || A.testRel || '')}" placeholder="3.8.0">
        <label>Where</label><select class="field" id="tiP">${Object.entries(PLAT).map(([k, l]) => `<option value="${k}" ${(it?.platform || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>What to check</label><input class="field" id="tiT" value="${esc(it?.title || '')}" maxlength="200" placeholder="The highlight orb shows up when you select text">
        <label>Steps</label><textarea class="field" id="tiS" rows="4" maxlength="2000" placeholder="1. Open Edge&#10;2. Select a sentence&#10;3. The orb should appear above it">${esc(it?.steps || '')}</textarea></div>
        <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="tiGo">Save</button></div>`);
      el.querySelector('#tiGo').onclick = async () => {
        const row = { release: el.querySelector('#tiR').value.trim(), platform: el.querySelector('#tiP').value, title: el.querySelector('#tiT').value.trim(), steps: el.querySelector('#tiS').value.trim() };
        if (!row.release || !row.title) return toast('Give it a release and a title.', true);
        const { error: er } = it ? await sb.from('test_items').update(row).eq('id', it.id) : await sb.from('test_items').insert({ ...row, created_by: A.user.id, sort: list.length });
        if (er) return toast(sqlMsg(er.message), true); A.testRel = row.release; close(); toast('✓ Saved'); P.testing();
      };
    };
    $('main').onchange = e => { if (e.target.id === 'tRel') { A.testRel = e.target.value; P.testing(); } };
    $('main').onclick = async e => {
      const b = e.target.closest('button'), row = e.target.closest('[data-titem]');
      if (b?.id === 'tAdd') return editItem(null);
      if (b?.id === 'tFill') {
        try {
          const ch = await (await fetch('https://apojidelegraphics.github.io/Nexus-28/whats-new/changes.json', { cache: 'no-store' })).json(); const latest = ch[0];
          const have = new Set(list.map(i => i.title));
          const rows = (latest.highlights || []).map((h, k) => ({ release: latest.version, platform: /windows|\bPC\b/i.test(h) && !/mac/i.test(h) ? 'windows' : /test run/i.test(h) ? 'web' : /N28C|phone/i.test(h) ? 'phone' : 'all', title: h.replace(/^\W+\s*/, '').replace(/[:.].*$/, '').slice(0, 200), steps: h.slice(0, 2000), sort: k, created_by: A.user.id })).filter(r => !have.has(r.title));
          if (!rows.length) return toast('Nothing new in the release notes.');
          const { error: er } = await sb.from('test_items').insert(rows); if (er) throw er; A.testRel = latest.version; toast(`✓ Added ${rows.length} items for ${latest.version}`); return P.testing();
        } catch (er) { return toast('Couldn’t read the release notes: ' + sqlMsg(er.message), true); }
      }
      if (b?.dataset.tedit) return editItem(list.find(x => x.id === +b.dataset.tedit));
      if (b?.dataset.tarch) { const { error: er } = await sb.from('test_items').update({ archived: true }).eq('id', +b.dataset.tarch); if (er) return toast(er.message, true); toast('Archived'); return P.testing(); }
      // 2.8.1: reply to a tester's result (they see it in Nexus → Settings → Beta → Needs testing, with a notification)
      if (b?.dataset.treply || b?.dataset.tunreply) {
        const [iid, uid] = (b.dataset.treply || b.dataset.tunreply).split('|'), r = (byItem[iid] || []).find(x => x.user_id === uid);
        const send = async body => { const { data, error: er } = await sb.rpc('admin_test_reply', { p_item: +iid, p_user: uid, p_body: body });
          if (er || !data?.ok) return toast(er ? (/admin_test_reply|42883|PGRST20/.test(er.message) ? 'Run supabase/apoji-admin-2.8.1.sql in Supabase → SQL Editor.' : sqlMsg(er.message)) : data.error, true);
          if (r) Object.assign(r, { reply: body.trim() || null, reply_by: body.trim() ? A.user.id : null, reply_at: data.reply_at }); toast(body.trim() ? '✓ Reply sent' : 'Reply removed'); detail(iid); return true; };
        if (b.dataset.tunreply) { if (!confirm('Remove this reply?')) return; return send(''); }
        const host = b.closest('.test-res'); if (host.querySelector('.test-rbox')) return host.querySelector('.test-rbox textarea').focus();
        host.insertAdjacentHTML('beforeend', `<div class="test-rbox"><textarea class="field" rows="2" maxlength="1000" placeholder="Reply to ${esc(people(uid))}… (e.g. Fixed in the next build, can you try again?)">${esc(r?.reply || '')}</textarea><div class="row"><span class="sp"></span><button class="btn sm" data-tcancel>Cancel</button><button class="btn sm primary" data-tsendreply>Send reply</button></div></div>`);
        const box = host.querySelector('.test-rbox'); box.querySelector('textarea').focus();
        box.querySelector('[data-tcancel]').onclick = ev => { ev.stopPropagation(); box.remove(); };
        box.querySelector('[data-tsendreply]').onclick = async ev => { ev.stopPropagation(); const v = box.querySelector('textarea').value; if (!v.trim()) return toast('Write a reply first.', true); ev.target.disabled = true; if (!await send(v)) ev.target.disabled = false; };
        return;
      }
      if (b?.dataset.tsendreply || b?.dataset.tcancel) return;
      if (b?.dataset.tbug) {
        // 2.8.1: made on the server (admin_test_to_bug). Inserting it here under the tester broke the reports' insert policy.
        const [iid, uid] = b.dataset.tbug.split('|'); b.disabled = true;
        const { data, error: er } = await sb.rpc('admin_test_to_bug', { p_item: +iid, p_user: uid }); b.disabled = false;
        if (er || !data?.ok) return toast(er ? (/admin_test_to_bug|42883|PGRST20/.test(er.message) ? 'Run supabase/apoji-admin-2.8.2.sql in Supabase → SQL Editor.' : sqlMsg(er.message)) : data.error, true);
        toast('🐞 Bug report made'); return NX.go('feedback', { arg: String(data.id) });
      }
      if (row) detail(row.dataset.titem);
    };
  };

  // pictures stored in the private feedback-files bucket → signed links (shared by Feedback and Testing)
  async function loadPics(root) {
    for (const el of root.querySelectorAll('[data-fbimg]:not([data-done])')) {
      el.dataset.done = 1;
      const { data } = await sb.storage.from('feedback-files').createSignedUrl(el.dataset.fbimg, 3600);
      el.innerHTML = data?.signedUrl ? `<img src="${data.signedUrl}" alt="Screenshot" data-full><button class="btn sm save-img" data-saveimg="${data.signedUrl}" data-name="${esc(el.dataset.fbimg.split('/').pop().replace(/\.\w+$/, ''))}" title="Save image">⬇ Save image</button>` : '<span class="muted">Picture unavailable</span>';
    }
  }
  NX.loadPics = loadPics;

  // =========================================================== 🧠 Training
  // 2.4: a WORKING mind map. Each step shows live numbers; click one to see and do what happens there.
  A.trStep = A.trStep || 'use';
  A.trMode = A.trMode || NX.store?.get('trMode', 'tree') || 'tree';   // 2.5: Tree or Graph
  P.training = async () => {
    if (!NX.can('training')) return NX.main(`<h1>🧠 Training</h1><div class="card"><p>Training data is limited to people who were given access.</p>${reqButton('training')}</div>`, { cards: false });
    const { data: st, error } = await sb.rpc('admin_training_stats');
    if (error) return NX.main(`<h1>🧠 Training</h1><div class="card">${esc(/admin_training_stats|lessons|approved/.test(error.message) ? 'Run supabase/nexus-v3.9.sql (Nexus repo) in Supabase → SQL Editor.' : sqlMsg(error.message))}</div>`, { cards: false });
    const delta = st.up_rate_7d != null && st.up_rate_prev != null ? st.up_rate_7d - st.up_rate_prev : null;
    const pl = (k, w) => `${k} ${k == 1 ? w : w === 'person' ? 'people' : w + 's'}`, leaf = (id, label, extra = {}) => ({ id, label, ...extra });
    const counts = (obj, pre, names = {}) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => leaf(pre + k, `${names[k] || k}: ${v}`));
    // 2.6: the lessons themselves (and the pushes) are on the map too
    const [{ data: lessonRows }, { data: pushData }] = await Promise.all([
      sb.from('training_examples').select('id,lesson,prompt,agent,push_id').eq('approved', true).order('approved_at', { ascending: false }).limit(40),
      sb.rpc('admin_training_pushes').then(r => r, () => ({ data: null }))]);
    const pushes = pushData?.pushes || [], live = new Map(pushes.filter(p => !p.undone_at).map(p => [p.id, p.stage]));
    const STG = { admin: 'admins', beta: 'beta', all: 'everyone' };
    const lessonLeaves = (lessonRows || []).map(r => leaf('ls:' + r.id, `${r.lesson ? '📏 ' + r.lesson : r.prompt.replace(/\s+/g, ' ').slice(0, 60)} · ${STG[live.get(r.push_id)] || 'admins only'}`, { step: 'use', lessonId: r.id }));
    const pushLeaves = pushes.slice(0, 12).map(p => leaf('ps:' + p.id, `${p.title} · ${p.undone_at ? 'undone' : STG[p.stage]} · ${p.lessons} lesson${p.lessons === 1 ? '' : 's'}`, { step: 'ship' }));
    // 2.4.1: a Notion-style mind map. Click a step (or its ○) to fold it; click a step's name to open what you can do there.
    const STEPS = [
      { id: 'collect', label: '1 · Collect', sub: `${pl(st.total, 'example')} · ${st.week} this week`, color: '#3dffa0', children: [
        leaf('c-testers', `${st.testers_consenting}/${st.testers} beta testers sharing`), leaf('c-opt', `${pl(st.consenting, 'person')} opted in`),
        { id: 'c-src', label: 'By app', collapsed: true, children: counts(st.by_source, 'src:', Object.fromEntries(Object.entries(SURF).map(([k, v]) => [k, v[0] + ' ' + v[1]]))) },
        leaf('c-never', 'Never: incognito, Axiom, files, pictures')] },
      { id: 'clean', label: '2 · Clean', sub: 'Automatic, before saving', color: '#5ce1ff', children: [
        leaf('k-email', 'Emails → [email]'), leaf('k-key', 'API keys and tokens → [key]'), leaf('k-phone', 'Phone numbers → [phone]'), leaf('k-num', 'Card-like numbers → [number]'), leaf('k-pw', 'Passwords → [hidden]'), leaf('k-url', 'Links lose their ?tokens')] },
      { id: 'store', label: '3 · Store', sub: `${pl(st.people, 'person')} · Supabase`, color: '#b18cff', children: [
        leaf('s-up', `👍 ${st.up} good`), leaf('s-down', `👎 ${st.down} not good`), leaf('s-fix', `✏️ ${st.corrected} better answers written`),
        { id: 's-agent', label: 'By agent', collapsed: true, children: counts(st.by_agent, 'ag:') }] },
      { id: 'use', label: '4 · Use', sub: `${pl(st.lessons, 'lesson')} · ${pl(st.rules, 'rule')}`, color: '#ffd36b', children: [
        leaf('u-review', st.to_review ? `${st.to_review} waiting for review` : 'Nothing to review', { step: 'use' }), leaf('u-match', 'Agents see the 3 best-matching lessons'), leaf('u-rules', 'and every rule, on every answer'), leaf('u-where', 'Admins first, then push (6 · Ship)', { step: 'ship' }),
        ...(lessonLeaves.length ? [{ id: 'u-lessons', label: `📚 The lessons (${lessonLeaves.length}${lessonLeaves.length === 40 ? '+' : ''})`, collapsed: lessonLeaves.length > 6, step: 'use', children: lessonLeaves }] : [])] },
      { id: 'check', label: '5 · Check', sub: st.up_rate_7d != null ? `👍 ${st.up_rate_7d}% this week` : 'Not enough ratings yet', color: '#ff8a98', children: [
        leaf('k-prev', st.up_rate_prev != null ? `${st.up_rate_prev}% the week before` : 'Week before: no ratings'), leaf('k-delta', delta == null ? 'Change: —' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} points`), leaf('k-try', 'Try a question', { step: 'check' })] },
      { id: 'ship', label: '6 · Ship', sub: 'Push lessons, prompts, flags', color: '#9be37b', children: [
        leaf('p-push', '🚀 Push lessons: admins → beta → everyone', { step: 'ship' }),
        ...(pushLeaves.length ? [{ id: 'p-pushes', label: `🚀 Pushes (${pushes.length})`, collapsed: true, step: 'ship', children: pushLeaves }] : []),
        leaf('p-prompts', '✍ Agent prompts', { go: 'prompts' }), leaf('p-flags', '⚑ Feature flags: admins → beta → everyone', { go: 'flags' }), leaf('p-jsonl', '⬇ Export for fine-tuning (JSONL)', { step: 'store' })] }];
    STEPS.forEach((s, i) => { s.open = true; s.step = s.id; s.side = i < 3 ? 'right' : 'left'; s.collapsed = A.trFold?.[s.id] ?? s.id === 'clean'; });
    NX.main(`<h1>🧠 Training</h1><p>Beta testers share their chats (personal details stripped) to help train Nexus models; anyone else can opt in. You review the best examples and approve them as <b>lessons</b>: every agent (desktop and Test Run) looks up matching lessons and rules before it answers.</p>
      <div class="card mm-tree"><div class="mm-tools"><button class="btn sm ${A.trMode === 'graph' ? '' : 'on'}" data-tmode="tree" title="Mind map (Notion-style)">🌳 Tree</button><button class="btn sm ${A.trMode === 'graph' ? 'on' : ''}" data-tmode="graph" title="Graph (Obsidian-style)">◉ Graph</button></div><div id="trTree"></div><p class="muted mm-hint">Click a step to see what you can do there · its ○ folds it · drag to move, scroll to zoom</p></div>
      <div id="trPanel"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    const tree = { id: 'root', label: 'Training', sub: 'Nexus models', color: '#3dffa0', children: STEPS };
    const mt = MindTree.create($('trTree'), { mode: A.trMode, iconFor: NX.iconFor,
      onOpen: n => {
        if (n.go) return NX.go(n.go);
        const step = n.step || n.branch?.step; if (!step) return;
        A.trStep = step; trPanel(st); document.querySelectorAll('#trTree .mt-n').forEach(g => g.classList.toggle('mt-on', g.dataset.id === step));
        if (n.depth > 1) $('trPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      tip: n => n.depth === 1 ? `<b>${esc(n.label)}</b><small>${esc(n.sub || '')}</small><small>Click to see what you can do here</small>` : n.go ? '<small>Opens that page</small>' : n.step ? '<small>Click to open it below</small>' : ''
    });
    mt.set(tree);
    document.querySelector(`#trTree .mt-n[data-id="${A.trStep}"]`)?.classList.add('mt-on');
    // remember folds between visits
    $('trTree').addEventListener('pointerup', () => setTimeout(() => { A.trFold = Object.fromEntries(mt.nodes.filter(n => n.depth === 1).map(n => [n.id, !!n.collapsed])); }, 0));
    NX.trainingTree = mt;
    $('main').querySelector('.mm-tools').onclick = e => { const b = e.target.closest('[data-tmode]'); if (!b) return; A.trMode = b.dataset.tmode; NX.store.set('trMode', A.trMode); mt.setMode(A.trMode); document.querySelectorAll('.mm-tools [data-tmode]').forEach(x => x.classList.toggle('on', x === b)); };
    trPanel(st);
  };
  const exRow = (r, acts = '') => `<details class="tr-ex"><summary><span class="pill">${esc(SURF[r.source]?.[0] || '')} ${esc(r.agent || '?')}</span> ${r.rating > 0 ? '👍' : r.rating < 0 ? '👎' : ''}${r.correction ? ' ✏️' : ''}${r.approved ? ' <span class="pill p-approved">LESSON</span>' : ''}${NX.autoLabel ? ' ' + NX.autoLabel(r) : ''} ${esc(r.prompt.slice(0, 110))} <span class="muted">${ago(r.created_at)}</span></summary>
    <div class="tr-qa"><b>Asked</b><p>${esc(r.prompt)}</p><b>${esc(r.model || 'Answer')}</b><p>${esc(r.answer)}</p>${r.correction ? `<b>Their better answer</b><p>${esc(r.correction)}</p>` : ''}${r.lesson ? `<b>Rule</b><p>${esc(r.lesson)}</p>` : ''}<div class="row">${acts}</div></div></details>`;
  async function trPanel(st) {
    const el = $('trPanel'); if (!el) return;
    const k = A.trStep, card = (h, body) => `<div class="card"><h3>${h}</h3>${body}</div>`;
    const sel = 'id,source,agent,model,prompt,answer,rating,correction,approved,lesson,created_at';
    if (k === 'collect') {
      const [{ data: testers }, { data: cons }] = await Promise.all([sb.from('profiles').select('id,username,nickname').eq('is_beta_tester', true).limit(300), sb.from('training_consent').select('user_id,agreed_at,revoked_at')]);
      const ok = new Map((cons || []).filter(c => !c.revoked_at).map(c => [c.user_id, c])), name = p => p.nickname || p.username || 'someone';
      const yes = (testers || []).filter(p => ok.has(p.id)), no = (testers || []).filter(p => !ok.has(p.id));
      el.innerHTML = card('1 · Collect: who shares', `<p class="muted">Beta testers must share to keep beta features (Nexus pauses them until they agree). Anyone else can opt in from Settings → Beta. Never collected: incognito chats, Axiom, files and pictures.</p>
        <div class="two"><div><b>Sharing (${yes.length})</b><p>${yes.map(p => esc(name(p))).join(', ') || '—'}</p></div><div><b>Testers who haven't agreed (${no.length})</b><p>${no.map(p => esc(name(p))).join(', ') || 'Everyone has. 🎉'}</p><p class="muted">Their beta features are paused until they do.</p></div></div>
        <div class="two"><div class="card"><h3>By agent</h3>${bars(st.by_agent)}</div><div class="card"><h3>From</h3>${bars(st.by_source)}</div></div>`);
    } else if (k === 'clean') {
      el.innerHTML = card('2 · Clean: what gets stripped first', `<p class="muted">On the person's own device, before anything is sent:</p><ul class="clean-list"><li>Email addresses → <code>[email]</code></li><li>Phone numbers → <code>[phone]</code></li><li>API keys and tokens (OpenAI, OpenRouter, GitHub, Google, AWS, JWTs) → <code>[key]</code> / <code>[token]</code></li><li>Card-like numbers → <code>[number]</code>, ID numbers → <code>[id]</code></li><li>“my password is …” → <code>[hidden]</code></li><li>Link tokens (everything after <code>?</code> in a URL)</li><li>Very short chats are skipped</li></ul><p class="muted">People can delete everything they shared from Settings → Beta at any time; you can delete single examples under Store.</p>`);
    } else if (k === 'store') {
      const { data: rows } = await sb.from('training_examples').select(sel).order('created_at', { ascending: false }).limit(40);
      el.innerHTML = card('3 · Store: the latest examples', (rows || []).map(r => exRow(r, `<button class="btn sm ghost danger" data-trdel="${r.id}">Delete this example</button>`)).join('') || '<p class="muted">Nothing yet.</p>');
    } else if (k === 'use') {
      const qq = cols => sb.from('training_examples').select(cols).eq('approved', false).or('rating.neq.0,correction.not.is.null').order('created_at', { ascending: false }).limit(30);
      const [{ data: queue }, { data: lessons }] = await Promise.all([
        qq(sel + ',auto_label,auto_note').then(r => r.error ? qq(sel) : r),   // 2.5: auto-sort labels (nexus-v3.10.sql)
        sb.from('training_examples').select(sel).eq('approved', true).order('approved_at', { ascending: false }).limit(60)]);
      NX.trQueue = queue || [];
      el.innerHTML = card(`4 · Use: review → lessons <span class="pill p-pending">${(queue || []).length} TO REVIEW</span>${NX.trainingAutoSort && (queue || []).length ? ' <button class="btn sm" id="trAuto" title="The free model pre-sorts the queue: looks good, looks wrong, personal info">✨ Auto-sort</button>' : ''}`, `<p class="muted">Approved lessons go to admins first; push them to beta testers and everyone from <b>6 · Ship</b>. Approve the good ones (or the ones with a better answer). Approved examples become lessons: agents see the 3 that match a question best, plus every rule you write, before they answer.</p>
          ${(queue || []).map(r => exRow(r, `<input class="field sm" data-rule="${r.id}" placeholder="Optional rule, e.g. “Always give units”" maxlength="600" style="flex:1;min-width:200px"><button class="btn sm primary" data-approve="${r.id}">✓ Approve as a lesson</button><button class="btn sm ghost" data-skip="${r.id}">Skip</button>`)).join('') || '<p class="muted">Nothing waiting. Rated and corrected answers show up here.</p>'}`)
        + card(`📚 Lessons (${(lessons || []).length})`, (lessons || []).map(r => exRow(r, `<button class="btn sm" data-unapprove="${r.id}">Stop using it</button>`)).join('') || '<p class="muted">None yet.</p>')
        + card('⬇ Export', `<div class="row"><button class="btn" id="trJsonl" title="Chat-format JSONL: rated 👍 or corrected answers">Export for fine-tuning (JSONL)</button><button class="btn" id="trEval" title="Questions with 👎 or corrections">Export a test set</button></div>`);
    } else if (k === 'check') {
      const days = st.days || [], max = Math.max(1, ...days.map(d => d.n));
      el.innerHTML = card('5 · Check: is it getting better?', `<div class="stats4"><div class="stat"><b>${st.up_rate_7d ?? '—'}${st.up_rate_7d != null ? '%' : ''}</b><span>👍 rate, last 7 days</span></div><div class="stat"><b>${st.up_rate_prev ?? '—'}${st.up_rate_prev != null ? '%' : ''}</b><span>the 7 days before</span></div><div class="stat"><b>${st.lessons}</b><span>lessons in use</span></div><div class="stat"><b>${st.corrected}</b><span>better answers written</span></div></div>
        <div class="tr-days">${days.map(d => `<i style="height:${Math.round(d.n / max * 100)}%" title="${esc(d.day)}: ${d.n}"></i>`).join('') || '<span class="muted">No examples in the last 30 days.</span>'}</div><p class="muted" style="margin-top:4px">Examples per day, last 30 days</p>
        <h3 style="margin-top:14px">Try a question</h3><p class="muted">See which lessons an agent would get for it.</p><div class="row"><input class="field" id="trTry" placeholder="How far away is the Moon?" style="flex:1"><select class="field" id="trTryA" style="width:auto"><option>flash</option><option>lyte</option><option>neodela</option><option>paragon</option></select><button class="btn primary" id="trTryGo">Look up</button></div><pre class="info" id="trTryOut" hidden></pre>`);
    } else if (k === 'ship') {
      setTimeout(() => { const b = $('trPush'); if (b && NX.trainingShip) NX.trainingShip(b); }, 0);   // 2.5: push lessons (rollout with undo)
      el.innerHTML = '<div id="trPush"><div class="card"><span class="spinner"></span></div></div>' + card('6 · Ship', `<p>Lessons work right away, with no update needed. For bigger changes:</p><div class="row"><button class="btn" data-go="prompts">✍ Agent prompts</button><button class="btn" data-go="flags">⚑ Feature flags</button><button class="btn" data-go="testing">🧪 Testing</button><button class="btn" data-go="releases">🚀 Releases</button></div><p class="muted">Try a change with admins first, then beta testers, then everyone. Check the 👍 rate on step 5 before and after.</p>`);
    }
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      const upd = async (id, patch, msg) => { const { error: er } = await sb.from('training_examples').update(patch).eq('id', id); if (er) return toast(sqlMsg(er.message), true); toast(msg); P.training(); };
      if (b.dataset.approve) return upd(+b.dataset.approve, { approved: true, approved_by: A.user.id, approved_at: new Date().toISOString(), lesson: el.querySelector(`[data-rule="${b.dataset.approve}"]`)?.value.trim() || null }, '✓ Approved: agents use it now');
      if (b.dataset.skip) return upd(+b.dataset.skip, { rating: 0 }, 'Skipped');
      if (b.dataset.unapprove) return upd(+b.dataset.unapprove, { approved: false }, 'No longer used');
      if (b.dataset.trdel) { if (!confirm('Delete this example for good?')) return; const { error: er } = await sb.from('training_examples').delete().eq('id', +b.dataset.trdel); if (er) return toast(er.message, true); toast('Deleted'); return P.training(); }
      if (b.dataset.go) return NX.go(b.dataset.go);
      if (b.id === 'trAuto') { b.disabled = true; return NX.trainingAutoSort(NX.trQueue || [], () => trPanel(st)); }
      if (b.id === 'trTryGo') { const q = $('trTry').value.trim(); if (!q) return; const [{ data: h }, { data: r }] = await Promise.all([sb.rpc('training_lessons', { p_query: q, p_agent: $('trTryA').value, p_limit: 3 }), sb.rpc('training_rules', { p_agent: $('trTryA').value })]); const o = $('trTryOut'); o.hidden = false; o.textContent = (r || []).length || (h || []).length ? `Rules (${(r || []).length}):\n${(r || []).map(x => '• ' + x).join('\n')}\n\nMatching lessons (${(h || []).length}):\n${(h || []).map((x, i) => `${i + 1}. ${x.q}\n   → ${x.a}`).join('\n')}` : 'No lessons match this question. The agent answers on its own.'; return; }
      if (b.id === 'trJsonl') return exportAll(r => r.rating > 0 || r.correction, r => ({ messages: [{ role: 'user', content: r.prompt }, { role: 'assistant', content: r.correction || r.answer }], metadata: { agent: r.agent, features: r.features } }), `nexus-training-${new Date().toISOString().slice(0, 10)}.jsonl`);
      if (b.id === 'trEval') return exportAll(r => r.rating < 0 || r.correction, r => ({ agent: r.agent, question: r.prompt, bad_answer: r.answer, better: r.correction || null }), `nexus-test-set-${new Date().toISOString().slice(0, 10)}.jsonl`);
    };
  }
  const bars = obj => { const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]), max = Math.max(1, ...e.map(x => x[1])); return e.map(([k, n]) => `<div class="tbar"><span>${esc(SURF[k]?.[1] || k)}</span><i style="width:${Math.round(n / max * 100)}%"></i><b>${n}</b></div>`).join('') || '<span class="muted">—</span>'; };
  async function exportAll(filter, map, file) {
    toast('Preparing…'); const out = [];
    for (let off = 0; off < 50000; off += 1000) { const { data, error: er } = await sb.from('training_examples').select('agent,model,features,prompt,answer,rating,correction').order('id').range(off, off + 999); if (er) return toast(er.message, true); out.push(...data.filter(filter).map(map)); if (data.length < 1000) break; }
    const blob = new Blob([out.map(x => JSON.stringify(x)).join('\n') + '\n'], { type: 'application/jsonl' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); toast(`⬇ ${out.length} examples`);
  }

  // The plan, as a mind map: where the data comes from → how it's cleaned → what it trains → how we check it
  function mindMap() {
    // left column top→bottom (1 Collect, 2 Clean, 3 Store), right column top→bottom (4 Use, 5 Check, 6 Ship)
    const C = { x: 470, y: 225 }, W = 106;
    const branches = [
      { t: '1 · Collect', c: '#3dffa0', x: 300, y: 75, kids: ['Beta testers (required)', 'Anyone who opts in', '👍 / 👎 on answers', '✏️ Corrected answers', 'Never: incognito, Axiom'] },
      { t: '2 · Clean', c: '#5ce1ff', x: 260, y: 225, kids: ['Strip emails, phones, keys', 'Drop very short chats', 'Users can delete theirs'] },
      { t: '3 · Store', c: '#b18cff', x: 300, y: 375, kids: ['Supabase training_examples', 'Consent in training_consent', 'Admins with access only'] },
      { t: '4 · Use', c: '#ffd36b', x: 640, y: 75, kids: ['Test set for prompts', 'Nexus help knowledge', 'Fine-tune a small open model'] },
      { t: '5 · Check', c: '#ff8a98', x: 680, y: 225, kids: ['Compare 👍 rate before/after', 'Run the test set', 'Beta testers try it first'] },
      { t: '6 · Ship', c: '#9be37b', x: 640, y: 375, kids: ['New prompt or model', 'Feature flag: admins → beta → all', 'Release notes'] }
    ];
    let lines = '', nodes = '';
    for (const b of branches) {
      const left = b.x < C.x, edge = b.x + (left ? -W / 2 : W / 2);
      lines += `<path d="M${C.x},${C.y} C${(C.x + b.x) / 2},${C.y} ${(C.x + b.x) / 2},${b.y} ${b.x},${b.y}" stroke="${b.c}" stroke-width="3" fill="none" opacity=".75"/>`;
      b.kids.forEach((k, i) => {
        const ky = b.y + (i - (b.kids.length - 1) / 2) * 21, kx = edge + (left ? -34 : 34);
        lines += `<path d="M${edge},${b.y} C${(edge + kx) / 2},${b.y} ${(edge + kx) / 2},${ky} ${kx},${ky}" stroke="${b.c}" stroke-width="1.4" fill="none" opacity=".55"/>`;
        nodes += `<text x="${kx + (left ? -6 : 6)}" y="${ky + 4}" text-anchor="${left ? 'end' : 'start'}" class="mm-k">${esc(k)}</text>`;
      });
      nodes += `<rect x="${b.x - W / 2}" y="${b.y - 15}" width="${W}" height="30" rx="15" fill="#120e26"/><rect x="${b.x - W / 2}" y="${b.y - 15}" width="${W}" height="30" rx="15" fill="${b.c}" fill-opacity=".2" stroke="${b.c}"/><text x="${b.x}" y="${b.y + 5}" text-anchor="middle" class="mm-b" fill="${b.c}">${b.t}</text>`;
    }
    nodes += `<circle cx="${C.x}" cy="${C.y}" r="58" fill="#0f1f1a" stroke="#3dffa0" stroke-width="2"/><text x="${C.x}" y="${C.y - 4}" text-anchor="middle" class="mm-c">Training</text><text x="${C.x}" y="${C.y + 16}" text-anchor="middle" class="mm-c2">Nexus models</text>`;
    return `<div class="card mm"><h3>🗺 How model training works</h3><svg viewBox="0 0 940 450" role="img" aria-label="Mind map of how Nexus model training works: collect, clean, store, use, check, ship">${lines}${nodes}</svg></div>`;
  }
  NX.trainingMap = mindMap;
})();
