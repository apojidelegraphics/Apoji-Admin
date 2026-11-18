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
          <div class="muted" style="margin-top:4px">${ago(x.created_at)} · from ${esc(x.source === 'phone' ? 'N28C' : x.source === 'web' ? 'the web' : 'Nexus on Mac or PC')}${x.reviewed_at ? ` · answered ${ago(x.reviewed_at)}` : ''}${x.review_note ? ` · “${esc(x.review_note)}”` : ''}</div></div>
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

  // =========================================================== Nexus (1.9: lives in Team chat)
  // "◆ Nexus" is the first room in Team chat: your own chat with Nexus, even when the desktop app is closed. There's no
  // model picker: it always uses the agent and model you last chatted with in Nexus '28 (from your computer's phone link).
  // When your computer is on with the phone link, your computer answers with every tool; otherwise the free Nexus key answers and
  // "Hand off to my computer" queues the question for your computer. Chats are kept in this browser.
  // In any other room, @paragon / @neodela / @lyte / @flash (and @axiom for people allowed to use him) answer in the
  // room: the recent messages are decrypted here and sent to the model, and those messages are marked "sent to AI".
  const OR = 'https://openrouter.ai/api/v1/chat/completions';
  const DEFAULT_AGENTS = { paragon: ["Nexus '28 Paragon", '#5ce1ff'], neodela: ["Nexus '28 Neodela", '#b18cff'], lyte: ["Nexus '28 Lyte", '#7dffb2'], flash: ["Nexus '28 Flash", '#ffd36b'], axiom: ["Nexus '28 Axiom", '#ff3b4f'] };
  const NC = { convs: NX.store.get('nexus-chats', []), open: null, status: null, statusAt: 0, busy: false, key: null, apex: null, host: null, onBack: null, orbImg: '' };
  const saveConvs = () => NX.store.set('nexus-chats', NC.convs.slice(0, 40).map(c => ({ ...c, messages: c.messages.slice(-60) })));
  const macOn = () => NC.status && Date.now() - NC.statusAt < 4 * 60e3;
  const isFree = id => id === 'openrouter/free' || /:free$/i.test(String(id || ''));
  async function loadStatus() {
    if (!A.user) return null;
    const { data } = await sb.from('companion_sync').select('data,updated_at').eq('user_id', A.user.id).eq('key', 'status').maybeSingle();
    if (data) { NC.status = data.data || null; NC.statusAt = new Date(data.updated_at).getTime(); }
    return NC.status;
  }
  async function loadApex() { try { const { data } = await sb.rpc('apex_session'); NC.apex = data || null; } catch { NC.apex = null; } }
  async function freeKey() {
    if (NC.key) return NC.key;
    const { data } = await sb.from('app_content').select('content').eq('key', 'openrouter_api_key').maybeSingle();
    const k = typeof data?.content === 'string' ? data.content.trim() : data?.content?.key || '';
    return (NC.key = k || null);
  }
  function agentInfo(id) {
    const st = (NC.status?.agents || []).find(a => a.id === id), d = DEFAULT_AGENTS[id] || [id, '#9a80ff'];
    const name = st?.name || d[0];
    return { id, name, short: name.replace(/^Nexus '28 /, ''), color: st?.color || d[1], about: st?.about || '', apex: id === 'axiom' };
  }
  const canAxiom = () => !!NC.apex?.allowed;
  const mentionable = () => ['paragon', 'neodela', 'lyte', 'flash', ...(canAxiom() ? ['axiom'] : [])].map(agentInfo);
  // 2.0.2: follow the agent and model picked in Nexus right now (status.current), then the last one used
  const agentOk = id => id && (id !== 'axiom' || canAxiom()) && (DEFAULT_AGENTS[id] || (NC.status?.agents || []).some(a => a.id === id));
  const lastAgent = () => [NC.status?.current?.agent, NC.status?.lastUsed?.agent].find(agentOk) || 'paragon';
  const macModel = () => { const c = NC.status?.current, l = NC.status?.lastUsed; return c?.agent === lastAgent() && c.model ? c : l?.agent === lastAgent() && l.model ? l : c?.model ? c : l || null; };
  const lastModel = () => { const m = macModel(); return m && (m.provider === 'openrouter' || m.freeKey || !m.provider) && isFree(m.model) ? m.model : 'openrouter/free'; };
  const modelNote = () => { const m = macModel(), use = lastModel(); return !m?.model || m.model === use ? esc(use) : `${esc(use)} <span title="Nexus uses ${esc(m.model)} on your computer; that one isn't on the free key">(on your computer: ${esc(m.model)})</span>`; };
  const md = s => esc(s).replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre>${c}</pre>`).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  const conv = () => NC.convs.find(c => c.id === NC.open) || null;
  // 2.0.3: one continuous chat with Nexus, like a DM (older separate chats are merged into it, oldest first)
  function oneChat() {
    if (NC.convs.length === 1 && NC.convs[0].id === 'nexus') { NC.open = 'nexus'; return NC.convs[0]; }
    const all = NC.convs.flatMap(c => c.messages || []).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200);
    const macConv = NC.convs.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).find(c => c.macConv)?.macConv;
    NC.convs = [{ id: 'nexus', title: 'Nexus', messages: all, at: Date.now(), ...(macConv ? { macConv } : {}) }];
    NC.open = 'nexus'; saveConvs(); return NC.convs[0];
  }
  function newConv() { const c = { id: 'c' + Date.now().toString(36), title: 'New chat', messages: [], at: Date.now() }; NC.convs.unshift(c); NC.open = c.id; saveConvs(); return c; }

  // Your orb (your orb skin from Nexus, in the color of the agent you're using). 2.0.2: it moves, like in Nexus '28:
  // one small orb runs off-screen and every Nexus picture on the page (room list, header, messages) shows its frames.
  const ORB = { cv: null, o: null, key: '', raf: 0, last: 0 };
  function renderOrb() {
    if (!window.NexusOrb) return;
    const skin = lastAgent() === 'axiom' ? 'crucible' : NC.status?.theme?.skin || A.profile?.theme?.skin || 'aurora', color = agentInfo(lastAgent()).color, key = skin + color;
    if (ORB.key === key && ORB.o) return;
    ORB.o?.stop(); ORB.cv?.remove();
    const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); cv.style.cssText = 'width:72px;height:72px;position:fixed;left:-300px;top:0;pointer-events:none';
    document.body.appendChild(cv);
    ORB.cv = cv; ORB.key = key; ORB.o = window.NexusOrb.create(cv, { minimal: true, color, skin });
    NC.orbImg = 'live';
    document.querySelectorAll('.gav[data-nxorb-wait]').forEach(g => g.outerHTML = icon());
    if (!ORB.raf) ORB.raf = requestAnimationFrame(blit);
  }
  function blit(t) {
    ORB.raf = requestAnimationFrame(blit);
    if (t - ORB.last < 33 || document.hidden || !ORB.cv) return;     // ~30 fps is plenty for a 32px picture
    ORB.last = t;
    for (const c of document.querySelectorAll('canvas[data-nxorb]')) {
      const r = c.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      const px = Math.round(r.width * (devicePixelRatio || 1));
      if (c.width !== px) { c.width = px; c.height = px; }
      const g = c.getContext('2d'); g.clearRect(0, 0, px, px); g.drawImage(ORB.cv, 0, 0, px, px);
    }
  }
  const icon = () => NC.orbImg ? '<canvas class="nx-orb" data-nxorb width="64" height="64" aria-hidden="true"></canvas>' : `<span class="gav" data-nxorb-wait style="--c:${esc(agentInfo(lastAgent()).color)}">◆</span>`;
  const subtitle = () => { const c = NC.convs[0], l = c?.messages?.at(-1); return l ? `${l.role === 'user' ? 'You' : agentInfo(lastAgent()).short}: ${String(l.content).slice(0, 60)}` : `${agentInfo(lastAgent()).short} · ${macOn() ? 'Mac on' : 'free key'}`; };
  const mentioned = text => { const m = String(text || '').match(/(^|\s)@(paragon|neodela|lyte|flash|axiom)\b/i); if (!m) return null; const id = m[2].toLowerCase(); return id === 'axiom' && !canAxiom() ? null : id; };

  // Start: who you last chatted with, your orb (once signed in)
  const boot = setInterval(() => { if (A.user) { clearInterval(boot); Promise.all([loadStatus(), loadApex()]).finally(renderOrb); } }, 500);

  // ---------- the ◆ Nexus room
  async function mount(el, onBack) {
    NC.host = el; NC.onBack = onBack;
    oneChat();
    el.classList.add('nxc-room');
    // 2.0: same layout as every other room (top bar, message rows with avatars and times, the compose box)
    el.innerHTML = '<div class="top"></div><div class="msgs" id="ncLog"></div><div class="compose"><div class="box"><textarea class="field" id="ncIn" rows="1" maxlength="8000"></textarea><button class="btn primary" id="ncSend" style="height:42px">Send</button></div></div>';
    paint();
    await Promise.all([loadStatus().catch(() => null), loadApex()]);
    if (NC.host === el && el.isConnected) { paint(); renderOrb(); }
    if (!NC.chan) NC.chan = sb.channel('nexus-relay-' + A.user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'relay_messages', filter: `user_id=eq.${A.user.id}` }, p => onRelay(p.new)).subscribe();
    clearInterval(NC.poll);
    NC.poll = setInterval(() => { if (!NC.host?.isConnected) return clearInterval(NC.poll); pollPending(); loadStatus().then(() => { paintTop(); renderOrb(); }).catch(() => {}); }, 6000);
    const inp = el.querySelector('#ncIn');
    inp.oninput = () => { inp.style.height = 'auto'; inp.style.height = Math.max(42, Math.min(160, inp.scrollHeight)) + 'px'; };
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'ncSend') return send();
      if (b.id === 'ncBack') return NC.onBack?.();
      if (b.dataset.handoff) return handoff(+b.dataset.handoff);
      if (b.dataset.copy) { navigator.clipboard?.writeText(conv().messages[+b.dataset.copy].content); return toast('Copied'); }
      if (b.dataset.tools) { const row = b.closest('.m'); return row?.classList.toggle('tools-on'); }
      if (b.dataset.del) { if (!confirm('Clear your Nexus chat in this browser? (Your chats on your computer stay.)')) return; NC.convs = []; oneChat(); return paint(); }
    };
  }
  function paintTop() {
    const el = NC.host?.querySelector('.top'); if (!el) return;
    const a = agentInfo(lastAgent()), on = macOn();
    el.innerHTML = `<button class="btn sm back" id="ncBack">‹</button>${icon()}
      <div class="ti"><b>Nexus <span class="muted" style="font-weight:400">· ${esc(a.short)}</span></b><small>${on ? 'Your computer answers, with every tool and @Feature' : `Free Nexus key · ${modelNote()} · no tools`} · the agent and model you're using in Nexus</small></div>
      <span class="mac-dot ${on ? 'on' : 'off'}" title="${on ? 'Your computer is on and linked' : NC.status ? 'Your computer was last seen ' + ago(NC.statusAt) : 'Turn on the phone link in Nexus (Settings → Phone) to hand off to your computer'}">${on ? '● Mac on' : '○ Mac off'}</span>`;
  }
  function paint() { paintTop(); paintLog(); const i = NC.host?.querySelector('#ncIn'); if (i) i.placeholder = `Message ${agentInfo(lastAgent()).short}…`; }
  function paintLog() {
    const c = conv(), log = NC.host?.querySelector('#ncLog'); if (!log || !c) return;
    const a = agentInfo(lastAgent()), meAdmin = A.me || A.admins?.find(x => x.id === A.user?.id) || { id: A.user?.id, email: A.user?.email };
    const hm = t => new Date(t || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    let html = '', lastDay = '', prev = null;
    c.messages.forEach((m, i) => {
      const at = m.at || c.at || Date.now(), day = new Date(at).toDateString(), ai = m.role !== 'user';
      if (day !== lastDay) { html += `<div class="day">${day === new Date().toDateString() ? 'Today' : new Date(at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>`; lastDay = day; prev = null; }
      const cont = prev && prev.role === m.role && at - (prev.at || 0) < 5 * 60e3;
      const who = ai ? (m.agentName || a.name) : NX.nameOf(meAdmin);
      const avatar = ai ? (NC.orbImg ? '<canvas class="av nx-orb" data-nxorb width="64" height="64" aria-hidden="true"></canvas>' : `<span class="av" style="--c:${esc(m.agentColor || a.color)}">${esc((m.agentShort || a.short)[0])}</span>`) : NX.av(meAdmin);
      const canHand = ai && !m.pending && !/^Your computer/.test(m.via || '');
      html += `<div class="m ${cont ? 'cont' : ''} ${ai ? 'bot' : ''} ${m.error ? 'nx-err' : ''}">${avatar}
        <div class="mb"><div class="by"><b style="color:${ai ? esc(m.agentColor || a.color) : NX.colorOf(meAdmin.id)}">${esc(who)}</b>${ai ? '<span class="ai-tag">AI</span>' : ''}<time>${hm(at)}</time></div>
          <div class="tx">${m.pending ? '<span class="typing"><i></i><i></i><i></i></span>' : md(m.content)}</div>
          ${ai && !m.pending && (m.via || canHand) ? `<div class="nx-via">${esc(m.via || '')}${canHand ? `<button data-handoff="${i}" title="Send the question before this answer to your computer, so it can use tools and @Features">➤ Hand off to my computer</button>` : ''}</div>` : ''}</div>
        ${m.pending ? '' : `<div class="tools"><button data-copy="${i}" title="Copy">⧉</button>${canHand ? `<button data-handoff="${i}" title="Hand off to my computer">➤</button>` : ''}</div><button class="m-more" data-tools="1" title="More" aria-label="More">⋯</button>`}</div>`;
      prev = { role: m.role, at };
    });
    log.innerHTML = c.messages.length ? html + '<div class="nx-end"><button class="btn sm ghost" data-del="1">Clear chat</button></div>'
      : `<div class="empty">Ask anything. ${macOn() ? 'Your computer is on, so it answers with all its tools.' : 'Your computer is off: answers come from the free Nexus key. Need a tool (calendar, files, Axiom’s kits)? Use “Hand off to my computer”.'}</div>`;
    log.scrollTop = log.scrollHeight;
  }
  // One model call on the free key (no tools). Axiom gets his prompt from Supabase and logs his minutes.
  // 2.0.5: Maintenance applies here too. Admins get through unless the switch has "Admins bypass" off.
  async function maintFor(agentId) {
    let data = []; try { ({ data } = await sb.from('maintenance_config').select('scope,enabled,message,admin_bypass')); } catch {}
    const hit = new Set(['global', 'all', 'app', 'everything', agentId, `nexus 28 ${agentId}`]);
    return (data || []).find(m => (m.enabled === true || m.enabled === 'true' || m.enabled?.enabled === true) && m.admin_bypass === false && hit.has(String(m.scope).trim().toLowerCase()));
  }
  async function ask(agentId, messages, extraSystem = '') {
    const down = await maintFor(agentId);
    if (down) throw new Error('🛠 ' + (down.message || `${agentInfo(agentId).name} is down for maintenance (admins don't bypass this one).`));
    const a = agentInfo(agentId), key = await freeKey();
    if (!key) throw new Error("The free Nexus key isn't set up.");
    let sys = `You are ${a.name}, an assistant in Nexus '28 by Apoji Delegraphics. You have no tools here: if something needs files, a calendar or your computer's apps, say so.` + (a.about ? '\n\nAbout you: ' + a.about : '');
    if (a.apex) { const { data: s } = await sb.rpc('apex_session'); if (!s?.allowed || !s.prompt) throw new Error(s?.exhausted ? 'You’ve used your Axiom minutes this week.' : 'Axiom isn’t available right now.'); sys = s.prompt; }
    const model = lastModel(), t0 = Date.now();
    const res = await fetch(OR, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Apoji Admin' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: sys + extraSystem }, ...messages] }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || 'OpenRouter said ' + res.status);
    if (a.apex) sb.rpc('apex_log', { p_seconds: Math.max(1, Math.round((Date.now() - t0) / 1000)), p_kind: 'chat', p_provider: 'openrouter', p_model: String(j.model || model).slice(0, 120) }).then(() => {}, () => {});
    return { text: j.choices?.[0]?.message?.content || '(no reply)', model: j.model || model };
  }
  async function send() {
    const inp = NC.host?.querySelector('#ncIn'), text = inp?.value.trim(); if (!text || NC.busy) return;
    const c = conv(); inp.value = ''; inp.style.height = '';
    c.messages.push({ role: 'user', content: text, at: Date.now() }); c.at = Date.now();
    if (c.title === 'New chat') c.title = text.slice(0, 48);
    const a = agentInfo(lastAgent());
    if (macOn()) return relayAsk(c, text, a);
    const reply = { role: 'assistant', content: '', pending: true, at: Date.now(), agentName: a.name, agentShort: a.short, agentColor: a.color }; c.messages.push(reply); paintLog(); NC.busy = true;
    try { const r = await ask(a.id, c.messages.filter(m => !m.pending && !m.error).slice(-16).map(m => ({ role: m.role, content: m.content })), '\nYou are answering in Apoji Admin. If something needs your computer, suggest "Hand off to my computer".'); Object.assign(reply, { content: r.text, pending: false, via: `Free key · ${r.model}` }); }
    catch (e) { Object.assign(reply, { content: e.message, pending: false, error: true, via: '' }); }
    finally { NC.busy = false; saveConvs(); if (NC.host?.isConnected) paintLog(); }
  }
  // To your computer, through the relay (what N28C does). The Mac answers with its full toolset, in the same chat each time.
  async function relayAsk(c, text, a, handed = false) {
    const reply = { role: 'assistant', content: '', pending: true, at: Date.now(), via: 'Your computer', agentName: a.name, agentShort: a.short, agentColor: a.color }; c.messages.push(reply); paintLog();
    const { data, error } = await sb.from('relay_messages').insert({ direction: 'to_desktop', kind: 'ask', agent: a.id, content: text.slice(0, 8000), meta: { from: 'portal', ...(c.macConv ? { convId: c.macConv } : {}) } }).select('id').single();
    if (error) { Object.assign(reply, { content: error.message, pending: false, error: true }); saveConvs(); return paintLog(); }
    reply.relayId = data.id; saveConvs();
    if (handed && !macOn()) { reply.pending = false; reply.content = '➤ Handed off. Your computer will answer when it’s on (the answer shows up here and in Nexus).'; reply.waiting = true; saveConvs(); paintLog(); }
  }
  function handoff(i) {
    const c = conv(), q = [...c.messages.slice(0, i)].reverse().find(m => m.role === 'user'); if (!q) return;
    relayAsk(c, q.content, agentInfo(lastAgent()), true);
  }
  function onRelay(row) {
    if (!row || row.direction !== 'to_phone' || !['reply', 'error'].includes(row.kind)) return;
    for (const c of NC.convs) {
      const m = c.messages.find(x => x.relayId === row.reply_to); if (!m) continue;
      Object.assign(m, { content: row.content, pending: false, waiting: false, error: row.kind === 'error', via: 'Your computer' + (row.meta?.model ? ' · ' + row.meta.model : '') });
      if (row.meta?.convId) c.macConv = row.meta.convId;
      sb.from('relay_messages').delete().in('id', [row.id, row.reply_to]).then(() => {}, () => {});
      saveConvs(); if (NC.host?.isConnected && c.id === NC.open) paintLog();
    }
  }
  async function pollPending() {
    const ids = NC.convs.flatMap(c => c.messages.filter(m => (m.pending || m.waiting) && m.relayId).map(m => m.relayId)); if (!ids.length) return;
    const { data } = await sb.from('relay_messages').select('id,direction,kind,content,reply_to,meta').in('reply_to', ids);
    (data || []).forEach(onRelay);
  }

  // ---------- a model answering in a team room
  async function groupReply({ room, agent, trigger }) {
    const a = agentInfo(agent);
    NX.chat.thinking(room, a, true);
    try {
      const ctx = NX.chat.contextFor(room, 20);
      const transcript = ctx.map(m => `${m.who}${m.bot ? ' (AI)' : ''}: ${m.text}`).join('\n');
      const r = await ask(agent, [{ role: 'user', content: `Recent messages in this room (oldest first):\n${transcript}\n\nReply to the latest message that mentions @${agent}.` }],
        `\n\nYou are in Apoji Admin's team chat, a private room of the Apoji Team (the admins of Nexus '28). Several people talk here. Answer the person who mentioned you, briefly and in plain text; don't greet everyone or repeat the question.`);
      await NX.chat.postBot({ room, bot: agent, text: r.text, replyTo: trigger?.id });
    } catch (e) { toast(`${a.short}: ${e.message}`, true); }
    finally { NX.chat.thinking(room, a, false); }
  }

  P.nexus = async () => NX.go('chat');
  NX.nexusChat = { mount, icon, subtitle, mentionable, mentioned, agentInfo, groupReply, lastAgent };
})();
