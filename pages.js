// Apoji Admin pages: dashboard, beta requests, feedback & bugs, reports, users, moderation, feature flags,
// announcements, maintenance, audit log and your settings.
(function () {
  const { sb, $, esc, when, ago, rpc, toast, av, nameOf, presence, PRES, main } = NX;
  const A = NX.A, P = NX.pages;
  const live = (tables, fn, ms = 1500) => { let t; const offs = tables.map(tb => NX.on(tb, () => { clearTimeout(t); t = setTimeout(fn, ms); })); const tab = A.tab; const stop = NX.on('poll', () => { if (A.tab === tab) fn(); }); const check = setInterval(() => { if (A.tab !== tab) { offs.forEach(o => o()); stop(); clearInterval(check); } }, 1000); };
  const sqlHint = e => NX.needSql(e.message) ? ' Run supabase/nexus-v2.2.sql in the SQL editor first.' : '';
  const csv = rows => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  function download(name, text, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  // =========================================================== Dashboard
  P.dashboard = async () => {
    const days = NX.store.get('dashDays', 30);
    if (!$('dash')) main(`<h1>Dashboard <span class="muted" id="dUpd" style="font-size:12px;font-weight:400"></span></h1><p>How Nexus is doing right now. Updates by itself.</p><div id="dash"><div class="empty"><span class="spinner"></span></div></div>`);
    let d; try { d = await rpc('admin_dashboard', { p_days: days }); } catch (e) { return main(`<h1>Dashboard</h1><div class="card err">${esc(e.message)}</div>`); }
    if (A.tab !== 'dashboard') return;
    const t = d.totals, rows = d.series || [];
    const tile = (n, l, tab, hot) => `<${tab ? `button data-go="${tab}"` : 'div'} class="stat ${hot && n ? 'hot' : ''}"><b>${(+n || 0).toLocaleString()}</b><span>${esc(l)}</span></${tab ? 'button' : 'div'}>`;
    const online = A.admins.filter(a => presence(a) !== 'offline');
    const tableOn = NX.store.get('dashTable', false);
    $('dash').innerHTML = `
      ${t.maintenance_on ? `<div class="banner warn">🛠 <span style="flex:1">${t.maintenance_on} maintenance switch${t.maintenance_on === 1 ? ' is' : 'es are'} on right now.</span><button class="btn sm" data-go="maint">Manage</button></div>` : ''}
      <div class="card" id="myDay"><span class="spinner"></span></div>
      <div class="grid">${tile(t.users, 'accounts', 'users')}${tile(t.new_7d, 'new this week', 'users')}${tile(t.active_today, 'active today')}${tile(t.active_7d, 'active this week')}
        ${tile(t.online_now, 'using Nexus now')}${tile(t.pending_requests, 'beta requests waiting', 'requests', 1)}${tile(t.new_feedback, 'new feedback & bugs', 'feedback', 1)}${tile(t.open_reports, 'open reports', 'reports', 1)}
        ${tile(t.beta_testers, 'beta testers', 'users')}${tile(t.moderated, 'suspended / banned', 'users')}${tile(t.spaces, 'Shared Spaces', 'moderation')}${tile(t.shared_agents, 'shared agents', 'moderation')}</div>
      <div class="row" style="margin-bottom:10px"><div class="tabsub" id="dRange" style="margin:0">${[14, 30, 90].map(n => `<button data-days="${n}" class="${n === days ? 'on' : ''}">${n} days</button>`).join('')}</div><span class="sp"></span>
        <label class="muted" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="dTable" ${tableOn ? 'checked' : ''}> Show numbers as tables</label></div>
      <div class="cols3">
        <div class="card"><h3>Active people per day</h3><div id="cActive"></div></div>
        <div class="card"><h3>Admins online <span class="muted">${online.length} of ${A.admins.length}</span>${A.level === 'high-admin' && A.tier !== 'viewer' ? '<span class="sp"></span><button class="btn sm" id="dNewAdmin" title="Make a new admin profile">＋ New admin profile</button>' : ''}</h3><div class="members">${A.admins.slice().sort((a, b) => ({ online: 0, idle: 1, dnd: 2, offline: 3 })[presence(a)] - ({ online: 0, idle: 1, dnd: 2, offline: 3 })[presence(b)]).slice(0, 8).map(a => { const p = presence(a); return `<div>${av(a, 'sm', true)}<span class="nm">${esc(nameOf(a))}<small><span class="prtxt ${p}">${PRES[p]}</span>${a.status_text ? ' · ' + esc(a.status_text) : ''}</small></span>${a.id !== A.user.id ? `<button class="btn sm" data-dm="${esc(a.id)}">💬</button>` : ''}</div>`; }).join('')}</div></div>
      </div>
      <div id="tryCard"></div>   <!-- 2.1: Test Run sits under active people + admins online -->
      <div class="cols">
        <div class="card"><h3>New accounts</h3><div id="cSign"></div></div>
        <div class="card"><h3>Shared Space posts</h3><div id="cPosts"></div></div>
      </div>
      <div class="cols">
        <div class="card"><h3>Versions in use <span class="muted">(last 14 days)</span></h3><b class="muted" style="font-size:12px">MAC APP</b><div id="vDesk"></div><b class="muted" style="font-size:12px;display:block;margin-top:10px">N28C</b><div id="vPhone"></div></div>
        <div class="card"><h3>Agents by chats <span class="muted">(free Nexus key)</span></h3><div id="cAgents"></div></div>
      </div>
      <div class="card"><h3>Latest activity</h3><div class="feed">${(d.feed || []).map(e => { const ic = { signup: '👋', beta_request: '🧪', feedback: '📮', report: '🚩', admin: '🛡', space: '👥' }[e.kind] || '•';
        const what = { signup: 'New account', beta_request: 'Beta request', feedback: 'Feedback', report: 'Content report', admin: String(e.what).replace(/_/g, ' '), space: 'New Shared Space' }[e.kind];
        return `<div>${`<span class="fi">${ic}</span>`}<span class="ft">${esc(what)}${e.who ? ' · ' + esc(e.who) : ''}<small>${esc(e.kind === 'admin' ? '' : e.what)}</small></span><time>${ago(e.at)}</time></div>`; }).join('') || '<div class="muted">Nothing yet.</div>'}</div></div>`;
    const draw = () => {
      const tbl = $('dTable')?.checked;
      if (tbl) { $('cActive').innerHTML = NXCharts.table(rows, [{ key: 'active_desktop', label: 'Mac & PC' }, { key: 'active_phone', label: 'N28C' }, { key: 'active', label: 'Total' }]); $('cSign').innerHTML = NXCharts.table(rows, [{ key: 'signups', label: 'Accounts' }]); $('cPosts').innerHTML = NXCharts.table(rows, [{ key: 'space_posts', label: 'Posts' }]); return; }
      NXCharts.line($('cActive'), rows, [{ key: 'active_desktop', label: 'Mac & PC', color: 'var(--s1)' }, { key: 'active_phone', label: 'N28C phone', color: 'var(--s2)' }]);
      NXCharts.bars($('cSign'), rows, 'signups', 'new accounts'); NXCharts.bars($('cPosts'), rows, 'space_posts', 'posts');
    };
    draw();
    const vers = src => (d.versions || []).filter(v => v.source === src).slice(0, 6).map(v => ({ label: 'v' + (v.version || '?'), value: v.users }));
    NXCharts.hbars($('vDesk'), vers('desktop')); NXCharts.hbars($('vPhone'), vers('phone'));
    NXCharts.hbars($('cAgents'), (d.agents || []).map(a => ({ label: a.name, value: +a.chats, sub: `${a.people} people` })));
    NX.tasks?.paintMyDay();
    // 2.0.3: Nexus Test Run (the web version) at a glance
    rpc('admin_try_stats').then(r => { const el = $('tryCard'); if (!el || !r?.success) return; el.innerHTML = `<div class="card"><h3>🧪 Test Run (web) <span class="sp"></span><a class="muted" href="https://apojidelegraphics.github.io/Nexus-28/try/" target="_blank" rel="noopener" style="font-size:12px">Open it ↗</a></h3>
      <div class="grid" style="margin:0">${[[r.people, 'people have used it'], [r.active_week, 'active this week'], [r.answers_today, 'free answers today'], [r.answers_week, 'answers this week'], [r.searches_week, 'web searches this week'], [r.chats, 'saved chats']].map(([n, l]) => `<div class="stat"><b>${(+n || 0).toLocaleString()}</b><span>${l}</span></div>`).join('')}</div>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">Take it down from Maintenance → 🧪 Test Run.</p></div>`; }).catch(() => {});
    $('dUpd').textContent = '· updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    $('main').onclick = e => {
      const g = e.target.closest('[data-go]'); if (g) return NX.go(g.dataset.go);
      const r = e.target.closest('[data-days]'); if (r) { NX.store.set('dashDays', +r.dataset.days); $('dash').innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return P.dashboard(); }
      if (e.target.id === 'dNewAdmin') return newProfile('admin');
      const dm = e.target.closest('[data-dm]'); if (dm) { NX.go('chat'); setTimeout(() => NX.chat.openRoom(NX.chat.dmRoom(dm.dataset.dm), true), 50); }
    };
    $('dTable').onchange = e => { NX.store.set('dashTable', e.target.checked); draw(); };
    if (!P.dashboard.wired) { P.dashboard.wired = true; setInterval(() => { if (A.tab === 'dashboard' && !document.hidden) P.dashboard(); }, 60e3); addEventListener('resize', () => { if (A.tab === 'dashboard') { clearTimeout(P.dashboard.rt); P.dashboard.rt = setTimeout(P.dashboard, 300); } }); }
  };

  // =========================================================== Beta requests
  P.requests = async () => {
    const filter = A.reqFilter || 'pending';
    main('<h1>Beta requests</h1><p>Loading…</p>');
    let q = sb.from('beta_requests').select('*').order('created_at', { ascending: false }).limit(200);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) return main(`<h1>Beta requests</h1><div class="card err">${esc(error.message)}${/beta_requests/.test(error.message) ? ' Run supabase/nexus-v2.0.sql first.' : ''}</div>`);
    const pend = data.filter(r => r.status === 'pending');
    main(`<h1>Beta requests</h1><p>People who asked to test new features (Settings → Account in the app). Approving turns beta on for their account right away.</p>
      <div class="row" style="margin-bottom:12px"><div class="tabsub" id="rf" style="margin:0">${['pending', 'approved', 'declined', 'all'].map(f => `<button data-f="${f}" class="${filter === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}${f === 'pending' && A.counts.requests ? `<b>${A.counts.requests}</b>` : ''}</button>`).join('')}</div><span class="sp"></span>
        ${filter === 'pending' && pend.length > 1 ? `<button class="btn" id="okAll">Approve all ${pend.length}</button>` : ''}</div>
      ${data.map(r => `<div class="card req"><div class="who"><b>${esc(r.username || '(no username)')}</b> <span class="pill p-${esc(r.status)}">${esc(r.status.toUpperCase())}</span>
        <div class="muted">${esc(r.email)} · ${when(r.created_at)} · ${esc(r.source)} ${esc(r.app_version)} · <a href="#" data-user="${esc(r.user_id)}">profile</a></div>
        ${r.why ? `<q><b class="muted">Why:</b> ${esc(r.why)}</q>` : ''}${r.uses ? `<q><b class="muted">Uses Nexus for:</b> ${esc(r.uses)}</q>` : ''}
        ${r.status !== 'pending' ? `<div class="muted" style="margin-top:6px">${r.status === 'approved' ? 'Approved' : 'Declined'} ${when(r.reviewed_at)}${r.note ? ' · “' + esc(r.note) + '”' : ''}</div>` : ''}</div>
        <div class="acts">${r.status === 'pending' ? `<input class="field" placeholder="Note (optional)" data-note="${esc(r.id)}"><button class="btn primary" data-ok="${esc(r.id)}">✓ Approve</button><button class="btn danger" data-no="${esc(r.id)}">Decline</button>`
          : r.status === 'declined' ? `<button class="btn" data-ok="${esc(r.id)}">Approve after all</button>` : ''}</div></div>`).join('') || `<div class="empty">No ${filter === 'all' ? '' : filter + ' '}requests. 🎉</div>`}`);
    $('main').onclick = async e => {
      const f = e.target.closest('[data-f]'); if (f) { A.reqFilter = f.dataset.f; return P.requests(); }
      const u = e.target.closest('[data-user]'); if (u) { e.preventDefault(); return userDrawer(u.dataset.user); }
      if (e.target.id === 'okAll') {
        if (!confirm(`Approve all ${pend.length} pending requests?`)) return;
        e.target.disabled = true; let n = 0;
        for (const r of pend) { try { await rpc('admin_review_beta_request', { request_id: r.id, approve: true, review_note: '' }); n++; } catch {} }
        toast(`✓ Approved ${n}`); NX.refreshCounts(); return P.requests();
      }
      const b = e.target.closest('[data-ok],[data-no]'); if (!b) return;
      const id = b.dataset.ok || b.dataset.no, approve = !!b.dataset.ok;
      b.disabled = true;
      try { await rpc('admin_review_beta_request', { request_id: id, approve, review_note: document.querySelector(`[data-note="${id}"]`)?.value || '' }); toast(approve ? '✓ Approved: beta is on for them' : 'Declined'); NX.refreshCounts(); P.requests(); }
      catch (err) { b.disabled = false; toast(err.message, true); }
    };
    live(['beta_requests'], P.requests, 2500);
  };

  // =========================================================== Feedback & bugs inbox
  const FB_STATUS = [['new', 'New'], ['triaged', 'Triaged'], ['working', 'Working on it'], ['fixed', 'Fixed'], ['wontfix', "Won't fix"], ['closed', 'Closed']];
  const FB_KIND = { bug: '🐞 Bug', feature: '✨ Feature idea', featfix: '🛠 Unsorted (old Feature & Fix)', feedback: '💬 Feedback', beta: '🧪 Beta bug', other: '• Other' };
  // 2.3: bugs and feature ideas are kept apart (tabs at the top); old "Feature & Fix" reports wait to be sorted
  const FB_GROUP = { bugs: ['bug', 'beta'], features: ['feature'], other: ['feedback', 'other'], unsorted: ['featfix'] };
  const PORTAL_KINDS = ['bug', 'feature', 'feedback', 'other'];      // what you can pick when writing one here
  // 2.0: write a bug or feedback straight from the portal (it lands in this inbox like any other report)
  const isPortal = r => r.channel === 'portal' || r.info === 'Added in Apoji Admin';
  // 2.0.2: the same form edits a report that was written here (r = the report)
  function newReport(r = null) {
    const ed = !!r, kinds = [...new Set([...PORTAL_KINDS, ...(r ? [r.kind] : [])])];
    const { el, close } = NX.modal(`<h3>${ed ? '✎ Edit report' : '＋ New report'}</h3><p class="muted" style="margin-top:0">${ed ? `#${r.id}, written in the portal${r.username ? ' by ' + esc(r.username) : ''}.` : 'For something you found yourself, or something someone told you outside the app.'}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><select class="field" id="nrK">${kinds.map(k => `<option value="${k}" ${(r ? r.kind : 'bug') === k ? 'selected' : ''}>${FB_KIND[k] || k}</option>`).join('')}</select>
        ${ed ? '' : `<select class="field" id="nrP">${['low', 'normal', 'high', 'urgent'].map(p => `<option value="${p}" ${p === 'normal' ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)} priority</option>`).join('')}</select>`}
        <input class="field" id="nrF" placeholder="Feature or area (optional)" maxlength="60" style="flex:1;min-width:140px"></div>
      <input class="field" id="nrT" placeholder="Title" maxlength="160" style="width:100%;margin-top:8px">
      <textarea class="field" id="nrB" rows="6" maxlength="8000" placeholder="What happened, steps to reproduce, what you expected…" style="width:100%;margin-top:8px"></textarea>
      <input class="field" id="nrV" placeholder="App version (optional), e.g. 3.3.0" maxlength="40" style="width:100%;margin-top:8px">
      ${ed ? '' : '<div class="row" style="margin-top:8px"><button class="btn sm" id="nrPicB" type="button">📎 Add pictures</button><input type="file" id="nrPic" accept="image/*" multiple hidden><span class="muted" id="nrPicN">Up to 4 screenshots</span></div>'}
      ${ed ? '' : '<label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="nrMe" checked> Assign to me</label>'}
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="nrX">Cancel</button><button class="btn primary" id="nrGo">${ed ? 'Save changes' : 'Add report'}</button></div>`);
    if (ed) { el.querySelector('#nrF').value = r.feature || ''; el.querySelector('#nrT').value = r.title || ''; el.querySelector('#nrB').value = r.body || ''; el.querySelector('#nrV').value = r.app_version || ''; }
    el.querySelector('#nrT').focus();
    el.querySelector('#nrX').onclick = close;
    let pics = [];
    if (!ed) { el.querySelector('#nrPicB').onclick = () => el.querySelector('#nrPic').click(); el.querySelector('#nrPic').onchange = e => { pics = [...e.target.files].filter(f => f.type.startsWith('image/') && f.size < 6e6).slice(0, 4); el.querySelector('#nrPicN').textContent = pics.length ? `${pics.length} picture${pics.length > 1 ? 's' : ''} ready` : 'Up to 4 screenshots'; }; }
    el.querySelector('#nrGo').onclick = async () => {
      const v = id => el.querySelector(id).value.trim(), title = v('#nrT');
      if (!title) return toast('Give it a title.', true);
      const b = el.querySelector('#nrGo'); b.disabled = true; b.textContent = ed ? 'Saving…' : 'Adding…';
      if (ed) {
        const patch = { kind: el.querySelector('#nrK').value, title, body: v('#nrB'), feature: v('#nrF'), app_version: v('#nrV'), updated_at: new Date().toISOString() };
        let { error } = await sb.from('feedback_reports').update(patch).eq('id', r.id);
        if (error && /kind/i.test(error.message) && patch.kind === 'featfix') error = { message: 'Run supabase/nexus-v3.3.2.sql (Nexus repo) to turn on Feature & Fix.' };
        if (error) { b.disabled = false; b.textContent = 'Save changes'; return toast(error.message, true); }
        close(); toast('✓ Saved'); return P.feedback();
      }
      const row = { kind: el.querySelector('#nrK').value, title, body: v('#nrB'), feature: v('#nrF'), app_version: v('#nrV'), source: 'web', channel: 'portal',
        email: A.user.email || '', username: (NX.nameOf(A.me) || '').slice(0, 60), info: 'Added in Apoji Admin' };
      let { data, error } = await sb.from('feedback_reports').insert(row).select('id').single();
      if (error && /channel/i.test(error.message)) ({ data, error } = await sb.from('feedback_reports').insert({ ...row, channel: 'app' }).select('id').single());   // before nexus-v3.3.sql
      if (error && /kind/i.test(error.message) && row.kind === 'featfix') error = { message: 'Run supabase/nexus-v3.3.2.sql (Nexus repo) to turn on Feature & Fix.' };
      if (error) { b.disabled = false; b.textContent = 'Add report'; return toast(error.message, true); }
      // 2.3: pictures go to the private feedback-files bucket (your folder), then onto the report
      if (pics.length) { const paths = []; for (const f of pics) { const path = `${A.user.id}/${data.id}-${Date.now()}-${paths.length}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`; const up = await sb.storage.from('feedback-files').upload(path, f, { contentType: f.type }); if (!up.error) paths.push(path); else toast('A picture didn’t upload: ' + (NX.needSql(up.error.message) || /bucket/i.test(up.error.message) ? 'run supabase/nexus-v3.8.sql' : up.error.message), true); }
        if (paths.length) await sb.from('feedback_reports').update({ attachments: paths }).eq('id', data.id); }
      const pri = el.querySelector('#nrP').value, me = el.querySelector('#nrMe').checked;
      if (pri !== 'normal' || me) await sb.from('feedback_reports').update({ priority: pri, ...(me ? { assignee: A.user.id, status: 'triaged' } : {}) }).eq('id', data.id);
      close(); toast('✓ Report added'); NX.refreshCounts?.();
      A.arg = String(data.id); history.replaceState(null, '', '#feedback/' + data.id); P.feedback();
    };
  }
  P.feedback = async () => {
    const f = A.fb = A.fb || { status: 'open', kind: 'all', q: '', mine: false };
    let q = sb.from('feedback_reports').select('*').order('updated_at', { ascending: false }).limit(300);
    if (f.status === 'open') q = q.in('status', ['new', 'triaged', 'working']); else if (f.status !== 'all') q = q.eq('status', f.status);
    if (FB_GROUP[f.kind]) q = q.in('kind', FB_GROUP[f.kind]); else if (f.kind !== 'all') q = q.eq('kind', f.kind);
    if (f.mine) q = q.eq('assignee', A.user.id);
    if (f.feature) q = q.eq('feature', f.feature);   // from Beta → See bug reports
    if (f.q) q = q.or(`title.ilike.%${f.q.replace(/[%,()]/g, '')}%,email.ilike.%${f.q.replace(/[%,()]/g, '')}%,body.ilike.%${f.q.replace(/[%,()]/g, '')}%`);
    const { data, error } = await q;
    if (error) return main(`<h1>Feedback & bugs</h1><div class="card err">${esc(error.message)}${sqlHint(error)}</div>`);
    const sel = A.arg ? +A.arg : null;
    main(`<h1>Feedback & bugs</h1><p>Everything people send from Feedback in the app, including the ones they also sent by GitHub or email. Reply and they see it in the app; internal notes stay between admins.</p>
      <div class="row" style="margin-bottom:10px"><div class="tabsub" id="fS" style="margin:0">${[['open', 'Open'], ...FB_STATUS, ['all', 'All']].map(([k, l]) => `<button data-s="${k}" class="${f.status === k ? 'on' : ''}">${l}${k === 'new' && A.counts.feedback ? `<b>${A.counts.feedback}</b>` : ''}</button>`).join('')}</div></div>
      <div class="tabsub" id="fG" style="margin:0 0 10px">${[['all', 'Everything'], ['bugs', '🐞 Bugs & fixes'], ['features', '✨ Feature ideas'], ['other', '💬 Feedback'], ['unsorted', '🛠 Unsorted']].map(([k, l]) => `<button data-g="${k}" class="${f.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-bottom:12px"><select class="field" id="fK" hidden><option value="all">All kinds</option>${Object.entries(FB_KIND).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="field" id="fQ" placeholder="Search title, email, text" value="${esc(f.q)}" style="flex:1;min-width:160px"><label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fM" ${f.mine ? 'checked' : ''}> Assigned to me</label>
        ${f.feature ? `<button class="btn sm" id="fFeat" title="Show everything">β ${esc(f.feature)} ✕</button>` : ''}<button class="btn" id="fCsv">Export CSV</button><button class="btn primary" id="fNew">＋ New report</button></div>
      <div class="inbox ${sel ? 'open' : ''}" id="inbox"><div class="ilist" id="ilist">${data.map(r => `<button class="iitem ${r.id === sel ? 'on' : ''} ${r.status === 'new' ? 'unread' : ''}" data-fb="${r.id}">
          <span class="row" style="gap:6px"><span class="pill p-${esc(r.status)}">${esc(r.status.toUpperCase())}</span>${r.priority !== 'normal' ? `<span class="pill p-${esc(r.priority)}">${esc(r.priority.toUpperCase())}</span>` : ''}<span class="muted">${FB_KIND[r.kind] || r.kind}</span><span class="sp"></span><span class="muted">${ago(r.updated_at)}</span></span>
          <b>${esc(r.title)}${(r.attachments || []).length ? ' <span title="Has pictures">📎</span>' : ''}</b><span class="muted">${r.channel && r.channel !== 'app' ? `<span class="pill" style="font-size:10px">${r.channel === 'github' ? 'GITHUB' : r.channel === 'portal' ? 'PORTAL' : 'EMAIL'}</span> ` : ''}${esc(r.username || r.email || (r.user_id ? 'Someone' : 'Not signed in'))} · ${esc(r.source)} ${esc(r.app_version)}${r.assignee ? ' · ' + esc(nameOf(NX.adminById(r.assignee))) : ''}</span></button>`).join('') || '<div class="empty">Inbox zero. 🎉</div>'}</div>
        <div class="idetail" id="idetail">${sel ? '<div class="card"><span class="spinner"></span></div>' : '<div class="card empty">Pick something on the left.</div>'}</div></div>`, { cards: false });
    if (sel) fbDetail(sel);
    $('main').onclick = e => {
      const s = e.target.closest('[data-s]'); if (s) { f.status = s.dataset.s; A.arg = null; return P.feedback(); }
      const g = e.target.closest('[data-g]'); if (g) { f.kind = g.dataset.g; A.arg = null; return P.feedback(); }
      if (e.target.closest('#fFeat')) { f.feature = ''; return P.feedback(); }
      const it = e.target.closest('[data-fb]'); if (it) { A.arg = it.dataset.fb; history.replaceState(null, '', '#feedback/' + it.dataset.fb); document.querySelectorAll('.iitem').forEach(x => x.classList.toggle('on', x === it)); $('inbox').classList.add('open'); return fbDetail(+it.dataset.fb); }
      if (e.target.id === 'fNew') return newReport();
      if (e.target.id === 'fCsv') download(`nexus-feedback-${new Date().toISOString().slice(0, 10)}.csv`, csv([['id', 'kind', 'status', 'priority', 'title', 'email', 'username', 'source', 'version', 'created'], ...data.map(r => [r.id, r.kind, r.status, r.priority, r.title, r.email, r.username, r.source, r.app_version, r.created_at])]));
    };
    $('fK').onchange = e => { f.kind = e.target.value; P.feedback(); };
    $('fM').onchange = e => { f.mine = e.target.checked; P.feedback(); };
    let t; $('fQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); P.feedback().then(() => { const i = $('fQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400); };
    live(['feedback_reports'], () => { if (!document.querySelector('#idetail textarea:focus')) P.feedback(); }, 2500);
  };
  async function fbDetail(id) {
    const [{ data: r, error }, { data: replies }] = await Promise.all([sb.from('feedback_reports').select('*').eq('id', id).maybeSingle(), sb.from('feedback_replies').select('*').eq('report_id', id).order('id')]);
    const el = $('idetail'); if (!el) return;
    if (error || !r) { el.innerHTML = `<div class="card err">${esc(error?.message || 'That report is gone.')}</div>`; return; }
    el.innerHTML = `<div class="card"><h3><button class="btn sm hide-d" id="fbBack" style="${innerWidth > 1100 ? 'display:none' : ''}">‹</button><span>${FB_KIND[r.kind] || ''}</span>${esc(r.title)}</h3>
      <div class="muted">#${r.id} · <a href="#" data-user="${esc(r.user_id || '')}">${esc(r.username || r.email || 'Someone')}</a>${r.email ? ' · ' + esc(r.email) : ''} · ${when(r.created_at)} · ${esc(r.source)} ${esc(r.app_version)}${r.feature ? ' · feature: ' + esc(r.feature) : ''}${r.channel === 'github' ? ' · also sent as a GitHub issue' : r.channel === 'email' ? ' · also sent by email' : ''}${!r.user_id ? ' · not signed in (they can\'t see replies)' : ''}</div>
      <div class="row" style="margin:12px 0"><select class="field" id="fbSt">${FB_STATUS.map(([k, l]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="field" id="fbPr">${['low', 'normal', 'high', 'urgent'].map(p => `<option value="${p}" ${r.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)} priority</option>`).join('')}</select>
        <select class="field" id="fbAs"><option value="">Unassigned</option>${A.admins.map(a => `<option value="${esc(a.id)}" ${r.assignee === a.id ? 'selected' : ''}>${esc(nameOf(a))}${a.id === A.user.id ? ' (me)' : ''}</option>`).join('')}</select>
        <span class="sp"></span>${isPortal(r) ? '<button class="btn sm" id="fbEdit" title="Written in the portal, so you can change it">✎ Edit</button>' : ''}<button class="btn sm" id="fbTask" title="Make a task for this">✅ Task</button><button class="btn sm danger" id="fbDel">Delete</button></div>
      ${r.kind === 'featfix' ? '<div class="banner">🛠 This came in as “Feature & Fix”. Which is it? <span class="sp" style="flex:1"></span><button class="btn sm" data-sortk="bug">🐞 A bug</button><button class="btn sm" data-sortk="feature">✨ A feature idea</button></div>' : ''}
      <div class="quote" style="margin-bottom:10px">${esc(r.body || '(no details)')}</div>
      ${(r.attachments || []).length ? `<div class="fb-pics">${r.attachments.map(p => `<div class="fb-pic" data-fbimg="${esc(p)}"><span class="spinner"></span></div>`).join('')}</div>` : ''}
      ${r.info ? `<details><summary class="muted" style="cursor:pointer">App details</summary><pre class="info">${esc(r.info)}</pre></details>` : ''}
      <div class="thread-r">${(replies || []).map(x => `<div class="r ${x.is_staff ? 'staff' : ''} ${x.internal ? 'internal' : ''}"><small>${x.internal ? '🔒 Internal note · ' : ''}${esc(x.author_name || (x.is_staff ? 'Admin' : r.username || 'Them'))} · ${when(x.created_at)}</small><span class="rb">${esc(x.body)}</span></div>`).join('') || '<div class="muted">No replies yet.</div>'}</div>
      <textarea class="field" id="fbTxt" rows="3" data-name="${esc(r.username || 'there')}" placeholder="Reply to ${esc(r.username || 'them')} (they see it in the app)…"></textarea>
      <div class="row" style="margin-top:8px"><label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fbInt"> Internal note (admins only)</label><span class="sp"></span>
        <button class="btn" id="fbSaved" title="Saved replies">⚡</button><button class="btn" data-quick="Thanks! We've got it and we're looking into it.">Quick: got it</button><button class="btn" data-quick="This is fixed in the next update. Thanks for reporting it!">Quick: fixed</button><button class="btn primary" id="fbSend">Send</button></div></div>`;
    const save = async patch => { const { error: er } = await sb.from('feedback_reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id); toast(er ? er.message : '✓ Saved', !!er); NX.refreshCounts(); };
    NX.loadPics?.(el);
    $('fbSt').onchange = e => save({ status: e.target.value });
    $('fbPr').onchange = e => save({ priority: e.target.value });
    $('fbAs').onchange = e => save({ assignee: e.target.value || null });
    el.onclick = async e => {
      const u = e.target.closest('[data-user]'); if (u) { e.preventDefault(); if (u.dataset.user) userDrawer(u.dataset.user); return; }
      if (e.target.id === 'fbBack') { $('inbox').classList.remove('open'); A.arg = null; return; }
      if (e.target.dataset.quick) { $('fbTxt').value = e.target.dataset.quick; $('fbTxt').focus(); return; }
      if (e.target.id === 'fbSaved') return NX.replies.picker(e.target, $('fbTxt'));
      if (e.target.id === 'fbEdit') return newReport(r);
      if (e.target.dataset.sortk) { await save({ kind: e.target.dataset.sortk }); return P.feedback(); }
      const pic = e.target.closest('.fb-pic img'); if (pic) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${pic.src}" alt=""><div class="lb-acts"><button class="btn primary" data-saveimg="${pic.src}" data-name="bug-report-${r.id}">⬇ Save image</button></div>`; lb.onclick = ev => { if (!ev.target.closest('button')) lb.remove(); }; document.body.appendChild(lb); return; }
      if (e.target.id === 'fbTask') return NX.tasks.modal({ title: r.title.slice(0, 200), link_kind: 'feedback', link_id: String(id), link_label: r.title.slice(0, 200), priority: r.priority === 'urgent' || r.priority === 'high' ? r.priority : 'normal', assignee: r.assignee || A.user.id });
      if (e.target.id === 'fbDel') { if (!confirm('Delete this report and its replies?')) return; const { error: er } = await sb.from('feedback_reports').delete().eq('id', id); if (er) return toast(er.message, true); A.arg = null; NX.refreshCounts(); return P.feedback(); }
      if (e.target.id === 'fbSend') {
        const body = $('fbTxt').value.trim(); if (!body) return;
        const internal = $('fbInt').checked;
        const { error: er } = await sb.from('feedback_replies').insert({ report_id: id, body, internal, is_staff: true, author_name: nameOf(A.me).slice(0, 60) });
        if (er) return toast(er.message, true);
        if (!internal && r.status === 'new') await sb.from('feedback_reports').update({ status: 'triaged' }).eq('id', id);
        toast(internal ? '🔒 Note added' : '✓ Sent. They\'ll see it in the app.'); fbDetail(id); NX.refreshCounts();
      }
    };
  }

  // =========================================================== Content reports
  const REASON = { spam: 'Spam', harassment: 'Harassment', inappropriate: 'Inappropriate', cheating: 'Cheating', other: 'Other' };
  P.reports = async () => {
    const f = A.rpF = A.rpF || 'open';
    let q = sb.from('content_reports').select('*').order('created_at', { ascending: false }).limit(200);
    if (f !== 'all') q = q.eq('status', f);
    const { data, error } = await q;
    if (error) return main(`<h1>Reports</h1><div class="card err">${esc(error.message)}${sqlHint(error)}</div>`);
    main(`<h1>Reports</h1><p>Things people reported in Shared Spaces, posts and shared agents (from the app and N28C).</p>
      <div class="tabsub" id="rpf">${['open', 'actioned', 'dismissed', 'all'].map(k => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}${k === 'open' && A.counts.reports ? `<b>${A.counts.reports}</b>` : ''}</button>`).join('')}</div>
      ${data.map(r => `<div class="card req"><div class="who"><b>${{ space: '👥 Shared Space', post: '💬 Post', agent: '🛠 Shared agent', session: '🏁 Live session' }[r.kind] || r.kind}</b> <span class="pill p-${esc(r.status)}">${esc(r.status.toUpperCase())}</span> <span class="pill" style="color:var(--danger)">${esc(REASON[r.reason] || r.reason)}</span>
          <div class="muted">${when(r.created_at)} · ${esc(r.kind === 'agent' ? 'code ' + r.target_id : r.target_id.slice(0, 8))}</div>
          ${r.target_label ? `<q>“${esc(r.target_label)}”</q>` : ''}${r.details ? `<q><b class="muted">Details:</b> ${esc(r.details)}</q>` : ''}
          ${r.status !== 'open' ? `<div class="muted" style="margin-top:6px">${esc(r.status)} ${when(r.handled_at)}${r.action_note ? ' · ' + esc(r.action_note) : ''}</div>` : ''}</div>
        <div class="acts"><button class="btn" data-view="${r.id}">View</button>${r.status === 'open' ? `<button class="btn danger" data-rm="${r.id}">Remove it</button><button class="btn" data-dis="${r.id}">Dismiss</button>` : ''}</div></div>`).join('') || `<div class="empty">No ${f === 'all' ? '' : f + ' '}reports. 🎉</div>`}`);
    $('main').onclick = async e => {
      const ff = e.target.closest('[data-f]'); if (ff) { A.rpF = ff.dataset.f; return P.reports(); }
      const id = +(e.target.dataset.view || e.target.dataset.rm || e.target.dataset.dis); if (!id) return;
      const r = data.find(x => x.id === id);
      if (e.target.dataset.view) {
        if (r.kind === 'agent') return agentsDrawer(r.target_id);
        if (r.kind === 'space') return spaceDrawer(r.target_id);
        if (r.kind === 'post') { const { data: sid } = await sb.rpc('admin_post_space', { p_post: r.target_id }); return sid ? spaceDrawer(sid, r.target_id) : toast('That post was already removed.'); }
        return toast('Nothing to show for this one.');
      }
      if (e.target.dataset.rm) {
        if (!confirm(`Remove this ${r.kind} for everyone? It can't be undone.`)) return;
        const reason = await NX.ask('Reason', { value: REASON[r.reason] || '', note: 'Saved in the audit log.', ok: 'Remove', danger: true }); if (reason === null) return;
        try { await rpc('admin_remove_content', { p_kind: r.kind, p_id: r.target_id, p_reason: reason }); toast('✓ Removed'); } catch (err) { return toast(err.message, true); }
      }
      if (e.target.dataset.dis) { const { error: er } = await sb.from('content_reports').update({ status: 'dismissed', handled_by: A.user.id, handled_at: new Date().toISOString(), action_note: 'Dismissed' }).eq('id', id); if (er) return toast(er.message, true); toast('Dismissed'); }
      NX.refreshCounts(); P.reports();
    };
    live(['content_reports'], P.reports, 2500);
  };

  // =========================================================== Moderation (Shared Spaces + shared agents)
  P.moderation = async () => {
    const tab = A.modTab = A.modTab || 'spaces', q = A.modQ || '';
    main(`<h1>Moderation</h1><p>Every Shared Space and shared agent. Reported things float to the top.</p>
      <div class="row" style="margin-bottom:12px"><div class="tabsub" style="margin:0" id="mt">${[['spaces', '👥 Shared Spaces'], ['agents', '🛠 Shared agents']].map(([k, l]) => `<button data-mt="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input class="field" id="mq" placeholder="Search name, code or owner email" value="${esc(q)}" style="flex:1;min-width:180px"></div><div id="ml"><div class="empty"><span class="spinner"></span></div></div>`);
    let r; try { r = await rpc(tab === 'spaces' ? 'admin_list_spaces' : 'admin_list_shared_agents', { p_search: q }); } catch (e) { $('ml').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    if (tab === 'spaces') $('ml').innerHTML = `<div class="card"><table class="cards"><tr><th>Space</th><th>Owner</th><th class="num">Members</th><th class="num">Posts</th><th>Last post</th><th></th></tr>${(r.spaces || []).map(s => `<tr class="click" data-space="${esc(s.id)}">
        <td><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${/^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : 'var(--accent)'};margin-right:6px"></i><b>${esc(s.name)}</b> <span class="muted">${esc(s.code)}</span>${s.reports ? ` <span class="pill" style="color:var(--danger)">${s.reports} REPORT${s.reports === 1 ? '' : 'S'}</span>` : ''}</td>
        <td class="muted">${esc(s.owner_email || '—')}</td><td class="num">${s.members}</td><td class="num">${s.posts}</td><td class="muted">${ago(s.last_post)}</td><td><button class="btn sm">Open</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No spaces.</td></tr>'}</table></div>`;
    else $('ml').innerHTML = `<div class="card"><table class="cards"><tr><th>Agent</th><th>Owner</th><th class="num">Imports</th><th>Shared</th><th></th></tr>${(r.agents || []).map(a => `<tr class="click" data-agent="${esc(a.code)}">
        <td><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${/^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : 'var(--accent)'};margin-right:6px"></i><b>${esc(a.name)}</b> <span class="muted">@${esc(a.handle || '')} · ${esc(a.code)}</span>${a.reports ? ` <span class="pill" style="color:var(--danger)">${a.reports} REPORT${a.reports === 1 ? '' : 'S'}</span>` : ''}<div class="muted" style="max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.prompt || '')}</div></td>
        <td class="muted">${esc(a.owner_email || '—')}</td><td class="num">${a.imports}</td><td class="muted">${ago(a.created_at)}</td><td><button class="btn sm">Open</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No shared agents yet.</td></tr>'}</table></div>`;
    NX.labelTables();
    wireMod();
  };
  function wireMod() {
    $('main').onclick = e => {
      const t = e.target.closest('[data-mt]'); if (t) { A.modTab = t.dataset.mt; return P.moderation(); }
      const s = e.target.closest('[data-space]'); if (s) return spaceDrawer(s.dataset.space);
      const a = e.target.closest('[data-agent]'); if (a) return agentsDrawer(a.dataset.agent);
    };
    let tm; $('mq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { A.modQ = e.target.value.trim(); P.moderation().then(() => { const i = $('mq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400); };
  }
  async function spaceDrawer(id, focusPost) {
    const { el, close } = NX.drawer('<div class="empty"><span class="spinner"></span></div>');
    let list, d; try { [list, d] = await Promise.all([rpc('admin_list_spaces', { p_search: '' }), rpc('admin_space_detail', { p_space: id })]); } catch (e) { el.innerHTML = `<button class="btn sm x" data-x>✕</button><div class="card err">${esc(e.message)}</div>`; return; }
    const s = (list.spaces || []).find(x => x.id === id);
    if (!s) { el.innerHTML = '<button class="btn sm x" data-x>✕</button><div class="card">That space is gone.</div>'; return; }
    el.innerHTML = `<button class="btn sm x" data-x>✕</button><h1>👥 ${esc(s.name)}</h1><p class="sub">Code ${esc(s.code)} · owner ${esc(s.owner_email || '—')} · created ${when(s.created_at)}</p>
      <div class="row" style="margin-bottom:12px"><button class="btn danger" id="spDel">Delete this space</button></div>
      <div class="card"><h3>Members (${d.members.length})</h3><div class="members">${d.members.map(m => `<div>${av({ id: m.user_id, nickname: m.nickname })}<span class="nm">${esc(m.nickname)}<small>${esc(m.email || '')} · 🔥 ${m.streak} · joined ${ago(m.joined_at)}</small></span><button class="btn sm" data-user="${esc(m.user_id)}">Profile</button></div>`).join('')}</div></div>
      <div class="card"><h3>Posts (${d.posts.length})</h3>${d.posts.map(p => `<div class="m ${p.id === focusPost ? 'mentioned' : ''}" style="margin:0 0 6px" data-post="${esc(p.id)}">${av({ id: p.email || p.nickname, nickname: p.nickname }, 'sm')}<div class="mb"><div class="by"><b>${esc(p.nickname)}</b><time>${when(p.created_at)}</time>${p.reports ? `<span class="pill" style="color:var(--danger)">${p.reports} REPORT${p.reports === 1 ? '' : 'S'}</span>` : ''}<span class="sp" style="flex:1"></span><button class="btn sm danger" data-rmpost="${esc(p.id)}">Remove</button></div>
        <div class="tx">${p.kind === 'deck' ? '🃏 Shared a deck: ' : p.kind === 'ai' ? '🤖 ' : ''}${esc(p.content)}</div></div></div>`).join('') || '<div class="muted">No posts.</div>'}</div>`;
    if (focusPost) el.querySelector(`[data-post="${focusPost}"]`)?.scrollIntoView({ block: 'center' });
    el.onclick = async e => {
      const u = e.target.closest('[data-user]'); if (u) return userDrawer(u.dataset.user);
      if (e.target.id === 'spDel') { if (!confirm(`Delete "${s.name}" for all ${d.members.length} members? This can't be undone.`)) return; const reason = await NX.ask('Reason', { note: 'Saved in the audit log.', ok: 'Delete space', danger: true }); if (reason === null) return; try { await rpc('admin_remove_content', { p_kind: 'space', p_id: id, p_reason: reason }); toast('✓ Space deleted'); close(); if (A.tab === 'moderation') P.moderation(); } catch (err) { toast(err.message, true); } }
      const rp = e.target.closest('[data-rmpost]'); if (rp) { if (!confirm('Remove this post?')) return; try { await rpc('admin_remove_content', { p_kind: 'post', p_id: rp.dataset.rmpost, p_reason: 'Removed by an admin' }); rp.closest('[data-post]').remove(); toast('✓ Removed'); NX.refreshCounts(); } catch (err) { toast(err.message, true); } }
    };
  }
  async function agentsDrawer(code) {
    const { el, close } = NX.drawer('<div class="empty"><span class="spinner"></span></div>');
    let r; try { r = await rpc('admin_list_shared_agents', { p_search: code }); } catch (e) { el.innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    const a = (r.agents || []).find(x => x.code === code);
    if (!a) { el.innerHTML = '<button class="btn sm x" data-x>✕</button><div class="card">That agent was removed.</div>'; return; }
    el.innerHTML = `<button class="btn sm x" data-x>✕</button><h1><i style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${/^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : 'var(--accent)'}"></i> ${esc(a.name)}</h1>
      <p class="sub">@${esc(a.handle || '')} · code ${esc(a.code)} · by ${esc(a.owner_email || '—')} · ${a.imports} import${a.imports === 1 ? '' : 's'} · ${when(a.created_at)}</p>
      <div class="card"><h3>Instructions</h3><div class="quote">${esc(a.prompt || '(none)')}</div></div>
      <div class="row"><button class="btn danger" id="agDel">Remove this shared agent</button><span class="muted">People who already imported it keep their copy; the code stops working.</span></div>`;
    el.querySelector('#agDel').onclick = async () => { if (!confirm('Remove this shared agent?')) return; const reason = await NX.ask('Reason', { note: 'Saved in the audit log.', ok: 'Remove agent', danger: true }); if (reason === null) return; try { await rpc('admin_remove_content', { p_kind: 'agent', p_id: code, p_reason: reason }); toast('✓ Removed'); close(); if (A.tab === 'moderation') P.moderation(); } catch (e) { toast(e.message, true); } };
  }

  // =========================================================== Users
  const UF = [['all', 'Everyone'], ['new7', 'New this week'], ['active7', 'Active this week'], ['beta', 'Beta testers'], ['comped', 'Comped'], ['admins', 'Admins & mods'], ['moderated', 'Suspended / banned']];
  // 2.1: make a new Nexus account from here, optionally as an admin profile (Mod / Admin / High-Admin)
  function newProfile(level = '') {
    const { el, close } = NX.modal(`<h3>＋ New profile</h3><p class="muted" style="margin-top:0">Makes a Nexus account they can sign in to everywhere (Mac, PC, N28C, Test Run). Make it an admin profile to give it a role in Apoji Admin too.</p>
      <div class="acct-grid np-grid">
        <label>Email</label><input class="field" id="npEmail" type="email" placeholder="name@example.com" autocomplete="off">
        <label>Password</label><div class="row" style="flex-wrap:nowrap"><input class="field" id="npPw" type="text" placeholder="8+ characters (or leave empty to email an invite)" autocomplete="new-password" style="flex:1"><button class="btn sm" id="npGen" type="button">Generate</button></div>
        <label>Name</label><input class="field" id="npNick" maxlength="40" placeholder="Nickname (optional)">
        <label>Username</label><input class="field" id="npUser" maxlength="24" placeholder="username (optional)">
        <label>Role</label><select class="field" id="npLvl"><option value="">Regular account (no admin role)</option><option value="mod" ${level === 'mod' ? 'selected' : ''}>Mod</option><option value="admin" ${level === 'admin' ? 'selected' : ''}>Admin</option><option value="high-admin" ${level === 'high-admin' ? 'selected' : ''}>High-Admin</option></select>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-x>Cancel</button><button class="btn primary" id="npGo">Create profile</button></div>`);
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-x')) return close();
      if (b.id === 'npGen') { const a = new Uint8Array(12); crypto.getRandomValues(a); el.querySelector('#npPw').value = [...a].map(x => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 55]).join(''); return; }
      if (b.id !== 'npGo') return;
      const v = id => el.querySelector(id).value.trim();
      const body = { action: 'create', email: v('#npEmail'), password: el.querySelector('#npPw').value, nickname: v('#npNick'), username: v('#npUser') };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return toast('Type an email address.', true);
      if (body.password && body.password.length < 8) return toast('Passwords need 8+ characters.', true);
      const lvl = v('#npLvl');
      if (lvl && !confirm(`Make ${body.email} a ${NX.levelLabel ? NX.levelLabel(lvl) : lvl}? They'll be able to open Apoji Admin.`)) return;
      b.disabled = true; b.textContent = 'Creating…';
      try {
        const { data, error } = await sb.functions.invoke('admin-users', { body });
        const res = data || (await error?.context?.json?.().catch(() => null)) || {};
        if (!res.ok) throw new Error(res.error || error?.message || 'Couldn’t create it.');
        if (lvl) { const g = await rpc('admin_grant_role', { target_email: body.email, new_level: lvl }); if (g && g.success === false) throw new Error('Account made, but the role failed: ' + (g.error || '')); await NX.loadAdmins?.(); }
        close(); toast(`✓ ${res.message || 'Profile created.'}${lvl ? ` Role: ${lvl}.` : ''}`); if (A.tab === 'users') P.users(); if (res.user_id) userDrawer(res.user_id);
      } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Create profile'; }
    };
  }
  NX.newProfile = newProfile;
  P.users = async () => {
    const u = A.uf = A.uf || { q: '', filter: 'all', sort: 'new', page: 0, sel: new Set() };
    const per = 50;
    let r; try { r = await rpc('admin_list_users', { p_search: u.q, p_filter: u.filter, p_limit: per, p_offset: u.page * per, p_sort: u.sort }); }
    catch (e) { return main(`<h1>Users</h1><div class="card err">${esc(e.message)}</div>`); }
    const users = r.users || [], pages = Math.max(1, Math.ceil(r.total / per));
    const pres = await (NX.presenceFor?.(users.map(x => x.id)) || {});    // 2.3: which apps they use (🟢 = right now)
    const badge = x => `${x.admin_level ? NX.levelPill(x.admin_level, x.id) + ' ' : ''}${x.beta ? '<span class="pill" style="color:var(--cyan)">BETA</span> ' : ''}${x.comped ? '<span class="pill" style="color:var(--gold)">COMPED</span> ' : ''}${x.status !== 'active' ? `<span class="pill p-declined">${esc(x.status.toUpperCase())}</span>` : ''}`;
    main(`<h1>Users <span class="muted" style="font-size:14px;font-weight:400">${r.total.toLocaleString()}</span></h1><p>Everyone with a Nexus account. Click someone for their profile, notes and history.</p>
      <div class="tabsub" id="uF">${UF.map(([k, l]) => `<button data-f="${k}" class="${u.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-bottom:10px"><input class="field" id="uQ" placeholder="Search email, username or nickname" value="${esc(u.q)}" style="flex:1;min-width:200px">
        <select class="field" id="uS"><option value="new" ${u.sort === 'new' ? 'selected' : ''}>Newest first</option><option value="active" ${u.sort === 'active' ? 'selected' : ''}>Recently active</option><option value="email" ${u.sort === 'email' ? 'selected' : ''}>Email A–Z</option></select>
        <button class="btn" id="uCsv">Export CSV</button>${(A.level === 'high-admin' && A.tier !== 'viewer') || NX.can?.('users_create') ? '<button class="btn primary" id="uNew">＋ New profile</button>' : NX.reqButton ? NX.reqButton('users_create').replace('Request access', 'Ask to make profiles') : ''}</div>
      <div class="banner" id="uBulk" ${u.sel.size ? '' : 'hidden'}><b>${u.sel.size} selected</b><span class="sp" style="flex:1"></span><button class="btn sm" data-bulk="beta_on">Make beta</button><button class="btn sm" data-bulk="beta_off">Remove beta</button>${A.level !== 'mod' ? '<button class="btn sm" data-bulk="comp_on">Comp</button><button class="btn sm" data-bulk="comp_off">Un-comp</button>' : ''}<button class="btn sm ghost" data-bulk="clear">Clear</button></div>
      <div class="card"><table class="cards"><tr><th><input type="checkbox" id="uAll"></th><th>Person</th><th>Joined</th><th>Last active</th><th>Active on</th><th>Status</th><th class="num">Notes</th></tr>
        ${users.map(x => `<tr class="click ${u.sel.has(x.id) ? 'sel' : ''}" data-uid="${esc(x.id)}"><td><input type="checkbox" data-pick="${esc(x.id)}" ${u.sel.has(x.id) ? 'checked' : ''}></td>
          <td><div class="row" style="gap:10px;flex-wrap:nowrap">${av({ id: x.id, nickname: x.nickname || x.username, email: x.email, avatar_url: x.avatar_url })}<span style="min-width:0"><b>${esc(x.nickname || x.username || '(no username)')}</b><div class="muted" style="overflow:hidden;text-overflow:ellipsis">${esc(x.email)}${x.username && x.nickname ? ' · @' + esc(x.username) : ''}</div></span></div></td>
          <td class="muted">${when(x.created_at).split(',')[0]}</td><td class="muted">${ago(x.last_active_at || x.last_sign_in_at)}</td><td class="surfs">${NX.surfaceChips ? NX.surfaceChips(pres[x.id]) : ''}</td><td>${badge(x) || '<span class="muted">—</span>'}</td><td class="num">${x.notes || ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nobody matches.</td></tr>'}</table>
        <div class="row" style="margin-top:10px"><span class="muted">Page ${u.page + 1} of ${pages}</span><span class="sp"></span><button class="btn sm" id="uPrev" ${u.page ? '' : 'disabled'}>‹ Prev</button><button class="btn sm" id="uNext" ${u.page + 1 < pages ? '' : 'disabled'}>Next ›</button></div></div>
      <div class="card"><h3>Look up by exact email</h3><form class="row" id="lf"><input class="field" id="le" type="email" placeholder="name@example.com" style="flex:1;min-width:220px"><button class="btn primary">Open profile</button></form></div>`);
    if (A.arg) { const id = A.arg; A.arg = null; userDrawer(id); }
    $('main').onclick = async e => {
      const f = e.target.closest('[data-f]'); if (f) { u.filter = f.dataset.f; u.page = 0; return P.users(); }
      if (e.target.id === 'uPrev') { u.page--; return P.users(); } if (e.target.id === 'uNext') { u.page++; return P.users(); }
      const pick = e.target.closest('[data-pick]'); if (pick) { pick.checked ? u.sel.add(pick.dataset.pick) : u.sel.delete(pick.dataset.pick); pick.closest('tr').classList.toggle('sel', pick.checked); paintBulk(); return; }
      if (e.target.id === 'uAll') { users.forEach(x => e.target.checked ? u.sel.add(x.id) : u.sel.delete(x.id)); return P.users(); }
      const bk = e.target.closest('[data-bulk]'); if (bk) {
        if (bk.dataset.bulk === 'clear') { u.sel.clear(); return P.users(); }
        if (!confirm(`${bk.textContent} for ${u.sel.size} ${u.sel.size === 1 ? 'person' : 'people'}?`)) return;
        try { const res = await rpc('admin_bulk', { p_users: [...u.sel], p_action: bk.dataset.bulk }); toast(`✓ Updated ${res.updated}`); u.sel.clear(); P.users(); } catch (err) { toast(err.message, true); }
        return;
      }
      if (e.target.id === 'uNew') return newProfile();
      if (e.target.id === 'uCsv') {
        toast('Preparing the CSV…'); const all = [];
        for (let off = 0; off < 5000; off += 200) { const res = await rpc('admin_list_users', { p_search: u.q, p_filter: u.filter, p_limit: 200, p_offset: off, p_sort: u.sort }); all.push(...res.users); if (res.users.length < 200) break; }
        download(`nexus-users-${u.filter}-${new Date().toISOString().slice(0, 10)}.csv`, csv([['email', 'username', 'nickname', 'joined', 'last_active', 'beta', 'comped', 'admin', 'status'], ...all.map(x => [x.email, x.username, x.nickname, x.created_at, x.last_active_at, x.beta, x.comped, x.admin_level || '', x.status])]));
        return;
      }
      const row = e.target.closest('[data-uid]'); if (row && !e.target.closest('input')) userDrawer(row.dataset.uid);
    };
    const paintBulk = () => { const b = $('uBulk'); b.hidden = !u.sel.size; b.querySelector('b').textContent = `${u.sel.size} selected`; };
    $('uS').onchange = e => { u.sort = e.target.value; P.users(); };
    let t; $('uQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { u.q = e.target.value.trim(); u.page = 0; P.users().then(() => { const i = $('uQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 400); };
    $('lf').onsubmit = async e => { e.preventDefault(); const em = $('le').value.trim(); if (!em) return; try { const res = await rpc('admin_list_users', { p_search: em, p_filter: 'all', p_limit: 5, p_offset: 0, p_sort: 'new' }); const hit = res.users.find(x => x.email.toLowerCase() === em.toLowerCase()) || res.users[0]; if (!hit) return toast('No account with that email.', true); userDrawer(hit.id); } catch (err) { toast(err.message, true); } };
  };

  async function userDrawer(uid) {
    if (!uid) return;
    const { el, close } = NX.drawer('<div class="empty"><span class="spinner"></span></div>');
    let base, d, lk;
    try {
      d = await rpc('admin_user_detail', { p_user: uid });
      base = d.user; if (!base) throw new Error('Account not found.');
      lk = await rpc('admin_lookup_user', { target_email: base.email }).catch(() => null);
    } catch (e) { el.innerHTML = `<button class="btn sm x" data-x>✕</button><div class="card err">${esc(e.message)}</div>`; return; }
    const p = lk?.profile || {}, m = lk?.moderation, high = A.level === 'high-admin', email = base.email;
    const tTier = lk?.admin_level === 'high-admin' ? (A.tiers || {})[uid] || 'editor' : '';
    // 1.7: change their account without knowing their password (Supabase function admin-users; Editors and the Owner)
    // 2.3: mods/admins with approved "Edit user accounts" access can change regular accounts
    const granted = !high && NX.can?.('users_edit') && !lk?.admin_level;
    const canEdit = (high && !A.viewer && (tTier !== 'owner' || A.owner)) || granted, canCreds = canEdit && (granted || A.owner || lk?.admin_level !== 'high-admin' || uid === A.user.id);
    const acctCard = () => `<div class="card" id="acctCard"><h3>Account ${tTier === 'owner' ? '<span class="pill owner-pill">👑 OWNER</span>' : ''}</h3>
      ${!canEdit ? `<p class="muted" style="margin:0">${A.viewer ? 'Viewers can look but not change accounts.' : high ? 'Only the Owner can change the Owner account.' : lk?.admin_level ? 'Only high-admins can change admin accounts.' : 'Changing accounts needs access.'}</p>${!high && !lk?.admin_level && NX.reqButton ? '<div class="row" style="margin-top:8px">' + NX.reqButton('users_edit') + '</div>' : ''}` : `
      <div class="acct-grid">
        <label>Name</label><div class="row"><input class="field" id="acNick" value="${esc(base.nickname || '')}" placeholder="Nickname" maxlength="40"><button class="btn sm" data-ac="nick">Save</button></div>
        <label>Username</label><div class="row"><input class="field" id="acUser" value="${esc(base.username || '')}" placeholder="username" maxlength="24"><button class="btn sm" data-ac="user">Save</button></div>
        ${canCreds ? `<label>Email</label><div class="row"><input class="field" id="acEmail" value="${esc(email)}" type="email"><button class="btn sm" data-ac="email">Change</button></div>
        <label>Password</label><div class="row"><button class="btn sm" data-ac="reset">✉ Send reset email</button><input class="field" id="acPw" type="password" placeholder="or set a new one (8+)" autocomplete="new-password"><button class="btn sm" data-ac="pw">Set</button></div>
        <label></label><div class="row"><button class="btn sm" data-ac="temp" title="A one-time password you tell them; Nexus asks them to pick their own at the next sign-in">🔑 Make a temporary password</button><span class="muted" style="font-size:12px">Nobody can see someone's current password (it's stored scrambled, one-way).</span></div>` : '<label>Email & password</label><span class="muted">Only the Owner can change another high-admin\'s email or password.</span>'}
        <label>Picture</label><div class="row"><button class="btn sm" data-ac="pic">📷 Change picture</button>${base.avatar_url ? '<button class="btn sm" data-ac="nopic">Remove picture</button>' : ''}<input type="file" id="acPicF" accept="image/*" hidden></div>
      </div>
      ${canCreds && uid !== A.user.id ? '<div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn sm danger" data-ac="del">Delete account…</button></div>' : ''}
      <p class="muted" style="margin:8px 0 0">They're not told about name or email changes; a reset email goes to their current address. Everything here is in the audit log.</p>`}</div>`;
    const acct = async (body, b) => {
      if (b) b.disabled = true;
      const { data, error } = await sb.functions.invoke('admin-users', { body: { user_id: uid, ...body } });
      if (b) b.disabled = false;
      const msg = error ? (/Failed to send|not found|404/i.test(error.message) ? 'Deploy the admin-users Supabase function first (see the README).' : (await error.context?.json?.().catch(() => null))?.error || error.message) : data?.ok ? data.message : data?.error;
      toast(msg || 'Done', !(data?.ok)); return !!data?.ok;
    };
    const days = []; const act = new Map((d.activity || []).map(a => [a.day + a.source, a]));
    for (let i = 59; i >= 0; i--) { const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push({ day, desk: act.has(day + 'desktop'), phone: act.has(day + 'phone') }); }
    const lastVer = (d.activity || []).find(a => a.source === 'desktop')?.version, lastPhone = (d.activity || []).find(a => a.source === 'phone')?.version;
    el.innerHTML = `<button class="btn sm x" data-x>✕</button>
      <div class="row" style="gap:14px;margin-bottom:6px;flex-wrap:nowrap">${av({ id: uid, nickname: base.nickname || base.username, avatar_url: base.avatar_url }, 'lg')}<div style="min-width:0"><h1 style="margin:0">${esc(base.nickname || base.username || '(no username)')}</h1>
        <div class="muted">${esc(email)}${base.username ? ' · @' + esc(base.username) : ''}</div><div style="margin-top:4px">${lk?.admin_level ? NX.levelPill(lk.admin_level, uid) + ' ' : ''}${p.is_beta_tester ? '<span class="pill" style="color:var(--cyan)">BETA</span> ' : ''}${p.is_comped ? '<span class="pill" style="color:var(--gold)">COMPED</span> ' : ''}${d.reports_against ? `<span class="pill" style="color:var(--danger)">${d.reports_against} OPEN REPORT${d.reports_against === 1 ? '' : 'S'}</span>` : ''}</div></div></div>
      <div id="swCard"></div>
      <div class="card"><div class="kv"><span>Joined</span><span>${when(base.created_at)}</span><span>Last active</span><span>${ago(base.last_active_at || base.last_sign_in_at)}${lastVer ? ` · desktop v${esc(lastVer)}` : ''}${lastPhone ? ' · uses N28C' : ''}</span>
        <span>Status</span><span>${m && m.status !== 'active' ? `<b class="err">${esc(m.status)}</b>${m.reason ? ' · ' + esc(m.reason) : ''}${m.suspended_until ? ' · until ' + when(m.suspended_until) : ''}` : 'Active'}</span>
        <span>Chats used</span><span>${(lk?.chat_usage || []).map(c => `${esc(c.assistant_name)}: ${c.count} <button class="btn sm" data-reset="${esc(c.assistant_name)}">reset</button>`).join(' · ') || '—'}</span>
        <span>Shared Spaces</span><span>${(d.spaces || []).map(s => `<a href="#" data-space="${esc(s.id)}">${esc(s.name)}</a>${s.owner ? ' (owner)' : ''}`).join(', ') || '—'}</span></div>
        <b class="muted" style="font-size:11px;letter-spacing:.08em;display:block;margin:12px 0 4px">LAST 60 DAYS</b>
        <div style="display:grid;grid-template-columns:repeat(60,1fr);gap:2px" title="Days they used Nexus">${days.map(x => `<i title="${x.day}${x.desk ? ' · Mac/PC' : ''}${x.phone ? ' · N28C' : ''}" style="height:16px;border-radius:2px;background:${x.desk && x.phone ? 'var(--accent)' : x.desk || x.phone ? 'rgba(var(--rgb),.5)' : 'rgba(var(--rgb),.07)'}"></i>`).join('')}</div></div>
      <div class="card" id="ordCard"><h3>🧾 Redeemed orders <span class="muted" id="ordN"></span></h3><div id="ordList"><span class="spinner"></span></div></div>
      <div class="card"><h3>Perks</h3><div class="row"><button class="btn ${p.is_beta_tester ? 'danger' : 'primary'}" data-beta="${p.is_beta_tester ? 0 : 1}">${p.is_beta_tester ? 'Remove beta' : 'Make beta tester'}</button>
        <button class="btn" data-comp="${p.is_comped ? 0 : 1}">${p.is_comped ? 'Remove comp' : 'Comp (unlimited free key)'}</button></div></div>
      <div class="card"><h3>Moderation</h3><div class="row"><select class="field" id="ms"><option value="active">Active (lift)</option><option value="suspended">Suspend</option><option value="banned">Ban</option></select>
        <select class="field" id="mh"><option value="">For…</option><option value="1">1 hour</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">1 week</option><option value="720">30 days</option></select>
        <input class="field" id="mr" placeholder="Reason (they see this)" style="flex:1;min-width:160px"><button class="btn" id="mgo">Apply</button></div>
        <p class="muted" style="margin:8px 0 0">Suspended or banned accounts can't use the free Nexus key, Shared Spaces or N28C until it's lifted. Their own API keys still work.</p></div>
      ${high ? acctCard() : ''}
      ${high ? `<div class="card"><h3>Admin role</h3><div class="row"><select class="field" id="rl"><option value="mod">Mod</option><option value="admin">Admin</option><option value="high-admin">High-admin</option></select>
        <button class="btn" id="rgo" ${A.viewer || (tTier === 'owner' && !A.owner) ? 'disabled' : ''}>Grant</button>${lk?.admin_level ? `<button class="btn danger" id="rrv" ${A.viewer || (tTier === 'owner' && !A.owner) ? 'disabled' : ''}>Revoke role</button>` : ''}</div>
        ${lk?.admin_level === 'high-admin' ? `<div class="row" style="margin-top:10px"><span class="muted">Tier</span>${tTier === 'owner' ? '<span class="pill owner-pill">👑 OWNER</span><span class="muted">set in the SQL editor only</span>'
          : `<select class="field" id="tierSel" ${A.owner ? '' : 'disabled'}><option value="editor" ${tTier === 'editor' ? 'selected' : ''}>Editor: can change things</option><option value="viewer" ${tTier === 'viewer' ? 'selected' : ''}>Viewer: can only look</option></select>${A.owner ? '<button class="btn" id="tierGo">Save tier</button>' : '<span class="muted">Only the Owner changes tiers</span>'}`}</div>` : ''}</div>` : ''}
      <div class="row" style="margin-bottom:10px"><button class="btn" data-mktask>✅ Make a task about ${esc(base.nickname || base.username || 'them')}</button></div>
      <div class="card"><h3>Private notes <span class="muted">(admins only)</span></h3><div class="thread-r" id="notes">${(d.notes || []).map(n => `<div class="r internal"><small>${esc(n.author_email || 'admin')} · ${when(n.created_at)}${n.mine || high ? ` · <a href="#" data-delnote="${n.id}">delete</a>` : ''}</small>${esc(n.body)}</div>`).join('') || '<div class="muted">No notes yet.</div>'}</div>
        <div class="row"><input class="field" id="nt" placeholder="Add a note, e.g. sent great bug reports" style="flex:1"><button class="btn primary" id="nadd">Add</button></div></div>
      ${(d.feedback || []).length ? `<div class="card"><h3>Feedback they sent</h3>${d.feedback.map(f => `<div class="row" style="padding:4px 0"><span class="pill p-${esc(f.status)}">${esc(f.status.toUpperCase())}</span><a href="#" data-fb="${f.id}">${esc(f.title)}</a><span class="sp"></span><span class="muted">${ago(f.created_at)}</span></div>`).join('')}</div>` : ''}
      ${(d.beta_requests || []).length ? `<div class="card"><h3>Beta requests</h3>${d.beta_requests.map(b => `<div style="padding:4px 0"><span class="pill p-${esc(b.status)}">${esc(b.status.toUpperCase())}</span> <span class="muted">${when(b.created_at)}</span>${b.why ? `<div class="muted">${esc(b.why)}</div>` : ''}</div>`).join('')}</div>` : ''}
      <div class="card"><h3>History</h3>${(d.history || []).map(h => `<div class="row" style="padding:3px 0;font-size:13.5px"><span>${esc(String(h.action).replace(/_/g, ' '))}</span><span class="muted">by ${esc(h.by || 'system')}</span><span class="sp"></span><span class="muted">${when(h.created_at)}</span></div>`).join('') || '<div class="muted">Nothing yet.</div>'}</div>`;
    // 1.8: their aARgon3 / Mexel orders, with the system config each one came with
    const paintOrders = async () => {
      const box = el.querySelector('#ordList'); if (!box) return;
      let list = (await sb.rpc('admin_user_redemptions', { p_user: uid })).data;
      if (!Array.isArray(list)) list = lk?.redemptions || [];
      el.querySelector('#ordN').textContent = list.length || '';
      const canRm = high && !A.viewer;
      box.innerHTML = list.length ? `<table class="cards"><tr><th>Order</th><th>Plan</th><th>System</th><th>Redeemed</th><th></th></tr>${list.map(o => `<tr><td><b style="font-family:var(--mono)">${esc(o.order_id)}</b></td><td>${esc(o.tier || '—')}</td>
        <td class="muted">${esc([o.config_os, o.config_chip, o.config_network, o.config_service_tier].filter(Boolean).join(' · ') || '—')}</td><td class="muted">${o.redeemed_at ? when(o.redeemed_at) : '—'}</td>
        <td>${canRm ? `<button class="btn sm danger" data-unredeem="${esc(o.order_id)}">Remove</button>` : ''}</td></tr>`).join('')}</table>
        <p class="muted" style="margin:6px 0 0">Removing un-redeems it: their perks from it stop, and the order can be redeemed again (by them or anyone with the number).</p>` : '<p class="muted" style="margin:0">No aARgon3 or Mexel orders redeemed.</p>';
      // 2.5: redeem an order for them (high-admins, or anyone given “Redeem orders for people”)
      if (NX.redeemFor && !A.viewer && (high || NX.can?.('redeem'))) box.insertAdjacentHTML('beforeend', `<div class="row" style="margin-top:10px"><input class="field" id="ordIn" placeholder="Order number, e.g. MRH33QFL-RA6C" style="flex:1;font-family:var(--mono)"><button class="btn primary" id="ordGo">🧾 Redeem for them</button></div>`);
      NX.labelTables();
    };
    paintOrders();
    el.onchange = async e => {
      if (e.target.id !== 'acPicF' || !e.target.files[0]) return;
      try { const image = await NX.avatarData(e.target.files[0]); if (await acct({ action: 'avatar', image })) { await NX.loadAdmins?.(); userDrawer(uid); } }
      catch (err) { toast(err.message || 'That picture can’t be used.', true); }
    };
    NX.softwareCard?.(uid).then(h => { const c = el.querySelector("#swCard"); if (c) c.outerHTML = h; }).catch(() => {});   // 2.3: what they use
    el.onclick = async e => {
      const b = e.target.closest('button,a'); if (!b) return;
      try {
        if (b.id === 'ordGo') { const inp = el.querySelector('#ordIn'); try { b.disabled = true; const r = await NX.redeemFor(uid, inp.value); toast(`✓ Redeemed ${r.order}${r.plan ? ' (' + r.plan + ')' : ''} for ${email}`); return paintOrders(); } catch (er) { b.disabled = false; return toast(er.message, true); } }
        if (b.dataset.unredeem) { if (!confirm(`Un-redeem order ${b.dataset.unredeem} from ${email}?`)) return; await rpc('admin_remove_redemption', { p_user: uid, p_order: b.dataset.unredeem }); toast('✓ Order removed'); return paintOrders(); }
        if (b.dataset.space) { e.preventDefault(); return spaceDrawer(b.dataset.space); }
        if (b.hasAttribute('data-mktask')) return NX.tasks.modal({ title: '', link_kind: 'user', link_id: uid, link_label: `${base.nickname || base.username || ''} (${email})`.trim() });
        if (b.dataset.fb) { e.preventDefault(); close(); return NX.go('feedback', { arg: b.dataset.fb }); }
        if (b.dataset.delnote) { e.preventDefault(); if (!confirm('Delete this note?')) return; const { error } = await sb.from('admin_user_notes').delete().eq('id', b.dataset.delnote); if (error) throw error; return userDrawer(uid); }
        if (b.id === 'nadd') { const body = $('nt').value.trim(); if (!body) return; const { error } = await sb.from('admin_user_notes').insert({ user_id: uid, body }); if (error) throw error; toast('✓ Note added'); return userDrawer(uid); }
        if (b.dataset.ac) {
          const a = b.dataset.ac;
          if (a === 'nick') return (await acct({ action: 'profile', nickname: $('acNick').value }, b)) && userDrawer(uid);
          if (a === 'user') return (await acct({ action: 'profile', username: $('acUser').value.trim() }, b)) && userDrawer(uid);
          if (a === 'pic') return $('acPicF').click();   // 2.0.4: change someone's picture (sent to admin-users, which uploads it)
          if (a === 'nopic') return (await acct({ action: 'profile', remove_avatar: true }, b)) && userDrawer(uid);
          if (a === 'email') { const v = $('acEmail').value.trim(); if (v === email || !confirm(`Change ${email}'s sign-in email to ${v}?`)) return; return (await acct({ action: 'email', email: v }, b)) && userDrawer(uid); }
          if (a === 'reset') { if (!confirm(`Email a password reset link to ${email}?`)) return; return acct({ action: 'reset', redirect: 'https://apojidelegraphics.github.io/Nexus-28/companion/' }, b); }
          if (a === 'temp') {
            if (!confirm(`Give ${email} a temporary password? Their current password stops working right away.`)) return;
            b.disabled = true; const { data, error } = await sb.functions.invoke('admin-users', { body: { user_id: uid, action: 'temp_password' } }); b.disabled = false;
            if (error || !data?.ok) return toast((error && (await error.context?.json?.().catch(() => null))?.error) || data?.error || error?.message || 'Couldn’t make one.', true);
            const { el: m } = NX.modal(`<h3>🔑 Temporary password</h3><p>Tell ${esc(base.nickname || base.username || email)} this privately. It works once: Nexus asks them to pick their own as soon as they sign in. It won't be shown again.</p>
              <div class="temp-pw"><code id="tpw">${esc(data.password)}</code><button class="btn sm" id="tpwCopy">Copy</button></div><div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn primary" data-close>Done</button></div>`);
            m.querySelector('#tpwCopy').onclick = () => { navigator.clipboard?.writeText(data.password); toast('Copied'); };
            return;
          }
          if (a === 'pw') { const v = $('acPw').value; if (v.length < 8) return toast('Use at least 8 characters.', true); if (!confirm(`Set a new password for ${email}?`)) return; if (await acct({ action: 'password', password: v }, b)) $('acPw').value = ''; return; }
          if (a === 'del') { const t = await NX.ask(`Delete ${email}?`, { note: 'Their account, Shared Space posts and everything synced to it go for good. Type DELETE to confirm.', placeholder: 'DELETE', ok: 'Delete forever', danger: true }); if (t !== 'DELETE') return t !== null && toast('Not deleted. Type DELETE exactly.', true); if (await acct({ action: 'delete', confirm: 'DELETE' }, b)) { close(); if (A.tab === 'users') P.users(); } return; }
        }
        if (b.id === 'tierGo') { await rpc('admin_set_tier', { p_user: uid, p_tier: $('tierSel').value }); await NX.loadAdmins(); toast('✓ Tier saved'); return userDrawer(uid); }
        if (b.dataset.beta) await rpc('admin_set_beta_tester', { target_email: email, enabled: b.dataset.beta === '1' });
        else if (b.dataset.comp) await rpc('admin_set_comp', { target_email: email, enabled: b.dataset.comp === '1' });
        else if (b.dataset.reset) { if (!confirm(`Reset their ${b.dataset.reset} chat count?`)) return; await rpc('admin_reset_chat_usage', { target_email: email, target_assistant: b.dataset.reset }); }
        else if (b.id === 'mgo') { const st = $('ms').value; if (st !== 'active' && !confirm(`${st === 'banned' ? 'Ban' : 'Suspend'} ${email}?`)) return; await rpc('admin_set_moderation', { target_email: email, new_status: st, reason_text: $('mr').value || null, suspend_hours: $('mh').value ? +$('mh').value : null }); }
        else if (b.id === 'rgo') { if (!confirm(`Make ${email} a ${$('rl').value}?`)) return; await rpc('admin_grant_role', { target_email: email, new_level: $('rl').value }); NX.loadAdmins(); }
        else if (b.id === 'rrv') { if (!confirm(`Remove ${email}'s admin role?`)) return; await rpc('admin_revoke_role', { target_email: email }); NX.loadAdmins(); }
        else return;
        toast('✓ Saved'); userDrawer(uid); if (A.tab === 'users') P.users();
      } catch (err) { toast(err.message, true); }
    };
  }
  NX.userDrawer = userDrawer;

  // =========================================================== Feature flags
  P.flags = async () => {
    const { data, error } = await sb.from('feature_flags').select('*').order('key');
    if (error) return main(`<h1>Feature flags</h1><div class="card err">${esc(error.message)}</div>`);
    const ST = [['off', 'Off'], ['admin', 'Admins'], ['beta', 'Beta testers'], ['all', 'Everyone']];
    main(`<h1>Feature flags</h1><p>Who gets each feature in the app. Apps pick up changes within a minute or two, no update needed.</p>
      <div class="card"><table class="cards"><tr><th>Feature</th><th>Who gets it</th><th>Min version</th><th>Changed</th><th></th></tr>${data.map(f => `<tr><td><b>${esc(f.title || f.key)}</b><div class="muted">${esc(f.key)}${f.description ? ' · ' + esc(f.description) : ''}</div></td>
        <td><select class="field" data-stage="${esc(f.key)}">${ST.map(([v, l]) => `<option value="${v}" ${f.stage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input class="field" data-minv="${esc(f.key)}" value="${esc(f.min_version || '')}" placeholder="any" style="width:90px"></td><td class="muted">${ago(f.updated_at)}</td><td>${A.viewer ? '' : `<button class="btn sm ghost danger" data-delflag="${esc(f.key)}" title="Remove this flag">🗑 Remove</button>`}</td></tr>`).join('')}</table>
        <p class="muted" style="margin:8px 0 0">Removing a flag deletes its row here. Apps that still know the feature fall back to their built-in setting (most are on for everyone); apps that don’t know it ignore it. To turn a feature off for everyone, set it to <b>Off</b> instead.</p></div>
      <div class="card"><h3>New flag</h3><div class="row"><input class="field" id="nk" placeholder="key_like_this"><input class="field" id="nt" placeholder="Title"><input class="field" id="nd" placeholder="Description" style="flex:1"><select class="field" id="ns">${ST.map(([v, l]) => `<option value="${v}" ${v === 'admin' ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn primary" id="nadd">Add</button></div></div>`);
    $('main').onchange = async e => {
      const t = e.target, key = t.dataset.stage || t.dataset.minv; if (!key) return;
      const patch = t.dataset.stage ? { stage: t.value } : { min_version: t.value.trim() || null };
      const { error: er } = await sb.from('feature_flags').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', key);
      toast(er ? er.message : '✓ Saved', !!er);
    };
    $('main').onclick = async e => {
      const del = e.target.closest('[data-delflag]');
      if (del) {   // 2.6: remove a flag
        const key = del.dataset.delflag; if (!confirm(`Remove the “${key}” flag? Apps fall back to their built-in setting for it.`)) return;
        const { error: er } = await sb.from('feature_flags').delete().eq('key', key);
        if (er) return toast(er.message, true);
        await sb.from('moderation_log').insert({ action: 'flag_removed', performed_by: A.user.id, details: { key } }).then(() => {}, () => {});
        toast('🗑 Removed ' + key); return P.flags();
      }
      if (e.target.id !== 'nadd') return;
      const key = $('nk').value.trim(); if (!/^[a-z0-9_]{2,48}$/.test(key)) return toast('Keys are 2–48 lowercase letters, numbers and _', true);
      const { error: er } = await sb.from('feature_flags').insert({ key, title: $('nt').value.trim() || key, description: $('nd').value.trim(), stage: $('ns').value });
      if (er) return toast(er.message, true); toast('✓ Added'); P.flags();
    };
  };

  // =========================================================== Beta dashboard (3.7)
  // Per beta feature: who has it, how many people used it, 👍 / 👎 from the one-tap beta feedback, and bug reports.
  P.beta = async () => {
    const { data, error } = await sb.rpc('admin_beta_stats');
    if (error) return main(`<h1>Beta</h1><div class="card err">${/admin_beta_stats|beta_events|42883|PGRST202/.test(error.message) ? 'Run <code>supabase/nexus-v3.7.sql</code> in the Supabase SQL editor to turn on the Beta dashboard.' : esc(error.message)}</div>`);
    const ST = { off: 'Off', admin: 'Admins', beta: 'Beta testers', all: 'Everyone' };
    const PL = { mac: '🍎 Mac', windows: '🪟 PC', web: '🧪 Test Run', phone: '📱 Phone', other: 'Other' };
    const early = (data || []).filter(f => f.stage !== 'all'), rest = (data || []).filter(f => f.stage === 'all');
    const card = f => { const votes = (f.up || 0) + (f.down || 0), pct = votes ? Math.round(f.up / votes * 100) : null;
      return `<div class="card beta-f"><div class="row"><b>${esc(f.title || f.key)}</b><span class="pill p-${f.stage === 'beta' ? 'approved' : f.stage === 'admin' ? 'pending' : f.stage === 'off' ? 'closed' : 'open'}">${ST[f.stage] || f.stage}</span>${f.min_version ? `<span class="muted">${esc(f.min_version)}+</span>` : ''}<span class="sp"></span>
        <select class="field sm" data-stage="${esc(f.key)}">${Object.entries(ST).map(([v, l]) => `<option value="${v}" ${f.stage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="beta-stats"><div><b>${f.uses_7d || 0}</b><span>uses this week</span></div><div><b>${f.people_30d || 0}</b><span>people (30 days)</span></div>
          <div><b>${pct === null ? '–' : pct + '%'}</b><span>👍 ${f.up || 0} · 👎 ${f.down || 0}</span></div><div><b class="${f.open_reports ? 'warn' : ''}">${f.open_reports || 0}</b><span>open bug reports (${f.reports || 0} total)</span></div></div>
        ${votes ? `<div class="bar2"><i style="width:${pct}%"></i></div>` : ''}
        <div class="muted">${f.platforms ? Object.entries(f.platforms).map(([p, n]) => `${PL[p] || p} ${n}`).join(' · ') : 'Nobody has used it yet.'}${f.last_used ? ' · last used ' + ago(f.last_used) : ''}</div>
        ${(f.notes || []).length ? `<details><summary>What people said (${f.notes.length})</summary>${f.notes.map(n => `<div class="beta-note">${n.kind === 'up' ? '👍' : n.kind === 'down' ? '👎' : '•'} ${esc(n.note)} <span class="muted">${PL[n.platform] || ''} · ${ago(n.at)}</span></div>`).join('')}</details>` : ''}
        ${f.reports ? `<button class="btn sm" data-reports="${esc(f.key)}">See bug reports</button>` : ''}</div>`; };
    main(`<h1>Beta</h1><p>How each early feature is doing. Testers rate a feature with one tap (⋯ menu → Beta feedback, on Mac, PC and in Test Run); bug reports land in Feedback. Change who gets it right here.</p>
      ${early.length ? early.map(card).join('') : '<div class="empty">No features in beta right now.</div>'}
      ${rest.length ? `<details class="card"><summary>Out of beta (${rest.length})</summary>${rest.map(card).join('')}</details>` : ''}`);
    $('main').onchange = async e => {
      const t = e.target; if (!t.dataset.stage) return;
      const { error: er } = await sb.from('feature_flags').update({ stage: t.value, updated_at: new Date().toISOString() }).eq('key', t.dataset.stage);
      toast(er ? er.message : '✓ Saved', !!er); if (!er) P.beta();
    };
    $('main').onclick = e => { const b = e.target.closest('[data-reports]'); if (b) { A.fb = { status: 'all', kind: 'all', q: '', mine: false, feature: b.dataset.reports }; NX.go('feedback'); } };
  };

  // =========================================================== Announcements
  P.announce = async () => {
    const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) return main(`<h1>Announcements</h1><div class="card err">${esc(error.message)}</div>`);
    main(`<h1>Announcements</h1><p>Live announcements show as a banner in Nexus on Mac and PC, in N28C and in Test Run.</p>
      <div class="card"><h3>New announcement</h3><textarea class="field" id="am" rows="2" maxlength="300" placeholder="Nexus 2.2 is out! Update from the app menu."></textarea>
        <div class="banner" style="margin:10px 0 0" id="apv" hidden>📣 <span></span></div>
        <div class="row" style="margin-top:8px"><span class="muted" id="ac">0 / 300</span><span class="sp"></span><button class="btn primary" id="aadd">Post it live</button></div></div>
      ${data.map(a => `<div class="card"><div class="row"><span class="pill ${a.active ? 'p-approved' : 'p-closed'}">${a.active ? 'LIVE' : 'OFF'}</span><span class="muted">${when(a.created_at)}${a.created_by ? ' · ' + esc(nameOf(NX.adminById(a.created_by))) : ''}</span><span class="sp"></span>
        <button class="btn sm" data-tog="${a.id}" data-on="${a.active ? 0 : 1}">${a.active ? 'Turn off' : 'Turn on'}</button><button class="btn sm danger" data-del="${a.id}">Delete</button></div><div style="margin-top:6px">${esc(a.message)}</div></div>`).join('') || '<div class="empty">No announcements yet.</div>'}`);
    $('am').oninput = e => { $('ac').textContent = `${e.target.value.length} / 300`; $('apv').hidden = !e.target.value.trim(); $('apv').querySelector('span').textContent = e.target.value; };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return; let error;
      if (b.id === 'aadd') { const m = $('am').value.trim(); if (!m) return; ({ error } = await sb.from('announcements').insert({ message: m, active: true, created_by: A.user.id })); }
      else if (b.dataset.tog) ({ error } = await sb.from('announcements').update({ active: b.dataset.on === '1' }).eq('id', b.dataset.tog));
      else if (b.dataset.del) { if (!confirm('Delete this announcement?')) return; ({ error } = await sb.from('announcements').delete().eq('id', b.dataset.del)); }
      else return;
      toast(error ? error.message : '✓ Saved', !!error); if (!error) P.announce();
    };
  };

  // =========================================================== Maintenance
  const SCOPES = [['global', '🌐 Everything', 'Nexus on Mac and PC, and N28C: no chats at all'], ['desktop', '💻 Desktop app', 'All chats in Nexus on Mac and PC (and asks from N28C)'], ['phone', '📱 N28C', 'The phone app'],
    ['spaces', '👥 Shared Spaces', 'Shared Spaces and live sessions'], ['web', '🧪 Test Run', 'The web version (Nexus in a browser)'], ['websearch', '🔎 Web search', 'Searching the web and reading pages everywhere (Mac, PC, Test Run, N28C); answers still work'], ['paragon', '@paragon', 'Only this agent'], ['neodela', '@neodela', 'Only this agent'], ['lyte', '@lyte', 'Only this agent'], ['flash', '@flash', 'Only this agent'], ['axiom', '@axiom', 'Only Axiom (Apex)']];
  const isOn = m => m.enabled === true || m.enabled === 'true' || m.enabled?.enabled === true;
  P.maint = async () => {
    const { data, error } = await sb.from('maintenance_config').select('*').order('scope');
    if (error) return main(`<h1>Maintenance</h1><div class="card err">${esc(error.message)}</div>`);
    const hasNew = data.length ? 'ends_at' in data[0] : true;
    const label = s => (SCOPES.find(x => x[0] === s) || [s, '⚙︎ @' + s + ' (feature)'])[1];
    main(`<h1>Maintenance</h1><p>Turn parts of Nexus off for everyone, with a message. Nexus on Mac and PC, Test Run and N28C check every minute (instantly in N28C) and block what's down. Admins can keep using things unless you turn that off.</p>
      ${hasNew ? '' : '<div class="banner warn">Run supabase/nexus-v2.2.sql to add end times and the admin bypass.</div>'}
      <div class="card"><h3>Take something down</h3>
        <div class="tabsub" id="scp" style="flex-wrap:wrap">${SCOPES.map(([k, l], i) => `<button data-sc="${k}" class="${i === 0 ? 'on' : ''}" title="${esc(SCOPES[i][2])}">${l}</button>`).join('')}<button data-sc="__feature">⚙︎ A feature…</button></div>
        <div class="row" style="margin-bottom:8px"><input class="field" id="mFeat" placeholder="Feature name, e.g. seek, magyk, studymode" hidden style="flex:1"></div>
        <div class="row"><select class="field" id="mType"><option value="update">🛠 Update</option><option value="outage">⚠️ Outage</option><option value="emergency">🚨 Emergency</option></select>
          <input class="field" id="mMsg" placeholder="Message people see, e.g. Back in about 20 minutes!" style="flex:1;min-width:200px"></div>
        <div class="row" style="margin-top:8px"><label class="muted">Back at <input class="field" type="datetime-local" id="mEnd"></label><label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mBy" checked> Admins can keep using it</label><span class="sp"></span><button class="btn danger" id="mGo">Take down</button></div>
        <div class="muted" id="mHelp" style="margin-top:8px">${esc(SCOPES[0][2])}</div></div>
      <h2>Switches</h2>
      ${data.map(m => `<div class="card"><div class="row"><b>${esc(label(m.scope))}</b><span class="muted" style="font-family:var(--mono)">${esc(m.scope)}</span><span class="pill ${isOn(m) ? 'p-declined' : 'p-approved'}">${isOn(m) ? 'DOWN' : 'UP'}</span>
          ${isOn(m) && m.ends_at ? `<span class="muted">back ${new Date(m.ends_at) > Date.now() ? 'in ' + Math.max(1, Math.round((new Date(m.ends_at) - Date.now()) / 60e3)) + ' min' : 'time passed'}</span>` : ''}<span class="sp"></span>
          <button class="btn sm ${isOn(m) ? 'primary' : 'danger'}" data-mt="${esc(m.scope)}" data-on="${isOn(m) ? 0 : 1}">${isOn(m) ? 'Bring back up' : 'Take down'}</button><button class="btn sm ghost" data-rm="${esc(m.scope)}" title="Remove this switch">🗑</button></div>
        <div class="row" style="margin-top:8px"><input class="field" style="flex:1" data-msg="${esc(m.scope)}" value="${esc(m.message || '')}" placeholder="Message people see">
          ${'admin_bypass' in m ? `<label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-by="${esc(m.scope)}" ${m.admin_bypass !== false ? 'checked' : ''}> Admins bypass</label>` : ''}</div>
        <div class="muted" style="margin-top:6px">${esc((Array.isArray(m.types) ? m.types : []).join(', ') || 'update')} · changed ${ago(m.updated_at)}</div></div>`).join('') || '<div class="empty">Nothing configured. Everything is up. ✅</div>'}`);
    let scope = 'global';
    $('scp').onclick = e => { const b = e.target.closest('[data-sc]'); if (!b) return; scope = b.dataset.sc; document.querySelectorAll('#scp button').forEach(x => x.classList.toggle('on', x === b)); $('mFeat').hidden = scope !== '__feature'; $('mHelp').textContent = scope === '__feature' ? 'Turns one @feature off in every agent.' : (SCOPES.find(x => x[0] === scope) || [])[2] || ''; if (scope === '__feature') $('mFeat').focus(); };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return; let error;
      const now = new Date().toISOString();
      if (b.id === 'mGo') {
        const sc = scope === '__feature' ? $('mFeat').value.trim().toLowerCase().replace(/^@/, '') : scope; if (!sc) return toast('Which feature?', true);
        if (!confirm(`Take "${label(sc)}" down for everyone?`)) return;
        const row = { scope: sc, enabled: true, message: $('mMsg').value.trim(), types: [$('mType').value], countdown: !!$('mEnd').value, updated_at: now };
        if (hasNew) Object.assign(row, { ends_at: $('mEnd').value ? new Date($('mEnd').value).toISOString() : null, admin_bypass: $('mBy').checked });
        ({ error } = await sb.from('maintenance_config').upsert(row));
      } else if (b.dataset.mt) {
        if (b.dataset.on === '1' && !confirm(`Take "${b.dataset.mt}" down for everyone?`)) return;
        ({ error } = await sb.from('maintenance_config').update({ enabled: b.dataset.on === '1', updated_at: now }).eq('scope', b.dataset.mt));
      } else if (b.dataset.rm) { if (!confirm(`Remove the "${b.dataset.rm}" switch?`)) return; ({ error } = await sb.from('maintenance_config').delete().eq('scope', b.dataset.rm)); }
      else return;
      toast(error ? error.message : '✓ Saved. Apps update within a minute.', !!error); if (!error) P.maint();
    };
    $('main').onchange = async e => {
      const s = e.target.dataset.msg || e.target.dataset.by; if (!s) return;
      const patch = e.target.dataset.msg ? { message: e.target.value } : { admin_bypass: e.target.checked };
      const { error: er } = await sb.from('maintenance_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('scope', s); toast(er ? er.message : '✓ Saved', !!er);
    };
    live(['maintenance_config'], () => { if (!document.activeElement?.matches('input,select')) P.maint(); }, 2000);
  };

  // =========================================================== Audit log
  P.audit = async () => {
    const r = await rpc('admin_get_audit_log', { row_limit: 300 });
    const rows = r.entries || [];
    main(`<h1>Audit log</h1><p>Every admin action: roles, perks, moderation, beta decisions and removed content.</p>
      <div class="row" style="margin-bottom:10px"><input class="field" id="aq" placeholder="Filter by action, account or admin" style="flex:1"><button class="btn" id="acsv">Export CSV</button></div>
      <div class="card"><table class="cards" id="at"><tr><th>When</th><th>Action</th><th>Account</th><th>By</th></tr>${rows.map(x => `<tr data-s="${esc((x.action + ' ' + (x.target_email || '') + ' ' + (x.performed_by_email || '')).toLowerCase())}"><td class="muted">${when(x.created_at)}</td><td>${esc(String(x.action).replace(/_/g, ' '))}</td><td>${esc(x.target_email || '—')}</td><td class="muted">${esc(x.performed_by_email || 'system')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing yet.</td></tr>'}</table></div>`);
    $('aq').oninput = e => { const q = e.target.value.toLowerCase(); document.querySelectorAll('#at tr[data-s]').forEach(tr => { tr.hidden = !!q && !tr.dataset.s.includes(q); }); };
    $('acsv').onclick = () => download(`nexus-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv([['when', 'action', 'account', 'by'], ...rows.map(x => [x.created_at, x.action, x.target_email, x.performed_by_email])]));
  };

  // =========================================================== My settings
  P.me = async () => {
    const me = A.me || {}, p = A.prefs, n = p.notify || {};
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const t = NX.store.get('theme', null);
    const tog = (id, label, sub, on) => `<label class="toggle"><div>${label}<small>${sub}</small></div><input type="checkbox" id="${id}" ${on ? 'checked' : ''}></label>`;
    const profile = `<div class="card"><h3>Profile</h3><div class="row" style="gap:16px;flex-wrap:nowrap">${av(me, 'xl', true)}<div style="flex:1;min-width:0">
          <input class="field" id="nick" placeholder="Your name in chat" maxlength="24" value="${esc(me.nickname || '')}" style="width:100%"><div class="row" style="margin-top:8px">
          <button class="btn" id="pic">Change picture</button>${me.avatar_url ? '<button class="btn ghost" id="picRm">Remove</button>' : ''}<input type="file" id="picF" accept="image/*" hidden></div>
          <p class="muted" style="margin:8px 0 0">Your picture shows here, in Nexus on Mac and PC, in Test Run and in N28C. You can also change it in Nexus (Settings → Account).</p></div></div></div>`;
    const status = `<div class="card"><h3>Status</h3><div class="tabsub" id="st" style="flex-wrap:wrap">${[['auto', '🟢 Automatic', 'Online, or idle when you step away'], ['dnd', '⛔ Do not disturb', 'No pop-ups or sounds'], ['invisible', '⚪ Invisible', 'Look offline']].map(([k, l, s]) => `<button data-st="${k}" class="${p.status === k ? 'on' : ''}" title="${s}">${l}</button>`).join('')}</div>
          <input class="field" id="stt" maxlength="80" placeholder="Custom status, e.g. 🛠 fixing the relay" value="${esc(p.status_text || '')}" style="width:100%">
          <p class="muted" style="margin:8px 0 0">Right now others see you as <span class="prtxt ${presence(me)}">${PRES[presence(me)]}</span>.</p></div>`;
    const notes = `<div class="card"><h3>Notifications</h3>
          <div class="row" style="margin-bottom:6px">${perm === 'granted' ? '<span class="ok">✓ Desktop notifications are on for this browser.</span>' : perm === 'denied' ? '<span class="err" style="flex:1;min-width:200px">Notifications are blocked for this site. Allow them in your browser\'s site settings.</span>' : perm === 'unsupported' ? '<span class="muted">This browser can\'t show notifications. You\'ll still get pop-ups in the portal.</span>' : '<button class="btn primary" id="perm">Turn on desktop notifications</button>'}<span class="sp"></span><button class="btn sm" id="ntest">Test</button></div>
          ${tog('nChat', '💬 Admin chat', 'New messages (muted chats only for @mentions)', n.chat !== false)}${tog('nReq', '🧪 Requests', 'Beta and access requests', n.requests !== false)}
          ${tog('nFb', '📮 Feedback & bugs', 'New reports and replies from people', n.feedback !== false)}${tog('nTask', '✅ Tasks', 'Someone gives you a task', n.tasks !== false)}${tog('nRep', '🚩 Content reports', 'Something reported in Shared Spaces or a shared agent', n.reports !== false)}
          ${tog('nAudit', '📜 Audit alerts', 'Another admin changes roles, bans someone or removes content', n.audit !== false)}${tog('nSched', '⏰ Schedules', 'A schedule ran or failed', n.schedules !== false)}
          ${tog('nSound', '🔊 Sound', 'A soft chime with each notification', n.sound !== false)}
          <p class="muted" style="margin:6px 0 0">Notifications arrive while Apoji Admin is open (even in the background). For notifications on your phone when it's closed, see <a href="#hub">${window.apojiDesktop ? 'This Mac' : 'Mac hub'}</a>.</p></div>`;
    const crypt = `<div class="card"><h3>🔒 Chat encryption</h3><p class="muted" style="margin-top:0">Admin chat messages and files are end-to-end encrypted with the team passphrase. Supabase only stores scrambled text.</p>
          <div class="row">${NXCrypto.ready() ? '<span class="ok">✓ Unlocked on this device</span><span class="sp"></span><button class="btn" id="eLock">Lock on this device</button>' : '<span class="muted">Locked on this device.</span><span class="sp"></span><button class="btn primary" id="eOpen">Unlock in Admin chat</button>'}</div>
          ${A.level === 'high-admin' && NXCrypto.ready() ? '<div class="row" style="margin-top:10px"><button class="btn" id="eOld">Encrypt messages from before</button><span class="muted" id="eOldN"></span></div>' : ''}</div>`;
    const privacy = `<div class="card"><h3>Privacy & theme</h3>${tog('rr', 'Read receipts', "Others see when you've read their messages. Turn it off and you won't see theirs either.", p.read_receipts !== false)}
      ${tog('tySend', 'Show when I’m typing', 'Others see “… is typing” while you write in Team chat.', p.typing_send !== false)}${tog('tyShow', 'Show when others are typing', 'See “… is typing” under the messages.', p.typing_show !== false)}
          <p class="muted" style="margin:10px 0 0">${t ? `<i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:6px"></i><b style="color:var(--text)">${esc(t.name || 'Your theme')}</b> · ` : ''}The portal uses the theme you picked in the Mac app (Settings → General → Theme). Change it there and it shows up here next time you open the portal.</p></div>`;
    const keys = `<div class="card"><h3>⌨ Shortcuts</h3><p class="muted" style="margin:0 0 8px">Press <kbd>⌘</kbd><kbd>K</kbd> (or <kbd>Ctrl</kbd><kbd>K</kbd>) to jump anywhere: pages, admins, users, feedback and tasks. <kbd>G</kbd> then a letter goes to a page, <kbd>N</kbd> makes a task.</p><button class="btn" id="keysHelp">See all shortcuts</button></div>`;
    main(`<h1>My settings</h1><p>Your picture, status and how the portal notifies you.</p>
      <div class="me-cols"><div>${profile}${notes}${NX.replies.card()}</div><div>${status}${crypt}${privacy}${keys}</div></div>
      <div class="me-foot"><span class="muted">Signed in as ${esc(A.user.email)} · ${esc(NX.levelLabel(A.level, A.user.id))}</span><span class="sp"></span><button class="btn danger" id="out">Sign out</button></div>
      <p class="apoji-foot">Apoji Admin · © ${new Date().getFullYear()} Apoji Delegraphics. All rights reserved.</p>`);
    const N = { nChat: 'chat', nReq: 'requests', nFb: 'feedback', nRep: 'reports', nTask: 'tasks', nAudit: 'audit', nSched: 'schedules', nSound: 'sound' };
    $('main').onchange = async e => {
      const id = e.target.id;
      if (N[id]) { await NX.savePrefs({ notify: { ...A.prefs.notify, [N[id]]: e.target.checked } }); toast('✓ Saved'); }
      if (id === 'tySend' || id === 'tyShow') { const k = id === 'tySend' ? 'typing_send' : 'typing_show'; await NX.savePrefs({ [k]: e.target.checked }); return toast(e.target.checked ? '✓ On' : 'Off'); }
      if (id === 'rr') { await NX.savePrefs({ read_receipts: e.target.checked }); toast(e.target.checked ? '✓ Read receipts on' : 'Read receipts off'); }
      if (id === 'picF' && e.target.files[0]) uploadAvatar(e.target.files[0]);
      if (id === 'nick') { const v = e.target.value.trim(); const { error } = await sb.from('profiles').update({ nickname: v || null }).eq('id', A.user.id); if (error) return toast(error.message, true); await NX.loadAdmins(); NX.paintHeader(); toast('✓ Saved'); }
      if (id === 'stt') { await NX.savePrefs({ status_text: e.target.value.trim() }); toast('✓ Status saved'); }
    };
    $('main').onclick = async e => {
      const s = e.target.closest('[data-st]'); if (s) { await NX.savePrefs({ status: s.dataset.st }); return P.me(); }
      if (await NX.replies.click(e)) return;
      if (e.target.id === 'keysHelp') return NX.shortcutsHelp();
      if (e.target.id === 'pic') $('picF').click();
      if (e.target.id === 'eLock') { if (!confirm('Lock admin chat on this device? You\'ll need the team passphrase to read it again here.')) return; await NX.chat.lock(); toast('🔒 Locked'); return P.me(); }
      if (e.target.id === 'eOpen') return NX.go('chat');
      if (e.target.id === 'eOld') { e.target.disabled = true; try { const r = await NX.chat.encryptOld((n, f) => { $('eOldN').textContent = `${n} messages, ${f} files…`; }); $('eOldN').textContent = `✓ Encrypted ${r.messages} message${r.messages === 1 ? '' : 's'} and ${r.files} file${r.files === 1 ? '' : 's'}.`; } catch (err) { toast(err.message, true); e.target.disabled = false; } }
      if (e.target.id === 'picRm') { await sb.from('profiles').update({ avatar_url: null }).eq('id', A.user.id); await NX.loadAdmins(); NX.paintHeader(); P.me(); }
      if (e.target.id === 'perm') { const r = await Notification.requestPermission(); toast(r === 'granted' ? '✓ Notifications on' : 'Notifications not allowed', r !== 'granted'); P.me(); }
      if (e.target.id === 'ntest') { const was = document.hidden; NX.notify({ kind: 'chat', force: true, title: '🔔 Test notification', body: 'This is what notifications look like.', who: A.me }); if (!was && 'Notification' in window && Notification.permission === 'granted') try { new Notification('🔔 Test notification', { body: 'This is what notifications look like.', icon: '../companion/icon-192.png' }); } catch {} }
      if (e.target.id === 'out') { await sb.from('admin_prefs').update({ last_seen: new Date(Date.now() - 3600e3).toISOString() }).eq('user_id', A.user.id); await sb.auth.signOut(); location.reload(); }
    };
  };
  // Square-crop, shrink to 256px, upload to avatars/<you>/avatar.webp, save the public URL on your profile
  // 2.0.4: crop any picture to a 256px square (webp, png fallback) as a data URL, for changing someone else's picture
  NX.avatarData = async file => {
    const img = await createImageBitmap(file);
    const sq = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.width - sq) / 2, (img.height - sq) / 2, sq, sq, 0, 0, 256, 256);
    let u = c.toDataURL('image/webp', .88); if (!u.startsWith('data:image/webp')) u = c.toDataURL('image/png');
    return u;
  };
  async function uploadAvatar(file) {
    try {
      const img = await createImageBitmap(file);
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      const blob = await new Promise(r => c.toBlob(r, 'image/webp', .88)) || await new Promise(r => c.toBlob(r, 'image/png'));
      const path = `${A.user.id}/avatar.${blob.type === 'image/webp' ? 'webp' : 'png'}`;
      const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type });
      if (error) throw new Error(NX.needSql(error.message) || /bucket/i.test(error.message) ? 'Run supabase/nexus-v2.2.sql first (it creates the avatars bucket).' : error.message);
      const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
      const { error: e2 } = await sb.from('profiles').update({ avatar_url: url }).eq('id', A.user.id); if (e2) throw e2;
      await NX.loadAdmins(); NX.paintHeader(); toast('✓ Picture updated'); P.me();
    } catch (e) { toast(e.message, true); }
  }
})();
