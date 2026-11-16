// Apoji Admin 1.8: access requests (Axiom, early features, beta, anything else) and Nexus chat inside the portal.
// Requests are made from Nexus (Settings → Account → Request access) and N28C. Only the Owner and the Axiom managers the
// Owner picked can accept or deny them; high-admins can look.
(function () {
  const { sb, $, esc, ago, when, toast, av, rpc } = NX;
  const A = NX.A, P = NX.pages;
  const SQL31 = 'Run supabase/nexus-v3.1.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';

  // =========================================================== Access requests
  const KIND = { axiom: ['🔺', 'Axiom'], feature: ['⚑', 'Early feature'], beta: ['🧪', 'Beta testing'], other: ['✋', 'Something else'] };
  let flagTitles = null;
  const what = r => { const [ic, l] = KIND[r.kind] || KIND.other; const t = r.kind === 'feature' ? (flagTitles?.[r.target] || r.target) : r.kind === 'other' ? r.target : ''; return `${ic} <b>${esc(l)}</b>${t ? ': ' + esc(t) : ''}`; };
  P.access = async () => {
    const f = A.accessFilter || 'pending';
    if (!flagTitles) { const { data } = await sb.from('feature_flags').select('key,title'); flagTitles = Object.fromEntries((data || []).map(x => [x.key, x.title || x.key])); }
    const { data: r, error } = await sb.rpc('admin_access_requests', { p_status: f });
    if (A.tab !== 'access') return;
    if (error || r?.success === false) return NX.main(`<h1>🔑 Access requests</h1><div class="card ${error ? 'err' : ''}">${esc(error ? (NX.needSql(error.message) ? SQL31 : error.message) : 'Only the Owner, Axiom managers and high-admins can see access requests.')}</div>`);
    const list = r.requests || [], can = !!r.can_review;
    NX.main(`<h1>🔑 Access requests</h1><p>People asking for Axiom, an early feature, beta testing or something else, from Nexus or N28C. ${can ? 'Approving gives it to them straight away.' : 'Only the Owner and Axiom managers can answer these; you can look.'}</p>
      <div class="tabsub" id="arF">${[['pending', 'Waiting'], ['approved', 'Approved'], ['denied', 'Denied'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}${k === 'pending' && A.counts.access ? `<b>${A.counts.access}</b>` : ''}</button>`).join('')}</div>
      ${list.length ? list.map(x => `<div class="card areq">${av({ id: x.user_id, nickname: x.nickname || x.username, email: x.email })}
        <div style="min-width:0"><div class="row" style="gap:8px"><b>${esc(x.nickname || x.username || x.email.split('@')[0])}</b><span class="muted">${esc(x.email)}</span>${x.status !== 'pending' ? `<span class="pill p-${x.status === 'approved' ? 'approved' : 'declined'}">${x.status.toUpperCase()}</span>` : ''}</div>
          <div style="margin-top:4px">${what(x)}</div>${x.note ? `<q class="quote muted" style="margin-top:4px">${esc(x.note)}</q>` : ''}
          <div class="muted" style="margin-top:4px">${ago(x.created_at)} · from ${esc(x.source === 'phone' ? 'N28C' : x.source === 'web' ? 'the web' : 'Nexus for Mac')}${x.reviewed_at ? ` · answered ${ago(x.reviewed_at)}` : ''}${x.review_note ? ` · “${esc(x.review_note)}”` : ''}</div></div>
        <div class="acts">${x.status === 'pending' && can ? `<button class="btn primary" data-ok="${x.id}">Approve</button><button class="btn danger" data-no="${x.id}">Deny</button>` : ''}
          ${x.status === 'approved' && can && x.kind === 'feature' ? `<button class="btn sm" data-revoke="${esc(x.user_id)}" data-flag="${esc(x.target)}">Take it back</button>` : ''}
          <button class="btn sm ghost" data-user="${esc(x.user_id)}">Profile</button></div></div>`).join('') : `<div class="empty">${f === 'pending' ? 'Nobody is waiting. 🎉' : 'Nothing here.'}</div>`}`);
    $('main').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.f) { A.accessFilter = b.dataset.f; return P.access(); }
      if (b.dataset.user) return NX.userDrawer(b.dataset.user);
      const x = list.find(q => q.id === +(b.dataset.ok || b.dataset.no));
      try {
        if (b.dataset.ok) {
          const extra = x.kind === 'axiom' ? 'They can use Axiom right away (Axiom → Select people).' : x.kind === 'feature' ? `They get ${flagTitles?.[x.target] || x.target} even before it's out for everyone.` : x.kind === 'beta' ? 'They become a beta tester.' : 'Nothing changes by itself: do what they asked, then approve so they know.';
          const note = await NX.ask(`Approve ${x.username ? '@' + x.username : x.email}?`, { note: extra, placeholder: 'Message for them (optional)', ok: 'Approve' }); if (note === null) return;
          await rpc('admin_review_access', { p_id: x.id, p_approve: true, p_note: note.trim() }); toast('✓ Approved');
        } else if (b.dataset.no) {
          const note = await NX.ask(`Deny ${x.username ? '@' + x.username : x.email}?`, { placeholder: 'Why (optional, they see it)', ok: 'Deny', danger: true }); if (note === null) return;
          await rpc('admin_review_access', { p_id: x.id, p_approve: false, p_note: note.trim() }); toast('Denied');
        } else if (b.dataset.revoke) {
          if (!confirm('Take this feature back from them?')) return;
          await rpc('admin_revoke_grant', { p_user: b.dataset.revoke, p_flag: b.dataset.flag }); toast('✓ Taken back');
        } else return;
        NX.refreshCounts(); P.access();
      } catch (err) { toast(err.message, true); }
    };
    NX.on('access_requests', () => { if (A.tab === 'access' && !document.querySelector('.modal')) P.access(); });
  };

  // =========================================================== Nexus chat
  // Chat with Nexus without the Mac app open. Uses the agent and model you last used in Nexus '28 (from your Mac's phone
  // link), the free Nexus key, and keeps the chats in this browser. Tools and @Features need the Mac: when it's on, a
  // message goes to it (like N28C) and the Mac answers with everything it has; when it's off you can hand a message
  // over and the Mac picks it up when it wakes.
  const OR = 'https://openrouter.ai/api/v1/chat/completions';
  const NC = { convs: NX.store.get('nexus-chats', []), open: null, status: null, statusAt: 0, busy: false, key: null, apex: null, list: false };
  const saveConvs = () => NX.store.set('nexus-chats', NC.convs.slice(0, 40).map(c => ({ ...c, messages: c.messages.slice(-60) })));
  const macOn = () => NC.status && Date.now() - NC.statusAt < 4 * 60e3;
  const isFree = id => id === 'openrouter/free' || /:free$/i.test(String(id || ''));
  async function loadStatus() {
    const { data } = await sb.from('companion_sync').select('data,updated_at').eq('user_id', A.user.id).eq('key', 'status').maybeSingle();
    NC.status = data?.data || null; NC.statusAt = data ? new Date(data.updated_at).getTime() : 0;
    return NC.status;
  }
  async function freeKey() {
    if (NC.key) return NC.key;
    const { data } = await sb.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
    const k = typeof data?.content === 'string' ? data.content.trim() : data?.content?.key || '';
    return (NC.key = k || null);
  }
  const agents = () => (NC.status?.agents || []).filter(a => !a.legacy && (!a.apex || NC.apex?.allowed));
  const last = () => NC.status?.lastUsed || {};
  const agentOf = c => agents().find(a => a.id === c.agent) || agents().find(a => a.id === last().agent) || agents()[0] || { id: 'nexus', name: 'Nexus', color: '#9a80ff' };
  const md = s => esc(s).replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre>${c}</pre>`).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  function newConv() { const a = agentOf({}); const c = { id: 'c' + Date.now().toString(36), title: 'New chat', agent: a.id, messages: [], at: Date.now() }; NC.convs.unshift(c); NC.open = c.id; saveConvs(); return c; }
  const conv = () => NC.convs.find(c => c.id === NC.open) || null;

  P.nexus = async () => {
    NX.main('<h1>◆ Nexus chat</h1><p><span class="spinner"></span> Connecting…</p>', { cards: false });
    await Promise.all([loadStatus().catch(() => null), sb.rpc('apex_session').then(r => { NC.apex = r.data || null; }, () => { NC.apex = null; })]);
    if (A.tab !== 'nexus') return;
    if (!conv()) NC.open = NC.convs[0]?.id || newConv().id;
    paint();
    // replies from the Mac arrive through the relay (same as N28C); one listener for the whole session
    if (!NC.chan) NC.chan = sb.channel('nexus-relay-' + A.user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'relay_messages', filter: `user_id=eq.${A.user.id}` }, p => onRelay(p.new)).subscribe();
    clearInterval(NC.poll);
    NC.poll = setInterval(() => { if (A.tab !== 'nexus') return clearInterval(NC.poll); pollPending(); loadStatus().then(() => paintTop()).catch(() => {}); }, 6000);
  };
  function paintTop() {
    const c = conv(), a = agentOf(c || {}), on = macOn();
    const el = document.querySelector('.nxc .top'); if (!el) return;
    el.innerHTML = `<button class="btn sm hide-d" id="ncList" title="Chats">☰</button><span class="gav" style="--c:${esc(a.color || 'var(--accent)')}">${esc((String(a.name || 'N').replace(/^Nexus '28 /, '')[0] || 'N'))}</span>
      <div class="who"><b>${esc(a.name || 'Nexus')}</b><small>${on ? 'Your Mac answers, with every tool and @Feature' : `Free Nexus key · ${esc(isFree(last().model) ? last().model : 'openrouter/free')} · no tools`}</small></div>
      <select class="field" id="ncAgent" title="Agent">${agents().map(x => `<option value="${esc(x.id)}" ${x.id === a.id ? 'selected' : ''}>${esc(x.name)}${x.apex ? ' 🔺' : ''}</option>`).join('') || '<option>Nexus</option>'}</select>
      <span class="mac-dot ${on ? 'on' : 'off'}" title="${on ? 'Your Mac is on and linked' : NC.status ? 'Your Mac was last seen ' + ago(NC.statusAt) : 'Turn on the phone link in Nexus (Settings → Phone) to hand off to your Mac'}">${on ? '● Mac on' : '○ Mac off'}</span>`;
  }
  function paint() {
    const c = conv();
    NX.main(`<h1>◆ Nexus chat</h1><p>Talk to Nexus from here, even when the Mac app is closed.</p>
      <div class="nxc ${NC.list ? 'list' : ''}"><aside><button class="btn primary" id="ncNew" style="margin-bottom:6px">＋ New chat</button>
        ${NC.convs.map(x => `<button class="cv ${x.id === NC.open ? 'on' : ''}" data-cv="${esc(x.id)}"><span>${esc(x.title)}</span><small>${esc(agentOf(x).name || '')} · ${ago(x.at)}</small></button>`).join('')}
        <p class="muted" style="margin:auto 6px 4px;font-size:11.5px">Chats here are kept in this browser only.</p></aside>
      <section><div class="top"></div><div class="log" id="ncLog"></div>
        <div class="cmp"><textarea class="field" id="ncIn" rows="1" placeholder="Message ${esc(agentOf(c || {}).name || 'Nexus')}…"></textarea><button class="btn primary" id="ncSend" style="height:42px">Send</button></div></section></div>`, { cards: false });
    paintTop(); paintLog();
    const inp = $('ncIn');
    inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.min(160, inp.scrollHeight) + 'px'; };
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('main').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'ncSend') return send();
      if (b.id === 'ncNew') { newConv(); NC.list = false; return paint(); }
      if (b.id === 'ncList') { NC.list = !NC.list; return paint(); }
      if (b.dataset.cv) { NC.open = b.dataset.cv; NC.list = false; return paint(); }
      if (b.dataset.handoff) return handoff(+b.dataset.handoff);
      if (b.dataset.copy) { navigator.clipboard?.writeText(conv().messages[+b.dataset.copy].content); return toast('Copied'); }
      if (b.dataset.del) { if (!confirm('Delete this chat from this browser?')) return; NC.convs = NC.convs.filter(x => x.id !== NC.open); NC.open = NC.convs[0]?.id || null; saveConvs(); return P.nexus(); }
    };
    $('main').onchange = e => { if (e.target.id === 'ncAgent') { const cv = conv(); cv.agent = e.target.value; saveConvs(); paintTop(); $('ncIn').placeholder = `Message ${agentOf(cv).name}…`; } };
  }
  function paintLog() {
    const c = conv(), log = $('ncLog'); if (!log || !c) return;
    log.innerHTML = c.messages.length ? c.messages.map((m, i) => `<div class="bub ${m.role === 'user' ? 'me' : 'ai'} ${m.error ? 'err' : ''}">${m.pending ? '<span class="typing"><i></i><i></i><i></i></span>' : md(m.content)}
      ${m.role !== 'user' && !m.pending ? `<div class="meta">${esc(m.via || '')}<button data-copy="${i}">Copy</button>${m.via !== 'Your Mac' ? `<button data-handoff="${i}" title="Send the question before this answer to your Mac, so it can use tools and @Features">➤ Hand off to my Mac</button>` : ''}</div>` : ''}</div>`).join('')
      + `<div class="row" style="justify-content:center"><button class="btn sm ghost" data-del="1">Delete chat</button></div>`
      : `<div class="empty">Ask anything. ${macOn() ? 'Your Mac is on, so it answers with all its tools.' : 'Your Mac is off: answers come from the free Nexus key. Need a tool (calendar, files, Axiom’s kits)? Use “Hand off to my Mac”.'}</div>`;
    log.scrollTop = log.scrollHeight;
  }
  async function send() {
    const inp = $('ncIn'), text = inp.value.trim(); if (!text || NC.busy) return;
    const c = conv(); inp.value = ''; inp.style.height = '';
    c.messages.push({ role: 'user', content: text, at: Date.now() }); c.at = Date.now();
    if (c.title === 'New chat') c.title = text.slice(0, 48);
    const a = agentOf(c);
    if (a.apex && !NC.apex?.allowed) { c.messages.push({ role: 'assistant', content: 'Axiom isn’t available to your account.', error: true, via: '' }); saveConvs(); return paintLog(); }
    if (macOn()) return relayAsk(c, text, a);
    const reply = { role: 'assistant', content: '', pending: true, at: Date.now() }; c.messages.push(reply); paintLog(); NC.busy = true;
    try {
      const key = await freeKey(); if (!key) throw new Error("The free Nexus key isn't set up. Hand this off to your Mac instead.");
      const model = isFree(last().model) ? last().model : 'openrouter/free';
      let sys = `You are ${a.name || 'Nexus'}, an assistant in Nexus '28 by Apoji Delegraphics. You're answering in Apoji Admin's Nexus chat, without the Mac app's tools: if something needs the user's files, calendar, Mac apps or live tools, say so and suggest "Hand off to my Mac".`;
      if (a.about) sys += '\n\nAbout you: ' + a.about;
      const t0 = Date.now();
      if (a.apex) { const { data: s } = await sb.rpc('apex_session'); if (!s?.allowed || !s.prompt) throw new Error(s?.exhausted ? 'You’ve used your Axiom minutes this week.' : 'Axiom isn’t available right now.'); sys = s.prompt; }
      const res = await fetch(OR, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://apojidelegraphics.github.io/Apoji-Admin/', 'X-Title': 'Apoji Admin' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, ...c.messages.filter(m => !m.pending && !m.error).slice(-16).map(m => ({ role: m.role, content: m.content }))] }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message || 'OpenRouter said ' + res.status);
      Object.assign(reply, { content: j.choices?.[0]?.message?.content || '(no reply)', pending: false, via: `Free key · ${j.model || model}` });
      if (a.apex) sb.rpc('apex_log', { p_seconds: Math.max(1, Math.round((Date.now() - t0) / 1000)), p_kind: 'chat', p_provider: 'openrouter', p_model: String(j.model || model).slice(0, 120) }).then(() => {}, () => {});
    } catch (e) { Object.assign(reply, { content: e.message, pending: false, error: true, via: '' }); }
    finally { NC.busy = false; saveConvs(); if (A.tab === 'nexus') paintLog(); }
  }
  // To the Mac, through the relay (exactly what N28C does). The Mac answers with its full toolset and the same chat.
  async function relayAsk(c, text, a, handed = false) {
    const reply = { role: 'assistant', content: '', pending: true, at: Date.now(), via: 'Your Mac' }; c.messages.push(reply); paintLog();
    const { data, error } = await sb.from('relay_messages').insert({ direction: 'to_desktop', kind: 'ask', agent: a.id, content: text.slice(0, 8000), meta: { from: 'portal', ...(c.macConv ? { convId: c.macConv } : {}) } }).select('id').single();
    if (error) { Object.assign(reply, { content: error.message, pending: false, error: true }); saveConvs(); return paintLog(); }
    reply.relayId = data.id; saveConvs();
    if (handed && !macOn()) { reply.pending = false; reply.content = '➤ Handed off. Your Mac will answer when it’s on (the answer shows up here and in Nexus).'; reply.waiting = true; saveConvs(); paintLog(); }
  }
  function handoff(i) {
    const c = conv(), q = [...c.messages.slice(0, i)].reverse().find(m => m.role === 'user'); if (!q) return;
    relayAsk(c, q.content, agentOf(c), true);
  }
  function onRelay(row) {
    if (!row || row.direction !== 'to_phone' || !['reply', 'error'].includes(row.kind)) return;
    for (const c of NC.convs) {
      const m = c.messages.find(x => x.relayId === row.reply_to); if (!m) continue;
      Object.assign(m, { content: row.content, pending: false, waiting: false, error: row.kind === 'error', via: 'Your Mac' + (row.meta?.model ? ' · ' + row.meta.model : '') });
      if (row.meta?.convId) c.macConv = row.meta.convId;
      sb.from('relay_messages').delete().in('id', [row.id, row.reply_to]).then(() => {}, () => {});
      saveConvs(); if (A.tab === 'nexus' && c.id === NC.open) paintLog();
    }
  }
  async function pollPending() {
    const ids = NC.convs.flatMap(c => c.messages.filter(m => (m.pending || m.waiting) && m.relayId).map(m => m.relayId)); if (!ids.length) return;
    const { data } = await sb.from('relay_messages').select('id,direction,kind,content,reply_to,meta').in('reply_to', ids);
    (data || []).forEach(onRelay);
  }
})();
