// Apoji Admin 3.3 (needs supabase/apoji-admin-3.3.sql):
//   • Health, rebuilt: one line that says if everything's fine, a tile per service (database, live updates, server
//     functions, free AI key, desktop hub, N28C relay, schedules, status page) with a colored light and a sparkline of
//     response times, what needs the team, where people are using Apoji right now, and storage. Checks again every 30 s.
//   • Feature flags: pick where each one runs (Mac, Windows, N28C, Test Run). None picked = everywhere.
//   • Release plans: "Publish release notes" turns a plan into the What's new entry in one click (the website and the
//     apps read it), adds the items to Testing, and copies the changes.json entry too.
(function () {
  const { sb, $, esc, ago, when, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL33 = 'Run supabase/apoji-admin-3.3.sql (this repo) in Supabase → SQL Editor to turn this on.';
  const need33 = m => /platforms|release_notes|admin_health_more|PGRST20|42P01|42703|42883|does not exist/i.test(m || '');

  // =========================================================== Health
  const HX = { hist: (() => { try { return JSON.parse(sessionStorage.getItem('hx-hist') || '[]'); } catch { return []; } })(), timer: 0, auto: true, fns: null, fnsAt: 0 };
  const spark = (vals, max) => { if (vals.length < 2) return ''; const m = Math.max(max || 0, ...vals, 1), w = 120, h = 28, step = w / (vals.length - 1);
    return `<svg class="hx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${vals.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / m) * (h - 4)).toFixed(1)}`).join(' ')}"/></svg>`; };
  const SURF = { mac: 'Mac', windows: 'Windows', phone: 'N28C', test_run: 'Test Run', admin: 'Apoji Admin', aargon3: 'aARgon3', mexel: 'Mexel', linux: 'Linux' };
  async function checkFns() {
    if (HX.fns && Date.now() - HX.fnsAt < 5 * 60e3) return HX.fns;   // server functions every 5 minutes, not every 30 s
    const list = (NX.serverFns || []).filter(f => !f.serverOnly), out = [];
    await Promise.all(list.map(async f => {
      const t0 = performance.now();
      try { const r = await fetch(`${f.base}/functions/v1/${f.name}${f.path || ''}`, f.method === 'GET' ? { headers: { apikey: f.key } } : { method: 'OPTIONS' }); out.push({ name: f.name, project: f.project, ok: r.status !== 404 && r.status < 500, status: r.status, ms: Math.round(performance.now() - t0) }); }
      catch { out.push({ name: f.name, project: f.project, ok: false, status: 0, ms: 0 }); }
    }));
    HX.fns = out.sort((a, b) => a.name.localeCompare(b.name)); HX.fnsAt = Date.now(); return HX.fns;
  }
  P.health = async () => {
    clearTimeout(HX.timer);
    if (!$('hxTiles')) NX.main('<h1>Health</h1><p><span class="spinner"></span> Checking everything…</p>', { cards: false });
    const H = NX.health; if (!H) return;
    const [c, more, fns] = await Promise.all([H.checks(), sb.rpc('admin_health_more').then(r => r.error ? { error: r.error.message } : r.data || {}, () => ({})), checkFns()]);
    if (A.tab !== 'health') return;
    HX.hist.push({ t: Date.now(), ping: c.ping }); HX.hist = HX.hist.slice(-40); try { sessionStorage.setItem('hx-hist', JSON.stringify(HX.hist)); } catch {}
    const pr = H.problems(c), all = H.problems(c, true), hidden = all.length - pr.length, h = c.h || {}, k = c.key || {};
    A.counts.health = pr.filter(p => p[0] !== 'info').length; NX.updateTitle();
    const fnBad = fns.filter(f => !f.ok), bad = pr.filter(p => p[0] === 'bad').length, warn = pr.filter(p => p[0] === 'warn').length + fnBad.length;
    const pings = HX.hist.map(x => x.ping).filter(x => x != null), avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
    const lv = (cond, warnCond) => cond ? 'bad' : warnCond ? 'warn' : 'ok';
    const keyPct = k.limit ? Math.max(0, Math.min(100, Math.round((k.remaining || 0) / k.limit * 100))) : null;
    const tiles = [
      { id: 'db', name: 'Database', lv: lv(c.ping == null, c.ping > 1500), big: c.ping == null ? 'Down' : c.ping + ' ms', sub: avg != null ? `average ${avg} ms` : '', extra: spark(pings, 600), open: 'status' },
      { id: 'live', name: 'Live updates', lv: A.live ? 'ok' : 'warn', big: A.live ? 'Live' : 'Polling', sub: A.live ? 'Changes show right away' : 'Changes show every few seconds' },
      { id: 'fns', name: 'Server functions', lv: fnBad.length ? (fnBad.length > 1 ? 'bad' : 'warn') : 'ok', big: `${fns.length - fnBad.length}/${fns.length}`, sub: fnBad.length ? 'Down: ' + fnBad.map(f => f.name).join(', ') : 'all answering', open: 'freeapi' },
      { id: 'key', name: 'Free AI key', lv: k.none || k.error ? 'warn' : keyPct != null && keyPct < 10 ? 'bad' : keyPct != null && keyPct < 25 ? 'warn' : 'ok', big: k.none ? 'Not set' : k.error ? 'Error' : k.limit == null ? 'No limit' : '$' + (+k.remaining).toFixed(2), sub: k.error ? esc(k.error) : keyPct != null ? `${keyPct}% left` : k.usage != null ? `$${(+k.usage).toFixed(2)} used` : '', extra: keyPct != null ? `<div class="hx-meter"><i style="width:${keyPct}%"></i></div>` : '', open: 'key' },
      { id: 'hub', name: 'Desktop hub', lv: !c.hub ? 'off' : H.fresh(c.hub) ? 'ok' : 'warn', big: !c.hub ? 'Not set up' : H.fresh(c.hub) ? 'Online' : 'Offline', sub: c.hub ? esc(c.hub.name || '') + (H.fresh(c.hub) ? '' : ' · ' + ago(c.hub.updated_at)) : 'optional', open: 'hub' },
      { id: 'relay', name: 'N28C relay', lv: h.relay_backlog > 0 ? 'warn' : 'ok', big: String(h.relay_backlog ?? 0), sub: 'requests waiting over 2 min', open: 'relay' },
      { id: 'sched', name: 'Schedules', lv: h.schedules_failed > 0 ? 'warn' : 'ok', big: String(h.schedules_pending ?? 0), sub: `pending${h.schedules_failed ? ` · ${h.schedules_failed} failed` : ''}`, open: 'schedules' },
      { id: 'status', name: 'Status page', lv: more.incidents_open ? 'warn' : h.maintenance_on ? 'info' : 'ok', big: more.incidents_open ? `${more.incidents_open} open` : h.maintenance_on ? 'Maintenance' : 'All good', sub: h.maintenance_on ? `${h.maintenance_on} switch${h.maintenance_on === 1 ? '' : 'es'} on` : 'what the public sees', open: 'status' }
    ];
    const queue = [['urgent_bugs', 'urgent bugs', 'feedback', true], ['bugs_open', 'open bug reports', 'feedback'], ['uploads_waiting', 'pictures to review', 'uploads'], ['reports_open', 'reports', 'reports'], ['access_waiting', 'access requests', 'access'], ['beta_waiting', 'beta requests', 'requests'], ['known_open', 'known issues open', 'status']]
      .filter(([key]) => more[key] > 0);
    const keepScroll = (document.scrollingElement || document.documentElement).scrollTop, mainScroll = $('main')?.scrollTop || 0;
    const surf = more.surfaces || {}, day = more.surfaces_day || {}, keys = [...new Set([...Object.keys(day), ...Object.keys(surf)])].sort((a, b) => (day[b] || 0) - (day[a] || 0));
    NX.main(`<div class="hx-top ${bad ? 'bad' : warn ? 'warn' : 'ok'}"><div class="hx-light"></div><div><h1>${bad ? `${bad + warn} thing${bad + warn === 1 ? ' needs' : 's need'} you` : warn ? `Mostly fine · ${warn} to look at` : 'Everything is working'}</h1>
        <p>Checked ${when(new Date())}${HX.auto ? ' · checks again every 30 seconds' : ''}.</p></div><span class="sp"></span>
        <label class="hx-auto"><input type="checkbox" id="hxAuto" ${HX.auto ? 'checked' : ''}> Keep checking</label><button class="btn" id="hRe">Check again</button></div>
      ${pr.length ? `<div class="hx-alerts">${pr.map(([l, t, id, open]) => `<div class="alert ${l}"><span class="hx-dot ${l}"></span><span>${esc(t)}</span><span class="sp"></span>${open ? `<button class="btn sm" data-open="${open}">Look</button>` : ''}<button class="btn sm ghost" data-dismiss="${esc(id)}" title="Hide until it changes">Hide</button></div>`).join('')}</div>` : ''}
      ${hidden ? `<p class="muted" style="margin:-4px 0 12px">${hidden} hidden. <a href="#" id="hShow">Show them</a></p>` : ''}
      <div class="hx-tiles" id="hxTiles">${tiles.map(t => `<button class="hx-tile ${t.lv}" ${t.open ? `data-open="${t.open}"` : ''}><span class="hx-name"><i class="hx-dot ${t.lv}"></i>${t.name}</span><b>${t.big}</b><small>${t.sub || ''}</small>${t.extra || ''}</button>`).join('')}</div>
      <div class="hx-cols">
        <div class="card"><h3>Waiting on the team</h3>${queue.length ? queue.map(([key, l, go, hot]) => `<button class="hx-q ${hot ? 'hot' : ''}" data-go="${go}"><b>${more[key]}</b><span>${l}</span><span class="sp"></span>›</button>`).join('') : `<p class="muted">${more.error ? (need33(more.error) ? SQL33 : esc(more.error)) : 'Nothing waiting. Nice.'}</p>`}</div>
        <div class="card"><h3>Where people are</h3>${keys.length ? `<div class="hx-surf">${keys.map(s => `<div><span>${esc(SURF[s] || s)}</span><b>${surf[s] || 0}</b><small>now · ${day[s] || 0} today</small></div>`).join('')}</div>` : '<p class="muted">Nobody in the last day.</p>'}
          <p class="muted" style="margin:8px 0 0">${(h.active_today ?? '—')} people used Nexus today.</p></div></div>
      <div class="card"><h3>Server functions</h3><div class="hx-fns">${fns.map(f => `<div class="${f.ok ? 'ok' : 'bad'}"><i class="hx-dot ${f.ok ? 'ok' : 'bad'}"></i><b>${esc(f.name)}</b><small>${esc(f.project)} · ${f.ok ? f.ms + ' ms' : f.status === 404 ? 'not deployed' : f.status ? 'error ' + f.status : 'can’t reach'}</small></div>`).join('') || '<span class="muted">None listed.</span>'}</div></div>
      ${h.tables || h.storage ? `<div class="hx-cols">${h.tables ? `<div class="card"><h3>Biggest tables <span class="muted">${h.db_bytes ? 'database ' + (h.db_bytes / 1048576).toFixed(1) + ' MB' : ''}</span></h3><div id="hTables"></div></div>` : ''}
        ${h.storage ? `<div class="card"><h3>File storage</h3><table class="cards"><tr><th>Bucket</th><th class="num">Files</th><th class="num">Size</th></tr>${h.storage.map(s => `<tr><td>${esc(s.bucket)}</td><td class="num">${(+s.files).toLocaleString()}</td><td class="num">${(+s.bytes / 1048576).toFixed(1)} MB</td></tr>`).join('')}</table></div>` : ''}</div>` : ''}`, { cards: false });
    if (h.tables && window.NXCharts) NXCharts.hbars($('hTables'), h.tables.slice(0, 8).map(t => ({ label: t.name, value: Math.round(t.bytes / 1024), sub: `${(t.bytes / 1048576).toFixed(1)} MB · ~${Math.max(0, t.rows).toLocaleString()} rows` })));
    NX.labelTables?.();
    if (keepScroll) (document.scrollingElement || document.documentElement).scrollTop = keepScroll; if (mainScroll && $('main')) $('main').scrollTop = mainScroll;   // auto-refresh stays where you were
    $('hRe').onclick = () => { HX.fnsAt = 0; P.health(); };
    $('hxAuto').onchange = e => { HX.auto = e.target.checked; P.health(); };
    $('main').onclick = e => {
      const d = e.target.closest('[data-dismiss]'); if (d) { H.dismiss(d.dataset.dismiss); return P.health(); }
      if (e.target.id === 'hShow') { e.preventDefault(); NX.store.set('health-dismissed', {}); return P.health(); }
      const g = e.target.closest('[data-go]'); if (g) return NX.go(g.dataset.go);
      const o = e.target.closest('[data-open]'); if (o) H.detail(o.dataset.open, c);
    };
    if (HX.auto) HX.timer = setTimeout(() => { if (A.tab === 'health' && !document.querySelector('.modal, .drawer')) P.health(); }, 30e3);
  };

  // =========================================================== Feature flags: where each one runs
  const PLATS = [['mac', 'Mac'], ['windows', 'Windows'], ['phone', 'N28C'], ['test_run', 'Test Run']];
  const flagsBefore = P.flags;
  if (flagsBefore) P.flags = async (...a) => {
    await flagsBefore(...a); if (A.tab !== 'flags') return;
    const { data, error } = await sb.from('feature_flags').select('key,platforms');
    const table = $('main').querySelector('table.cards'); if (!table) return;
    const head = table.querySelector('tr'); head?.children[1]?.insertAdjacentHTML('afterend', '<th>Where</th>');
    const by = Object.fromEntries((data || []).map(f => [f.key, f.platforms || []]));
    for (const sel of table.querySelectorAll('[data-stage]')) {
      const key = sel.dataset.stage, td = sel.closest('td'), on = by[key] || [];
      td.insertAdjacentHTML('afterend', `<td>${error ? `<span class="muted" title="${esc(SQL33)}">—</span>` : `<div class="plat-chips" data-plats="${esc(key)}">${PLATS.map(([p, l]) => `<button class="${on.includes(p) ? 'on' : ''}" data-plat="${p}">${l}</button>`).join('')}</div><small class="muted plat-note">${on.length ? 'only these' : 'everywhere'}</small>`}</td>`);
    }
    if (error) $('main').querySelector('h1 + p')?.insertAdjacentHTML('afterend', `<div class="card"><p class="muted" style="margin:0">Picking platforms per feature: ${esc(SQL33)}</p></div>`);
    table.addEventListener('click', async e => {
      const b = e.target.closest('[data-plat]'); if (!b) return; e.stopPropagation();
      if (A.viewer) return toast('Viewers can’t change flags.', true);
      const box = b.closest('[data-plats]'); b.classList.toggle('on');
      const list = [...box.querySelectorAll('.on')].map(x => x.dataset.plat);
      const { error: er } = await sb.from('feature_flags').update({ platforms: list, updated_at: new Date().toISOString() }).eq('key', box.dataset.plats);
      if (er) { b.classList.toggle('on'); return toast(need33(er.message) ? SQL33 : er.message, true); }
      box.nextElementSibling.textContent = list.length ? 'only these' : 'everywhere';
      toast(list.length ? `${box.dataset.plats}: only on ${list.map(p => PLATS.find(x => x[0] === p)[1]).join(', ')}` : `${box.dataset.plats}: everywhere`);
    }, true);
  };

  // =========================================================== Release plan → release notes in one click
  // A plan's features and fixes become What's new lines ("Fixed:" in front of fixes), published to release_notes (the
  // Nexus website's What's new page and the apps read them), added to Testing, and copied as a changes.json entry.
  const sentence = t => { let s = String(t || '').replace(/\s+/g, ' ').trim(); if (!s) return ''; s = s[0].toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };
  NX.planNotes = p => {
    const items = (p.items || []).filter(x => (x.text || '').trim() && x.kind !== 'chore');
    return [...items.filter(x => x.kind !== 'fix').map(x => sentence(x.text)), ...items.filter(x => x.kind === 'fix').map(x => 'Fixed: ' + sentence(x.text).replace(/^Fixed:?\s*/i, ''))].slice(0, 40);
  };
  const appOf = p => (p.apps || []).some(a => ['nexus', 'n28c', 'test_run'].includes(a)) || !(p.apps || []).length ? 'nexus' : 'admin';
  NX.publishNotes = async (p, { lines, title, addTests = true } = {}) => {
    const hl = (lines || NX.planNotes(p)).map(x => String(x).trim()).filter(Boolean);
    if (!hl.length) throw new Error('This plan has nothing to put in the notes yet.');
    const row = { app: appOf(p), version: p.version, title: (title ?? p.title ?? '').slice(0, 120), date: new Date().toISOString().slice(0, 10), highlights: hl, published: true, plan_id: p.id, updated_at: new Date().toISOString() };
    const { error } = await sb.from('release_notes').upsert(row, { onConflict: 'app,version' });
    if (error) throw new Error(need33(error.message) ? SQL33 : error.message);
    let tests = 0;
    if (addTests) {
      // 3.3.1: each line becomes one test per platform its plan item runs on (the item's own, else the release's)
      const { data: have } = await sb.from('test_items').select('title,platform').eq('release', p.version);
      const seen = new Set((have || []).map(x => x.title.toLowerCase() + '|' + (x.platform || 'all')));
      const norm = t => String(t || '').replace(/^Fixed:?\s*/i, '').replace(/[.!?]+$/, '').trim().toLowerCase();
      const itemOf = h => (p.items || []).find(x => norm(sentence(x.text)) === norm(h)) || { text: h };
      const rows = hl.flatMap(h => { const title = (NX.testTitle ? NX.testTitle(h) : h).slice(0, 200); return (NX.planTestRows ? NX.planTestRows(itemOf(h), p, title) : [{ title, platform: 'all' }]).map(r => ({ ...r, steps: h.slice(0, 2000) })); })
        .filter(r => !seen.has(r.title.toLowerCase() + '|' + r.platform)).map((r, i) => ({ release: p.version, platform: r.platform, title: r.title, steps: r.steps, created_by: A.user.id, sort: (have || []).length + i }));
      if (rows.length) { const { error: er } = await sb.from('test_items').insert(rows); if (!er) tests = rows.length; }
    }
    const entry = JSON.stringify({ version: p.version, date: row.date, title: row.title, highlights: hl }, null, 2);
    try { await navigator.clipboard?.writeText(entry); } catch {}
    sb.from('moderation_log').insert({ action: 'release_notes_published', performed_by: A.user.id, details: { version: p.version, app: row.app, lines: hl.length } }).then(() => {}, () => {});
    return { app: row.app, lines: hl.length, tests };
  };
  function publishModal(p, after) {
    const lines = NX.planNotes(p);
    const { el, close } = NX.modal(`<h3>Release notes for ${esc(p.version)}</h3><p class="muted">One line per change. They go on the What's new page ${appOf(p) === 'nexus' ? 'for Nexus (website, apps and the changelog email)' : 'for Apoji Admin'}, and into Testing.</p>
      <label class="muted">Title</label><input class="field" id="rnTitle" maxlength="120" value="${esc(p.title || '')}" placeholder="Widgets that stay put" style="width:100%">
      <label class="muted" style="display:block;margin-top:10px">What's new</label><textarea class="field" id="rnLines" rows="${Math.min(14, Math.max(5, lines.length + 1))}" style="width:100%">${esc(lines.join('\n'))}</textarea>
      <label class="as-row" style="margin-top:8px"><input type="checkbox" id="rnTests" checked><span>Add them to Testing for ${esc(p.version)}</span></label>
      <div class="row" style="margin-top:12px"><span class="muted">The changes.json entry is copied too.</span><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="rnGo">Publish</button></div>`);
    el.classList.add('wide-modal');
    el.querySelector('#rnGo').onclick = async () => {
      const b = el.querySelector('#rnGo'); b.disabled = true;
      try { const r = await NX.publishNotes(p, { lines: el.querySelector('#rnLines').value.split('\n'), title: el.querySelector('#rnTitle').value.trim(), addTests: el.querySelector('#rnTests').checked });
        close(); toast(`Published ${r.lines} line${r.lines === 1 ? '' : 's'} for ${p.version}${r.tests ? ` · ${r.tests} added to Testing` : ''} · changes.json entry copied`); after?.(); }
      catch (e) { b.disabled = false; toast(e.message, true); }
    };
  }
  NX.publishPlanNotes = (p, after) => publishModal(p, after);
  const relBefore = P.releases, RX = { plans: [], wired: false };
  if (relBefore) P.releases = async (...a) => {
    await relBefore(...a); if (A.tab !== 'releases') return;
    try { await addPublish(); } catch (e) { console.warn('publish buttons', e); }   // never take the Releases page down
  };
  async function addPublish() {
    const plans = ((await sb.from('admin_release_plans').select('*')).data || []).filter(p => p.status !== 'dropped');
    const { data: pub } = await sb.from('release_notes').select('app,version,updated_at').then(x => x, () => ({ data: [] }));
    const done = new Set((pub || []).map(r => r.version));
    for (const el of document.querySelectorAll('.plan[data-plan] .plan-foot')) {
      const id = +el.closest('[data-plan]').dataset.plan, p = (plans || []).find(x => x.id === id); if (!p || el.querySelector('[data-publish]')) continue;
      el.insertAdjacentHTML('beforeend', `<button class="btn sm ${done.has(p.version) ? 'ghost' : 'primary'}" data-publish="${id}" title="Turn this plan into the What's new entry">${done.has(p.version) ? 'Notes published · update' : 'Publish release notes'}</button>`);
    }
    RX.plans = plans || [];
    if (!RX.wired) { RX.wired = true; $('main').addEventListener('click', e => {   // once: #main stays between renders
      const b = e.target.closest('[data-publish]'); if (!b) return; e.stopPropagation();
      if (!(A.owner || NX.can('changelog'))) return toast('You need the changelog access to publish notes.', true);
      const p = RX.plans.find(x => x.id === +b.dataset.publish); if (p) publishModal(p, () => P.releases());
    }, true); }
  }
})();

// 3.3.1: which admins are around in any Apoji app (Nexus, N28C, Test Run, the Admin app), so their dots match their profile
(function () {
  const { sb } = NX;
  let busy = false;
  async function appsLive() {
    if (busy || !NX.A?.user || !(NX.A.admins || []).length || !NX.markSeen) return; busy = true;
    try {
      const ids = NX.A.admins.map(a => a.id), since = new Date(Date.now() - 5 * 60e3).toISOString();
      const { data } = await sb.from('user_presence').select('user_id,seen_at').in('user_id', ids).gte('seen_at', since);
      for (const r of data || []) NX.markSeen(r.user_id, r.seen_at);
      if ((data || []).length) { for (const id of new Set(data.map(r => r.user_id))) NX.repaintPresence?.(id); NX.emit?.('presence', null); }
    } catch {} finally { busy = false; }
  }
  setTimeout(appsLive, 4000); setInterval(appsLive, 60e3);
  NX.appsLive = appsLive;
})();
