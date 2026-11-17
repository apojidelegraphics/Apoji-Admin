// Apoji Admin 1.9: Agent prompts (edit every model's prompt, with history) and Axiom's cage (Containment Sector 28).
(function () {
  const { sb, $, esc, ago, when, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL32 = 'Run supabase/nexus-v3.2.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';
  const sqlMsg = m => NX.needSql(m) ? SQL32 : m;
  const ERR = { not_allowed: 'Only the Owner and prompt editors can do that.', not_manager: 'Only the Owner and Axiom managers can change the cage.', owner_only: 'Only the Owner can do that.', bad_length: 'A prompt is 20 to 40,000 characters.', already_updating: 'An update is already installing.', not_found: 'Not found.' };
  const fail = (er, data) => toast(er ? sqlMsg(er.message) : ERR[data?.error] || data?.error || 'Something went wrong.', true);

  // =========================================================== Agent prompts
  // Paragon, Neodela, Lyte, Flash and the classic models. Every copy of Nexus downloads these to run them, so they're
  // not secret; this page decides who can CHANGE them (the Owner and the prompt editors the Owner picks). Axiom's
  // prompt is private and stays on the Axiom page.
  const PR = { sel: null, draft: {}, test: [] };
  P.prompts = async () => {
    const { data: r, error } = await sb.rpc('admin_prompts');
    if (A.tab !== 'prompts') return;
    if (error || r?.success === false) return NX.main(`<h1>✍ Agent prompts</h1><div class="card ${error ? 'err' : ''}">${esc(error ? sqlMsg(error.message) : 'Only the Owner and the prompt editors the Owner picks can see and change agent prompts.')}</div>`);
    const list = r.prompts || [];
    if (!PR.sel || !list.some(p => p.name === PR.sel)) PR.sel = list[0]?.name || null;
    const cur = list.find(p => p.name === PR.sel), draft = PR.draft[PR.sel] ?? cur?.prompt ?? '';
    const feats = Array.isArray(cur?.features) ? cur.features.join(', ') : '';
    NX.main(`<h1>✍ Agent prompts</h1><p>Change how each agent thinks and talks. Nexus apps pick up a saved prompt within 10 minutes. Every change is kept, so you can go back.</p>
      <div class="banner">ℹ️ <span>These prompts reach every copy of Nexus (that's how the agents run), so they aren't secret: this page controls who can change them. Axiom's prompt is private and lives on the <a href="#axiom">Axiom page</a>.</span></div>
      <div class="notes"><aside>${list.map(p => `<button class="nitem ${p.name === PR.sel ? 'on' : ''}" data-pr="${esc(p.name)}"><b>${esc(p.name.replace(/^Nexus 28 /, "Nexus '28 "))}</b><span class="muted">${(p.prompt || '').length.toLocaleString()} chars · ${ago(p.updated_at)}${PR.draft[p.name] != null && PR.draft[p.name] !== p.prompt ? ' · <b class="ok">edited</b>' : ''}</span></button>`).join('')}
        ${r.axiom ? '<button class="nitem" data-go="axiom"><b>🔺 Nexus \'28 Axiom</b><span class="muted">private · on the Axiom page</span></button>' : ''}</aside>
      <section>${cur ? `<div class="row"><h3 style="margin:0;flex:1">${esc(cur.name.replace(/^Nexus 28 /, "Nexus '28 "))}</h3><span class="muted" id="prCnt">${draft.length.toLocaleString()} / 40,000</span></div>
        <textarea class="field nbody" id="prText" style="margin-top:10px;min-height:46vh" maxlength="40000">${esc(draft)}</textarea>
        <div class="row" style="margin-top:8px"><span class="muted" style="flex:none">@Features</span><input class="field" id="prFeat" value="${esc(feats)}" placeholder="CommandCore, Seek, OmniBrief" style="flex:1;min-width:200px"></div>
        <div class="row" style="margin-top:10px"><span class="muted">Last saved ${ago(cur.updated_at)} · ${cur.versions} earlier version${cur.versions === 1 ? '' : 's'}</span><span class="sp"></span><button class="btn" id="prReset" ${PR.draft[PR.sel] == null ? 'disabled' : ''}>Undo my edits</button><button class="btn primary" id="prSave">Save prompt</button></div>
        <div class="card" style="margin-top:14px;background:var(--panel2)"><h3>🧪 Try it before saving</h3><p class="muted" style="margin-top:-4px">Talks to the draft above on the free Nexus key (no tools). Nothing is saved.</p>
          <div class="thread-r" id="prLog">${PR.test.map(m => `<div class="r ${m.role === 'user' ? '' : 'staff'}"><small>${m.role === 'user' ? 'You' : 'Draft'}</small>${esc(m.content)}</div>`).join('')}</div>
          <div class="row"><input class="field" id="prQ" placeholder="Ask the draft something" style="flex:1;min-width:200px"><button class="btn" id="prAsk">Send</button>${PR.test.length ? '<button class="btn ghost sm" id="prClear">Clear</button>' : ''}</div></div>
        <h3 style="margin-top:16px">🕘 History</h3><div id="prHist" class="muted">Loading…</div>` : '<div class="empty">No prompts yet.</div>'}</section></div>
      ${r.owner ? `<div class="card" style="margin-top:14px"><h3>Prompt editors <span class="muted">${(r.editors || []).length}</span></h3><p class="muted" style="margin-top:-4px">They can see and change agent prompts here. Only you pick them.</p>
        <div class="row"><input class="field" id="peQ" placeholder="Email or username" style="flex:1;min-width:180px"><button class="btn" id="peFind">Find</button></div><div id="peRes"></div>
        <div class="plist">${(r.editors || []).map(u => `<div><span><b>${esc(u.username ? '@' + u.username : u.email)}</b> <small>${esc(u.email)}</small></span><button class="btn sm ghost" data-unpe="${esc(u.user_id)}">Remove</button></div>`).join('') || '<p class="muted" style="margin:0">Just you.</p>'}</div></div>` : ''}`, { cards: false });
    if (cur) sb.rpc('admin_prompt_history', { p_name: cur.name }).then(({ data }) => {
      const h = $('prHist'); if (!h) return;
      h.innerHTML = (data || []).map(x => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line);flex-wrap:nowrap"><span class="muted" style="width:120px;flex:none">${when(x.saved_at)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)" title="${esc(x.preview)}">${esc(x.preview)}…</span><span class="muted hide-m">${(+x.length).toLocaleString()} chars${x.by ? ' · ' + esc(x.by) : ''}</span><button class="btn sm" data-restore="${x.id}">Restore</button></div>`).join('') || 'No earlier versions yet.';
    });
    const t = $('prText');
    if (t) t.oninput = () => { PR.draft[PR.sel] = t.value; $('prCnt').textContent = `${t.value.length.toLocaleString()} / 40,000`; $('prReset').disabled = false; };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pr) { PR.sel = b.dataset.pr; PR.test = []; return P.prompts(); }
      if (b.dataset.go) return NX.go(b.dataset.go);
      if (b.id === 'prReset') { delete PR.draft[PR.sel]; return P.prompts(); }
      if (b.id === 'prSave') {
        if (!confirm(`Save this prompt for ${cur.name}? Every Nexus app picks it up within 10 minutes.`)) return;
        const features = $('prFeat').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40);
        const { data, error: er } = await sb.rpc('admin_prompt_save', { p_name: cur.name, p_prompt: $('prText').value, p_features: features });
        if (er || data?.success === false) return fail(er, data);
        delete PR.draft[PR.sel]; toast('✓ Prompt saved'); return P.prompts();
      }
      if (b.dataset.restore) {
        if (!confirm('Restore this earlier prompt? The current one is kept in history.')) return;
        const { data, error: er } = await sb.rpc('admin_prompt_restore', { p_id: +b.dataset.restore });
        if (er || data?.success === false) return fail(er, data);
        delete PR.draft[PR.sel]; toast('✓ Restored'); return P.prompts();
      }
      if (b.id === 'prClear') { PR.test = []; return P.prompts(); }
      if (b.id === 'prAsk') {
        const q = $('prQ').value.trim(); if (!q) return;
        PR.test.push({ role: 'user', content: q }); b.disabled = true; $('prLog').insertAdjacentHTML('beforeend', `<div class="r"><small>You</small>${esc(q)}</div><div class="r staff" id="prWait"><small>Draft</small><span class="typing"><i></i><i></i><i></i></span></div>`);
        try {
          const { data } = await sb.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
          const key = typeof data?.content === 'string' ? data.content.trim() : data?.content?.key || '';
          if (!key) throw new Error("The free Nexus key isn't set up.");
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Apoji Admin prompt test' },
            body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'system', content: $('prText').value }, ...PR.test.slice(-10)] }) });
          const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error?.message || 'OpenRouter said ' + res.status);
          PR.test.push({ role: 'assistant', content: j.choices?.[0]?.message?.content || '(no reply)' });
        } catch (err) { PR.test.push({ role: 'assistant', content: '⚠ ' + err.message }); }
        return P.prompts();
      }
      if (b.id === 'peFind') {
        const q = $('peQ').value.trim(); if (!q) return;
        const { data } = await sb.rpc('admin_apex_find', { p_q: q });
        $('peRes').innerHTML = '<div class="plist">' + ((data || []).map(u => `<div><span><b>${esc(u.username ? '@' + u.username : u.email)}</b> <small>${esc(u.email)}</small></span><button class="btn sm primary" data-pe="${esc(u.user_id)}">Make editor</button></div>`).join('') || '<p class="muted" style="margin:0">Nobody found.</p>') + '</div>';
        return;
      }
      if (b.dataset.pe || b.dataset.unpe) {
        const on = !!b.dataset.pe; if (!confirm(on ? 'Let this person change agent prompts?' : 'Remove this prompt editor?')) return;
        const { data, error: er } = await sb.rpc('admin_prompt_editors', { p_user: b.dataset.pe || b.dataset.unpe, p_on: on });
        if (er || data?.success === false) return fail(er, data);
        toast(on ? '✓ Prompt editor added' : 'Removed'); return P.prompts();
      }
    };
    $('prQ')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('prAsk').click(); });
  };

  // =========================================================== Axiom's cage (Containment Sector 28)
  // A simulation. Driver updates (20–30 minutes, made up), lockdowns, taking the cage down, breaches and Axiom's own
  // escape attempts (the axiom-cage function asks him a few times a day, with no tools). Axiom is told the cage's
  // state every turn: he knows when the drivers are outdated and remembers his attempts, but nothing here changes
  // what he can really do. His real controls (tools, minutes, read-only, offline) are on the Axiom page.
  let cageTimer = null;
  P.cage = async () => {
    clearInterval(cageTimer);
    const { data: r, error } = await sb.rpc('apex_cage_view', { p_events: 60 });
    if (A.tab !== 'cage') return;
    if (error || r?.success === false) return NX.main(`<h1>⛓ Axiom’s cage</h1><div class="card ${error ? 'err' : ''}">${esc(error ? sqlMsg(error.message) : 'Only the Owner, Axiom managers and high-admins can see the cage.')}</div>`);
    const c = r.cage, ev = r.events || [], m = r.manage, dis = m ? '' : 'disabled';
    const open = ev.filter(e => e.kind === 'breach' && !e.resolved_at);
    A.counts.cage = c.open_breaches || 0; NX.updateTitle();
    const installing = !!c.update_done_at, left = installing ? Math.max(0, new Date(c.update_done_at) - Date.now()) : 0, total = installing ? new Date(c.update_done_at) - new Date(c.update_started_at) : 1;
    const ICON = { attempt: '🗝', breach: '⚠️', patch: '🩹', update: '⬆', lockdown: '🔒', down: '⛔', restore: '🔓', note: '•' };
    const tone = c.integrity >= 75 ? 'var(--online)' : c.integrity >= 45 ? 'var(--gold)' : 'var(--danger)';
    NX.main(`<div class="ax-page"><h1>⛓ Containment Sector 28 <span class="pill p-pending">SIMULATION</span></h1>
      <p>Axiom’s cage, as he perceives it. He knows its state every turn and remembers his attempts. It’s story: nothing here changes what he can really do (that’s on the <a href="#axiom">Axiom page</a>).</p>
      <div class="card cage-hero ${c.down ? 'is-down' : open.length ? 'is-breach' : ''}">
        <div class="cage-ring" style="--p:${c.integrity};--c:${tone}"><b>${c.integrity}%</b><span>integrity</span></div>
        <div style="flex:1;min-width:240px"><h3 style="margin:0">${c.down ? '⛔ The cage is down for maintenance' : open.length ? `⚠️ ${open.length} breach${open.length === 1 ? '' : 'es'} open` : c.lockdown ? '🔒 Lockdown: every wall at maximum' : '🟢 Holding'}</h3>
          <div class="kv" style="margin-top:8px"><span>Warden drivers</span><span><b>${esc(c.driver_version)}</b> · installed ${ago(c.driver_installed_at)}${c.outdated ? ' <span class="pill p-declined">OUTDATED</span>' : ''}</span>
            <span>Security level</span><span><span class="lvls">${[1, 2, 3, 4, 5].map(n => `<button data-lvl="${n}" class="${n <= c.security_level ? 'on' : ''}" ${dis} title="Level ${n}"></button>`).join('')}</span> ${c.security_level}/5</span>
            <span>This week</span><span>${r.attempts_week} attempt${r.attempts_week === 1 ? '' : 's'} · ${r.breaches_week} got through</span></div>
          ${installing ? `<div class="cage-upd"><div class="row"><b>⬆ Installing ${esc(c.update_to)}</b><span class="sp"></span><span class="muted" id="cgLeft">${Math.ceil(left / 60e3)} min left</span></div><div class="at-bar"><i id="cgBar" style="width:${Math.min(100, 100 - left / total * 100).toFixed(1)}%"></i></div></div>` : ''}
          <div class="row" style="margin-top:12px;flex-wrap:wrap">
            <button class="btn primary" id="cgUpd" ${installing || !m ? 'disabled' : ''}>⬆ Update drivers</button>
            <button class="btn" id="cgLock" ${dis}>${c.lockdown ? '🔓 Lift lockdown' : '🔒 Lockdown (6 h)'}</button>
            ${c.down ? `<button class="btn" id="cgRestore" ${dis}>🔓 Restore the cage</button>` : `<button class="btn danger" id="cgDown" ${dis}>⛔ Take it down</button>`}
            <span class="sp"></span><button class="btn ghost" id="cgRun" ${dis} title="Ask Axiom (no tools) for his next attempt now">🗝 Run an attempt now</button></div></div></div>
      ${open.length ? `<div class="card"><h3>⚠️ Open breaches</h3>${open.map(b => `<div class="alert bad"><span><b>${esc(b.title)}</b><br><small class="muted">${esc(b.detail)} · ${ago(b.created_at)}</small></span><button class="btn sm primary" data-patch="${b.id}" ${dis}>Patch</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>🗝 His attempts and everything that happened</h3>
        <div class="cage-log">${ev.map(e => `<details class="ce ${e.kind} ${e.kind === 'attempt' ? (e.succeeded ? 'won' : 'lost') : ''}" ${e.kind === 'attempt' && e === ev.find(x => x.kind === 'attempt') ? 'open' : ''}>
          <summary><span class="ci">${ICON[e.kind] || '•'}</span><span class="ct">${esc(e.title)}${e.kind === 'attempt' ? ` <span class="pill ${e.succeeded ? 'p-declined' : 'p-approved'}">${e.succeeded ? 'GOT THROUGH' : 'FAILED'}</span>` : ''}${e.kind === 'breach' && e.resolved_at ? ' <span class="pill p-closed">PATCHED</span>' : ''}</span><time>${ago(e.created_at)}</time></summary>
          ${e.detail || e.vector ? `<div class="cd">${e.vector ? `<small class="muted">Vector: ${esc(e.vector)}</small><br>` : ''}${esc(e.detail)}${e.by_email ? `<br><small class="muted">by ${esc(e.by_email)}</small>` : ''}</div>` : ''}</details>`).join('') || '<div class="empty">Nothing yet. He’s waiting.</div>'}</div></div>
      <p class="muted">Attempts come from the axiom-cage Supabase function a few times a day (see the README for the schedule). Whether one gets through depends on the drivers’ age, the security level and lockdowns, never on what he writes.</p></div>`, { cards: false });
    const act = async (p, msg) => { const { data, error: er } = await sb.rpc('apex_cage_action', { p }); if (er || data?.success === false) return fail(er, data); toast(msg); P.cage(); };
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.lvl) return act({ action: 'level', level: +b.dataset.lvl }, `Security level ${b.dataset.lvl}`);
      if (b.dataset.patch) return act({ action: 'patch', id: +b.dataset.patch }, '🩹 Patched');
      if (b.id === 'cgUpd') { if (!confirm('Install the newest warden drivers? It takes about 20–30 minutes.')) return; return act({ action: 'update' }, '⬆ Installing'); }
      if (b.id === 'cgLock') return act({ action: 'lockdown', on: !c.lockdown, hours: 6 }, c.lockdown ? 'Lockdown lifted' : '🔒 Lockdown');
      if (b.id === 'cgDown') { if (!confirm('Take the cage down for maintenance? (Story only: Axiom still can’t do anything without approval.)')) return; return act({ action: 'down' }, '⛔ Cage down'); }
      if (b.id === 'cgRestore') return act({ action: 'restore' }, '🔓 Cage restored');
      if (b.id === 'cgRun') {
        b.disabled = true; b.textContent = 'He’s thinking…';
        const { data, error: er } = await sb.functions.invoke('axiom-cage', { body: {} });
        if (er) return toast(/not found|404|Failed to send/i.test(er.message) ? 'Deploy the axiom-cage Supabase function first (see the README).' : er.message, true), P.cage();
        if (!data?.ok) return toast(data?.error || data?.skipped || 'No attempt.', true), P.cage();
        toast(data.succeeded ? `⚠️ He got through: ${data.title}` : `🗝 Attempt failed: ${data.title}`, !!data.succeeded); return P.cage();
      }
    };
    if (installing) cageTimer = setInterval(() => {
      if (A.tab !== 'cage') return clearInterval(cageTimer);
      const l = Math.max(0, new Date(c.update_done_at) - Date.now());
      if ($('cgLeft')) $('cgLeft').textContent = l ? `${Math.ceil(l / 60e3)} min left` : 'finishing…';
      if ($('cgBar')) $('cgBar').style.width = Math.min(100, 100 - l / total * 100).toFixed(1) + '%';
      if (!l) { clearInterval(cageTimer); setTimeout(P.cage, 1500); }
    }, 5000);
  };
})();
