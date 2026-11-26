// Apoji Admin 3.4 (needs the Nexus repo's supabase/nexus-v4.2.0.sql):
//   • Session replays (INSIGHTS): anonymous step-by-step replays from the Mac and Windows apps, N28C and Test Run: which
//     screen, which button, where on the window, and errors. Never what people type, their chats or who they are.
//     Filter by app, days and "had an error", see where people go and what they click most, and play one back.
//   • Feature flags → Split: give a feature to part of the people who'd get it (50% = an A/B test), and compare the two
//     halves (sessions, time, steps, errors) from the replays.
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL42 = 'Run supabase/nexus-v4.2.0.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';
  const need42 = m => /session_replays|rollout|42P01|42703|PGRST20|does not exist/i.test(m || '');
  const APP = { mac: 'Mac', windows: 'Windows', phone: 'N28C', test_run: 'Test Run' };
  const RP = { app: '', days: 7, errs: false, rows: null };
  const dur = ms => { const s = Math.round((ms || 0) / 1000); return s < 60 ? s + 's' : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`; };
  const top = (arr, n = 6) => Object.entries(arr.reduce((o, k) => (k ? (o[k] = (o[k] || 0) + 1) : 0, o), {})).sort((a, b) => b[1] - a[1]).slice(0, n);

  // =========================================================== Session replays page
  P.replays = async () => {
    NX.main(`<h1>Session replays</h1><p>Anonymous steps from the apps: which screen, which button, where on the window, and errors. Never what people type, their chats or who they are. Kept 30 days. People can turn it off in each app.</p>
      <div class="row rp-ctl"><div class="seg" id="rpApp">${[['', 'All apps'], ...Object.entries(APP)].map(([k, l]) => `<button data-rpa="${k}" class="${RP.app === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg" id="rpDays">${[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([d, l]) => `<button data-rpd="${d}" class="${RP.days === d ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="as-row"><input type="checkbox" id="rpErr" ${RP.errs ? 'checked' : ''}><span>Only ones with an error</span></label></div>
      <div id="rpBody"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    $('rpApp').onclick = e => { const b = e.target.closest('[data-rpa]'); if (b) { RP.app = b.dataset.rpa; P.replays(); } };
    $('rpDays').onclick = e => { const b = e.target.closest('[data-rpd]'); if (b) { RP.days = +b.dataset.rpd; P.replays(); } };
    $('rpErr').onchange = e => { RP.errs = e.target.checked; P.replays(); };
    let q = sb.from('session_replays').select('id,app,version,variants,screen,steps,errors,duration_ms,started_at,created_at,events').gte('created_at', new Date(Date.now() - RP.days * 864e5).toISOString()).order('created_at', { ascending: false }).limit(300);
    if (RP.app) q = q.eq('app', RP.app);
    if (RP.errs) q = q.gt('errors', 0);
    const { data, error } = await q;
    const box = $('rpBody'); if (!box) return;
    if (error) { box.innerHTML = `<div class="card"><p class="muted" style="margin:0">${esc(need42(error.message) ? SQL42 : error.message)}</p></div>`; return; }
    RP.rows = data || [];
    if (!RP.rows.length) { box.innerHTML = '<div class="card"><p class="muted" style="margin:0">No replays yet for this filter. They show up a little after people use the apps.</p></div>'; return; }
    box.innerHTML = summary(RP.rows) + `<div class="card"><h3>Sessions <span class="muted">${RP.rows.length}${RP.rows.length === 300 ? '+' : ''}</span></h3><table class="cards rp-table"><tr><th>When</th><th>App</th><th>Length</th><th>Steps</th><th>Path</th><th>Errors</th><th></th></tr>
      ${RP.rows.map(r => { const views = (r.events || []).filter(e => e.k === 'view').map(e => e.s); return `<tr data-rp="${esc(r.id)}"><td data-l="When">${esc(ago(r.created_at))}</td><td data-l="App">${esc(APP[r.app] || r.app)} <span class="muted">${esc(r.version)}</span>${Object.keys(r.variants || {}).length ? ` <span class="pill" title="${esc(JSON.stringify(r.variants))}">A/B</span>` : ''}</td><td data-l="Length">${dur(r.duration_ms)}</td><td data-l="Steps">${r.steps}</td>
        <td data-l="Path" class="rp-path">${esc([...new Set(views)].slice(0, 5).join(' → ') || '—')}</td><td data-l="Errors">${r.errors ? `<b class="err">${r.errors}</b>` : '<span class="muted">0</span>'}</td><td><button class="btn sm" data-play="${esc(r.id)}">▶ Play</button></td></tr>`; }).join('')}</table></div>`;
    box.onclick = e => { const b = e.target.closest('[data-play], tr[data-rp]'); if (!b) return; const r = RP.rows.find(x => x.id === (b.dataset.play || b.dataset.rp)); if (r) player(r); };
  };
  function summary(rows) {
    const ev = rows.flatMap(r => r.events || []), n = rows.length;
    const avg = k => Math.round(rows.reduce((s, r) => s + (r[k] || 0), 0) / n);
    const screens = top(ev.filter(e => e.k === 'view').map(e => e.s)), clicks = top(ev.filter(e => e.k === 'click').map(e => e.l), 8), errs = top(ev.filter(e => e.k === 'error').map(e => e.l), 5);
    // where sessions end: the last screen of each one
    const ends = top(rows.map(r => [...(r.events || [])].reverse().find(e => e.s)?.s));
    const bar = (list) => { const m = Math.max(1, ...list.map(x => x[1])); return list.map(([k, v]) => `<div class="rp-bar"><span title="${esc(k)}">${esc(k)}</span><i style="width:${Math.round(v / m * 100)}%"></i><b>${v}</b></div>`).join('') || '<p class="muted">—</p>'; };
    return `<div class="rp-tiles"><div class="card tile"><b>${n}</b><span>sessions</span></div><div class="card tile"><b>${dur(avg('duration_ms'))}</b><span>average length</span></div><div class="card tile"><b>${avg('steps')}</b><span>steps per session</span></div><div class="card tile"><b>${Math.round(rows.filter(r => r.errors).length / n * 100)}%</b><span>had an error</span></div></div>
      <div class="rp-grid"><div class="card"><h3>Screens people visit</h3>${bar(screens)}</div><div class="card"><h3>Where sessions end</h3>${bar(ends)}</div><div class="card"><h3>Most-clicked</h3>${bar(clicks)}</div><div class="card"><h3>Errors</h3>${bar(errs)}</div></div>`;
  }
  // play one back: the window as a box, clicks as dots where they happened, the screen name, a timeline and the steps
  function player(r) {
    const evs = (r.events || []).slice().sort((a, b) => a.t - b.t), end = Math.max(1000, r.duration_ms || evs[evs.length - 1]?.t || 1000);
    const w = +r.screen?.w || 1200, h = +r.screen?.h || 800;
    const { el, close } = NX.modal(`<h3>${esc(APP[r.app] || r.app)} ${esc(r.version)} <span class="muted">· ${esc(new Date(r.started_at).toLocaleString())} · ${dur(end)} · ${r.steps} steps${r.errors ? ` · <b class="err">${r.errors} error${r.errors === 1 ? '' : 's'}</b>` : ''}</span></h3>
      <div class="rp-player"><div class="rp-stage" style="aspect-ratio:${w}/${h}"><div class="rp-screen" id="rpScr">—</div><div class="rp-dots" id="rpDots"></div><div class="rp-cursor" id="rpCur"></div></div>
        <div class="rp-steps" id="rpSteps">${evs.map((e, i) => `<button class="rp-step k-${esc(e.k)}" data-i="${i}"><span>${dur(e.t)}</span><b>${esc(e.k)}</b>${esc(e.k === 'view' ? e.s : e.l || '')}</button>`).join('')}</div></div>
      <div class="row rp-ctl2"><button class="btn sm primary" id="rpPlay">▶ Play</button><div class="seg" id="rpSpd">${[1, 2, 4, 8].map(s => `<button data-spd="${s}" class="${s === 2 ? 'on' : ''}">${s}×</button>`).join('')}</div><input type="range" id="rpSeek" min="0" max="${end}" value="0" style="flex:1"><span class="muted" id="rpT">0s</span>${r.errors ? '<button class="btn sm" id="rpErrJump">Next error</button>' : ''}</div>
      ${Object.keys(r.variants || {}).length ? `<p class="muted">A/B: ${Object.entries(r.variants).map(([k, v]) => `${esc(k)} = <b>${esc(String(v).toUpperCase())}</b>`).join(', ')}</p>` : ''}
      <div class="row"><span class="sp"></span><button class="btn" data-close>Close</button></div>`);
    el.classList.add('wide-modal');
    let t = 0, spd = 2, playing = false, raf = 0, last = 0;
    const paint = () => {
      const past = evs.filter(e => e.t <= t);
      el.querySelector('#rpScr').textContent = [...past].reverse().find(e => e.s)?.s || '—';
      el.querySelector('#rpDots').innerHTML = past.filter(e => e.k === 'click' && e.x != null).slice(-12).map((e, i, a) => `<i class="${i === a.length - 1 && t - e.t < 900 ? 'fresh' : ''}" style="left:${e.x * 100}%;top:${e.y * 100}%" title="${esc(e.l || '')}"></i>`).join('');
      const lc = [...past].reverse().find(e => e.x != null), cur = el.querySelector('#rpCur'); if (lc) { cur.style.left = lc.x * 100 + '%'; cur.style.top = lc.y * 100 + '%'; cur.hidden = false; } else cur.hidden = true;
      el.querySelectorAll('.rp-step').forEach(b => { const e = evs[+b.dataset.i]; b.classList.toggle('past', e.t <= t); b.classList.toggle('now', e === past[past.length - 1]); });
      el.querySelector('.rp-step.now')?.scrollIntoView({ block: 'nearest' });
      el.querySelector('#rpSeek').value = t; el.querySelector('#rpT').textContent = `${dur(t)} / ${dur(end)}`;
    };
    const tick = ts => { if (!playing) return; t = Math.min(end, t + (ts - last) * spd); last = ts; paint(); if (t >= end || !el.isConnected) { playing = false; el.querySelector('#rpPlay').textContent = '▶ Play'; return; } raf = requestAnimationFrame(tick); };
    el.querySelector('#rpPlay').onclick = () => { playing = !playing; el.querySelector('#rpPlay').textContent = playing ? '❚❚ Pause' : '▶ Play'; if (playing) { if (t >= end) t = 0; last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); };
    el.querySelector('#rpSpd').onclick = e => { const b = e.target.closest('[data-spd]'); if (!b) return; spd = +b.dataset.spd; el.querySelectorAll('[data-spd]').forEach(x => x.classList.toggle('on', x === b)); };
    el.querySelector('#rpSeek').oninput = e => { t = +e.target.value; paint(); };
    el.querySelector('#rpSteps').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { t = evs[+b.dataset.i].t; paint(); } };
    el.querySelector('#rpErrJump')?.addEventListener('click', () => { const nx = evs.find(e => e.k === 'error' && e.t > t + 1) || evs.find(e => e.k === 'error'); if (nx) { t = nx.t; paint(); } });
    paint();
    return close;
  }
  NX.replayPlayer = player;

  // =========================================================== Feature flags → Split (A/B)
  const SPLITS = [[100, 'Everyone it’s for'], [50, 'Half (A/B test)'], [25, '25%'], [10, '10%']];
  const flagsBefore = P.flags;
  if (flagsBefore) P.flags = async (...a) => {
    await flagsBefore(...a); if (A.tab !== 'flags') return;
    const { data, error } = await sb.from('feature_flags').select('key,rollout');
    const table = $('main').querySelector('table.cards'); if (!table) return;
    const head = table.querySelector('tr'), whereTh = [...(head?.children || [])].find(th => /where/i.test(th.textContent));
    (whereTh || head?.children[1])?.insertAdjacentHTML('afterend', '<th title="Give it to part of the people who’d get it, to compare">Split</th>');
    const by = Object.fromEntries((data || []).map(f => [f.key, f.rollout ?? 100]));
    for (const sel of table.querySelectorAll('[data-stage]')) {
      const key = sel.dataset.stage, row = sel.closest('tr'), ro = by[key] ?? 100;
      const after = row.querySelector('[data-plats]')?.closest('td') || sel.closest('td');
      after.insertAdjacentHTML('afterend', `<td data-l="Split">${error ? `<span class="muted" title="${esc(SQL42)}">—</span>` : `<select class="field sm" data-split="${esc(key)}" ${A.viewer ? 'disabled' : ''}>${SPLITS.map(([v, l]) => `<option value="${v}" ${+ro === v ? 'selected' : ''}>${l}</option>`).join('')}${SPLITS.some(s => s[0] === +ro) ? '' : `<option value="${ro}" selected>${ro}%</option>`}</select>${ro < 100 ? ` <button class="btn sm" data-ab="${esc(key)}">Results</button>` : ''}`}</td>`);
    }
    if (error && need42(error.message)) $('main').querySelector('h1 + p')?.insertAdjacentHTML('afterend', `<div class="card"><p class="muted" style="margin:0">A/B splits: ${esc(SQL42)}</p></div>`);
    table.addEventListener('change', async e => {
      const s = e.target.closest('[data-split]'); if (!s) return; e.stopPropagation();
      if (A.viewer) return toast('Viewers can’t change flags.', true);
      const v = +s.value, { error: er } = await sb.from('feature_flags').update({ rollout: v, updated_at: new Date().toISOString() }).eq('key', s.dataset.split);
      if (er) return toast(need42(er.message) ? SQL42 : er.message, true);
      sb.from('moderation_log').insert({ action: 'flag_split', performed_by: A.user.id, details: { key: s.dataset.split, rollout: v } }).then(() => {}, () => {});
      toast(v === 100 ? `${s.dataset.split}: everyone it’s for` : `${s.dataset.split}: ${v}% get it (the rest are the comparison group)`); P.flags();
    }, true);
    table.addEventListener('click', e => { const b = e.target.closest('[data-ab]'); if (!b) return; e.stopPropagation(); abResults(b.dataset.ab); }, true);
  };
  // the two halves side by side, from the last 14 days of replays
  async function abResults(key) {
    const { el } = NX.modal(`<h3>A/B: ${esc(key)}</h3><div id="abBody"><span class="spinner"></span></div><div class="row"><span class="sp"></span><button class="btn" data-close>Close</button></div>`);
    const { data, error } = await sb.from('session_replays').select('app,variants,steps,errors,duration_ms').gte('created_at', new Date(Date.now() - 14 * 864e5).toISOString()).limit(2000);
    const box = el.querySelector('#abBody');
    if (error) { box.innerHTML = `<p class="muted">${esc(need42(error.message) ? SQL42 : error.message)}</p>`; return; }
    const rows = (data || []).filter(r => r.variants?.[key]), g = v => rows.filter(r => r.variants[key] === v);
    const stat = list => { const n = list.length || 1; return { n: list.length, len: Math.round(list.reduce((s, r) => s + r.duration_ms, 0) / n), steps: (list.reduce((s, r) => s + r.steps, 0) / n).toFixed(1), err: Math.round(list.filter(r => r.errors).length / n * 100) }; };
    const a = stat(g('a')), b = stat(g('b'));
    const cell = (x, y, better) => { const d = y - x; return `${better === 'up' ? (d > 0 ? '▲' : d < 0 ? '▼' : '') : (d < 0 ? '▲' : d > 0 ? '▼' : '')}`; };
    box.innerHTML = rows.length ? `<table class="cards ab-table"><tr><th></th><th>A · without it</th><th>B · with it</th></tr>
      <tr><td>Sessions</td><td>${a.n}</td><td>${b.n}</td></tr>
      <tr><td>Average length</td><td>${dur(a.len)}</td><td>${dur(b.len)} <span class="muted">${cell(a.len, b.len, 'up')}</span></td></tr>
      <tr><td>Steps per session</td><td>${a.steps}</td><td>${b.steps} <span class="muted">${cell(+a.steps, +b.steps, 'up')}</span></td></tr>
      <tr><td>Had an error</td><td>${a.err}%</td><td>${b.err}% <span class="muted">${cell(a.err, b.err, 'down')}</span></td></tr></table>
      <p class="muted">From session replays in the last 14 days (only people who share them). ${Math.min(a.n, b.n) < 30 ? 'Not many sessions yet: wait for more before deciding.' : 'Longer sessions with more steps usually mean people are using it more.'}</p>`
      : '<p class="muted">No replays from this test yet. People get their half the next time their app checks flags; replays arrive after they use it.</p>';
  }
  NX.abResults = abResults;
})();
