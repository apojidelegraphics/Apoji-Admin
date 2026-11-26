// Apoji Admin 2.5 (needs supabase/nexus-v3.10.sql from the Nexus repo):
//   • 🧠 Training → 6 · Ship: push lessons to admins → beta testers → everyone (people get a notification), with the
//     👍 rate before and after each push, and Undo. Only the Owner and the high-admins they pick (training_push).
//   • ✨ Auto-sort: the free model pre-sorts the review queue (looks good / looks wrong / personal info)
//   • 📊 Free API usage: Nexus speech (Groq) and Test Run against the free limits
//   • 🧪 Testing: assign tests to testers (they get a notice) and the release gate (also on Releases)
//   • 📜 Terms: the Terms & Conditions (terms-data.js, the same file as Nexus), and admins accept the admin part once
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL310 = 'Run supabase/nexus-v3.10.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';
  const needSql = m => /training_push|admin_training|admin_free_usage|admin_testers|admin_assign_tests|admin_release_gate|admin_redeem_for|terms_|stt_usage|auto_label|PGRST20|42P01|42883|42703|does not exist/i.test(String(m || ''));
  const sqlMsg = m => needSql(m) ? SQL310 : m;
  NX.sqlMsg310 = sqlMsg;
  const STAGE = { admin: ['ADMINS', 'p-pending'], beta: ['BETA TESTERS', 'p-reviewing'], all: ['EVERYONE', 'p-approved'] };

  // ---------- new permissions
  Object.assign(NX.PERMS || {}, {
    training_push: ['🚀 Push lessons', 'Send approved lessons to beta testers and everyone (never automatic for high-admins: the Owner picks)'],
    redeem: ['🧾 Redeem orders for people', 'Redeem an aARgon3 / Mexel order on someone\'s account from Users']
  });

  // =========================================================== 🧠 Training → push (rollout with undo)
  NX.trainingShip = async el => {
    const { data, error } = await sb.rpc('admin_training_pushes');
    if (error) { el.innerHTML = `<div class="card"><h3>🚀 Push lessons</h3><p class="muted">${esc(sqlMsg(error.message))}</p></div>`; return; }
    const can = !!data.can_push, pushes = data.pushes || [];
    const ready = can && data.ready ? (await sb.from('training_examples').select('id,agent,prompt,lesson,approved_at,push_id').eq('approved', true).order('approved_at', { ascending: false }).limit(200)).data || [] : [];
    const undone = new Set(pushes.filter(p => p.undone_at).map(p => p.id));
    const fresh = ready.filter(r => !r.push_id || undone.has(r.push_id));
    const rate = (b, a, n) => b == null && a == null ? '<span class="muted">not enough 👍 / 👎 yet</span>' : `👍 ${b ?? '—'}${b != null ? '%' : ''} before → <b>${a ?? '—'}${a != null ? '%' : ''}</b> after${n ? ` <span class="muted">(${n} rated)</span>` : ''}${a != null && b != null ? ` <b style="color:${a >= b ? 'var(--online)' : 'var(--danger)'}">${a >= b ? '▲' : '▼'} ${Math.abs(a - b)}</b>` : ''}`;
    el.innerHTML = `<div class="card"><h3>🚀 Push lessons <span class="muted">${data.ready || 0} ready</span></h3>
      <p class="muted">Approved lessons reach admins first, so you can try them (Check → Try a question). Push them to beta testers, then everyone: each push sends a notification (“🧠 Nexus learned 3 new things”). If the 👍 rate drops, Undo stops them right away.</p>
      ${!can ? '<p class="muted">Only the Owner and the high-admins they choose (Admin access → 🚀 Push lessons) can push.</p>' : fresh.length ? `
        <div class="push-pick">${fresh.map(r => `<label class="row push-row"><input type="checkbox" data-pick="${r.id}" checked><span><b>${esc(r.lesson || r.prompt.slice(0, 90))}</b><small class="muted"> ${esc(r.agent || '')} · approved ${ago(r.approved_at)}</small></span></label>`).join('')}</div>
        <div class="acct-grid" style="margin-top:10px"><label>Title</label><input class="field" id="puT" maxlength="80" value="${fresh.length} new lesson${fresh.length === 1 ? '' : 's'}">
          <label>What changed</label><input class="field" id="puN" maxlength="400" placeholder="Gives units with measurements; better answers about Python">
          <label>Send to</label><select class="field" id="puS"><option value="admin">Admins (try it first)</option><option value="beta">Beta testers</option><option value="all">Everyone</option></select></div>
        <div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn primary" id="puGo">🚀 Push</button></div>` : '<p class="muted">Nothing new to push. Approve examples in 4 · Use.</p>'}
      ${pushes.length ? `<h3 style="margin-top:16px">Pushes</h3>${pushes.map(p => `<div class="push-item ${p.undone_at ? 'undone' : ''}">
        <div class="row"><b>${esc(p.title)}</b><span class="pill ${p.undone_at ? 'p-declined' : STAGE[p.stage][1]}">${p.undone_at ? 'UNDONE' : STAGE[p.stage][0]}</span><span class="muted">${p.lessons} lesson${p.lessons === 1 ? '' : 's'} · ${ago(p.created_at)}${p.by ? ' · ' + esc(p.by) : ''}</span><span class="sp"></span>
          ${can && !p.undone_at ? `${p.stage === 'admin' ? `<button class="btn sm" data-promote="${p.id}" data-to="beta">→ Beta testers</button>` : ''}${p.stage !== 'all' ? `<button class="btn sm primary" data-promote="${p.id}" data-to="all">→ Everyone</button>` : ''}<button class="btn sm danger" data-undo="${p.id}">↶ Undo</button>` : ''}</div>
        ${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}<div style="font-size:13.5px;margin-top:4px">${rate(p.up_before, p.up_after, p.rated_after)}</div>
        ${(p.rules || []).length ? `<details><summary class="muted">What's in it</summary><ul>${p.rules.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}</div>`).join('')}` : ''}</div>`;
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'puGo') {
        const ids = [...el.querySelectorAll('[data-pick]:checked')].map(x => +x.dataset.pick); if (!ids.length) return toast('Pick at least one lesson.', true);
        const stage = $('puS').value; if (stage === 'all' && !confirm(`Push ${ids.length} lesson${ids.length === 1 ? '' : 's'} to everyone now? Everyone gets a notification.`)) return;
        const { data: r, error: er } = await sb.rpc('admin_training_push', { p_title: $('puT').value.trim() || 'New lessons', p_note: $('puN').value.trim(), p_ids: ids, p_stage: stage });
        if (er || !r?.success) return toast(er ? sqlMsg(er.message) : r.error === 'not_allowed' ? 'Only the Owner and chosen high-admins can push.' : 'Nothing to push.', true);
        toast(`🚀 Pushed ${r.lessons} lesson${r.lessons === 1 ? '' : 's'} to ${STAGE[stage][0].toLowerCase()}`); return NX.trainingShip(el);
      }
      if (b.dataset.promote) {
        if (b.dataset.to === 'all' && !confirm('Send these lessons to everyone? Everyone gets a notification.')) return;
        const { data: r, error: er } = await sb.rpc('admin_training_promote', { p_push: +b.dataset.promote, p_stage: b.dataset.to });
        if (er || !r?.success) return toast(er ? sqlMsg(er.message) : 'Couldn’t move it.', true); toast('✓ Sent on'); return NX.trainingShip(el);
      }
      if (b.dataset.undo) {
        if (!confirm('Undo this push? Agents stop using these lessons within 10 minutes and the notification is taken back. You can push them again later.')) return;
        const { data: r, error: er } = await sb.rpc('admin_training_undo', { p_push: +b.dataset.undo });
        if (er || !r?.success) return toast(er ? sqlMsg(er.message) : 'Couldn’t undo it.', true); toast('↶ Undone'); return NX.trainingShip(el);
      }
    };
  };

  // =========================================================== ✨ Auto-sort the review queue (free model, in the browser)
  const OR = 'https://openrouter.ai/api/v1/chat/completions';
  async function freeKey() {
    const { data } = await sb.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
    return typeof data?.content === 'string' ? data.content.trim() : data?.content?.key || '';
  }
  // obvious personal details the scrubber may have missed: names after "my name is", addresses, etc.
  const PRIVATE = /\b(my name is|i live (at|on)|my address|my (phone|number) is|password|social security|\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd)\b)/i;
  NX.trainingAutoSort = async (rows, onDone) => {
    const todo = rows.filter(r => !r.auto_label).slice(0, 30); if (!todo.length) return toast('Everything here is already sorted.');
    const key = await freeKey(); if (!key) return toast('No free key in app_content → openrouter_api_key.', true);
    toast(`✨ Sorting ${todo.length}…`);
    let done = 0;
    for (let i = 0; i < todo.length; i += 6) {
      const batch = todo.slice(i, i + 6);
      const prompt = 'You review examples for training an AI assistant. For each one, label it:\n- "good": the answer (or the user\'s better answer) is correct and helpful\n- "wrong": the answer is wrong, unhelpful or unsafe\n- "private": it contains personal information about a real person (names, addresses, school, health)\n- "unsure": you can\'t tell\nReply with ONLY JSON: {"labels":[{"n":1,"label":"good","why":"max 12 words"}]}\n\n'
        + batch.map((r, k) => `${k + 1}. Q: ${r.prompt.slice(0, 700)}\nA: ${(r.answer || '').slice(0, 900)}${r.correction ? `\nUser's better answer: ${r.correction.slice(0, 600)}` : ''}${r.rating ? `\nUser rated it ${r.rating > 0 ? '👍' : '👎'}` : ''}`).join('\n\n');
      try {
        const res = await fetch(OR, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Apoji Admin' }, body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'user', content: prompt }], max_tokens: 900 }) });
        const j = await res.json(); const text = j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning || '';
        const m = text.match(/\{[\s\S]*\}/); const out = m ? JSON.parse(m[0]).labels || [] : [];
        for (const o of out) {
          const r = batch[+o.n - 1]; if (!r || !['good', 'wrong', 'private', 'unsure'].includes(o.label)) continue;
          const label = PRIVATE.test(r.prompt + ' ' + r.answer) ? 'private' : o.label;
          await sb.from('training_examples').update({ auto_label: label, auto_note: String(o.why || '').slice(0, 300), auto_at: new Date().toISOString() }).eq('id', r.id); done++;
        }
      } catch (e) { console.warn('auto-sort', e); }
    }
    toast(done ? `✨ Sorted ${done}` : 'The free model didn’t answer. Try again in a minute.', !done); onDone?.();
  };
  NX.autoLabel = r => r.auto_label ? `<span class="pill auto-${r.auto_label}" title="${esc(r.auto_note || '')}">✨ ${({ good: 'LOOKS GOOD', wrong: 'LOOKS WRONG', private: 'PERSONAL INFO', unsure: 'UNSURE' })[r.auto_label]}</span>` : '';

  // =========================================================== 📊 Free API usage
  P.freeapi = async () => {
    const [{ data: u, error }, key] = await Promise.all([sb.rpc('admin_free_usage'), NX.freeKeyCredit ? NX.freeKeyCredit() : Promise.resolve(null)]);
    if (error) return NX.main(`<h1>📊 Free API usage</h1><div class="card">${esc(sqlMsg(error.message))}</div>`, { cards: false });
    const sp = u.speech || {}, tr = u.test_run || {};
    const meter = (v, max, label) => { const p = Math.min(100, Math.round(100 * v / Math.max(1, max))); return `<div class="meter"><div class="row"><b>${label}</b><span class="sp"></span><span>${v.toLocaleString()} / ${max.toLocaleString()} · ${p}%</span></div><div class="at-bar"><i style="width:${p}%;background:${p >= 80 ? 'var(--danger)' : p >= 50 ? 'var(--gold)' : 'var(--online)'}"></i></div></div>`; };
    const days = (list, f, label) => { const max = Math.max(1, ...list.map(f)); return `<div class="tr-days">${list.map(d => `<i style="height:${Math.round(f(d) / max * 100)}%" title="${esc(d.day)}: ${f(d)} ${label}"></i>`).join('') || '<span class="muted">Nothing yet.</span>'}</div>`; };
    const warn = sp.seconds >= .8 * sp.limit_seconds || sp.calls >= .8 * sp.limit_calls;
    NX.main(`<h1>📊 Free API usage</h1><p>The free services everyone shares, today (resets at midnight UTC). Nexus speech runs on one Groq key (Supabase secret GROQ_API_KEY); Test Run and the free Nexus key run on OpenRouter.</p>
      ${warn ? '<div class="alert bad"><span><b>Nexus speech is near Groq’s free daily limit.</b> When it runs out, dictation falls back to each computer’s own recognizer until tomorrow. Lower the per-person cap (stt_take in nexus-v3.9.sql) or upgrade the Groq account.</span></div>' : ''}
      <div class="card"><h3>🎙 Nexus speech (Groq Whisper)</h3>${meter(Math.round(sp.seconds / 60), Math.round(sp.limit_seconds / 60), 'Minutes of audio')}${meter(sp.calls, sp.limit_calls, 'Dictations')}
        <p class="muted">${sp.people} ${sp.people === 1 ? 'person' : 'people'} today · each person gets ${sp.per_person_calls} dictations or ${Math.round(sp.per_person_seconds / 60)} minutes a day. Groq’s limits here are the usual free plan; check yours at console.groq.com → Settings → Limits.</p>
        ${(sp.top || []).length ? `<table class="cards"><tr><th>Most today</th><th>Dictations</th><th>Minutes</th></tr>${sp.top.map(t => `<tr><td>${esc(t.email)}</td><td>${t.calls}</td><td>${Math.round(t.seconds / 60)}</td></tr>`).join('')}</table>` : ''}
        ${days(sp.days || [], d => Math.round(d.seconds / 60), 'minutes')}<p class="muted" style="margin-top:4px">Minutes per day, last 2 weeks</p></div>
      <div class="card"><h3>🧪 Test Run</h3><div class="stats4"><div class="stat"><b>${tr.answers}</b><span>answers today</span></div><div class="stat"><b>${tr.extra}</b><span>extra passes</span></div><div class="stat"><b>${tr.searches}</b><span>web searches</span></div><div class="stat"><b>${tr.people}</b><span>people</span></div></div>
        ${days(tr.days || [], d => d.answers, 'answers')}<p class="muted" style="margin-top:4px">Answers per day, last 2 weeks</p></div>
      <div class="card"><h3>🔑 Free Nexus key (OpenRouter)</h3><div id="faKey">${key ? keyHtml(key) : '<span class="muted">See Health for the key’s credit.</span>'}</div><div class="row"><button class="btn" data-go="health">🩺 Health</button></div></div>`, { cards: false });
    $('main').onclick = e => { const g = e.target.closest('[data-go]'); if (g) NX.go(g.dataset.go); };
  };
  const keyHtml = k => k.error ? `<span class="muted">${esc(k.error)}</span>` : k.none ? '<span class="muted">No free key set.</span>' : `<div class="stats4"><div class="stat"><b>${k.remaining != null ? '$' + (+k.remaining).toFixed(2) : '∞'}</b><span>credit left</span></div><div class="stat"><b>$${(+k.usage || 0).toFixed(2)}</b><span>used</span></div><div class="stat"><b>${k.free ? 'FREE' : 'PAID'}</b><span>tier</span></div></div>`;

  // =========================================================== 🧪 Testing: assign + release gate
  async function gateCard(release) {
    if (!release) return '';
    const { data: g, error } = await sb.rpc('admin_release_gate', { p_release: release });
    if (error) return `<div class="card"><p class="muted">${esc(sqlMsg(error.message))}</p></div>`;
    if (!g.items) return '';
    return `<div class="card gate ${g.ready ? 'ok' : 'bad'}"><div class="row"><b>${g.ready ? '✅ Ready to release' : '⛔ Not ready to release'}</b><span class="muted">${esc(release)} · ${g.passed}/${g.items} passed${g.failing ? ` · ${g.failing} failing` : ''}${g.untested ? ` · ${g.untested} untested` : ''}</span></div>
      ${(g.fails || []).length ? `<ul>${g.fails.map(f => `<li>❌ ${esc(f.title)} <span class="muted">${esc(f.platform)}</span></li>`).join('')}</ul>` : ''}
      ${g.ready ? '' : '<p class="muted" style="margin:4px 0 0">Every test needs a ✅ (a ❌ counts until someone passes it again). You can still release, but you’ll be asked first.</p>'}</div>`;
  }
  NX.testGateCard = r => gateCard(r); NX.testAssign = r => assignModal(r);   // 3.2: the new Testing page (v32.js) uses these
  NX.releaseGate = async release => { const { data } = await sb.rpc('admin_release_gate', { p_release: release }); return data || null; };
  const origTesting = P.testing;
  P.testing = async () => {
    await origTesting();
    if (A.tab !== 'testing') return;
    const main = $('main'), rel = A.testRel; if (!rel) return;
    const h1 = main.querySelector('h1 + p'); const box = document.createElement('div'); box.id = 'tGate'; h1?.after(box);
    box.innerHTML = await gateCard(rel);
    if (NX.can('testing')) {
      const bar = main.querySelector('#tAdd')?.parentElement;
      if (bar && !bar.querySelector('#tAssign')) bar.insertAdjacentHTML('afterbegin', '<button class="btn" id="tAssign">👥 Assign to testers</button>');
      main.querySelector('#tAssign')?.addEventListener('click', () => assignModal(rel));
    }
  };
  async function assignModal(rel) {
    const [{ data: items }, { data: testers, error }] = await Promise.all([sb.from('test_items').select('id,title,platform').eq('release', rel).eq('archived', false).order('sort'), sb.rpc('admin_testers')]);
    if (error) return toast(sqlMsg(error.message), true);
    const SURF = NX.SURF || {}, plats = t => (t.surfaces || []).map(s => (SURF[s] || [s])[0]).join(' ') || '<span class="muted">not seen lately</span>';
    const fits = (t, i) => i.platform === 'all' || (t.surfaces || []).some(s => ({ windows: ['windows'], mac: ['mac'], web: ['test_run'], phone: ['phone'], admin: ['admin'] })[i.platform]?.includes(s));
    const { el, close } = NX.modal(`<h3>👥 Assign tests · ${esc(rel)}</h3><p class="muted">Each tester gets one notice in Nexus (and on their phone) listing what to check. Testers are matched to items by the apps they use.</p>
      <div class="acct-grid"><label>Tests</label><div class="assign-list">${(items || []).map(i => `<label class="as-row"><input type="checkbox" data-ai="${i.id}" data-plat="${esc(i.platform)}" checked><span>${esc(i.title)} <span class="muted">${esc(i.platform)}</span></span></label>`).join('')}</div>
      <label>Testers</label><div class="assign-list">${(testers || []).map(t => `<label class="as-row"><input type="checkbox" data-at="${t.id}"><span><b>${esc(t.name)}</b> ${plats(t)} <span class="muted">${t.assigned ? `${t.done}/${t.assigned} done` : ''}</span></span></label>`).join('') || '<span class="muted">No beta testers yet.</span>'}</div></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="asAuto">✨ Match by platform</button><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="asGo">Assign</button></div>`);
    el.querySelector('#asAuto').onclick = () => { const picked = (items || []).filter(i => el.querySelector(`[data-ai="${i.id}"]`).checked); for (const t of testers || []) el.querySelector(`[data-at="${t.id}"]`).checked = picked.some(i => fits(t, i)); };
    el.querySelector('#asGo').onclick = async () => {
      const its = [...el.querySelectorAll('[data-ai]:checked')].map(x => +x.dataset.ai), us = [...el.querySelectorAll('[data-at]:checked')].map(x => x.dataset.at);
      if (!its.length || !us.length) return toast('Pick tests and testers.', true);
      const { data: r, error: er } = await sb.rpc('admin_assign_tests', { p_items: its, p_users: us });
      if (er || !r?.success) return toast(er ? sqlMsg(er.message) : 'Couldn’t assign.', true);
      close(); toast(r.assigned ? `✓ Assigned ${r.assigned} test${r.assigned === 1 ? '' : 's'} · testers were notified` : 'They already had those.');
    };
  }
  // Releases: the gate for the newest release in Testing
  const origReleases = P.releases;
  if (origReleases) P.releases = async () => {
    await origReleases();
    if (A.tab !== 'releases') return;
    const { data: rel } = await sb.from('test_items').select('release').eq('archived', false).order('release', { ascending: false }).limit(1);
    const r = rel?.[0]?.release; if (!r) return;
    const html = await gateCard(r); if (!html || A.tab !== 'releases') return;
    const p = $('main').querySelector('h1 + p') || $('main').querySelector('h1'); p?.insertAdjacentHTML('afterend', `<div id="relGate">${html}</div>`);
  };

  // =========================================================== 🧾 Redeem an order for a customer (Users → their drawer)
  // The aARgon3 / Mexel store: publishable key, and only the order number, plan, status and system config are read.
  const STORE_URL = 'https://yuergfrpfhtcxjkcgjrx.supabase.co', STORE_KEY = 'sb_publishable_tX9wZpRsI3fAlthnz4lQKA_yVdY7768';
  const VOID = /^(void|voided|refunded|cancel+ed|canceled|deleted)$/i;
  NX.redeemFor = async (uid, raw) => {
    const id = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,}-[A-Z0-9]{2,}$/.test(id)) throw new Error('That doesn’t look like an order number (example: MRH33QFL-RA6C).');
    const res = await fetch(`${STORE_URL}/rest/v1/orders?select=order_id,plan_type,status,config&order_id=eq.${encodeURIComponent(id)}`, { headers: { apikey: STORE_KEY } });
    if (!res.ok) throw new Error(`Couldn’t look the order up (${res.status}).`);
    const [o] = await res.json(); if (!o) throw new Error('No aARgon3 or Mexel order has that number.');
    if (VOID.test(o.status || '')) throw new Error(`That order is ${String(o.status).toLowerCase()} and can’t be redeemed.`);
    const c = o.config || {};
    const { data: r, error } = await sb.rpc('admin_redeem_for', { p_user: uid, p_order: id, p_tier: o.plan_type || null, p_os: c.os || null, p_chip: c.chip || null, p_network: c.connection || null, p_service: c.service_tier || null });
    if (error) throw new Error(sqlMsg(error.message));
    if (!r?.success) throw new Error({ taken: 'Someone else already redeemed that order. Remove it from their account first.', already_theirs: 'They already have that order.', not_allowed: 'You need the “Redeem orders for people” access.', bad_order: 'That doesn’t look like an order number.' }[r?.error] || 'Couldn’t redeem it.');
    return { order: id, plan: o.plan_type };
  };

  // =========================================================== 📜 Terms
  P.terms = async () => {
    const T = window.NexusTerms?.TERMS; if (!T) return NX.main('<h1>📜 Terms</h1><div class="card">The terms file didn’t load.</div>', { cards: false });
    const [{ data: mine }, { data: stats }] = await Promise.all([sb.from('terms_acceptance').select('version,accepted_at').eq('user_id', A.user.id).eq('version', T.version).maybeSingle(), sb.rpc('admin_terms_stats')]);
    const cur = (stats || []).find(s => s.version === T.version);
    NX.main(`<h1>📜 Terms & Conditions</h1><p>The terms for Nexus ’28 (Mac, Windows, Test Run, N28C) and Apoji Admin. Section 11 is about being an admin or moderator. The same text is in Nexus (Settings → Terms) and on the website.</p>
      <div class="card"><div class="row"><b>Version ${esc(T.version)}</b><span class="muted">effective ${esc(T.effective)}${cur ? ` · ${cur.people} ${cur.people === 1 ? 'person has' : 'people have'} accepted it` : ''}</span><span class="sp"></span>
        ${mine ? `<span class="pill p-approved">YOU ACCEPTED ${esc(new Date(mine.accepted_at).toLocaleDateString())}</span>` : '<button class="btn primary" id="tmOk">I agree</button>'}
        <a class="btn" href="https://apojidelegraphics.github.io/Nexus-28/terms/" target="_blank" rel="noopener">Open on the website</a></div>
        <p class="muted" style="margin:6px 0 0">To change the terms, edit renderer/terms-data.js in the Nexus repo (and copy it to this repo as terms-data.js), then run node scripts/build-terms.js. Have a lawyer look it over before relying on it.</p></div>
      <div class="card terms-card">${window.NexusTerms.toHTML(T, { highlight: 'admin' })}</div>`, { cards: false });
    $('main').querySelector('#tmOk')?.addEventListener('click', accept);
  };
  async function accept() {
    const T = window.NexusTerms.TERMS;
    const { error } = await sb.rpc('terms_accept', { p_version: T.version, p_surface: 'admin' });
    if (error) return toast(sqlMsg(error.message), true);
    NX.store.set('termsSeen', T.version); toast('✓ Thanks'); document.querySelector('.terms-ask')?.remove(); if (A.tab === 'terms') P.terms();
  }
  // Admins see the admin part once per version
  NX.termsCheck = async () => {
    const T = window.NexusTerms?.TERMS; if (!T || !A.user || NX.store.get('termsSeen') === T.version) return;
    const { data, error } = await sb.from('terms_acceptance').select('version').eq('user_id', A.user.id).eq('version', T.version).maybeSingle();
    if (error || data) { if (data) NX.store.set('termsSeen', T.version); return; }
    const adminSec = T.sections.find(s => s.id === 'admins');
    const { el, close } = NX.modal(`<h3>📜 Terms for admins and moderators</h3><p class="muted">Before using Apoji Admin, please read and agree to the Terms & Conditions (version ${esc(T.version)}). The part about admins:</p>
      <div class="terms-card terms-ask">${window.NexusTerms.toHTML({ sections: [adminSec] })}</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="taAll">Read all the terms</button><span class="sp"></span><button class="btn primary" id="taOk">I agree</button></div>`);
    el.querySelector('#taAll').onclick = () => { close(); NX.go('terms'); };
    el.querySelector('#taOk').onclick = async () => { await accept(); close(); };
  };
})();
