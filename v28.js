// Apoji Admin 2.8 (needs supabase/apoji-admin-2.8.sql in the Nexus project):
//   • Dashboard: the daily digest (yesterday at a glance, one notification each morning) and who's on call
//   • On-call: a weekly rotation (Status page); major incidents and urgent bugs page whoever is on call
//   • Feedback: similar reports on each bug, a Duplicates list, merge into one (the reporter is told)
//   • Admin activity: a weekday × hour heatmap of what admins did
//   • STAFF: shift reminders (Nexus app + phone), shift swaps, payroll export, more about each person, promo performance
// (Idle status and the Done / calendar release plans are in admin.js, pages.js and v26.js.)
(function () {
  const { sb, $, esc, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL28 = 'Run supabase/apoji-admin-2.8.sql (this repo) in Supabase → SQL Editor to turn this on.';
  const need28 = m => /admin_daily_digest|admin_oncall|admin_feedback|admin_activity|staff_|duplicate_of|PGRST20|42P01|42883|function .* does not exist/i.test(m || '');
  const nm = a => NX.nameOf(a);
  const day = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const tm = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const plural = (n, w) => `${n} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'}`;
  const csvOf = rows => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); };

  // =========================================================== On-call
  const OC = { data: null, at: 0 };
  async function oncall(force) {
    if (!force && OC.data && Date.now() - OC.at < 60e3) return OC.data;
    const { data, error } = await sb.rpc('admin_oncall_now');
    OC.data = error ? { error: error.message } : data; OC.at = Date.now(); return OC.data;
  }
  NX.oncall = oncall;
  const isHigh = () => A.level === 'high-admin' && !A.viewer;
  const ocLine = s => { const a = NX.adminById(s.user_id); return `${a ? NX.av(a, 'sm') : ''}<b>${esc(a ? nm(a) : s.name || 'Someone')}</b><span class="muted">${day(s.starts_at)} ${tm(s.starts_at)} → ${day(s.ends_at)} ${tm(s.ends_at)}</span>`; };
  function ocCard(d, { manage = false } = {}) {
    if (d?.error) return `<div class="card oc-card"><h3>On call</h3><p class="muted">${need28(d.error) ? SQL28 : esc(d.error)}</p></div>`;
    const me = d?.now?.user_id === A.user.id;
    return `<div class="card oc-card ${me ? 'me' : ''}"><div class="row"><h3 style="margin:0">On call</h3>${me ? '<span class="pill p-declined">YOU</span>' : ''}<span class="sp"></span>${manage && isHigh() ? '<button class="btn sm" id="ocPlan">Plan the rotation</button>' : manage ? '' : '<button class="btn sm ghost" data-go="status">Rotation</button>'}</div>
      ${d?.now ? `<div class="row oc-now">${ocLine(d.now)}</div><p class="muted" style="margin:6px 0 0">${me ? 'Major incidents and urgent bugs page you (here, in Nexus and on your phone), even in Do not disturb.' : 'Major incidents and urgent bugs page them.'}</p>`
        : '<p class="muted" style="margin:6px 0 0">Nobody is on call right now.' + (isHigh() ? ' Plan a rotation so outages always reach someone.' : '') + '</p>'}
      ${d?.next ? `<div class="row oc-next"><span class="muted">Next</span>${ocLine(d.next)}</div>` : ''}
      ${manage && (d?.upcoming || []).length ? `<details class="oc-up"><summary class="muted">The next weeks (${d.upcoming.length})</summary>${d.upcoming.map(s => `<div class="row oc-row ${s.id === d.now?.id ? 'on' : ''}">${ocLine(s)}<span class="sp"></span>${isHigh() ? `<button class="btn sm ghost" data-ocdel="${s.id}" title="Remove">✕</button>` : ''}</div>`).join('')}</details>` : ''}</div>`;
  }
  function rotationModal(host) {
    const admins = A.admins.slice().sort((a, b) => nm(a).localeCompare(nm(b)));
    const mon = (() => { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
    const local = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
    const { el, close } = NX.modal(`<h3>Plan the on-call rotation</h3><p class="muted" style="margin-top:0">Pick who takes turns, in order. Each person is on call for a week. This replaces what's planned from the start time on.</p>
      <div class="oc-pick">${admins.map(a => `<label class="row oc-p"><input type="checkbox" data-ocu="${esc(a.id)}">${NX.av(a, 'sm')}<span>${esc(nm(a))}</span><span class="muted">${esc(NX.levelLabel(a.level, a.id))}</span></label>`).join('')}</div>
      <div class="acct-grid" style="margin-top:10px"><label>Starts</label><input class="field" type="datetime-local" id="ocS" value="${local(mon)}"><label>Weeks</label><input class="field" type="number" id="ocW" min="1" max="52" value="8" style="width:100px"></div>
      <p class="muted" id="ocOrder"></p><div class="row"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="ocGo">Save the rotation</button></div>`);
    const order = [];
    el.addEventListener('change', e => { const u = e.target.dataset.ocu; if (!u) return; const i = order.indexOf(u); if (e.target.checked && i < 0) order.push(u); if (!e.target.checked && i >= 0) order.splice(i, 1);
      el.querySelector('#ocOrder').textContent = order.length ? 'Order: ' + order.map(id => nm(NX.adminById(id))).join(' → ') : ''; });
    el.querySelector('#ocGo').onclick = async () => {
      if (!order.length) return toast('Pick at least one person.', true);
      const { data, error } = await sb.rpc('admin_oncall_rotate', { p_users: order, p_start: new Date(el.querySelector('#ocS').value).toISOString(), p_weeks: +el.querySelector('#ocW').value || 8 });
      if (error || !data?.success) return toast(error ? (need28(error.message) ? SQL28 : error.message) : data.error, true);
      close(); toast(`Planned ${plural(data.shifts, 'week')} of on-call`); await oncall(true); paintOc(host, true);
    };
  }
  async function paintOc(host, manage) {
    const d = await oncall(); if (!host.isConnected) return;
    host.innerHTML = ocCard(d, { manage });
    host.onclick = async e => {
      if (e.target.closest('#ocPlan')) return rotationModal(host);
      const g = e.target.closest('[data-go]'); if (g) return NX.go(g.dataset.go);
      const del = e.target.closest('[data-ocdel]'); if (del) { if (!confirm('Remove this on-call week?')) return; const { error } = await sb.from('admin_oncall').delete().eq('id', +del.dataset.ocdel); if (error) return toast(error.message, true); await oncall(true); paintOc(host, manage); }
    };
  }
  // the Status page gets the on-call card and rotation
  const beforeStatus = P.status;
  if (beforeStatus) P.status = async (...a) => {
    await beforeStatus(...a);
    if (A.tab !== 'status') return;
    if ($('oncall')) return;
    const host = document.createElement('div'); host.id = 'oncall'; host.style.marginTop = '14px';
    const first = $('main').querySelector('h1 + p'); (first || $('main').querySelector('h1')).after(host);
    paintOc(host, true);
  };
  // pages: major incidents and urgent bugs, for whoever is on call (even in Do not disturb)
  const paged = new Set();
  const page = (key, title, body, tab, arg) => { if (paged.has(key)) return; paged.add(key); NX.notify({ kind: 'audit', title, body, tab, force: true, urgent: true, onClick: () => NX.go(tab, arg ? { arg } : {}) }); };
  NX.on('status_incidents', async p => {
    if (p.eventType !== 'INSERT' || !['major', 'critical'].includes(p.new?.severity)) return;
    const d = await oncall(true); if (d?.now?.user_id === A.user.id) page('inc' + p.new.id, 'You’re on call: ' + p.new.title, `A ${p.new.severity} incident was posted.`, 'status');
  });
  NX.on('feedback_reports', async p => {
    const r = p.new; if (!r || r.priority !== 'urgent' || !['bug', 'featfix'].includes(r.kind) || p.old?.priority === 'urgent') return;
    const d = await oncall(true); if (d?.now?.user_id === A.user.id) page('bug' + r.id, `You’re on call: urgent bug #${r.id}`, r.title, 'feedback', String(r.id));
  });
  NX.on('admin_oncall', () => { OC.at = 0; const h = $('oncall') || $('dashOncall'); if (h) paintOc(h, h.id === 'oncall'); });

  // =========================================================== Daily digest
  const n = v => (+v || 0).toLocaleString();
  function digestHtml(d) {
    if (!d || d.error) return `<div class="card dg-card"><h3>Yesterday at a glance</h3><p class="muted">${need28(d?.error) ? SQL28 : esc(d?.error || 'Couldn’t load the digest.')}</p></div>`;
    const fb = d.feedback || {}, fbTotal = Object.values(fb).reduce((a, b) => a + b, 0);
    const SURF = { mac: 'Mac', windows: 'Windows', test_run: 'Test Run', phone: 'N28C', admin: 'Admin', linux: 'Linux' };
    const open = (d.incidents || []).filter(i => i.status !== 'resolved');
    const tile = (v, l, go, warn) => `<button class="stat dg-t ${warn ? 'warn' : ''}" ${go ? `data-go="${go}"` : ''}><b>${n(v)}</b><span>${l}</span></button>`;
    return `<div class="card dg-card"><div class="row"><h3 style="margin:0">Yesterday at a glance</h3><span class="muted">${day(d.day + 'T12:00')}</span><span class="sp"></span><button class="btn sm ghost" id="dgPrev" title="The day before">‹</button><button class="btn sm ghost" id="dgNext" title="The day after">›</button></div>
      <div class="dg-tiles">${tile(d.active_users, 'people used Nexus', 'users')}${tile(d.new_users, 'new accounts', 'users')}${tile(fbTotal, 'reports came in', 'feedback')}${tile(d.bugs_open, 'bugs open', 'feedback', d.urgent_open > 0)}${tile(d.premium_tasks, 'Paragon & Axiom tasks', 'freeapi')}${tile(d.try_answers, 'Test Run answers', 'freeapi')}</div>
      <ul class="dg-list">
        ${d.urgent_open ? `<li class="warn"><b>${plural(d.urgent_open, 'urgent bug')}</b> still open. <a href="#feedback">Open Feedback</a></li>` : ''}
        ${d.unanswered ? `<li><b>${plural(d.unanswered, 'report')}</b> waiting more than a day for a first look.</li>` : ''}
        ${open.length ? `<li class="warn"><b>${plural(open.length, 'incident')}</b> not resolved: ${open.map(i => esc(i.title)).join(', ')}. <a href="#status">Status page</a></li>` : ''}
        ${(d.releases_soon || []).length ? `<li>Coming up: ${d.releases_soon.map(r => `<b>${esc(r.version)}</b> ${new Date(r.target_date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`).join(', ')}. <a href="#releases">Releases</a></li>` : ''}
        ${fbTotal ? `<li>Reports: ${Object.entries(fb).map(([k, v]) => `${v} ${esc(k === 'featfix' ? 'unsorted' : k)}`).join(', ')} · ${plural(d.replies, 'reply')} sent by the team.</li>` : ''}
        ${Object.keys(d.by_surface || {}).length ? `<li>Where: ${Object.entries(d.by_surface).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(SURF[k] || k)} ${n(v)}`).join(' · ')}</li>` : ''}
        ${d.reports ? `<li>${plural(d.reports, 'content report')} from Shared Spaces or shared agents.</li>` : ''}
        <li class="muted">${plural(d.admin_actions, 'admin action')} logged · on call: ${esc(d.oncall || 'nobody')}</li></ul></div>`;
  }
  const DG = { offset: 1 };
  async function digest(offset = DG.offset) {
    const d0 = new Date(); d0.setUTCHours(12, 0, 0, 0); d0.setUTCDate(d0.getUTCDate() - offset);
    const { data, error } = await sb.rpc('admin_daily_digest', { p_day: d0.toISOString().slice(0, 10) });
    return error ? { error: error.message } : data;
  }
  async function paintDigest(host) {
    const d = await digest(); if (!host.isConnected) return;
    host.innerHTML = digestHtml(d);
    if (DG.offset !== 1) host.querySelector('h3').textContent = DG.offset === 0 ? 'Today so far' : 'That day at a glance';
    host.onclick = e => {
      if (e.target.closest('#dgPrev')) { DG.offset = Math.min(60, DG.offset + 1); return paintDigest(host); }
      if (e.target.closest('#dgNext')) { DG.offset = Math.max(0, DG.offset - 1); return paintDigest(host); }
      const g = e.target.closest('[data-go]'); if (g) NX.go(g.dataset.go);
    };
  }
  // one notification a morning (after 7 AM), the first time Apoji Admin is open that day
  async function morning() {
    const today = new Date().toDateString(); if (new Date().getHours() < 7 || NX.store.get('digestDay', '') === today) return;
    const d = await digest(1); if (!d || d.error || !d.success) return;
    NX.store.set('digestDay', today);
    const fb = Object.values(d.feedback || {}).reduce((a, b) => a + b, 0);
    const bits = [`${n(d.active_users)} people used Nexus`, d.new_users ? `${n(d.new_users)} new` : '', fb ? plural(fb, 'report') : '', d.urgent_open ? `${plural(d.urgent_open, 'urgent bug')} open` : '', (d.incidents || []).some(i => i.status !== 'resolved') ? 'an incident is open' : ''].filter(Boolean);
    NX.notify({ kind: 'schedules', title: 'Your daily digest', body: bits.join(' · '), tab: 'dashboard' });
  }
  setTimeout(() => { if (A.user) morning(); }, 6000); setInterval(() => { if (A.user) morning(); }, 15 * 60e3);
  // 2.8.1: "Needs you" under the on-call box: what's waiting right now, and quick links
  async function paintNeeds(host) {
    const [d, tests] = await Promise.all([digest(0), sb.from('test_results').select('item_id,status,reply,updated_at').eq('status', 'fail').is('reply', null).gte('updated_at', new Date(Date.now() - 14 * 864e5).toISOString()).then(r => r.error ? sb.from('test_results').select('item_id,status,updated_at').eq('status', 'fail').gte('updated_at', new Date(Date.now() - 14 * 864e5).toISOString()) : r, () => ({ data: [] }))]);
    if (!host.isConnected) return;
    const ok = d && !d.error, open = ok ? (d.incidents || []).filter(i => i.status !== 'resolved').length : 0, fails = (tests?.data || []).length;
    const items = ok ? [[d.urgent_open, 'urgent bug|urgent bugs', 'feedback', true], [open, 'open incident|open incidents', 'status', true], [d.unanswered, 'report waiting over a day|reports waiting over a day', 'feedback'], [fails, 'failed test without a reply|failed tests without a reply', 'testing'], [(d.releases_soon || []).length, 'release coming up|releases coming up', 'releases']].filter(x => +x[0] > 0) : [];
    host.innerHTML = `<div class="card"><h3 style="margin:0">Needs you</h3>
      <div class="needs-list">${!ok ? `<div class="ok">${need28(d?.error) ? SQL28 : 'Couldn’t check right now.'}</div>` : items.length ? items.map(([v, l, go, warn]) => `<button data-go="${go}" class="${warn ? 'warn' : ''}"><b>${n(v)}</b><span>${esc(l.split('|')[+v === 1 ? 0 : 1])}</span></button>`).join('') : '<div class="ok">Nothing waiting. Nice.</div>'}</div>
      <div class="quick-links">${[['feedback', 'Feedback'], ['testing', 'Testing'], ['releases', 'Releases'], ['status', 'Status'], ['chat', 'Team chat']].map(([k, l]) => `<button class="btn sm ghost" data-go="${k}">${l}</button>`).join('')}</div></div>`;
    host.onclick = e => { const g = e.target.closest('[data-go]'); if (g) NX.go(g.dataset.go); };
  }
  const beforeDash = P.dashboard;
  P.dashboard = async (...a) => {
    await beforeDash(...a);
    if (A.tab !== 'dashboard') return;
    if ($('main').querySelector('.dg-wrap')) return;   // the dashboard can render twice at once
    const wrap = document.createElement('div'); wrap.className = 'dg-wrap'; wrap.innerHTML = '<div class="dg-main"><div id="dashDigest"></div></div><div class="dg-side"><div id="dashOncall"></div><div id="dashNeeds"></div></div>';
    const first = $('main').querySelector('h1 + p') || $('main').querySelector('h1'); first ? first.after(wrap) : $('main').prepend(wrap);
    // 3.0: "Your day" sits under the digest, so the left side isn't empty next to On call + Needs you
    const md = $('myDay'); if (md) wrap.querySelector('.dg-main').appendChild(md);
    paintDigest($('dashDigest')); paintOc($('dashOncall'), false); paintNeeds($('dashNeeds'));
  };

  // =========================================================== Bug duplicates
  NX.afterFeedbackList = list => {
    // mark duplicates in the list
    for (const r of list) if (r.duplicate_of) document.querySelector(`.iitem[data-fb="${r.id}"] .row`)?.insertAdjacentHTML('beforeend', `<span class="pill" title="Duplicate of #${r.duplicate_of}">DUPLICATE</span>`);
    const bar = $('fCsv'); if (!bar || $('fDupes')) return;
    bar.insertAdjacentHTML('beforebegin', '<button class="btn" id="fDupes" title="Open bugs that look like the same problem">Duplicates</button>');
    $('fDupes').onclick = dupesModal;
    sb.rpc('admin_feedback_dupes', { p_days: 60 }).then(({ data }) => { const k = data?.pairs?.length || 0; if (k && $('fDupes')) $('fDupes').innerHTML = `Duplicates <span class="pill p-pending">${k}</span>`; });
  };
  async function merge(from, into, tell = true) {
    const { data, error } = await sb.rpc('admin_feedback_merge', { p_id: from, p_into: into, p_tell: tell });
    if (error || !data?.success) { toast(error ? (need28(error.message) ? SQL28 : error.message) : data.error, true); return false; }
    toast(`#${from} merged into #${data.into}${tell ? '. The reporter was told.' : ''}`); return true;
  }
  async function dupesModal() {
    const { el, close } = NX.modal('<h3>Possible duplicates</h3><div id="dpL"><span class="spinner"></span></div>');
    const paint = async () => {
      const { data, error } = await sb.rpc('admin_feedback_dupes', { p_days: 60 });
      const L = el.querySelector('#dpL'); if (!L) return;
      if (error) { L.innerHTML = `<p class="muted">${need28(error.message) ? SQL28 : esc(error.message)}</p>`; return; }
      const pairs = data?.pairs || [];
      L.innerHTML = pairs.length ? `<p class="muted" style="margin-top:0">Open bug reports from the last 60 days that use mostly the same words. Merging closes the newer one, tells its reporter, and keeps one report to work on.</p>
        ${pairs.map(p => `<div class="dp-row"><div class="dp-pair"><a href="#feedback/${p.a}" data-close>#${p.a} ${esc(p.a_title)}</a><span class="muted">and</span><a href="#feedback/${p.b}" data-close>#${p.b} ${esc(p.b_title)}</a></div>
          <div class="row"><span class="pill">${Math.round(p.score * 100)}% alike</span><span class="sp"></span><button class="btn sm" data-merge="${p.b}" data-into="${p.a}">Merge #${p.b} into #${p.a}</button><button class="btn sm ghost" data-merge="${p.a}" data-into="${p.b}">#${p.a} into #${p.b}</button></div></div>`).join('')}`
        : '<p class="muted">No open bugs look alike right now.</p>';
    };
    el.addEventListener('click', async e => { const b = e.target.closest('[data-merge]'); if (!b) return; b.disabled = true; if (await merge(+b.dataset.merge, +b.dataset.into)) { paint(); if (A.tab === 'feedback') P.feedback(); } });
    paint();
  }
  NX.afterFbDetail = async (el, r) => {
    const card = el.querySelector('.card'); if (!card) return;
    const box = document.createElement('div'); box.className = 'fb-dupes';
    const quote = card.querySelector('.quote'); (quote || card.lastElementChild).before(box);
    if (r.duplicate_of) box.innerHTML = `<div class="banner">This is a duplicate of <a href="#feedback/${r.duplicate_of}">report #${r.duplicate_of}</a>.<span class="sp" style="flex:1"></span><button class="btn sm" id="fbUndup">Not a duplicate</button></div>`;
    const { data, error } = await sb.rpc('admin_feedback_similar', { p_id: r.id, p_limit: 5 });
    if (error || !box.isConnected) return;
    const sim = (data?.similar || []).filter(x => x.id !== r.duplicate_of);
    if (sim.length) box.insertAdjacentHTML('beforeend', `<details class="fb-sim" ${sim.some(x => x.score >= 0.6) ? 'open' : ''}><summary class="muted">Looks like ${plural(sim.length, 'other report')}</summary>
      ${sim.map(x => `<div class="row fb-sim-row"><a href="#feedback/${x.id}">#${x.id} ${esc(x.title)}</a><span class="pill p-${esc(x.status)}">${esc(x.status.toUpperCase())}</span><span class="muted">${Math.round(x.score * 100)}% alike</span><span class="sp"></span>
        ${r.duplicate_of ? '' : `<button class="btn sm" data-dupinto="${x.duplicate_of || x.id}" title="Close this one and keep #${x.duplicate_of || x.id}">Duplicate of #${x.duplicate_of || x.id}</button>`}${x.duplicate_of ? '' : `<button class="btn sm ghost" data-dupfrom="${x.id}" title="Close #${x.id} and keep this one">Merge #${x.id} here</button>`}</div>`).join('')}</details>`);
    box.onclick = async e => {
      const a = e.target.closest('[data-dupinto]'); if (a && await merge(r.id, +a.dataset.dupinto)) return P.feedback();
      const b = e.target.closest('[data-dupfrom]'); if (b && await merge(+b.dataset.dupfrom, r.id)) return P.feedback();
      if (e.target.id === 'fbUndup') { const { error: er } = await sb.from('feedback_reports').update({ duplicate_of: null, status: 'triaged', updated_at: new Date().toISOString() }).eq('id', r.id); if (er) return toast(er.message, true); toast('Not a duplicate any more'); P.feedback(); }
    };
  };

  // =========================================================== Admin activity heatmap
  const HM = { days: 28, who: 'all' };
  P.activity = async () => {
    NX.main(`<h1>Admin activity</h1><p>When the team is active: chat messages, replies to reports, admin actions and incidents, by weekday and hour (your time).</p>
      <div class="row hm-ctl"><div class="seg" id="hmDays">${[[7, '7 days'], [28, '4 weeks'], [90, '3 months']].map(([d, l]) => `<button data-hmd="${d}" class="${HM.days === d ? 'on' : ''}">${l}</button>`).join('')}</div>
        <select class="field" id="hmWho" style="width:auto"><option value="all">Everyone</option>${A.admins.map(a => `<option value="${esc(a.id)}" ${HM.who === a.id ? 'selected' : ''}>${esc(nm(a))}</option>`).join('')}</select></div>
      <div id="hm"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    $('hmDays').onclick = e => { const b = e.target.closest('[data-hmd]'); if (b) { HM.days = +b.dataset.hmd; P.activity(); } };
    $('hmWho').onchange = e => { HM.who = e.target.value; P.activity(); };
    const { data, error } = await sb.rpc('admin_activity_heatmap', { p_days: HM.days });
    if (A.tab !== 'activity') return;
    if (error || !data?.success) { $('hm').innerHTML = `<div class="card"><p class="muted">${error && need28(error.message) ? SQL28 : esc(error?.message || data?.error || 'Couldn’t load it.')}</p></div>`; return; }
    const rows = (data.hours || []).filter(x => HM.who === 'all' || x.u === HM.who);
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0)), kinds = {}, per = {}, byDay = {};
    for (const x of rows) { const d = new Date(x.h), dow = (d.getDay() + 6) % 7; grid[dow][d.getHours()] += x.n; per[x.u] = (per[x.u] || 0) + x.n; const k = d.toDateString(); byDay[k] = (byDay[k] || 0) + x.n; for (const [kk, v] of Object.entries(x.k || {})) kinds[kk] = (kinds[kk] || 0) + v; }
    const max = Math.max(1, ...grid.flat()), total = rows.reduce((s, x) => s + x.n, 0);
    const busiest = (() => { let b = [0, 0, 0]; grid.forEach((r, i) => r.forEach((v, h) => { if (v > b[0]) b = [v, i, h]; })); return b; })();
    const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hl = h => h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
    const K = { chat: 'Chat messages', replies: 'Replies to reports', actions: 'Admin actions', incidents: 'Incidents posted' };
    const days = Array.from({ length: HM.days }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (HM.days - 1 - i)); return d; }), dmax = Math.max(1, ...days.map(d => byDay[d.toDateString()] || 0));
    $('hm').innerHTML = `<div class="stats4"><div class="stat"><b>${n(total)}</b><span>things done</span></div><div class="stat"><b>${Object.keys(per).length}</b><span>admins active</span></div><div class="stat"><b>${busiest[0] ? `${DOW[busiest[1]]} ${hl(busiest[2])}` : '—'}</b><span>busiest hour</span></div><div class="stat"><b>${n(Math.round(total / HM.days))}</b><span>a day on average</span></div></div>
      <div class="card"><h3>By weekday and hour</h3><div class="hm-wrap"><div class="hm-grid"><span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hm-hl">${h % 3 === 0 ? hl(h) : ''}</span>`).join('')}
        ${grid.map((r, i) => `<span class="hm-dl">${DOW[i]}</span>${r.map((v, h) => `<span class="hm-c" style="--a:${v ? (0.15 + 0.85 * v / max).toFixed(2) : 0}" title="${DOW[i]} ${hl(h)}: ${v}"></span>`).join('')}`).join('')}</div></div>
        <div class="row hm-key"><span class="muted">Less</span>${[0, .25, .5, .75, 1].map(a => `<span class="hm-c" style="--a:${a ? (0.15 + 0.85 * a).toFixed(2) : 0}"></span>`).join('')}<span class="muted">More</span><span class="sp"></span><span class="muted">${Object.entries(kinds).map(([k, v]) => `${esc(K[k] || k)} ${n(v)}`).join(' · ')}</span></div></div>
      <div class="card"><h3>Day by day</h3><div class="hm-days">${days.map(d => { const v = byDay[d.toDateString()] || 0; return `<span class="hm-day" title="${day(d)}: ${v}"><i style="height:${Math.round(v / dmax * 100)}%"></i></span>`; }).join('')}</div>
        <div class="row muted"><span>${day(days[0])}</span><span class="sp"></span><span>Today</span></div></div>
      ${HM.who === 'all' && Object.keys(per).length ? `<div class="card"><h3>Who</h3>${Object.entries(per).sort((a, b) => b[1] - a[1]).map(([u, v]) => { const a = NX.adminById(u); return `<div class="row hm-who">${a ? NX.av(a, 'sm') : ''}<b>${esc(a ? nm(a) : 'Former admin')}</b><span class="sp"></span><span class="muted">${n(v)}</span></div><div class="at-bar"><i style="width:${Math.max(2, Math.round(v / Math.max(...Object.values(per)) * 100))}%"></i></div>`; }).join('')}</div>` : ''}`;
  };

  // =========================================================== STAFF (aARgon3)
  const K = () => NX.staffKit || {};
  const myEmail = () => String(NX.mexelState?.me?.email || A.user?.email || '').toLowerCase();
  // Shifts → This week: publish to the reminder feed (managers), your reminders, swaps
  NX.afterShiftsWeek = async (host, list, team, ctx) => {
    if (ctx.mgr && ctx.to > Date.now() - 864e5) {
      const email = Object.fromEntries((team || []).map(t => [String(t.user_id), String(t.email || '').toLowerCase()]));
      const shifts = list.map(c => ({ id: c.id, email: email[String(c.user_id)] || '', name: c.name || '', starts_at: c.starts_at, ends_at: c.ends_at, store: c.store_code || '', note: c.note || '', time_off: !!c.time_off })).filter(s => s.email);
      sb.rpc('staff_publish_shifts', { p_from: ctx.from.toISOString(), p_to: ctx.to.toISOString(), p_shifts: shifts }).then(() => {}, () => {});
    }
    const box = document.createElement('div'); box.id = 'shExtra'; host.appendChild(box);
    paintStaffExtra(box, list, team, ctx);
  };
  async function paintStaffExtra(box, list, team, ctx) {
    const me = myEmail();
    const [{ data: pref, error: e1 }, { data: swaps, error: e2 }] = await Promise.all([
      sb.from('staff_reminder_prefs').select('*').eq('email', me).maybeSingle(), sb.from('staff_shift_swaps').select('*').order('created_at', { ascending: false }).limit(40)]);
    if (!box.isConnected) return;
    if (e1 && need28(e1.message) || e2 && need28(e2.message)) { box.innerHTML = `<div class="card"><h3>Shift reminders and swaps</h3><p class="muted">${SQL28}</p></div>`; return; }
    const on = pref ? pref.enabled : true, lead = pref?.lead_minutes || 60;
    const mine = list.filter(c => !c.time_off && new Date(c.starts_at) > Date.now() && (String(c.user_id) === String(NX.mexelState?.me?.id) || (team.find(t => String(t.user_id) === String(c.user_id))?.email || '').toLowerCase() === me));
    const open = (swaps || []).filter(s => ['asked', 'accepted'].includes(s.status)), past = (swaps || []).filter(s => !['asked', 'accepted'].includes(s.status)).slice(0, 6);
    const who = e => { const t = team.find(x => String(x.email || '').toLowerCase() === e); return esc(t?.name || e || 'Anyone'); };
    const when = s => `${day(s.shift.starts_at)}, ${tm(s.shift.starts_at)}–${tm(s.shift.ends_at)}`;
    const ST = { asked: ['Asked', 'p-pending'], accepted: ['Taken, waiting for a manager', 'p-reviewing'], approved: ['Approved', 'p-approved'], declined: ['Declined', 'p-declined'], cancelled: ['Cancelled', ''] };
    box.innerHTML = `<div class="sh-extra"><div class="card"><h3>Shift reminders</h3>
        <label class="toggle"><div>Remind me before my shifts<small>A notice in Nexus and on your phone (N28C), from the Nexus account with your staff email.</small></div><input type="checkbox" id="srOn" ${on ? 'checked' : ''}></label>
        <div class="row"><span class="muted">How long before</span><select class="field sm" id="srLead" style="width:auto" ${on ? '' : 'disabled'}>${[[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [720, '12 hours'], [1440, '1 day']].map(([v, l]) => `<option value="${v}" ${lead === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <p class="muted" style="margin:8px 0 0">Everyone on the schedule gets reminders like this (they can change theirs here). ${ctx.mgr ? 'Opening or changing the schedule keeps the reminders up to date.' : 'Reminders follow the schedule as your managers keep it.'}</p></div>
      <div class="card"><div class="row"><h3 style="margin:0">Shift swaps</h3><span class="muted">${open.length} open</span></div>
        ${open.length ? open.map(s => { const fromMe = s.from_email === me, toMe = s.to_email === me || (!s.to_email && !fromMe);
          return `<div class="sw-row"><div class="row"><b>${who(s.from_email)}</b><span class="muted">${when(s)}</span><span class="pill ${ST[s.status][1]}">${ST[s.status][0].toUpperCase()}</span></div>
            <div class="muted">${s.to_email ? `Asked ${who(s.to_email)}` : 'Open to anyone'}${s.taker_email ? ` · ${who(s.taker_email)} will take it` : ''}${s.note ? ` · “${esc(s.note)}”` : ''}</div>
            <div class="row" style="margin-top:6px"><span class="sp"></span>${s.status === 'asked' && toMe ? `<button class="btn sm primary" data-sw="accept" data-id="${s.id}">I’ll take it</button>${s.to_email === me ? `<button class="btn sm" data-sw="refuse" data-id="${s.id}">Can’t</button>` : ''}` : ''}
              ${s.status === 'accepted' && ctx.mgr ? `<button class="btn sm primary" data-swok="${s.id}">Approve and move the shift</button><button class="btn sm" data-sw="decline" data-id="${s.id}">Decline</button>` : ''}
              ${fromMe || ctx.mgr ? `<button class="btn sm ghost" data-sw="cancel" data-id="${s.id}">Cancel</button>` : ''}</div></div>`; }).join('') : '<p class="muted">No swaps waiting.</p>'}
        ${mine.length ? `<h4 class="sw-h">Your coming shifts</h4>${mine.slice(0, 8).map(c => `<div class="row sw-mine"><span>${day(c.starts_at)}, ${tm(c.starts_at)}–${tm(c.ends_at)}</span><span class="sp"></span>${open.some(s => s.shift_id === c.id) ? '<span class="muted">swap asked</span>' : `<button class="btn sm" data-swask="${c.id}">Ask for a swap</button>`}</div>`).join('')}` : ''}
        ${past.length ? `<details><summary class="muted">Earlier swaps</summary>${past.map(s => `<div class="row muted sw-past"><span>${who(s.from_email)} · ${when(s)}</span><span class="sp"></span><span class="pill ${ST[s.status][1]}">${ST[s.status][0].toUpperCase()}</span></div>`).join('')}</details>` : ''}</div></div>`;
    const savePref = async patch => { const row = { email: me, enabled: on, lead_minutes: lead, ...patch, updated_at: new Date().toISOString() };
      const { error } = await sb.from('staff_reminder_prefs').upsert(row, { onConflict: 'email' }); if (error) return toast(error.message, true); toast('✓ Saved'); paintStaffExtra(box, list, team, ctx); };
    box.onchange = e => { if (e.target.id === 'srOn') savePref({ enabled: e.target.checked }); if (e.target.id === 'srLead') savePref({ lead_minutes: +e.target.value }); };
    box.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
      if (b.dataset.swask) return askSwap(list.find(c => c.id === +b.dataset.swask), team, () => paintStaffExtra(box, list, team, ctx));
      if (b.dataset.sw) { const { data, error } = await sb.rpc('staff_swap', { p_action: b.dataset.sw, p_id: +b.dataset.id }); if (error || !data?.success) return toast(error?.message || data.error, true);
        toast({ accept: 'You’ll take it once a manager approves', refuse: 'Told them', cancel: 'Cancelled', decline: 'Declined' }[b.dataset.sw]); return paintStaffExtra(box, list, team, ctx); }
      if (b.dataset.swok) {   // a manager approves: move the shift in aARgon3 first (the staff function checks they're a manager), then close the swap
        const s = (swaps || []).find(x => x.id === +b.dataset.swok), c = list.find(x => x.id === s?.shift_id), taker = team.find(t => String(t.email || '').toLowerCase() === s?.taker_email);
        if (!s || !taker) return toast('Couldn’t find who’s taking it on the team.', true);
        if (!c) return toast('That shift isn’t in this week. Open its week and approve it there.', true);
        b.disabled = true;
        try { await K().mexel('schedule_save', { id: c.id, user_id: taker.user_id, store_code: c.store_code || null, starts_at: c.starts_at, ends_at: c.ends_at, note: c.note || '' }); }
        catch (er) { b.disabled = false; return toast(K().friendly ? K().friendly(er) : er.message, true); }
        const { data, error } = await sb.rpc('staff_swap', { p_action: 'approve', p_id: s.id }); if (error || !data?.success) toast(error?.message || data.error, true); else toast(`Approved. The shift is ${taker.name}'s now.`);
        return ctx.week();
      }
    };
  }
  function askSwap(c, team, done) {
    if (!c) return;
    const me = myEmail(), others = (team || []).filter(t => t.active && t.email && String(t.email).toLowerCase() !== me);
    const { el, close } = NX.modal(`<h3>Ask for a swap</h3><p class="muted" style="margin-top:0">${day(c.starts_at)}, ${tm(c.starts_at)}–${tm(c.ends_at)}${c.store_code ? ' · ' + esc(c.store_code) : ''}</p>
      <div class="acct-grid"><label>Who</label><select class="field" id="swTo"><option value="">Anyone on the team</option>${others.map(t => `<option value="${esc(String(t.email).toLowerCase())}">${esc(t.name || t.email)}</option>`).join('')}</select>
        <label>Note</label><input class="field" id="swN" maxlength="300" placeholder="Optional, e.g. doctor's appointment"></div>
      <p class="muted">They answer here in Shifts${others.length ? '' : ' (managers see the whole team)'}; then a manager approves and the shift moves to them.</p><div class="row"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="swGo">Ask</button></div>`);
    el.querySelector('#swGo').onclick = async () => {
      const { data, error } = await sb.rpc('staff_swap', { p_action: 'ask', p_shift: { id: c.id, email: me, name: c.name || '', starts_at: c.starts_at, ends_at: c.ends_at, store: c.store_code || '' }, p_to: el.querySelector('#swTo').value || null, p_note: el.querySelector('#swN').value.trim() });
      if (error || !data?.success) return toast(error ? (need28(error.message) ? SQL28 : error.message) : data.error, true);
      close(); toast('Asked'); done();
    };
  }
  let swT = null;
  NX.on('staff_shift_swaps', () => { clearTimeout(swT); swT = setTimeout(() => { if (A.tab === 'shifts' && $('shExtra') && !document.querySelector('.modal')) P.shifts(); }, 1200); });

  // Timesheets → Payroll (hours, overtime over 40 a week, pay where the rate is known)
  NX.afterTimesheets = (host, rows, ctx) => {
    if (!ctx.mgr || host.querySelector('#tsPay')) return;
    host.querySelector('#tsCsv')?.insertAdjacentHTML('beforebegin', '<button class="btn" id="tsPay" title="Hours, overtime and pay for this period">Payroll</button>');
    host.querySelector('#tsPay').onclick = async e => { e.stopPropagation(); payroll(rows, ctx); };
  };
  async function payroll(rows, ctx) {
    let team = []; try { team = await K().mexel('team'); } catch {}
    const rate = name => { const t = team.find(x => x.name === name); return t && t.pay_rate !== null && t.pay_rate !== '' && t.pay_rate !== undefined ? +t.pay_rate : null; };
    const wk = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toDateString(); };
    const people = {};
    for (const s of rows) { const k = s.name || 'Staff', p = people[k] ||= { name: k, weeks: {}, shifts: 0, minutes: 0, sales: 0, forgot: 0 }; const w = wk(s.clock_in); p.weeks[w] = (p.weeks[w] || 0) + (+s.minutes || 0); p.shifts++; p.minutes += +s.minutes || 0; p.sales += +s.sales || 0; if (s.forgot) p.forgot++; }
    const OT = 40 * 60, money = K().money || (v => '$' + (+v).toFixed(2)), hm = K().hm || (m => (m / 60).toFixed(1) + 'h');
    const lines = Object.values(people).map(p => { const ot = Object.values(p.weeks).reduce((s, m) => s + Math.max(0, m - OT), 0), reg = p.minutes - ot, r = rate(p.name);
      return { ...p, reg, ot, rate: r, gross: r == null ? null : (reg / 60) * r + (ot / 60) * r * 1.5 }; }).sort((a, b) => a.name.localeCompare(b.name));
    const sum = lines.reduce((s, l) => s + (l.gross || 0), 0), unknown = lines.filter(l => l.rate == null).length;
    const f = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const { el } = NX.modal(`<h3>Payroll</h3><p class="muted" style="margin-top:0">${f(ctx.from)} – ${f(new Date(ctx.to - 864e5))}${ctx.everyone ? '' : ' · only you (tick Everyone first for the whole team)'}. Overtime is time over 40 hours in a week, at 1.5×.</p>
      <table class="cards pay-t"><tr><th>Who</th><th>Shifts</th><th>Regular</th><th>Overtime</th><th>Rate</th><th>Pay</th></tr>${lines.map(l => `<tr><td><b>${esc(l.name)}</b>${l.forgot ? ` <span class="pill p-pending" title="Forgot to clock out ${l.forgot}×">CHECK</span>` : ''}</td><td>${l.shifts}</td><td>${hm(l.reg)}</td><td>${l.ot ? `<b>${hm(l.ot)}</b>` : '—'}</td><td>${l.rate == null ? '<span class="muted">—</span>' : money(l.rate) + '/h'}</td><td>${l.gross == null ? '<span class="muted">—</span>' : `<b>${money(l.gross)}</b>`}</td></tr>`).join('')}</table>
      <div class="row" style="margin-top:10px"><b>Total ${money(sum)}</b>${unknown ? `<span class="muted">${plural(unknown, 'person')} without a pay rate (only the owner sees and sets rates in Employees)</span>` : ''}<span class="sp"></span><button class="btn" data-close>Close</button><button class="btn primary" id="payCsv">⬇ Payroll CSV</button></div>`);
    NX.labelTables?.();
    el.querySelector('#payCsv').onclick = () => download(`payroll-${new Date(ctx.from).toISOString().slice(0, 10)}.csv`, csvOf([['Name', 'Period start', 'Period end', 'Shifts', 'Regular hours', 'Overtime hours', 'Rate', 'Gross pay', 'Sales', 'Forgot to clock out'],
      ...lines.map(l => [l.name, new Date(ctx.from).toISOString().slice(0, 10), new Date(ctx.to - 864e5).toISOString().slice(0, 10), l.shifts, (l.reg / 60).toFixed(2), (l.ot / 60).toFixed(2), l.rate ?? '', l.gross == null ? '' : l.gross.toFixed(2), (+l.sales || 0).toFixed(2), l.forgot])]));
  }

  // Employees: more about each person (start date, skills, availability, emergency contact, goals, manager notes) + their numbers
  const EXT = { list: null };
  NX.afterEmployees = async (host, team) => {
    const { data, error } = await sb.from('staff_profiles_ext').select('*');
    if (error || !host?.isConnected) return;
    EXT.list = data || [];
    for (const t of team) {
      const x = EXT.list.find(r => r.email === String(t.email || '').toLowerCase()), card = host.querySelector(`[data-emp="${t.id}"]`); if (!x || !card) continue;
      const yrs = x.start_date ? Math.floor((Date.now() - new Date(x.start_date)) / (365.25 * 864e5)) : null;
      const bday = x.birthday && (() => { const [m, d] = x.birthday.split('-').map(Number), b = new Date(new Date().getFullYear(), m - 1, d), diff = Math.round((b - new Date().setHours(0, 0, 0, 0)) / 864e5); return diff >= 0 && diff <= 14 ? (diff === 0 ? 'Birthday today' : `Birthday in ${diff} day${diff === 1 ? '' : 's'}`) : ''; })();
      card.insertAdjacentHTML('beforeend', `<div class="em-ext">${x.start_date ? `<span class="muted">With the team since ${new Date(x.start_date + 'T12:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}${yrs ? ` · ${plural(yrs, 'year')}` : ''}</span>` : ''}${bday ? `<span class="pill p-approved">${bday}</span>` : ''}
        ${(x.skills || []).length ? `<div class="em-skills">${x.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}</div>`);
    }
  };
  NX.afterEmpModal = async (el, t, { canEdit }) => {
    if (!t?.email) return;
    const email = String(t.email).toLowerCase(), mineToo = email === myEmail();
    const sec = document.createElement('div'); sec.className = 'em-more'; sec.innerHTML = '<h4>More about them</h4><span class="spinner"></span>';
    const actions = [...el.children].filter(c => c.classList.contains('row')).pop(); (actions || el.lastElementChild).before(sec);
    const { data: x, error } = await sb.from('staff_profiles_ext').select('*').eq('email', email).maybeSingle();
    if (!sec.isConnected) return;
    if (error) { sec.innerHTML = `<h4>More about them</h4><p class="muted">${need28(error.message) ? SQL28 : esc(error.message)}</p>`; return; }
    const ed = canEdit || mineToo, dis = ed ? '' : 'disabled', v = x || {};
    const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
    sec.innerHTML = `<h4>More about them</h4><div class="em-nums" id="emNums"><span class="spinner"></span></div>
      <div class="acct-grid mx-form"><label>Started</label><input class="field" type="date" id="exStart" value="${esc(v.start_date || '')}" ${dis}>
        <label>Birthday</label><input class="field" id="exBday" placeholder="MM-DD" maxlength="5" value="${esc(v.birthday || '')}" ${dis} style="width:110px">
        <label>Pronouns</label><input class="field" id="exPro" maxlength="30" value="${esc(v.pronouns || '')}" ${dis}>
        <label>Skills</label><input class="field" id="exSkills" maxlength="300" placeholder="Comma separated, e.g. Sales, Setup, Spanish" value="${esc((v.skills || []).join(', '))}" ${dis}>
        <label>Can work</label><div class="em-avail">${DAYS.map(([k, l]) => `<label><span>${l}</span><input class="field sm" data-av="${k}" maxlength="20" placeholder="—" value="${esc((v.availability || {})[k] || '')}" ${dis}></label>`).join('')}</div>
        <label>Emergency contact</label><div class="row"><input class="field" id="exEN" maxlength="80" placeholder="Name" value="${esc(v.emergency_name || '')}" ${dis}><input class="field" id="exEP" maxlength="40" placeholder="Phone" value="${esc(v.emergency_phone || '')}" ${dis}></div>
        <label>Goals</label><textarea class="field" id="exGoals" rows="2" maxlength="600" ${dis}>${esc(v.goals || '')}</textarea>
</div>
      ${ed ? '<div class="row"><span class="sp"></span><button class="btn" id="exSave">Save these</button></div>' : ''}`;
    sec.querySelector('#exSave')?.addEventListener('click', async () => {
      const q = id => sec.querySelector('#' + id), b = q('exBday').value.trim();
      if (b && !/^\d{2}-\d{2}$/.test(b)) return toast('Birthday is MM-DD, like 04-17.', true);
      const row = { email, start_date: q('exStart').value || null, birthday: b, pronouns: q('exPro').value.trim(), skills: q('exSkills').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20),
        availability: Object.fromEntries([...sec.querySelectorAll('[data-av]')].map(i => [i.dataset.av, i.value.trim()]).filter(([, val]) => val)), emergency_name: q('exEN').value.trim(), emergency_phone: q('exEP').value.trim(),
        goals: q('exGoals').value.trim(), ...(q('exNotes') ? { manager_notes: q('exNotes').value.trim() } : {}), updated_by: A.user.id, updated_at: new Date().toISOString() };
      const { error: er } = await sb.from('staff_profiles_ext').upsert(row, { onConflict: 'email' }); if (er) return toast(er.message, true); toast('✓ Saved');
    });
    // their numbers: hours this month and last, shifts, sales, coming shifts
    try {
      const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1), m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const [rows, feed] = await Promise.all([K().mexel('shifts', { from: m1.toISOString(), to: new Date(now.getTime() + 864e5).toISOString(), everyone: true }), sb.from('staff_shift_feed').select('starts_at,ends_at,store').eq('email', email).gte('starts_at', now.toISOString()).order('starts_at').limit(5)]);
      const theirs = rows.filter(s => s.name === t.name || String(s.user_id || '') === String(t.user_id || ''));
      const sumMin = (a, b) => theirs.filter(s => new Date(s.clock_in) >= a && new Date(s.clock_in) < b).reduce((s, x) => s + (+x.minutes || 0), 0);
      const hm = K().hm || (m => (m / 60).toFixed(1) + 'h'), money = K().money || (x => '$' + (+x).toFixed(2));
      const nums = sec.querySelector('#emNums'); if (!nums) return;
      nums.innerHTML = `<div class="stats4 em-stats"><div class="stat"><b>${hm(sumMin(m0, new Date(8.64e15)))}</b><span>this month</span></div><div class="stat"><b>${hm(sumMin(m1, m0))}</b><span>last month</span></div><div class="stat"><b>${theirs.length}</b><span>shifts (2 months)</span></div><div class="stat"><b>${money(t.month_sales)}</b><span>sold this month</span></div></div>
        ${(feed.data || []).length ? `<div class="muted em-next">Next: ${feed.data.map(f => `${day(f.starts_at)} ${tm(f.starts_at)}`).join(' · ')}</div>` : ''}`;
    } catch { const nums = sec.querySelector('#emNums'); if (nums) nums.innerHTML = ''; }
  };

  // Mexel → Promotions: how each code is doing
  NX.afterPromos = async (box, list) => {
    if (!list?.length) return;
    const money = K().money || (v => '$' + (+v).toFixed(2));
    let orders = []; try { const r = await K().mexel('orders', { q: '' }); orders = Array.isArray(r) ? r : r?.orders || []; } catch {}
    const codeOf = o => String(o.promo_code || o.promo || o.coupon || o.discount_code || o.config?.promo || '').toUpperCase();
    const perf = list.map(x => {
      const since = x.created_at || x.starts || null, live = since ? new Date(since) : null, days = live ? Math.max(1, Math.round(((x.ends && new Date(x.ends) < Date.now() ? new Date(x.ends) : Date.now()) - live) / 864e5)) : null;
      const os = orders.filter(o => codeOf(o) === String(x.code).toUpperCase()), revenue = os.reduce((s, o) => s + (+o.amount || 0), 0);
      const disc = os.reduce((s, o) => s + (+o.discount || 0), 0) || (x.type === 'fixed' ? (+x.value || 0) * (+x.used || 0) : null);
      return { ...x, days, perDay: days ? (+x.used || 0) / days : null, fill: x.limit ? Math.min(100, Math.round((+x.used || 0) / x.limit * 100)) : null, revenue: os.length ? revenue : null, orders: os.length, disc };
    }).sort((a, b) => (+b.used || 0) - (+a.used || 0));
    const max = Math.max(1, ...perf.map(p => +p.used || 0)), totalUsed = perf.reduce((s, p) => s + (+p.used || 0), 0), best = perf[0];
    const card = document.createElement('div'); card.className = 'card pr-perf';
    card.innerHTML = `<div class="row"><h3 style="margin:0">How codes are doing</h3><span class="sp"></span><span class="muted">${totalUsed} uses in all</span></div>
      ${best?.used ? `<p class="muted">Most used: <b>${esc(best.code)}</b> (${best.used}×${best.perDay != null ? `, ${best.perDay >= 1 ? best.perDay.toFixed(1) + ' a day' : (best.perDay * 7).toFixed(1) + ' a week'}` : ''}).</p>` : ''}
      <div class="mx-bars">${perf.map(p => `<div class="mx-bar"><div class="row"><b class="mx-code">${esc(p.code)}</b>${p.live ? '' : '<span class="pill">ENDED</span>'}<span class="sp"></span><span>${p.used || 0} use${p.used === 1 ? '' : 's'}</span></div>
        <div class="at-bar"><i style="width:${Math.max(2, Math.round((+p.used || 0) / max * 100))}%"></i></div>
        <small class="muted">${[p.fill != null ? `${p.fill}% of its ${p.limit} uses` : '', p.perDay != null ? `${p.perDay >= 1 ? p.perDay.toFixed(1) + ' a day' : (p.perDay * 7).toFixed(1) + ' a week'} over ${plural(p.days, 'day')}` : '', p.revenue != null ? `${money(p.revenue)} in ${plural(p.orders, 'order')}` : '', p.disc != null ? `about ${money(p.disc)} off given` : ''].filter(Boolean).join(' · ')}</small></div>`).join('')}</div>
      ${orders.length && !perf.some(p => p.orders) ? '<p class="muted" style="margin:8px 0 0">Orders don’t say which code they used yet, so sales per code can’t be shown (aARgon3’s orders need a promo code field).</p>' : ''}`;
    if (box.isConnected) box.appendChild(card);
  };
})();
