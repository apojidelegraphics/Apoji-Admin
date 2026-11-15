// Apoji Admin 1.2: your Mac as the team's hub over Tailscale, phone notifications, broadcasts, schedules,
// encrypted team notes, a health page and a release dashboard.
//
// How the pieces fit:
//   • Supabase is still the source of truth. The website (GitHub Pages) and the Mac app both work fully from anywhere.
//   • The Mac app can be the hub (This Mac page). It runs a private API on your tailnet (electron/hub.js), stays
//     awake if you want, runs schedules on time and sends push notifications to admins' phones.
//   • The website finds the hub (its address is in admin_hub) and, when your phone is on Tailscale, talks to it
//     directly: turn on phone notifications, run schedules now, see what's new on the Mac.
(function () {
  const { sb, $, esc, ago, when, toast, nameOf, rpc } = NX;
  const A = NX.A, P = NX.pages, D = window.apojiDesktop, DESK = !!D?.hub;
  const SQL12 = 'Run supabase/apoji-admin-1.2.sql in Supabase → SQL Editor to turn this on.';
  const sqlMsg = m => NX.needSql(m) ? SQL12 : m;
  const live = (tables, fn, ms = 1500) => { let t; const offs = tables.map(tb => NX.on(tb, () => { clearTimeout(t); t = setTimeout(fn, ms); })); const tab = A.tab; const check = setInterval(() => { if (A.tab !== tab) { offs.forEach(o => o()); clearInterval(check); } }, 1000); };
  const bytes = b => { b = +b || 0; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + ' ' + u[i]; };
  const localInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const pill = (cls, t) => `<span class="pill ${cls}">${t}</span>`;
  const tog = (id, label, sub, on, dis) => `<label class="toggle"><div>${label}<small>${sub}</small></div><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}></label>`;
  const cmpVer = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

  // =========================================================== the hub, as seen from anywhere (Supabase heartbeat)
  const H = { rows: [], row: null, reach: null, info: null, events: [], err: '' };
  const fresh = r => r && Date.now() - new Date(r.updated_at) < 3 * 60e3 && r.status?.online;
  async function loadHubRow() {
    const { data, error } = await sb.from('admin_hub').select('*').order('updated_at', { ascending: false }).limit(5);
    if (error) { H.err = sqlMsg(error.message); return null; }
    H.err = ''; H.rows = data || []; H.row = H.rows.find(fresh) || H.rows[0] || null;
    paintHubBadge(); return H.row;
  }
  function paintHubBadge() { A.counts.hub = H.row && !fresh(H.row) ? 1 : 0; NX.updateTitle(); }
  NX.on('admin_hub', p => { const r = p.new; if (!r?.id) return; H.rows = [r, ...H.rows.filter(x => x.id !== r.id)]; H.row = H.rows.find(fresh) || r; paintHubBadge(); if (A.tab === 'hub' && !DESK) paintWebHub(); });
  // Talk to the hub directly (over Tailscale). Works from the website and the phone when they're on your tailnet.
  async function hubFetch(pathname, { method = 'GET', body, ms = 5000 } = {}) {
    const url = H.row?.status?.url; if (!url) throw new Error('no_hub');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url + pathname, { method, signal: ctl.signal, headers: { Authorization: 'Bearer ' + (A.session?.access_token || ''), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error({ not_allowed: `Your Tailscale account (${j.login || '?'}) isn't on this hub's allow list.`, sign_in: 'Sign in again.', tailnet_only: 'Only works through Tailscale.' }[j.error] || j.error || 'HTTP ' + r.status);
      return j;
    } finally { clearTimeout(t); }
  }
  async function probe() {
    if (!H.row?.status?.url) return (H.reach = false);
    try { H.info = await hubFetch('/api/hub'); H.reach = true; } catch (e) { H.reach = false; H.reachErr = e.name === 'AbortError' || /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? '' : e.message; }
    return H.reach;
  }
  // "Run it now": the hub if we can reach it, else run here
  async function runNow() {
    if (DESK && W.on) return runJobs(true);
    if (H.reach) { try { await hubFetch('/api/nudge', { method: 'POST', body: { what: 'jobs' } }); return toast('⚡ Sent to your Mac. Schedules run in a second.'); } catch {} }
    return runJobs(true);
  }

  // =========================================================== the hub worker (Mac app with the hub on)
  // Heartbeat → admin_hub · claims and runs due schedules · forwards notifications to phones
  const W = { on: false, st: null, jobs: { ran: 0, failed: 0, last: null }, running: false, assignees: new Map() };
  async function beat() {
    if (!DESK || !A.user) return;
    const st = W.st = await D.hub.status();
    W.on = !!st.enabled;
    const status = { online: !!st.enabled && !!st.online, url: st.url || '', serving: !!st.serving, version: st.version, devices: st.devices, keepAwake: st.keepAwake, awake: st.awake,
      tailscale: { running: !!st.tailscale?.running, https: !!st.tailscale?.https, error: st.tailscale?.error || '' }, jobs: W.jobs, error: st.error || '' };
    if (!st.enabled && !H.rows.some(r => r.id === st.id)) return;     // never been a hub: don't write anything
    const { error } = await sb.from('admin_hub').upsert({ id: st.id, name: st.name, owner: A.user.id, status, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error && !NX.needSql(error.message)) console.warn('hub heartbeat', error.message);
  }
  const JOB = {
    announcement_on: async j => { const { data, error } = await sb.from('announcements').update({ active: true }).eq('id', j.target).select('id'); if (error) throw error; if (!data?.length) throw new Error('That announcement was deleted.'); return 'Announcement is live'; },
    announcement_off: async j => { const { error } = await sb.from('announcements').update({ active: false }).eq('id', j.target); if (error) throw error; return 'Announcement turned off'; },
    maintenance_on: async j => {
      const p = j.payload || {}, row = { scope: j.target, enabled: true, message: p.message || '', types: [p.type || 'update'], countdown: !!p.ends_at, updated_at: new Date().toISOString(), ends_at: p.ends_at || null, admin_bypass: p.admin_bypass !== false };
      const { error } = await sb.from('maintenance_config').upsert(row); if (error) throw error; return `${j.target} is down for maintenance`;
    },
    maintenance_off: async j => { const { error } = await sb.from('maintenance_config').update({ enabled: false, updated_at: new Date().toISOString() }).eq('scope', j.target); if (error) throw error; return `${j.target} is back up`; },
    flag_stage: async j => {
      const stage = j.payload?.stage; if (!['off', 'admin', 'beta', 'all'].includes(stage)) throw new Error('Bad stage');
      const { data, error } = await sb.from('feature_flags').update({ stage, updated_at: new Date().toISOString() }).eq('key', j.target).select('key'); if (error) throw error; if (!data?.length) throw new Error('No flag called ' + j.target);
      return `${j.target} → ${stage}`;
    }
  };
  async function runJobs(manual) {
    if (W.running || !A.user) return; W.running = true;
    try {
      const { data, error } = await sb.rpc('admin_claim_schedules', { p_hub: DESK && W.on ? (W.st?.name || 'Mac hub') : DESK ? 'Apoji Admin (Mac)' : 'Apoji Admin (web)' });
      if (error) { if (manual) toast(sqlMsg(error.message), true); return; }
      for (const j of data || []) {
        let ok = true, res = '';
        try { res = await JOB[j.kind](j); } catch (e) { ok = false; res = e.message || String(e); }
        await sb.rpc('admin_finish_schedule', { p_id: j.id, p_ok: ok, p_result: res });
        W.jobs[ok ? 'ran' : 'failed']++; W.jobs.last = new Date().toISOString();
        NX.notify({ kind: 'schedules', title: ok ? '⏰ Schedule ran' : '⚠️ Schedule failed', body: `${j.label || j.kind}: ${res}`, tab: 'schedules' });
      }
      if (manual) toast(data?.length ? `⏰ Ran ${data.length} schedule${data.length === 1 ? '' : 's'}` : 'Nothing is due right now.');
      if (data?.length && A.tab === 'schedules') P.schedules();
    } finally { W.running = false; }
  }
  // Forward notifications from this Mac to phones (the hub strips chat text unless you allow it)
  NX.on('notify', ev => {
    if (!DESK || !W.on) return;
    const mine = ev.kind === 'chat' || ev.kind === 'tasks';   // you only see your own rooms and tasks here
    D.hub.push({ kind: ev.kind, title: ev.title, body: ev.body, room: ev.room, to: mine ? A.user.id : ev.to, url: ev.tab ? '#' + ev.tab : '', tag: ev.kind + ':' + (ev.tab || '') }).catch(() => {});
  });
  // Tasks given to other admins → their phones
  NX.on('admin_tasks', p => {
    const t = p.new; if (!DESK || !W.on || !t?.id) return;
    const before = W.assignees.get(t.id); W.assignees.set(t.id, t.assignee);
    if (t.assignee && t.assignee !== A.user.id && t.assignee !== before && t.status !== 'done')
      D.hub.push({ kind: 'tasks', to: t.assignee, title: '✅ New task for you', body: `${t.title}${t.due ? ' · due ' + t.due : ''}`, url: '#tasks', tag: 'task:' + t.id }).catch(() => {});
  });
  async function startWorker() {
    await loadHubRow().catch(() => {});
    if (DESK) {
      D.hub.onNudge(what => { if (what === 'jobs') runJobs(); else if (what === 'heartbeat') beat(); else NX.go(A.tab); });
      D.hub.onChange(st => { W.st = st; W.on = !!st.enabled; if (A.tab === 'hub') paintDeskHub(st); });
      const { data } = await sb.from('admin_tasks').select('id,assignee'); (data || []).forEach(t => W.assignees.set(t.id, t.assignee));
      await beat(); setInterval(beat, 60e3);
    }
    // The hub runs schedules every 30 s. Any other open Apoji Admin runs them when no hub is online.
    setInterval(() => { if ((DESK && W.on) || !fresh(H.row)) runJobs(); }, 30e3);
    setInterval(() => loadHubRow().catch(() => {}), 120e3);
    healthBadge(); setInterval(healthBadge, 10 * 60e3);
  }

  // =========================================================== This Mac (desktop) / Mac hub (website)
  P.hub = async () => DESK ? deskHub() : webHub();

  async function deskHub() {
    NX.main('<h1>🖥 This Mac</h1><p><span class="spinner"></span> Checking Tailscale…</p>', { cards: false });
    paintDeskHub(await D.hub.status(true));
  }
  function tsHelp(t) {
    if (!t.installed) return `<ol class="hubsteps"><li>Install <a href="https://tailscale.com/download/mac" target="_blank" rel="noopener">Tailscale for Mac</a> and sign in. Already have it? Open Tailscale's Settings and pick <b>Install CLI</b>.</li><li>In the <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener">Tailscale admin console → DNS</a>, turn on <b>MagicDNS</b> and <b>HTTPS Certificates</b>.</li><li>Come back here and press <b>Check again</b>.</li></ol>`;
    if (!t.running) return `<p class="muted">Open Tailscale from the menu bar and connect, then press <b>Check again</b>.</p>`;
    if (!t.https) return `<p class="muted">In the <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener">Tailscale admin console → DNS</a>, turn on <b>MagicDNS</b> and <b>HTTPS Certificates</b>, then press <b>Check again</b>.</p>`;
    return '';
  }
  function paintDeskHub(st) {
    if (A.tab !== 'hub') return;
    const t = st.tailscale || {}, on = st.enabled;
    const state = !on ? pill('p-closed', 'OFF') : st.serving ? pill('p-approved', 'ONLINE') : pill('p-pending', 'NOT ON TAILNET');
    NX.main(`<h1>🖥 This Mac ${state}</h1><p>Make this Mac your team's hub. Over <b>Tailscale</b> (only your tailnet can reach it) it sends notifications to admins' phones, runs schedules on time and stays awake. The website and Supabase keep working everywhere either way.</p>
      <div class="card">${tog('hOn', '🛰 Use this Mac as the hub', 'Runs in the menu bar when you close the window. ⌘Q quits.', on)}</div>
      ${on ? `<div class="grid">
        <div class="stat ${st.serving ? '' : 'hot'}"><b>${st.serving ? '🛰' : '○'}</b><span>${st.serving ? 'On your tailnet' : 'Not reachable yet'}</span></div>
        <div class="stat ${st.awake?.on ? '' : 'hot'}"><b>${st.awake?.on ? '☕' : '💤'}</b><span>${esc(st.awake?.reason || '')}</span></div>
        <div class="stat"><b>${st.devices}</b><span>phone${st.devices === 1 ? '' : 's'} get notifications</span></div>
        <div class="stat"><b>${W.jobs.ran}</b><span>schedules run${W.jobs.failed ? ` · ${W.jobs.failed} failed` : ''}</span></div></div>
      <div class="card"><h3>🔗 Tailscale <span class="sp"></span><button class="btn sm" id="hChk">Check again</button></h3>
        ${t.running ? `<div class="muted">Signed in as <b>${esc(t.login)}</b>${t.tailnet ? ' · tailnet ' + esc(t.tailnet) : ''}</div>` : ''}
        ${t.error ? `<div class="banner warn" style="margin-top:10px">⚠️ ${esc(t.error)}</div>${t.detail ? `<div class="muted" style="font-family:var(--mono);font-size:11.5px;overflow-wrap:anywhere">${esc(t.detail)}</div>` : ''}` : ''}${st.error ? `<div class="banner warn" style="margin-top:10px">⚠️ ${esc(st.error)}</div>` : ''}${tsHelp(t)}
        ${st.url ? `<div class="hubaddr"><img src="${st.qr || ''}" alt="" width="120" height="120"><div><div class="muted">Your hub's private address (only your tailnet can open it)</div><code id="hUrl">${esc(st.url)}</code>
          <div class="row" style="margin-top:8px"><button class="btn sm" id="hCopy">Copy</button></div>
          <p class="muted" style="margin:8px 0 0">On your phone: install Tailscale (same account), open the Apoji Admin website, go to <b>Mac hub</b> and turn on notifications. You don't need this address; the website finds it.</p></div></div>` : ''}</div>
      <div class="card"><h3>☕ Keep this Mac awake</h3>
        ${tog('hAwake', 'Keep this Mac awake', 'So schedules and notifications don’t wait for you to wake it. The screen can still turn off.', st.keepAwake)}
        ${tog('hPlug', 'Only while plugged in', 'On battery it sleeps normally.', st.pluggedOnly, !st.keepAwake)}
        ${tog('hLogin', 'Open at login', 'Starts quietly in the menu bar when you log in.', st.openAtLogin)}</div>
      <div class="card"><h3>📱 Phone notifications</h3>
        ${tog('hChat', 'Include chat text', 'Off: phones only see “New message in #room”. Admin chat is end-to-end encrypted, so this is off by default.', st.chatText)}
        ${(st.subs || []).length ? `<table class="cards" style="margin-top:8px"><tr><th>Device</th><th>Admin</th><th>Gets</th><th>Last sent</th><th></th></tr>${st.subs.map(s => `<tr><td>${esc(s.label)}</td><td>${esc(s.email || s.login)}</td><td class="muted">${esc(s.kinds.join(', '))}</td><td class="muted">${s.lastOk ? ago(s.lastOk) : 'never'}</td><td><button class="btn sm ghost" data-rmdev="${esc(s.id)}">Remove</button></td></tr>`).join('')}</table>` : '<p class="muted">No phones yet. Each admin turns notifications on from the website (Mac hub page) on their phone.</p>'}
        <div class="row" style="margin-top:10px"><button class="btn" id="hTest">Send a test to my phones</button><button class="btn" id="hRun">⏰ Run due schedules now</button></div></div>
      <div class="card"><h3>🔐 Who can use it</h3>
        <p class="muted" style="margin-top:0">Everyone needs to be on your tailnet <b>and</b> signed in as an Apoji admin. You can also limit it to certain Tailscale accounts.</p>
        ${tog('hRestrict', 'Only these Tailscale accounts', `You (${esc(t.login || 'this Mac’s account')}) always get in.`, st.restrict)}
        <div class="row" style="margin-top:8px"><input class="field" id="hAllowIn" placeholder="someone@example.com or name@github" style="flex:1"><button class="btn" id="hAllowAdd">Add</button></div>
        <div class="chips" style="margin-top:8px">${(st.allow || []).map(a => `<span class="chip">${esc(a)}<button data-rmallow="${esc(a)}" title="Remove">✕</button></span>`).join('') || '<span class="muted">Nobody added.</span>'}</div></div>
      <div class="card"><h3>🕘 What happened on this Mac</h3>${(st.recent || []).length ? `<div class="feed">${st.recent.map(e => `<div><span class="muted">${ago(e.at)}</span> ${esc(e.title)}${e.body ? ` <span class="muted">· ${esc(e.body)}</span>` : ''}${e.sent != null ? ` <span class="muted">→ ${e.sent} phone${e.sent === 1 ? '' : 's'}</span>` : ''}</div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>` : ''}`, { cards: false });
    const set = async patch => { const s = await D.hub.set(patch); W.on = !!s.enabled; paintDeskHub(s); beat(); };
    $('main').onchange = e => {
      const id = e.target.id, v = e.target.checked;
      const map = { hOn: 'enabled', hAwake: 'keepAwake', hPlug: 'pluggedOnly', hLogin: 'openAtLogin', hChat: 'chatText', hRestrict: 'restrict' };
      if (map[id]) set({ [map[id]]: v }).then(() => { if (id === 'hOn' && v) toast('🛰 Hub on. Look for it in the menu bar.'); });
    };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'hChk') { b.disabled = true; paintDeskHub(await D.hub.status(true)); beat(); }
      if (b.id === 'hCopy') { navigator.clipboard.writeText(st.url).then(() => toast('✓ Copied')); }
      if (b.id === 'hTest') { const r = await D.hub.push({ kind: 'hub', to: A.user.id, title: '🔔 Apoji Admin', body: 'Phone notifications from your Mac work.', tag: 'test' }); toast(r.targets ? `Sent to ${r.sent} of ${r.targets} device${r.targets === 1 ? '' : 's'}` : 'None of your phones are set up yet.', !r.sent); }
      if (b.id === 'hRun') runJobs(true);
      if (b.dataset.rmdev && confirm('Stop notifications to this device?')) paintDeskHub(await D.hub.removeDevice(b.dataset.rmdev));
      if (b.id === 'hAllowAdd') { const v = $('hAllowIn').value.trim().toLowerCase(); if (v) set({ allow: [...(st.allow || []), v] }); }
      if (b.dataset.rmallow) set({ allow: (st.allow || []).filter(x => x !== b.dataset.rmallow) });
    };
  }

  // ---------- website + phone
  const PUSH_KINDS = [['requests', '🧪 Beta requests'], ['feedback', '📮 Feedback & bugs'], ['reports', '🚩 Content reports'], ['tasks', '✅ Tasks for me'], ['chat', '💬 Admin chat (mine)'], ['audit', '📜 Audit alerts'], ['schedules', '⏰ Schedules']];
  const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const b64u = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function currentSub() { if (!pushOk()) return null; const reg = await navigator.serviceWorker.getRegistration(); return reg ? reg.pushManager.getSubscription() : null; }
  async function webHub() {
    NX.main('<h1>🖥 Mac hub</h1><p><span class="spinner"></span> Looking for your Mac…</p>', { cards: false });
    await loadHubRow(); if (H.row) await probe();
    if (H.reach) H.events = (await hubFetch('/api/events').catch(() => ({ events: [] }))).events || [];
    paintWebHub();
  }
  async function paintWebHub() {
    if (A.tab !== 'hub') return;
    const r = H.row, s = r?.status || {}, on = fresh(r), sub = await currentSub().catch(() => null);
    NX.main(`<h1>🖥 Mac hub ${!r ? '' : on ? pill('p-approved', 'ONLINE') : pill('p-declined', 'OFFLINE')}</h1>
      <p>Everything here works from anywhere through Supabase. When this device is on <b>Tailscale</b>, it also talks to your team's Mac directly: phone notifications, running schedules right away and what's new on the Mac.</p>
      ${H.err ? `<div class="card err">${esc(H.err)}</div>` : !r ? `<div class="card"><h3>No hub yet</h3><p class="muted" style="margin:0">Open the Apoji Admin Mac app → <b>This Mac</b> → turn on <b>Use this Mac as the hub</b>. Until then, schedules run whenever an Apoji Admin is open.</p></div>` : `
      <div class="grid">
        <div class="stat"><b style="font-size:18px;overflow-wrap:anywhere">${esc(r.name || 'Mac')}</b><span>${on ? 'online' : 'last seen ' + ago(r.updated_at)}</span></div>
        <div class="stat ${s.awake?.on ? '' : 'hot'}"><b>${s.awake?.on ? '☕' : '💤'}</b><span>${esc(s.awake?.reason || (s.keepAwake ? 'Keep awake on' : 'Can sleep'))}</span></div>
        <div class="stat ${H.reach ? '' : 'hot'}"><b>${H.reach ? '🔗' : '—'}</b><span>${H.reach ? 'This device reaches it' : 'Not reachable from here'}</span></div>
        <div class="stat"><b>${s.jobs?.ran ?? 0}</b><span>schedules run${s.jobs?.last ? ' · ' + ago(s.jobs.last) : ''}</span></div></div>
      ${!H.reach ? `<div class="banner warn">${H.reachErr ? '⚠️ ' + esc(H.reachErr) : `🔌 Can't reach ${esc(r.name || 'the Mac')} from this device. Turn on Tailscale here (same tailnet)${on ? '' : ', and make sure the Mac is awake with Apoji Admin open'}, then <button class="btn sm" id="wRetry">try again</button>`}</div>` : ''}
      <div class="card"><h3>📱 Notifications on this device</h3>
        ${!pushOk() ? `<p class="muted" style="margin:0">${isIOS && !standalone() ? 'On iPhone: tap Share → <b>Add to Home Screen</b>, open Apoji Admin from there, then come back to this page.' : 'This browser can’t get push notifications.'}</p>` : `
        <p class="muted" style="margin-top:0">Sent by your Mac over Tailscale, even when this page is closed. ${sub ? '<b class="ok">On for this device.</b>' : ''}</p>
        <div class="chips" id="wKinds">${PUSH_KINDS.map(([k, l]) => `<label class="chip"><input type="checkbox" value="${k}" ${NX.store.get('pushKinds', PUSH_KINDS.map(x => x[0])).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div class="row" style="margin-top:10px">${sub ? `<button class="btn" id="wSave" ${H.reach ? '' : 'disabled'}>Save choices</button><button class="btn" id="wTest" ${H.reach ? '' : 'disabled'}>Send a test</button><button class="btn ghost" id="wOff">Turn off</button>` : `<button class="btn primary" id="wOn" ${H.reach ? '' : 'disabled'}>Turn on notifications</button>`}</div>`}</div>
      <div class="card"><h3>⚡ Quick actions</h3><div class="row"><button class="btn" id="wRun">⏰ Run due schedules now</button><button class="btn" id="wPing" ${H.reach ? '' : 'disabled'}>Wake its data (refresh)</button></div>
        <p class="muted" style="margin-bottom:0">${H.reach ? 'Goes straight to your Mac over Tailscale.' : 'Without the hub, this device runs due schedules itself.'}</p></div>
      ${H.reach ? `<div class="card"><h3>🕘 What's new on ${esc(r.name || 'the Mac')}</h3>${H.events.length ? `<div class="feed">${H.events.map(e => `<div><span class="muted">${ago(e.at)}</span> ${esc(e.title)}${e.body ? ` <span class="muted">· ${esc(e.body)}</span>` : ''}</div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}</div>` : ''}
      ${H.rows.length > 1 ? `<div class="card"><h3>Other hubs</h3>${H.rows.filter(x => x !== r).map(x => `<div class="row"><b>${esc(x.name)}</b><span class="muted">${fresh(x) ? 'online' : 'last seen ' + ago(x.updated_at)}</span></div>`).join('')}</div>` : ''}`}`, { cards: false });
    const kinds = () => [...document.querySelectorAll('#wKinds input:checked')].map(i => i.value);
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.id === 'wRetry') return webHub();
        if (b.id === 'wRun') return runNow();
        if (b.id === 'wPing') { await hubFetch('/api/nudge', { method: 'POST', body: { what: 'refresh' } }); return toast('✓ Sent'); }
        if (b.id === 'wOn') {
          b.disabled = true;
          if (await Notification.requestPermission() !== 'granted') { b.disabled = false; return toast('Notifications are blocked for this site. Allow them in your browser settings.', true); }
          const reg = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
          const { key } = await hubFetch('/api/push/key');
          let s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe();
          s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
          NX.store.set('pushKinds', kinds());
          await hubFetch('/api/push/subscribe', { method: 'POST', body: { subscription: s.toJSON(), kinds: kinds(), label: deviceLabel() } });
          toast('🔔 Notifications are on for this device'); return paintWebHub();
        }
        if (b.id === 'wSave') { const s = await currentSub(); NX.store.set('pushKinds', kinds()); await hubFetch('/api/push/subscribe', { method: 'POST', body: { subscription: s.toJSON(), kinds: kinds(), label: deviceLabel() } }); return toast('✓ Saved'); }
        if (b.id === 'wTest') { const r = await hubFetch('/api/push/test', { method: 'POST', body: {} }); return toast(r.sent ? '🔔 Sent. It should arrive in a few seconds.' : 'Your Mac has no devices for you yet.', !r.sent); }
        if (b.id === 'wOff') { const s = await currentSub(); if (s) { await hubFetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: s.endpoint } }).catch(() => {}); await s.unsubscribe(); } toast('🔕 Off for this device'); return paintWebHub(); }
      } catch (err) { b.disabled = false; toast(err.message === 'no_hub' ? 'No hub address yet.' : err.name === 'AbortError' ? 'Your Mac didn’t answer. Is Tailscale on here?' : err.message, true); }
    };
  }
  const deviceLabel = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : /Mac/.test(navigator.userAgent) ? 'Mac browser' : 'Browser';

  // =========================================================== Broadcasts (to every Nexus Mac app + phone)
  let prefill = null;
  const AUD = [['all', '🌍 Everyone'], ['beta', '🧪 Beta testers'], ['admins', '🛡 Admins only'], ['outdated', '⬆ Older versions']];
  const bcState = b => b.cancelled ? ['p-closed', 'CANCELLED'] : new Date(b.send_at) > Date.now() ? ['p-pending', 'SCHEDULED'] : new Date(b.expires_at) < Date.now() ? ['p-closed', 'ENDED'] : ['p-approved', 'LIVE'];
  P.broadcast = async () => {
    const { data, error } = await sb.from('broadcasts').select('*').order('send_at', { ascending: false }).limit(60);
    if (error) return NX.main(`<h1>📡 Broadcasts</h1><div class="card err">${esc(sqlMsg(error.message))}</div>`);
    const f = prefill || {}; prefill = null;
    NX.main(`<h1>📡 Broadcasts</h1><p>A message that pops up as a notification in everyone's Nexus Mac app (and on their phone through N28C), once per person. Nexus 2.3 and newer.</p>
      <div class="card"><h3>New broadcast</h3>
        <input class="field" id="bT" maxlength="80" placeholder="Title, e.g. Nexus 2.3 is out" value="${esc(f.title || '')}" style="width:100%">
        <textarea class="field" id="bB" rows="2" maxlength="400" placeholder="What should people know?" style="width:100%;margin-top:8px">${esc(f.body || '')}</textarea>
        <input class="field" id="bU" placeholder="Link (optional, https://…)" value="${esc(f.url || '')}" style="width:100%;margin-top:8px">
        <div class="tabsub" id="bAud" style="margin-top:10px">${AUD.map(([k, l]) => `<button data-aud="${k}" class="${(f.audience || 'all') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row" id="bVerRow" ${(f.audience || 'all') === 'outdated' ? '' : 'hidden'}><label class="muted">Only apps older than <input class="field" id="bV" placeholder="2.3.0" value="${esc(f.max_version || '')}" style="width:90px"></label></div>
        <div class="row" style="margin-top:8px"><label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bD" checked> 💻 Mac app</label><label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bP" checked> 📱 Phone</label>
          <label class="muted">Send <input class="field" type="datetime-local" id="bAt" title="Leave empty to send now"></label>
          <label class="muted">for <select class="field" id="bExp"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label></div>
        <div class="bcprev" id="bPrev"><img src="icons/icon-192.png" alt=""><div><b>Nexus '28</b><div class="t"></div><div class="muted b"></div></div></div>
        <div class="row" style="margin-top:10px"><span class="muted" id="bCnt"></span><span class="sp"></span><button class="btn primary" id="bGo">📡 Send</button></div></div>
      <h2>Sent and scheduled</h2>
      ${data.map(b => { const [c, l] = bcState(b); return `<div class="card"><div class="row">${pill(c, l)}<b>${esc(b.title)}</b><span class="muted">${esc(AUD.find(a => a[0] === b.audience)?.[1] || b.audience)}${b.audience === 'outdated' && b.max_version ? ' &lt; ' + esc(b.max_version) : ''} · ${b.desktop ? '💻' : ''}${b.phone ? '📱' : ''} · ${when(b.send_at)}${b.created_by ? ' · ' + esc(nameOf(NX.adminById(b.created_by))) : ''}</span><span class="sp"></span>${l === 'LIVE' || l === 'SCHEDULED' ? `<button class="btn sm" data-stop="${b.id}">${l === 'LIVE' ? 'End now' : 'Cancel'}</button>` : ''}</div>${b.body ? `<div style="margin-top:6px">${esc(b.body)}</div>` : ''}${b.url ? `<div class="muted" style="margin-top:4px">🔗 ${esc(b.url)}</div>` : ''}</div>`; }).join('') || '<div class="empty">Nothing sent yet.</div>'}`, { cards: false });
    let aud = f.audience || 'all';
    const prev = () => { $('bPrev').querySelector('.t').textContent = $('bT').value || 'Title'; $('bPrev').querySelector('.b').textContent = $('bB').value; $('bCnt').textContent = `${$('bT').value.length}/80 · ${$('bB').value.length}/400`; };
    $('bT').oninput = $('bB').oninput = prev; prev();
    $('bAud').onclick = e => { const b = e.target.closest('[data-aud]'); if (!b) return; aud = b.dataset.aud; document.querySelectorAll('#bAud button').forEach(x => x.classList.toggle('on', x === b)); $('bVerRow').hidden = aud !== 'outdated'; };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.stop) { const { error: er } = await sb.from('broadcasts').update({ cancelled: true }).eq('id', b.dataset.stop); toast(er ? er.message : '✓ Stopped', !!er); if (!er) P.broadcast(); return; }
      if (b.id !== 'bGo') return;
      const title = $('bT').value.trim(), url = $('bU').value.trim(), at = $('bAt').value ? new Date($('bAt').value) : new Date();
      if (!title) return toast('Give it a title.', true);
      if (url && !/^https:\/\//.test(url)) return toast('Links need to start with https://', true);
      if (aud === 'outdated' && !/^\d+(\.\d+){0,2}$/.test($('bV').value.trim())) return toast('Which version? e.g. 2.3.0', true);
      if (!$('bD').checked && !$('bP').checked) return toast('Pick Mac app, phone or both.', true);
      if (!confirm(`${$('bAt').value ? 'Schedule' : 'Send'} “${title}” to ${AUD.find(a => a[0] === aud)[1].replace(/^\S+ /, '').toLowerCase()}?`)) return;
      const { error: er } = await sb.from('broadcasts').insert({ title, body: $('bB').value.trim(), url, audience: aud, max_version: aud === 'outdated' ? $('bV').value.trim() : '', desktop: $('bD').checked, phone: $('bP').checked,
        send_at: at.toISOString(), expires_at: new Date(at.getTime() + +$('bExp').value * 86400e3).toISOString(), created_by: A.user.id });
      if (er) return toast(sqlMsg(er.message), true);
      toast($('bAt').value ? '⏰ Scheduled' : '📡 Sent. Apps pick it up within a minute.'); P.broadcast();
    };
    live(['broadcasts'], () => { if (!document.activeElement?.matches('input,textarea,select')) P.broadcast(); }, 2000);
  };
  NX.broadcast = f => { prefill = f; NX.go('broadcast'); };

  // =========================================================== Schedules
  const SK = { announcement_on: '📣 Announcement on', announcement_off: '📣 Announcement off', maintenance_on: '🛠 Maintenance on', maintenance_off: '🛠 Maintenance off', flag_stage: '⚑ Feature flag' };
  const MSCOPES = [['global', '🌐 Everything'], ['desktop', '💻 Mac app'], ['phone', '📱 N28C'], ['spaces', '👥 Shared Spaces'], ['paragon', '@paragon'], ['neodela', '@neodela'], ['lyte', '@lyte'], ['flash', '@flash']];
  P.schedules = async () => {
    const [{ data, error }, { data: flags }, { data: anns }] = await Promise.all([
      sb.from('admin_schedules').select('*').order('run_at', { ascending: false }).limit(120),
      sb.from('feature_flags').select('key,title,stage').order('key'), sb.from('announcements').select('id,message,active').order('created_at', { ascending: false }).limit(30)]);
    if (error) return NX.main(`<h1>⏰ Schedules</h1><div class="card err">${esc(sqlMsg(error.message))}</div>`);
    await loadHubRow().catch(() => {});
    const up = data.filter(j => j.status === 'pending' || j.status === 'running').sort((a, b) => new Date(a.run_at) - new Date(b.run_at)), done = data.filter(j => !up.includes(j));
    const hubOn = fresh(H.row);
    const soon = localInput(Date.now() + 60 * 60e3);
    NX.main(`<h1>⏰ Schedules</h1><p>Turn things on and off at a set time: announcements, maintenance and feature flags.</p>
      <div class="banner ${hubOn ? '' : 'warn'}">${hubOn ? `🛰 <b>${esc(H.row.name)}</b> runs these on time (checks every 30 seconds).` : `💤 No Mac hub is online, so these run when any Apoji Admin is open. Turn on the hub in the Mac app (This Mac) to run them on time.`}<span class="sp" style="flex:1"></span><button class="btn sm" id="sRun">Run due now</button></div>
      <div class="card"><h3>New schedule</h3>
        <div class="tabsub" id="sKind"><button data-k="ann" class="on">📣 Announcement</button><button data-k="maint">🛠 Maintenance</button><button data-k="flag">⚑ Feature flag</button></div>
        <div data-f="ann"><select class="field" id="sAnnPick" style="width:100%"><option value="">New announcement…</option>${(anns || []).map(a => `<option value="${a.id}">${a.active ? '● ' : ''}${esc(a.message.slice(0, 90))}</option>`).join('')}</select>
          <textarea class="field" id="sAnnMsg" rows="2" maxlength="300" placeholder="Announcement text" style="width:100%;margin-top:8px"></textarea></div>
        <div data-f="maint" hidden><div class="row"><select class="field" id="sScope">${MSCOPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select class="field" id="sType"><option value="update">🛠 Update</option><option value="outage">⚠️ Outage</option><option value="emergency">🚨 Emergency</option></select>
          <input class="field" id="sMsg" placeholder="Message people see" style="flex:1;min-width:180px"></div><label class="muted" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="sBy" checked> Admins can keep using it</label></div>
        <div data-f="flag" hidden><div class="row"><select class="field" id="sFlag">${(flags || []).map(f => `<option value="${esc(f.key)}">${esc(f.title || f.key)} (now: ${esc(f.stage)})</option>`).join('') || '<option value="">No flags yet</option>'}</select>
          <span class="muted">→</span><select class="field" id="sStage"><option value="off">Off</option><option value="admin">Admins</option><option value="beta">Beta testers</option><option value="all" selected>Everyone</option></select></div></div>
        <div class="row" style="margin-top:10px"><label class="muted">Start <input class="field" type="datetime-local" id="sAt" value="${soon}"></label><label class="muted" id="sEndL">End <input class="field" type="datetime-local" id="sEnd"></label><span class="sp"></span><button class="btn primary" id="sAdd">Schedule it</button></div></div>
      <h2>Coming up</h2>
      ${up.length ? `<div class="card"><table class="cards"><tr><th>When</th><th>What</th><th>Details</th><th>By</th><th></th></tr>${up.map(j => `<tr><td><b>${when(j.run_at)}</b><div class="muted">${new Date(j.run_at) < Date.now() ? 'due now' : 'in ' + until(j.run_at)}</div></td><td>${SK[j.kind]}${j.status === 'running' ? ' ' + pill('p-pending', 'RUNNING') : ''}</td><td>${esc(j.label || j.target)}</td><td class="muted">${esc(nameOf(NX.adminById(j.created_by)))}</td><td>${j.status === 'pending' ? `<button class="btn sm ghost" data-cancel="${j.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing scheduled.</div>'}
      <h2>History</h2>
      ${done.length ? `<div class="card"><table class="cards"><tr><th>Ran</th><th>What</th><th>Result</th><th>Where</th></tr>${done.slice(0, 50).map(j => `<tr><td class="muted">${when(j.ran_at || j.run_at)}</td><td>${SK[j.kind]} ${pill(j.status === 'done' ? 'p-approved' : j.status === 'failed' ? 'p-declined' : 'p-closed', j.status.toUpperCase())}</td><td>${esc(j.label || j.target)}${j.result ? `<div class="muted">${esc(j.result)}</div>` : ''}</td><td class="muted">${esc(j.ran_by || '—')}</td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing has run yet.</div>'}`);
    let kind = 'ann';
    $('sKind').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; document.querySelectorAll('#sKind button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('[data-f]').forEach(x => { x.hidden = x.dataset.f !== kind; }); $('sEndL').hidden = kind === 'flag'; };
    $('sAnnPick').onchange = e => { $('sAnnMsg').hidden = !!e.target.value; };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'sRun') return runNow();
      if (b.dataset.cancel) { const { error: er } = await sb.from('admin_schedules').update({ status: 'cancelled' }).eq('id', b.dataset.cancel).eq('status', 'pending'); toast(er ? er.message : '✓ Cancelled', !!er); return P.schedules(); }
      if (b.id !== 'sAdd') return;
      const at = $('sAt').value ? new Date($('sAt').value) : null, end = kind !== 'flag' && $('sEnd').value ? new Date($('sEnd').value) : null;
      if (!at) return toast('When should it start?', true);
      if (end && end <= at) return toast('The end has to be after the start.', true);
      const rows = [];
      try {
        if (kind === 'ann') {
          let id = $('sAnnPick').value, label;
          if (!id) {
            const m = $('sAnnMsg').value.trim(); if (!m) return toast('Write the announcement.', true);
            const { data: a, error: er } = await sb.from('announcements').insert({ message: m, active: false, created_by: A.user.id }).select('id').single(); if (er) throw er;
            id = a.id; label = m;
          } else label = (anns.find(a => String(a.id) === id)?.message || '');
          label = label.slice(0, 120);
          rows.push({ kind: 'announcement_on', target: String(id), label, run_at: at.toISOString() });
          if (end) rows.push({ kind: 'announcement_off', target: String(id), label, run_at: end.toISOString() });
        } else if (kind === 'maint') {
          const sc = $('sScope').value, label = `${MSCOPES.find(x => x[0] === sc)?.[1] || sc}${$('sMsg').value.trim() ? ': ' + $('sMsg').value.trim() : ''}`.slice(0, 200);
          rows.push({ kind: 'maintenance_on', target: sc, label, run_at: at.toISOString(), payload: { message: $('sMsg').value.trim(), type: $('sType').value, admin_bypass: $('sBy').checked, ends_at: end ? end.toISOString() : null } });
          if (end) rows.push({ kind: 'maintenance_off', target: sc, label, run_at: end.toISOString() });
        } else {
          const k = $('sFlag').value; if (!k) return toast('Make a feature flag first.', true);
          rows.push({ kind: 'flag_stage', target: k, label: `${k} → ${$('sStage').selectedOptions[0].textContent}`, run_at: at.toISOString(), payload: { stage: $('sStage').value } });
        }
        const { error: er } = await sb.from('admin_schedules').insert(rows.map(r => ({ ...r, created_by: A.user.id }))); if (er) throw er;
        toast(`⏰ Scheduled${rows.length > 1 ? ' (start and end)' : ''}`);
        if (at <= Date.now()) runNow();
        P.schedules();
      } catch (er) { toast(sqlMsg(er.message), true); }
    };
    live(['admin_schedules'], () => { if (!document.activeElement?.matches('input,textarea,select')) P.schedules(); }, 2000);
  };
  const until = t => { const m = Math.round((new Date(t) - Date.now()) / 60e3); return m < 60 ? m + ' min' : m < 48 * 60 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days'; };

  // =========================================================== Team notes (end-to-end encrypted)
  const N = { list: [], open: null, dirty: false, saving: false, conflict: null, q: '', preview: false, timer: 0 };
  const E = window.NXCrypto;
  async function decNote(n) { return { ...n, t: (await E.dec(n.title)) ?? '🔒', b: (await E.dec(n.body)) ?? '' }; }
  async function loadNotes() {
    const { data, error } = await sb.from('admin_team_notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false });
    if (error) throw new Error(sqlMsg(error.message));
    N.list = await Promise.all((data || []).map(decNote));
  }
  function md(s) {
    // a small, safe markdown: everything is escaped first
    const inline = t => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    let out = '', list = null, code = false;
    for (const raw of esc(s).split('\n')) {
      if (raw.startsWith('```')) { if (list) { out += `</${list}>`; list = null; } out += code ? '</pre>' : '<pre>'; code = !code; continue; }
      if (code) { out += raw + '\n'; continue; }
      const li = raw.match(/^\s*([-*]|\d+\.)\s+(.*)$/), cb = raw.match(/^\s*- \[( |x)\]\s+(.*)$/i);
      const type = li ? (/\d/.test(li[1]) ? 'ol' : 'ul') : null;
      if (list && list !== type) { out += `</${list}>`; list = null; }
      if (cb) { if (!list) { out += '<ul class="cbl">'; list = 'ul'; } out += `<li>${cb[1].trim() ? '☑' : '☐'} ${inline(cb[2])}</li>`; continue; }
      if (type) { if (!list) { out += `<${type}>`; list = type; } out += `<li>${inline(li[2])}</li>`; continue; }
      const h = raw.match(/^(#{1,3})\s+(.*)$/);
      out += h ? `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>` : raw.trim() ? `<p>${inline(raw)}</p>` : '';
    }
    if (list) out += `</${list}>`; if (code) out += '</pre>';
    return out;
  }
  P.notes = async () => {
    if (!E) return NX.main('<h1>📓 Team notes</h1><div class="card err">Encryption is missing.</div>');
    const cfg = await E.config().catch(e => ({ error: e.message }));
    if (cfg?.error) return NX.main(`<h1>📓 Team notes</h1><div class="card err">${esc(cfg.error)}</div>`);
    if (!cfg) return NX.main(`<h1>📓 Team notes</h1><div class="card"><h3>🔒 Set the team passphrase first</h3><p class="muted" style="margin:0">Team notes are encrypted with the same passphrase as Admin chat. A high-admin sets it the first time they open <a href="#chat">Admin chat</a>.</p></div>`);
    if (!E.ready()) await E.load().catch(() => {});
    if (!E.ready()) {
      NX.main(`<h1>📓 Team notes</h1><form class="card" id="nUnlock" style="max-width:460px"><h3>🔒 Unlock</h3><p class="muted" style="margin-top:0">Notes are end-to-end encrypted with the team passphrase (the same one as Admin chat). Supabase only stores scrambled text.</p>
        <input class="field" type="password" id="nPass" placeholder="Team passphrase" autocomplete="off" style="width:100%"><div class="row" style="margin-top:10px"><span class="err" id="nErr"></span><span class="sp"></span><button class="btn primary">Unlock</button></div></form>`, { cards: false });
      $('nUnlock').onsubmit = async e => { e.preventDefault(); $('nErr').textContent = ''; const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Unlocking…'; try { await E.unlock($('nPass').value); P.notes(); } catch (er) { $('nErr').textContent = er.message; b.disabled = false; b.textContent = 'Unlock'; } };
      return;
    }
    try { await loadNotes(); } catch (e) { return NX.main(`<h1>📓 Team notes</h1><div class="card err">${esc(e.message)}</div>`); }
    if (A.arg && N.list.some(n => n.id === A.arg)) N.open = A.arg;
    NX.main(`<h1>📓 Team notes <span class="pill" title="End-to-end encrypted">🔒 E2EE</span><span class="sp" style="flex:1"></span><button class="btn primary" id="nNew">＋ New note</button></h1>
      <p>Playbooks, how-tos and things to remember. Encrypted like Admin chat; changes save as you type.</p>
      <div class="notes"><aside><input class="field" id="nQ" placeholder="Search notes" value="${esc(N.q)}"><div id="nList"></div></aside><section id="nEd"></section></div>`, { cards: false });
    paintNoteList(); paintEditor();
    $('nQ').oninput = e => { N.q = e.target.value.toLowerCase(); paintNoteList(); };
    $('nNew').onclick = newNote;
    $('nList').onclick = e => { const b = e.target.closest('[data-note]'); if (b) openNote(b.dataset.note); };
  };
  function paintNoteList() {
    const el = $('nList'); if (!el) return;
    const items = N.list.filter(n => !N.q || (n.t + ' ' + n.b).toLowerCase().includes(N.q));
    el.innerHTML = items.map(n => `<button data-note="${n.id}" class="nitem ${n.id === N.open ? 'on' : ''}"><b>${n.pinned ? '📌 ' : ''}${esc(n.t || 'Untitled')}</b><span class="muted">${esc((n.b || '').replace(/\[[ x]\]/gi, '').replace(/[#*`>\-\[\]]/g, '').slice(0, 70)) || 'Empty'}</span><small class="muted">${ago(n.updated_at)} · ${esc(nameOf(NX.adminById(n.updated_by || n.created_by)))}</small></button>`).join('') || `<div class="muted" style="padding:12px">${N.q ? 'No matches.' : 'No notes yet.'}</div>`;
  }
  function paintEditor() {
    const el = $('nEd'); if (!el) return;
    const n = N.list.find(x => x.id === N.open);
    if (!n) { el.innerHTML = '<div class="empty">Pick a note or make a new one.</div>'; return; }
    el.innerHTML = `${N.conflict ? `<div class="banner warn">⚠️ ${esc(nameOf(NX.adminById(N.conflict.updated_by)))} saved a newer version. <span class="sp" style="flex:1"></span><button class="btn sm" id="nTheirs">Load theirs</button><button class="btn sm" id="nMine">Keep mine</button></div>` : ''}
      <div class="row"><input class="field ntitle" id="nT" value="${esc(n.t)}" placeholder="Title" maxlength="200"><span class="muted" id="nSave">${N.saving ? 'Saving…' : N.dirty ? 'Edited' : 'Saved'}</span></div>
      <div class="row" style="margin:8px 0"><div class="tabsub" style="margin:0"><button id="nEdit" class="${N.preview ? '' : 'on'}">✏️ Write</button><button id="nPrev" class="${N.preview ? 'on' : ''}">👁 Preview</button></div><span class="sp"></span>
        <button class="btn sm" id="nPin">${n.pinned ? '📌 Unpin' : '📌 Pin'}</button><button class="btn sm" id="nCopy" title="Copy a link to this note">🔗</button><button class="btn sm danger" id="nDel">Delete</button></div>
      ${N.preview ? `<div class="mdv">${md(n.b) || '<p class="muted">Nothing here yet.</p>'}</div>` : `<textarea class="field nbody" id="nB" placeholder="Write here. Markdown works: # headings, **bold**, - lists, - [ ] checklists, \`code\`, [links](https://…)">${esc(n.b)}</textarea>`}
      <div class="muted" style="margin-top:6px">Last saved ${ago(n.updated_at)} by ${esc(nameOf(NX.adminById(n.updated_by || n.created_by)))} · version ${n.version}</div>`;
    const changed = () => { n.t = $('nT').value; if ($('nB')) n.b = $('nB').value; N.dirty = true; $('nSave').textContent = 'Edited'; clearTimeout(N.timer); N.timer = setTimeout(saveNote, 1200); };
    $('nT').oninput = changed; if ($('nB')) $('nB').oninput = changed;
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'nEdit' || b.id === 'nPrev') { if (N.dirty) await saveNote(); N.preview = b.id === 'nPrev'; paintEditor(); }
      if (b.id === 'nPin') { n.pinned = !n.pinned; N.dirty = true; await saveNote(); paintNoteList(); paintEditor(); }
      if (b.id === 'nCopy') navigator.clipboard.writeText(location.href.split('#')[0] + '#notes/' + n.id).then(() => toast('✓ Link copied (only admins can open it)'));
      if (b.id === 'nDel') { if (!confirm(`Delete “${n.t || 'Untitled'}” for everyone?`)) return; const { error } = await sb.from('admin_team_notes').delete().eq('id', n.id); if (error) return toast(error.message, true); N.list = N.list.filter(x => x.id !== n.id); N.open = null; paintNoteList(); paintEditor(); }
      if (b.id === 'nTheirs') { const fresh = await decNote(N.conflict); Object.assign(n, fresh); N.conflict = null; N.dirty = false; paintEditor(); paintNoteList(); }
      if (b.id === 'nMine') { n.version = N.conflict.version; N.conflict = null; N.dirty = true; await saveNote(); }
    };
  }
  async function saveNote() {
    clearTimeout(N.timer);
    const n = N.list.find(x => x.id === N.open); if (!n || !N.dirty || N.saving || N.conflict) return;
    N.saving = true; const s = $('nSave'); if (s) s.textContent = 'Saving…';
    try {
      const r = await sb.rpc('admin_save_note', { p_id: n.id, p_title: await E.enc(n.t || 'Untitled'), p_body: await E.enc(n.b || ''), p_pinned: !!n.pinned, p_version: n.version });
      if (r.error) throw r.error;
      if (r.data?.success === false && r.data.error === 'conflict') {
        const { data } = await sb.from('admin_team_notes').select('*').eq('id', n.id).maybeSingle(); N.conflict = data; paintEditor(); return;
      }
      if (r.data?.success === false) throw new Error(r.data.error);
      n.version = r.data.version; n.updated_at = new Date().toISOString(); n.updated_by = A.user.id; N.dirty = false;
      if ($('nSave')) $('nSave').textContent = 'Saved';
      paintNoteList();
    } catch (e) { toast(sqlMsg(e.message), true); if ($('nSave')) $('nSave').textContent = 'Not saved'; }
    finally { N.saving = false; if (N.dirty && !N.conflict) N.timer = setTimeout(saveNote, 1200); }
  }
  async function openNote(id) { if (N.dirty) await saveNote(); N.open = id; N.conflict = null; N.preview = false; history.replaceState(null, '', '#notes/' + id); A.arg = id; paintNoteList(); paintEditor(); }
  async function newNote() {
    if (!E.ready()) return P.notes();
    if (N.dirty) await saveNote();
    const { data, error } = await sb.from('admin_team_notes').insert({ title: await E.enc('Untitled'), body: await E.enc(''), created_by: A.user.id }).select().single();
    if (error) return toast(sqlMsg(error.message), true);
    N.list.unshift(await decNote(data)); N.open = data.id; N.preview = false; paintNoteList(); paintEditor(); setTimeout(() => { $('nT')?.select(); }, 30);
  }
  NX.on('admin_team_notes', async p => {
    if (A.tab !== 'notes' || !E?.ready()) return;
    if (p.eventType === 'DELETE') { N.list = N.list.filter(x => x.id !== p.old?.id); if (N.open === p.old?.id) N.open = null; paintNoteList(); paintEditor(); return; }
    const r = p.new; if (!r?.id) return;
    const cur = N.list.find(x => x.id === r.id);
    if (cur && r.version <= cur.version) return;     // our own save echoing back
    if (cur && r.id === N.open && N.dirty) { N.conflict = r; paintEditor(); return; }
    const d = await decNote(r); if (cur) Object.assign(cur, d); else N.list.unshift(d);
    paintNoteList(); if (r.id === N.open && !document.activeElement?.matches('#nT,#nB')) paintEditor();
  });

  // =========================================================== Health
  async function checks() {
    const t0 = performance.now();
    const ping = await sb.from('feature_flags').select('key', { head: true, count: 'exact' }).then(r => r.error ? null : Math.round(performance.now() - t0));
    const [h, _hub, key] = await Promise.all([sb.rpc('admin_health'), loadHubRow().catch(() => null), freeKey()]);
    return { ping, h: h.error ? { error: sqlMsg(h.error.message) } : h.data || {}, hub: H.row, key };
  }
  async function freeKey() {
    try {
      const { data } = await sb.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
      const k = typeof data?.content === 'string' ? data.content.trim() : data?.content?.key || data?.content?.value || '';
      if (!k) return { none: true };
      const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: 'Bearer ' + k } }); if (!r.ok) return { error: 'OpenRouter said ' + r.status };
      const j = (await r.json()).data || {}; return { usage: j.usage, limit: j.limit, remaining: j.limit_remaining ?? (j.limit != null ? j.limit - j.usage : null), free: j.is_free_tier, rate: j.rate_limit };
    } catch (e) { return { error: e.message }; }
  }
  function problems(c) {
    const out = [];
    if (c.ping == null) out.push(['bad', 'Supabase isn’t answering']); else if (c.ping > 1500) out.push(['warn', `Supabase is slow (${c.ping} ms)`]);
    if (!A.live) out.push(['warn', 'Live updates are off (polling)']);
    if (c.h.error) out.push(['warn', c.h.error]);
    if (c.h.relay_backlog > 0) out.push(['warn', `${c.h.relay_backlog} N28C request${c.h.relay_backlog === 1 ? '' : 's'} waiting over 2 minutes (is someone’s Mac asleep?)`]);
    if (c.h.schedules_failed > 0) out.push(['warn', `${c.h.schedules_failed} schedule${c.h.schedules_failed === 1 ? '' : 's'} failed this week`]);
    if (c.h.maintenance_on > 0) out.push(['info', `${c.h.maintenance_on} maintenance switch${c.h.maintenance_on === 1 ? ' is' : 'es are'} on`]);
    if (c.hub && !fresh(c.hub)) out.push(['warn', `Mac hub ${c.hub.name} is offline (last seen ${ago(c.hub.updated_at)})`]);
    if (c.hub?.status?.tailscale?.error) out.push(['warn', 'Hub: ' + c.hub.status.tailscale.error]);
    if (c.key?.remaining != null && c.key.limit && c.key.remaining / c.key.limit < .1) out.push(['bad', 'The free AI key is almost out of credit']);
    if (c.key?.error) out.push(['warn', 'Free AI key: ' + c.key.error]);
    return out;
  }
  async function healthBadge() { try { const c = await checks(); A.counts.health = problems(c).filter(p => p[0] !== 'info').length; NX.updateTitle(); } catch {} }
  P.health = async () => {
    NX.main('<h1>🩺 Health</h1><p><span class="spinner"></span> Checking everything…</p>', { cards: false });
    const c = await checks(), pr = problems(c), h = c.h;
    A.counts.health = pr.filter(p => p[0] !== 'info').length; NX.updateTitle();
    if (A.tab !== 'health') return;
    const k = c.key || {};
    NX.main(`<h1>🩺 Health <span class="sp" style="flex:1"></span><button class="btn" id="hRe">↻ Check again</button></h1><p>Is everything working? Checked ${when(new Date())}.</p>
      ${pr.length ? pr.map(([lv, t]) => `<div class="banner ${lv === 'info' ? '' : 'warn'}">${lv === 'bad' ? '🔴' : lv === 'warn' ? '🟠' : 'ℹ️'} ${esc(t)}</div>`).join('') : '<div class="banner">🟢 All good.</div>'}
      <div class="grid">
        <div class="stat ${c.ping == null || c.ping > 1500 ? 'hot' : ''}"><b>${c.ping == null ? '—' : c.ping + ' ms'}</b><span>Supabase response</span></div>
        <div class="stat ${A.live ? '' : 'hot'}"><b>${A.live ? '● Live' : '○ Polling'}</b><span>Realtime updates</span></div>
        <div class="stat ${c.hub && !fresh(c.hub) ? 'hot' : ''}"><b>${!c.hub ? '—' : fresh(c.hub) ? '🛰 Online' : '💤 Offline'}</b><span>Mac hub${c.hub ? ' · ' + esc(c.hub.name) : ''}</span></div>
        <div class="stat"><b>${h.active_today ?? '—'}</b><span>active today</span></div>
        <div class="stat ${h.relay_backlog ? 'hot' : ''}"><b>${h.relay_backlog ?? '—'}</b><span>N28C requests waiting</span></div>
        <div class="stat ${h.schedules_failed ? 'hot' : ''}"><b>${h.schedules_pending ?? '—'}</b><span>schedules pending${h.schedules_failed ? ` · ${h.schedules_failed} failed` : ''}</span></div>
        <div class="stat"><b>${h.db_bytes ? bytes(h.db_bytes) : '—'}</b><span>database size</span></div>
        <div class="stat ${k.remaining != null && k.limit && k.remaining / k.limit < .1 ? 'hot' : ''}"><b>${k.none ? 'none' : k.error ? '—' : k.limit == null ? '∞' : '$' + (+k.remaining).toFixed(2)}</b><span>free AI key ${k.none ? 'not set' : k.limit == null && !k.error ? 'has no limit' : 'credit left'}${k.usage != null ? ` · used $${(+k.usage).toFixed(2)}` : ''}</span></div></div>
      ${h.tables ? `<div class="card"><h3>🗄 Biggest tables <span class="muted">KB</span></h3><div id="hTables"></div></div>` : ''}
      ${h.storage ? `<div class="card"><h3>🗂 File storage</h3><table class="cards"><tr><th>Bucket</th><th class="num">Files</th><th class="num">Size</th></tr>${h.storage.map(s => `<tr><td>${esc(s.bucket)}</td><td class="num">${(+s.files).toLocaleString()}</td><td class="num">${bytes(s.bytes)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No files.</td></tr>'}</table></div>` : ''}`, { cards: false });
    if (h.tables) NXCharts.hbars($('hTables'), h.tables.slice(0, 10).map(t => ({ label: t.name, value: Math.round(t.bytes / 1024), sub: `${bytes(t.bytes)} · ~${Math.max(0, t.rows).toLocaleString()} rows` })));
    NX.labelTables();
    $('hRe').onclick = () => P.health();
  };

  // =========================================================== Releases
  const gh = repo => fetch(`https://api.github.com/repos/apojidelegraphics/${repo}/releases?per_page=8`, { headers: { Accept: 'application/vnd.github+json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error('GitHub said ' + r.status)));
  P.releases = async () => {
    NX.main('<h1>🚀 Releases</h1><p><span class="spinner"></span> Loading…</p>', { cards: false });
    const [nx, aa, st] = await Promise.all([gh('Nexus-28').catch(e => ({ error: e.message })), gh('Apoji-Admin').catch(e => ({ error: e.message })), sb.rpc('admin_release_stats', { p_days: 30 })]);
    if (A.tab !== 'releases') return;
    const stats = st.error ? { error: sqlMsg(st.error.message) } : st.data || {};
    const latest = Array.isArray(nx) ? (nx.find(r => !r.prerelease && !r.draft) || nx[0]) : null, lv = latest ? latest.tag_name.replace(/^v/, '') : '';
    const desk = (stats.current || []).filter(x => x.source === 'desktop'), total = desk.reduce((a, x) => a + +x.users, 0), onLatest = desk.filter(x => cmpVer(x.version, lv) >= 0).reduce((a, x) => a + +x.users, 0);
    const dl = r => (r.assets || []).reduce((a, x) => a + (x.download_count || 0), 0);
    const relTable = (list) => Array.isArray(list) ? `<table class="cards"><tr><th>Version</th><th>Published</th><th class="num">Downloads</th><th>Files</th></tr>${list.map(r => `<tr><td><a href="${esc(r.html_url)}" target="_blank" rel="noopener"><b>${esc(r.tag_name)}</b></a>${r.prerelease ? ' ' + pill('p-pending', 'PRE') : ''}</td><td class="muted">${when(r.published_at)}</td><td class="num">${dl(r).toLocaleString()}</td><td class="muted">${(r.assets || []).filter(a => /\.(dmg|zip)$/.test(a.name)).map(a => `${esc(a.name.replace(/^.*-(arm64|x64|universal)\./, '$1.'))} ${a.download_count}`).join(' · ') || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No releases.</td></tr>'}</table>` : `<div class="err">${esc(list.error)}</div>`;
    NX.main(`<h1>🚀 Releases</h1><p>Downloads from GitHub and which versions people actually run (from the last 14 days of check-ins).</p>
      <div class="grid">
        <div class="stat"><b>${esc(lv || '—')}</b><span>latest Nexus</span></div>
        <div class="stat ${total && onLatest / total < .5 ? 'hot' : ''}"><b>${total ? Math.round(onLatest / total * 100) + '%' : '—'}</b><span>of Mac apps on it (${onLatest}/${total})</span></div>
        <div class="stat"><b>${latest ? dl(latest).toLocaleString() : '—'}</b><span>downloads of ${esc(lv || 'latest')}</span></div>
        <div class="stat"><b>${Array.isArray(aa) && aa[0] ? esc(aa[0].tag_name) : '—'}</b><span>latest Apoji Admin</span></div></div>
      ${lv && total > onLatest ? `<div class="banner">⬆ ${total - onLatest} Mac app${total - onLatest === 1 ? ' is' : 's are'} on an older version.<span class="sp" style="flex:1"></span><button class="btn sm primary" id="rNudge">Nudge them to update</button></div>` : ''}
      ${stats.error ? `<div class="card err">${esc(stats.error)}</div>` : `<div class="two"><div class="card"><h3>💻 Mac app versions</h3><div id="rDesk"></div></div><div class="card"><h3>📱 N28C versions</h3><div id="rPhone"></div></div></div>
      <div class="card"><h3>📈 People on ${esc(lv || 'the latest version')} vs older (Mac app, 30 days)</h3><div id="rLine"></div></div>`}
      <div class="card"><h3>Nexus '28 on GitHub</h3>${relTable(nx)}</div>
      <div class="card"><h3>Apoji Admin on GitHub</h3>${relTable(aa)}</div>`, { cards: false });
    if (!stats.error) {
      const vers = src => (stats.current || []).filter(x => x.source === src).sort((a, b) => cmpVer(b.version, a.version)).map(x => ({ label: x.version || '?', value: +x.users, color: cmpVer(x.version, lv) >= 0 || src === 'phone' ? 'var(--accent)' : 'var(--gold)' }));
      NXCharts.hbars($('rDesk'), vers('desktop')); NXCharts.hbars($('rPhone'), vers('phone'));
      const days = {}; for (const r of stats.daily || []) { if (r.source !== 'desktop') continue; const d = days[r.day] = days[r.day] || { day: r.day, latest: 0, older: 0 }; d[cmpVer(r.version, lv) >= 0 ? 'latest' : 'older'] += +r.users; }
      const rows = Object.values(days).sort((a, b) => a.day < b.day ? -1 : 1);
      if (rows.length) NXCharts.line($('rLine'), rows, [{ key: 'latest', label: lv || 'latest', color: 'var(--s1)' }, { key: 'older', label: 'older', color: 'var(--s2)' }]); else $('rLine').innerHTML = '<div class="muted">No check-ins yet.</div>';
    }
    NX.labelTables();
    if ($('rNudge')) $('rNudge').onclick = () => NX.broadcast({ title: `Nexus ${lv} is out`, body: 'Update from the menu: Nexus → Check for Updates. Here’s what’s new.', url: latest.html_url, audience: 'outdated', max_version: lv });
  };

  // =========================================================== Public status page (Nexus 2.5)
  const PUBLIC_STATUS = 'https://apojidelegraphics.github.io/Nexus-28/status/';
  const SEV = [['minor', '🟡 Minor'], ['major', '🟠 Major'], ['critical', '🔴 Critical'], ['maintenance', '🔵 Maintenance']];
  const IST = [['investigating', 'Investigating'], ['identified', 'Identified'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved']];
  const OVR = [['', 'Automatic'], ['operational', 'Operational'], ['degraded', 'Degraded'], ['partial', 'Partial outage'], ['outage', 'Major outage'], ['maintenance', 'Maintenance']];
  P.status = async () => {
    const [{ data: comps, error }, { data: incs }, pub] = await Promise.all([sb.from('status_components').select('*').order('position'), sb.from('status_incidents').select('*').order('started_at', { ascending: false }).limit(40), sb.rpc('public_status')]);
    if (error) return NX.main(`<h1>🟢 Status page</h1><div class="card err">${esc(NX.needSql(error.message) ? 'Run supabase/nexus-v2.5.sql (in the Nexus repo) in Supabase → SQL Editor to turn on the status page.' : error.message)}</div>`);
    const now = Object.fromEntries((pub.data?.components || []).map(c => [c.key, c.status]));
    const open = (incs || []).filter(i => !i.resolved_at), done = (incs || []).filter(i => i.resolved_at);
    const cname = k => (comps.find(c => c.key === k) || {}).label || k;
    const dot = st => `<span class="pill ${st === 'operational' ? 'p-approved' : st === 'maintenance' ? '' : st === 'degraded' ? 'p-pending' : 'p-declined'}">${esc((OVR.find(o => o[0] === st) || [, st])[1])}</span>`;
    NX.main(`<h1>🟢 Status page <span class="sp" style="flex:1"></span><a class="btn" href="${PUBLIC_STATUS}" target="_blank" rel="noopener">Open public page ↗</a></h1>
      <p>What everyone sees at the public Nexus status page. Maintenance switches show up there automatically; post an incident when something breaks.</p>
      <div class="card"><h3>New incident</h3>
        <input class="field" id="siT" maxlength="120" placeholder="What's wrong, e.g. Free AI key is failing" style="width:100%">
        <textarea class="field" id="siB" rows="2" maxlength="1000" placeholder="First update people see, e.g. We're looking into errors when chatting on the free key." style="width:100%;margin-top:8px"></textarea>
        <div class="tabsub" id="siSev" style="margin-top:8px">${SEV.map(([k, l], i) => `<button data-sev="${k}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="chips" id="siComp">${comps.map(c => `<label class="chip"><input type="checkbox" value="${esc(c.key)}"> ${esc(c.label)}</label>`).join('')}</div>
        <div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn primary" id="siGo">Post incident</button></div></div>
      <h2>Open incidents</h2>
      ${open.map(i => `<div class="card"><div class="row"><b>${esc(i.title)}</b><span class="pill">${esc(i.severity)}</span><span class="pill p-pending">${esc(i.status)}</span><span class="muted">since ${when(i.started_at)} · ${i.components.map(cname).map(esc).join(', ') || 'Nexus'}</span></div>
        <div class="feed" style="margin-top:8px">${(i.updates || []).map(u => `<div><span class="muted">${when(u.at)}</span> <b>${esc(u.status)}</b> ${esc(u.body)}</div>`).join('')}</div>
        <div class="row" style="margin-top:8px"><select class="field" data-ust="${i.id}">${IST.map(([k, l]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="field" data-ub="${i.id}" placeholder="Update for everyone" style="flex:1;min-width:200px"><button class="btn" data-upd="${i.id}">Post update</button><button class="btn primary" data-resolve="${i.id}">Resolve</button></div></div>`).join('') || '<div class="empty">No open incidents. 🎉</div>'}
      <h2>Components</h2>
      <div class="card"><table class="cards"><tr><th>Component</th><th>Public page shows</th><th>Override</th><th>Note</th></tr>${comps.map(c => `<tr><td><b>${esc(c.label)}</b><div class="muted">${esc(c.description)}</div></td><td>${dot(now[c.key] || 'operational')}</td>
        <td><select class="field" data-ovr="${esc(c.key)}">${OVR.map(([k, l]) => `<option value="${k}" ${(c.override || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td><input class="field" data-note="${esc(c.key)}" value="${esc(c.note || '')}" placeholder="Shown when overridden"></td></tr>`).join('')}</table>
        <p class="muted" style="margin-bottom:0">Automatic = from open incidents and maintenance switches. Overrides stay until you set them back to Automatic.</p></div>
      <h2>Resolved (last 40)</h2>
      ${done.length ? `<div class="card">${done.map(i => `<div class="row" style="padding:6px 0"><b>${esc(i.title)}</b><span class="muted">${when(i.started_at)} → ${when(i.resolved_at)} · ${esc(i.severity)}</span><span class="sp"></span>${A.level === 'high-admin' ? `<button class="btn sm ghost" data-del="${i.id}">Delete</button>` : ''}</div>`).join('')}</div>` : '<div class="empty">Nothing yet.</div>'}`);
    let sev = 'minor';
    $('siSev').onclick = e => { const b = e.target.closest('[data-sev]'); if (!b) return; sev = b.dataset.sev; document.querySelectorAll('#siSev button').forEach(x => x.classList.toggle('on', x === b)); };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return; let er;
      if (b.id === 'siGo') {
        const title = $('siT').value.trim(), body = $('siB').value.trim(), cs = [...document.querySelectorAll('#siComp input:checked')].map(i => i.value);
        if (title.length < 3) return toast('Say what’s wrong.', true); if (!cs.length) return toast('Pick what’s affected.', true);
        if (!confirm(`Post "${title}" on the public status page?`)) return;
        ({ error: er } = await sb.from('status_incidents').insert({ title, severity: sev, components: cs, status: sev === 'maintenance' ? 'identified' : 'investigating', updates: [{ at: new Date().toISOString(), status: sev === 'maintenance' ? 'identified' : 'investigating', body: body || title }] }));
        if (!er) NX.notify({ kind: 'audit', title: '🟢 Incident posted', body: title, tab: 'status' });
      } else if (b.dataset.upd || b.dataset.resolve) {
        const id = +(b.dataset.upd || b.dataset.resolve), st = b.dataset.resolve ? 'resolved' : document.querySelector(`[data-ust="${id}"]`).value, body = document.querySelector(`[data-ub="${id}"]`).value.trim() || (st === 'resolved' ? 'This is fixed. Thanks for your patience.' : '');
        if (!body) return toast('Write the update.', true);
        const r = await sb.rpc('admin_status_update', { p_id: id, p_status: st, p_body: body }); er = r.error || (r.data?.success === false ? { message: r.data.error } : null);
      } else if (b.dataset.del) { if (!confirm('Delete this incident from the history?')) return; ({ error: er } = await sb.from('status_incidents').delete().eq('id', b.dataset.del)); }
      else return;
      toast(er ? er.message : '✓ Live on the status page', !!er); if (!er) P.status();
    };
    $('main').onchange = async e => {
      const k = e.target.dataset.ovr || e.target.dataset.note; if (!k) return;
      const patch = e.target.dataset.ovr ? { override: e.target.value || null } : { note: e.target.value.trim() };
      const { error: er } = await sb.from('status_components').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', k);
      toast(er ? er.message : '✓ Saved', !!er); if (!er && e.target.dataset.ovr) P.status();
    };
    live(['status_incidents'], () => { if (!document.activeElement?.matches('input,textarea,select')) P.status(); }, 2000);
  };

  // =========================================================== Axiom (Apex tier, BETA): who gets it, weekly minutes, providers, prompt
  const STAGES = [['off', '⛔ Off', 'Nobody, not even you'], ['owner', '👤 Only unlimited', 'Just the accounts in apex_unlimited'], ['high-admin', '🛡 High-admins', '90-ish minutes a week each'],
    ['admin', '🛡 Admins', 'Every admin'], ['beta', '🧪 Beta testers', 'Beta testers and admins'], ['all', '🌍 Everyone', 'The public (own key, allowed providers only)']];
  const PROV = [['anthropic', 'Claude'], ['openrouter', 'OpenRouter'], ['openai', 'ChatGPT'], ['gemini', 'Gemini'], ['groq', 'Groq'], ['mistral', 'Mistral'], ['xai', 'xAI (Grok)'], ['deepseek', 'DeepSeek'], ['together', 'Together AI'], ['fireworks', 'Fireworks'], ['cerebras', 'Cerebras'], ['perplexity', 'Perplexity'], ['cohere', 'Cohere'], ['ollama', 'Ollama (local)'], ['lmstudio', 'LM Studio (local)']];
  P.axiom = async () => {
    if (A.level !== 'high-admin') return NX.main('<h1>🔺 Axiom</h1><div class="card"><h3>High-admins only</h3><p class="muted" style="margin:0">Axiom is the Apex tier. Only high-admins can see or change its settings.</p></div>');
    const { data: r, error } = await sb.rpc('admin_apex_overview');
    if (error || r?.success === false) return NX.main(`<h1>🔺 Axiom</h1><div class="card err">${esc(NX.needSql(error?.message) ? 'Run supabase/nexus-v2.4.sql (and later) from the Nexus repo in Supabase → SQL Editor to turn on the Apex tier.' : error?.message || r.error)}</div>`);
    const c = r.config || {}, week = r.week || [], total = week.reduce((a, x) => a + +x.minutes, 0);
    NX.main(`<h1>🔺 Nexus '28 Axiom <span class="pill" style="color:#ff6b7a">APEX</span> <span class="pill p-pending">BETA</span></h1>
      <p>"An AI too advanced for its use." Supabase decides who gets it and for how long: the Mac app only becomes Axiom after the database says yes, and its prompt never ships in the app.</p>
      <div class="grid">
        <div class="stat"><b>${esc((STAGES.find(x => x[0] === c.stage) || [, c.stage])[1])}</b><span>who can use it</span></div>
        <div class="stat"><b>${c.weekly_minutes}</b><span>minutes a week each</span></div>
        <div class="stat"><b>${Math.round(total)}</b><span>minutes used this week · ${week.length} ${week.length === 1 ? 'person' : 'people'}</span></div>
        <div class="stat"><b>${(r.unlimited || []).length}</b><span>unlimited account${(r.unlimited || []).length === 1 ? '' : 's'}</span></div></div>
      <div class="card"><h3>Who can use it</h3><div class="tabsub" id="axStage" style="flex-wrap:wrap">${STAGES.map(([k, l, d]) => `<button data-st="${k}" class="${c.stage === k ? 'on' : ''}" title="${esc(d)}">${l}</button>`).join('')}</div>
        <p class="muted" style="margin:0" id="axStageHelp">${esc((STAGES.find(x => x[0] === c.stage) || [])[2] || '')}. Minutes reset every Monday at 00:00 UTC (next: ${when(r.resets_at)}).</p></div>
      <div class="two"><div class="card"><h3>Weekly minutes</h3><p class="muted" style="margin-top:0">Time Axiom spends answering, checking (Proof mode) and working. Unlimited accounts don't count.</p>
          <div class="row"><input class="field" type="number" min="0" max="10080" id="axMin" value="${c.weekly_minutes}" style="width:110px"><span class="muted">minutes per person per week</span><span class="sp"></span><button class="btn" id="axMinSave">Save</button></div></div>
        <div class="card"><h3>Providers for the public</h3><p class="muted" style="margin-top:0">Admins can use any provider. Everyone else, only these (with high-usage warnings).</p>
          <div class="chips" id="axProv">${PROV.map(([k, l]) => `<label class="chip"><input type="checkbox" value="${k}" ${(c.public_providers || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
          <div class="row" style="margin-top:8px"><span class="sp"></span><button class="btn" id="axProvSave">Save</button></div></div></div>
      <div class="card"><h3>🔒 Axiom's prompt <span class="sp"></span><span class="muted" id="axCnt">${(c.prompt || '').length} / 40,000</span></h3>
        <p class="muted" style="margin-top:0">Stored only in Supabase and handed out only to someone allowed with minutes left. ${c.prompt ? '' : '<b class="err">Empty: Axiom has no personality until you paste it here.</b>'}</p>
        <textarea class="field" id="axPrompt" rows="10" style="width:100%;font:13px/1.5 var(--mono)" maxlength="40000">${esc(c.prompt || '')}</textarea>
        <div class="row" style="margin-top:8px"><span class="muted">Last changed ${ago(c.updated_at)}</span><span class="sp"></span><button class="btn primary" id="axPromptSave">Save prompt</button></div></div>
      <div class="card"><h3>This week</h3>${week.length ? `<table class="cards"><tr><th>Who</th><th>Level</th><th class="num">Minutes</th><th class="num">Turns</th><th>Last used</th></tr>${week.map(w => `<tr><td>${esc(w.email)}${w.unlimited ? ' <span class="pill p-approved">∞</span>' : ''}</td><td class="muted">${esc(w.level || 'user')}</td><td class="num">${w.minutes}${w.unlimited ? '' : ` / ${c.weekly_minutes}`}</td><td class="num">${w.turns}</td><td class="muted">${ago(w.last)}</td></tr>`).join('')}</table>` : '<div class="empty">Nobody has used Axiom this week.</div>'}</div>
      <div class="card"><h3>Last 8 weeks</h3><div id="axWeeks"></div></div>
      <div class="card"><h3>Unlimited accounts</h3>${(r.unlimited || []).map(u => `<div class="row"><b>${esc(u.email)}</b><span class="muted">${esc(u.note || '')}</span></div>`).join('') || '<p class="muted" style="margin:0">None yet.</p>'}
        <p class="muted" style="margin-bottom:0">For safety this can't be changed from the app. In Supabase → SQL Editor: <code>insert into public.apex_unlimited (user_id, note) select id, 'owner' from auth.users where email = 'you@example.com';</code></p></div>`);
    if ((r.weeks || []).length) NXCharts.bars($('axWeeks'), r.weeks.map(x => ({ day: x.week, minutes: +x.minutes })), 'minutes', 'minutes'); else $('axWeeks').innerHTML = '<div class="muted">No usage yet.</div>';
    const save = async (args, msg) => { const { data, error: er } = await sb.rpc('admin_apex_set', { p_stage: null, p_weekly_minutes: null, p_providers: null, p_prompt: null, ...args }); if (er || data?.success === false) return toast(er?.message || data.error, true); toast(msg); P.axiom(); };
    $('axPrompt').oninput = e => { $('axCnt').textContent = `${e.target.value.length.toLocaleString()} / 40,000`; };
    $('main').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.st) { const st = STAGES.find(x => x[0] === b.dataset.st); if (STAGES.findIndex(x => x[0] === b.dataset.st) > STAGES.findIndex(x => x[0] === c.stage) && !confirm(`Open Axiom to: ${st[1].replace(/^\S+ /, '')}?\n\n${st[2]}.`)) return; return save({ p_stage: b.dataset.st }, `✓ Axiom: ${st[1].replace(/^\S+ /, '')}`); }
      if (b.id === 'axMinSave') return save({ p_weekly_minutes: Math.max(0, Math.min(10080, +$('axMin').value || 0)) }, '✓ Weekly minutes saved');
      if (b.id === 'axProvSave') { const v = [...document.querySelectorAll('#axProv input:checked')].map(i => i.value); if (!v.length) return toast('Pick at least one.', true); return save({ p_providers: v }, '✓ Providers saved'); }
      if (b.id === 'axPromptSave') { if (!confirm("Replace Axiom's prompt for everyone?")) return; return save({ p_prompt: $('axPrompt').value }, '✓ Prompt saved. Apps pick it up within 2 minutes.'); }
    };
  };

  // Start once signed in
  const wait = setInterval(() => { if (A.user && A.admins.length) { clearInterval(wait); startWorker().catch(e => console.warn('hub', e)); } }, 300);
  NX.hub = { load: loadHubRow, probe, runJobs, runNow, beat, fetch: hubFetch, state: H, worker: W, md };
})();
