// Admin chat (Apoji Admin): end-to-end encrypted with the team passphrase (crypto.js) · # All admins, group chats, private messages. Images and files, replies, reactions, edits,
// @mentions, read receipts (you can turn yours off), online / idle / do not disturb / offline, unread counts that
// follow you between devices, and notifications. Only admins can read any of it (row-level security).
(function () {
  const { sb, $, esc, av, nameOf, colorOf, presence, PRES, adminById, toast } = NX;
  const A = NX.A;
  const PAGE = 100, MAX_FILE = 10 * 1024 * 1024;
  const QUICK = ['👍', '❤️', '😂', '🔥', '👀', '✅', '🎉', '🙏'];
  const MORE = ['😀', '😅', '🤔', '😮', '😢', '😡', '🤯', '🥳', '😎', '🤝', '👏', '💯', '⚡', '🚀', '🐛', '🛠', '📌', '❓', '❗', '✨', '🙌', '💀', '🫡', '👋'];
  // ---------- end-to-end encryption: decrypted text lives only in memory here
  const E = window.NXCrypto, plain = new Map(), attMeta = new Map();
  const LOCKED = '🔒 Encrypted message', BROKEN = '🔒 Can\'t decrypt this message (sent with a different passphrase)';
  // m → readable text ('' for deleted). Legacy messages from before encryption are shown as-is.
  const txt = m => m.deleted ? '' : E.isEnc(m.body) ? (plain.has(m.id) ? plain.get(m.id).t ?? BROKEN : LOCKED) : (m.body || '');
  const metaOf = a => a.e ? attMeta.get(a.path) || { name: '🔒 encrypted file', mime: '', size: a.size || 0 } : a;
  async function reveal(list) {
    if (!E.ready()) return;
    await Promise.all(list.map(async m => {
      const cur = plain.get(m.id);
      if (!m.deleted && E.isEnc(m.body) && (!cur || cur.raw !== m.body)) plain.set(m.id, { raw: m.body, t: await E.dec(m.body) });
      for (const a of m.attachments || []) if (a.e && !attMeta.has(a.path)) { try { attMeta.set(a.path, JSON.parse(await E.dec(a.e) || 'null') || { name: '🔒 file' }); } catch { attMeta.set(a.path, { name: '🔒 file' }); } }
    }));
  }
  const C = { groups: [], members: {}, msgs: {}, more: {}, meta: {}, myRead: {}, reads: {}, room: NX.store.get('room', 'all'), open: false, replyTo: null, pending: [], urls: {}, find: '', inited: null, sending: false };

  // ---------- rooms
  const me = () => A.user.id;
  const dmRoom = other => 'dm:' + [me(), other].sort().join(':');
  const isDm = r => r.startsWith('dm:'), isGroup = r => r.startsWith('g:');
  const dmOther = r => adminById(r.slice(3).split(':').find(x => x !== me()));
  const groupOf = r => C.groups.find(g => 'g:' + g.id === r);
  // 1.9: "◆ Nexus" is your own chat with Nexus (v18.js), shown as the first room. Models can be @mentioned in any room.
  const AGENTS = () => NX.nexusChat?.mentionable() || [];
  function roomName(r) { if (r === 'nexus') return 'Nexus'; if (r === 'all') return 'All admins'; if (isDm(r)) return nameOf(dmOther(r)); const g = groupOf(r); return g ? g.name : 'Group'; }
  function roomPeople(r) {
    if (r === 'all') return A.admins;
    if (isDm(r)) return [A.me, dmOther(r)].filter(Boolean);
    return (C.members[r.slice(2)] || []).map(m => adminById(m.user_id) || { id: m.user_id, email: '' });
  }
  function roomIcon(r, size = '') {
    if (r === 'nexus') return NX.nexusChat?.icon() || '<span class="gav" style="--c:var(--accent)">◆</span>';
    if (r === 'all') return `<span class="gav" style="--c:var(--accent)">#</span>`;
    if (isDm(r)) return av(dmOther(r) || { id: r }, size, true);
    const g = groupOf(r) || {}; return `<span class="gav" style="--c:${esc(g.color || '#3dffa0')}">${esc(g.emoji || (g.name || 'G')[0].toUpperCase())}</span>`;
  }
  const muted = r => (A.prefs.muted_rooms || []).includes(r);
  const allRooms = () => ['nexus', 'all', ...C.groups.map(g => 'g:' + g.id), ...A.admins.filter(a => a.id !== me()).map(a => dmRoom(a.id))];
  const mentionsMe = m => { const n = nameOf(A.me).toLowerCase(); const b = String(txt(m)).toLowerCase(); return m.sender !== me() && (b.includes('@' + n) || /@(everyone|here)\b/.test(b)); };

  async function loadGroups() {
    const [{ data: gs }, { data: ms }] = await Promise.all([sb.from('admin_groups').select('*').order('created_at'), sb.from('admin_group_members').select('*')]);
    C.groups = gs || []; C.members = {};
    for (const m of ms || []) (C.members[m.group_id] = C.members[m.group_id] || []).push(m);
  }
  async function init() {
    return C.inited || (C.inited = (async () => {
      await loadGroups().catch(() => {});
      const [{ data: recent }, { data: reads }] = await Promise.all([
        sb.from('admin_messages').select('*').order('id', { ascending: false }).limit(500),
        sb.from('admin_reads').select('*')]);
      for (const r of reads || []) { (C.reads[r.room] = C.reads[r.room] || {})[r.user_id] = r.last_read_id; if (r.user_id === me()) C.myRead[r.room] = r.last_read_id; }
      // first time on v2.2: carry over what you'd read on this device in v2.1
      const oldSeen = NX.store.get('seen-v21', null) || (() => { try { return JSON.parse(localStorage.getItem('nx-admin-seen') || 'null'); } catch { return null; } })();
      if (oldSeen) for (const [r, id] of Object.entries(oldSeen)) if (!C.myRead[r]) C.myRead[r] = id;
      const rec = (recent || []).reverse(); await reveal(rec); C.recent = rec;
      for (const m of rec) bumpMeta(m, false);
      if (!allRooms().includes(C.room)) C.room = 'all';
      NX.on('admin_messages', onMsg); NX.on('admin_reads', onRead);
      NX.on('admin_groups', () => loadGroups().then(() => { if (A.tab === 'chat') { paintRooms(); paintTop(); } }));
      NX.on('admin_group_members', () => loadGroups().then(() => { if (!allRooms().includes(C.room)) C.room = 'all'; if (A.tab === 'chat') { paintRooms(); paintTop(); } }));
      NX.on('presence', () => { if (A.tab === 'chat') { paintRooms(); paintTop(); } });
      NX.on('poll', poll); NX.on('visible', () => markRead());
      recount();
    })());
  }
  function bumpMeta(m, live = true) {
    const meta = C.meta[m.room] = C.meta[m.room] || { last: null, unread: 0, mention: false };
    if (!meta.last || meta.last.id < m.id) meta.last = m;
    if (m.sender !== me() && !m.deleted && m.id > (C.myRead[m.room] || 0)) { meta.unread++; if (mentionsMe(m)) meta.mention = true; }
  }
  function recount() {
    let n = 0;
    for (const [r, meta] of Object.entries(C.meta)) { if (!allRooms().includes(r)) continue; if (meta.unread && (!muted(r) || meta.mention)) n += meta.unread; }
    A.counts.chat = n; NX.paintHeader();
  }
  async function poll() {
    const top = Math.max(0, ...Object.values(C.meta).map(m => m.last?.id || 0));
    const { data } = await sb.from('admin_messages').select('*').gt('id', top).order('id').limit(100);
    (data || []).forEach(m => onMsg({ eventType: 'INSERT', new: m }));
  }

  // ---------- incoming
  function viewing(r) { return A.tab === 'chat' && C.room === r && !document.hidden && (C.open || innerWidth > 760); }
  async function onMsg(p) {
    const m = p.new; if (!m?.id) return;
    await reveal([m]);
    if (p.eventType === 'UPDATE') {
      const list = C.msgs[m.room]; const i = list ? list.findIndex(x => x.id === m.id) : -1;
      if (i >= 0) { const was = list[i].pinned_at; list[i] = m; if (A.tab === 'chat' && C.room === m.room) { repaintMsg(m); if (!was !== !m.pinned_at) paintPinCount(); } }
      return;
    }
    if (p.eventType !== 'INSERT') return;
    const list = C.msgs[m.room];
    if (list?.some(x => x.id === m.id) || (C.meta[m.room]?.last?.id >= m.id && !list)) return;
    if (list) list.push(m);
    bumpMeta(m);
    if (viewing(m.room)) { appendMsg(m); markRead(); }
    else if (m.sender !== me()) {
      const mention = mentionsMe(m);
      if (!muted(m.room) || mention) {
        const who = adminById(m.sender) || { id: m.sender, nickname: m.sender_name };
        NX.notify({ kind: 'chat', force: mention, who, title: `${mention ? '@ ' : ''}${m.sender_name || nameOf(who)}${m.room === 'all' || isGroup(m.room) ? ' · ' + roomName(m.room) : ''}`,
          body: (E.ready() || !E.isEnc(m.body) ? txt(m) : '🔒 New encrypted message') || (m.attachments?.length ? `📎 ${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}` : ''), onClick: () => { NX.go('chat'); openRoom(m.room, true); } });
      }
    }
    recount();
    if (A.tab === 'chat') paintRooms();
  }
  function onRead(p) {
    const r = p.new; if (!r?.room) return;
    (C.reads[r.room] = C.reads[r.room] || {})[r.user_id] = r.last_read_id;
    if (r.user_id === me()) { C.myRead[r.room] = Math.max(C.myRead[r.room] || 0, r.last_read_id); const meta = C.meta[r.room]; if (meta && (C.msgs[r.room] || []).every(x => x.id <= r.last_read_id || x.sender === me())) { meta.unread = 0; meta.mention = false; } recount(); if (A.tab === 'chat') paintRooms(); }
    else if (A.tab === 'chat' && C.room === r.room) paintSeen();
  }
  let readT = null;
  function markRead() {
    clearTimeout(readT);
    readT = setTimeout(async () => {
      const r = C.room, list = C.msgs[r] || []; if (!list.length || !viewing(r)) return;
      const top = list[list.length - 1].id;
      const meta = C.meta[r]; if (meta) { meta.unread = 0; meta.mention = false; } recount(); paintRooms();
      if ((C.myRead[r] || 0) >= top) return;
      C.myRead[r] = top; (C.reads[r] = C.reads[r] || {})[me()] = top;
      await sb.from('admin_reads').upsert({ room: r, user_id: me(), last_read_id: top, updated_at: new Date().toISOString() }, { onConflict: 'room,user_id' });
    }, 600);
  }

  // ---------- page
  NX.pages.chat = async () => {
    if (!E.ready() && !(await E.load())) return lockScreen();
    await init();
    if (C.recent && !C.revealed) { C.revealed = true; await reveal(C.recent); await Promise.all(Object.values(C.msgs).map(reveal)); recountAll(); }
    NX.main(`<h1>Team chat</h1><p>Your team's own chat, end-to-end encrypted, with Nexus in it: open ◆ Nexus for your own chat, or @mention a model (like @paragon) in any room.</p>
      <div class="chat ${C.open ? 'open' : ''}" id="chat">
        <div class="rooms" id="rooms"></div>
        <div class="thread" id="thread">
          <div class="top" id="ttop"></div>
          <div class="find" id="tfind" hidden><input class="field" id="tfq" placeholder="Search this chat…" style="width:100%"></div>
          <div class="msgs" id="msgs"></div>
          <div class="compose" id="compose">
            <div class="replying" id="replying" hidden></div><div class="pend" id="pend" hidden></div>
            <div class="box"><button class="ib" id="cAttach" title="Attach images or files (or paste / drop them)">📎</button><input type="file" id="cFile" multiple hidden>
              <textarea class="field" id="ct" placeholder="Encrypted message…" maxlength="4000" rows="1"></textarea>
              <button class="ib" id="cSaved" title="Saved replies">⚡</button><button class="ib" id="cEmoji" title="Emoji">🙂</button><button class="btn primary" id="cSend" style="height:42px">Send</button></div>
          </div>
        </div>
      </div>`, { cards: false });
    wire();
    paintRooms(); await openRoom(C.room, false);
  };

  function paintRooms() {
    const el = $('rooms'); if (!el) return;
    const q = ($('rq')?.value || '').toLowerCase();
    const item = (r, label, sub) => {
      if (q && !label.toLowerCase().includes(q)) return '';
      const meta = C.meta[r] || {};
      const badge = meta.unread ? `<span class="unread ${meta.mention ? 'mention' : ''}">${meta.mention ? '@' : meta.unread > 99 ? '99+' : meta.unread}</span>` : muted(r) ? '<span class="mut" title="Muted">🔕</span>' : '';
      return `<button class="rm ${C.room === r ? 'on' : ''}" data-room="${esc(r)}">${roomIcon(r)}<span class="nm">${esc(label)}<small>${esc(sub)}</small></span>${badge}</button>`;
    };
    const preview = r => { const l = C.meta[r]?.last; if (!l) return ''; const who = l.bot ? (NX.nexusChat?.agentInfo(l.bot)?.short || 'AI') : l.sender === me() ? 'You' : (l.sender_name || 'Admin').split(' ')[0]; return `${who}: ${l.deleted ? 'deleted a message' : txt(l) || '📎 attachment'}`; };
    const others = A.admins.filter(a => a.id !== me()).sort((a, b) => {
      const order = { online: 0, idle: 1, dnd: 2, offline: 3 }; const la = C.meta[dmRoom(a.id)]?.last?.id || 0, lb = C.meta[dmRoom(b.id)]?.last?.id || 0;
      return (lb - la) || (order[presence(a)] - order[presence(b)]) || nameOf(a).localeCompare(nameOf(b));
    });
    el.innerHTML = `<div class="rtools"><input class="field" id="rq" placeholder="Find a chat" value="${esc(q)}"></div>
      ${item('nexus', 'Nexus', NX.nexusChat?.subtitle() || 'Your own chat with Nexus')}
      ${item('all', 'All admins', preview('all') || `${A.admins.length} admins`)}
      <h4>GROUPS <button id="newGroup" title="New group">＋</button></h4>
      ${C.groups.map(g => item('g:' + g.id, g.name, preview('g:' + g.id) || `${(C.members[g.id] || []).length} members`)).join('') || (q ? '' : '<p class="muted" style="margin:2px 10px 6px">No groups yet.</p>')}
      <h4>DIRECT MESSAGES</h4>
      ${others.map(a => item(dmRoom(a.id), nameOf(a), preview(dmRoom(a.id)) || (a.status_text || `${PRES[presence(a)]} · ${a.level}`))).join('') || '<p class="muted" style="margin:2px 10px">No other admins yet.</p>'}`;
    const rq = $('rq'); if (q) { rq.focus(); rq.setSelectionRange(q.length, q.length); }
  }
  function paintTop() {
    const t = $('ttop'); if (!t) return;
    const r = C.room, people = roomPeople(r);
    let sub = '';
    if (r === 'all') sub = `${A.admins.filter(a => presence(a) !== 'offline').length} online · ${A.admins.length} admins`;
    else if (isDm(r)) { const o = dmOther(r); const p = presence(o); sub = `<span class="prtxt ${p}">${PRES[p]}</span>${o?.status_text ? ' · ' + esc(o.status_text) : ''}${p === 'offline' && o?.last_seen && new Date(o.last_seen) > Date.now() - 30 * 864e5 ? ' · last seen ' + NX.ago(o.last_seen) : ''}`; }
    else sub = `${people.length} members · ${people.filter(a => presence(a) !== 'offline').length} online`;
    t.innerHTML = `<button class="btn sm back" id="tBack">‹</button>${roomIcon(r, '')}<div class="ti"><b>${esc(roomName(r))}<span class="e2ee" title="End-to-end encrypted: only admins with the team passphrase can read this. Supabase only stores scrambled text.">🔒 E2EE</span></b><small>${sub}</small></div>
      <button class="btn sm ghost" id="tPins" title="Pinned messages">📌<span id="tPinN"></span></button><button class="btn sm ghost" id="tFind" title="Search">🔍</button><button class="btn sm ghost" id="tMute" title="${muted(r) ? 'Unmute' : 'Mute'} notifications">${muted(r) ? '🔕' : '🔔'}</button>
      ${isGroup(r) ? '<button class="btn sm ghost" id="tInfo" title="Group settings">ⓘ</button>' : r === 'all' ? '<button class="btn sm ghost" id="tInfo" title="Who\'s here">👥</button>' : ''}`;
  }

  async function openRoom(r, user) {
    if (!allRooms().includes(r)) r = 'all';
    // the Nexus room draws its own thread; coming back from it rebuilds the normal one
    if (r === 'nexus' || (C.room === 'nexus' && r !== 'nexus' && !$('msgs'))) {
      const was = C.room; C.room = r; NX.store.set('room', r); if (user) C.open = true;
      if (r === 'nexus') { $('chat')?.classList.toggle('open', C.open); paintRooms(); NX.nexusChat?.mount($('thread'), () => { C.open = false; $('chat')?.classList.remove('open'); }); return; }
      if (was === 'nexus') return NX.pages.chat();
    }
    if (C.room !== r) { C.replyTo = null; C.find = ''; }
    C.room = r; NX.store.set('room', r);
    if (user) C.open = true;
    $('chat')?.classList.toggle('open', C.open);
    paintRooms(); paintTop(); paintReply(); paintPinCount();
    if (!$('msgs')) return;
    if (!C.msgs[r]) {
      $('msgs').innerHTML = '<div class="empty"><span class="spinner"></span></div>';
      const { data, error } = await sb.from('admin_messages').select('*').eq('room', r).order('id', { ascending: false }).limit(PAGE);
      if (error) { $('msgs').innerHTML = `<div class="empty err">${esc(NX.needSql(error.message) ? 'Run supabase/nexus-v2.2.sql to turn on the new admin chat.' : error.message)}</div>`; return; }
      C.msgs[r] = (data || []).reverse(); C.more[r] = (data || []).length === PAGE; await reveal(C.msgs[r]);
      if (C.room !== r) return;
    }
    C.unreadMark = C.myRead[r] || 0;
    paintMsgs(true);
    markRead();
    if (innerWidth > 760 || C.open) $('ct')?.focus();
  }

  // ---------- messages
  const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/(^|\s)@([\w.\-]{2,30})/g, (all, sp, n) => `${sp}<span class="mention">@${n}</span>`);
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function msgHtml(m, prev) {
    const d = new Date(m.created_at);
    const cont = prev && prev.sender === m.sender && (prev.bot || null) === (m.bot || null) && !prev.deleted && d - new Date(prev.created_at) < 5 * 60e3 && new Date(prev.created_at).toDateString() === d.toDateString() && !m.reply_to;
    const bot = m.bot ? NX.nexusChat?.agentInfo(m.bot) : null;
    const who = bot ? { id: 'bot-' + m.bot, nickname: bot.short } : adminById(m.sender) || { id: m.sender, nickname: m.sender_name };
    const mine = m.sender === me() && !bot;
    const reply = m.reply_to ? (C.msgs[m.room] || []).find(x => x.id === m.reply_to) : null;
    const atts = (m.attachments || []).map((a0, i) => { const a = metaOf(a0); return /^image\//.test(a.mime || '')
      ? `<span class="ph" data-img="${esc(a0.path)}" data-i="${i}" style="${a.w && a.h ? `width:${Math.min(320, a.w * Math.min(1, 240 / a.h))}px;aspect-ratio:${a.w}/${a.h};height:auto` : ''}"><span class="spinner"></span></span>`
      : `<a class="file" data-file="${esc(a0.path)}" data-name="${esc(a.name)}" href="#"><i>${a0.e ? '🔐' : '📄'}</i><span>${esc(a.name)}<small>${fmtSize(a.size || a0.size || 0)} · download</small></span></a>`; }).join('');
    const rx = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length).map(([e, ids]) => `<button data-rx="${esc(e)}" class="${ids.includes(me()) ? 'mine' : ''}" title="${esc(ids.map(id => nameOf(adminById(id))).join(', '))}">${esc(e)} ${ids.length}</button>`).join('');
    return `<div class="m ${cont ? 'cont' : ''} ${m.deleted ? 'del' : ''} ${mentionsMe(m) ? 'mentioned' : ''} ${bot ? 'bot' : ''}" data-id="${m.id}">${bot ? `<span class="av" style="--c:${esc(bot.color)}">${esc(bot.short[0])}</span>` : av(who)}
      <div class="mb"><div class="by"><b style="color:${bot ? esc(bot.color) : colorOf(m.sender)}">${esc(bot ? bot.name : mine ? nameOf(A.me) : m.sender_name || nameOf(who))}</b>${bot ? `<span class="ai-tag" title="Written by a model, asked by ${esc(nameOf(adminById(m.sender)))}">AI · asked by ${esc(m.sender === me() ? 'you' : nameOf(adminById(m.sender)).split(' ')[0])}</span>` : m.ai_sent ? '<span class="ai-sent" title="This message and the recent chat were sent to a model (not end-to-end encrypted on the way there)">→ sent to AI</span>' : ''}<time title="${esc(d.toLocaleString())}">${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></div>
        ${reply ? `<div class="rq" data-jump="${reply.id}">↪ ${esc(reply.sender_name || 'Admin')}: ${esc(reply.deleted ? 'deleted message' : txt(reply) || '📎 attachment')}</div>` : m.reply_to ? '<div class="rq">↪ an earlier message</div>' : ''}
        ${m.pinned_at && !m.deleted ? `<div class="pinmark">📌 Pinned by ${esc(m.pinned_by === me() ? 'you' : nameOf(adminById(m.pinned_by)))}</div>` : ''}<div class="tx">${m.deleted ? 'This message was deleted.' : linkify(txt(m))}${m.edited_at && !m.deleted ? '<span class="ed">(edited)</span>' : ''}</div>
        ${!m.deleted && atts ? `<div class="atts">${atts}</div>` : ''}${rx ? `<div class="rx">${rx}</div>` : ''}</div>
      ${m.deleted ? '' : `<div class="tools">${QUICK.slice(0, 3).map(e => `<button data-rx="${e}" title="React">${e}</button>`).join('')}<button data-act="react" title="More reactions">😀</button><button data-act="reply" title="Reply">↩︎</button><button data-act="pin" title="${m.pinned_at ? 'Unpin' : 'Pin'}">${m.pinned_at ? '📍' : '📌'}</button>${mine && plain.get(m.id)?.t ? '<button data-act="edit" title="Edit">✎</button>' : ''}${txt(m) ? '<button data-act="copy" title="Copy">⧉</button>' : ''}${mine || A.level === 'high-admin' ? '<button data-act="del" title="Delete">🗑</button>' : ''}</div>`}</div>`;
  }
  function paintMsgs(scroll) {
    const el = $('msgs'); if (!el) return;
    const q = C.find.toLowerCase();
    const list = (C.msgs[C.room] || []).filter(m => !q || String(txt(m)).toLowerCase().includes(q) || (m.attachments || []).some(a => String(metaOf(a).name).toLowerCase().includes(q)));
    let html = C.more[C.room] && !q ? '<div style="text-align:center;margin:6px 0"><button class="btn sm" id="older">Load older messages</button></div>' : '';
    let lastDay = '', prev = null, newShown = false;
    for (const m of list) {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) { html += `<div class="day">${new Date(m.created_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>`; lastDay = day; prev = null; }
      if (!newShown && C.unreadMark && m.id > C.unreadMark && m.sender !== me() && !q) { html += '<div class="newline">NEW</div>'; newShown = true; prev = null; }
      html += msgHtml(m, prev); prev = m;
    }
    if (!list.length) html += `<div class="empty">${q ? 'Nothing matches.' : C.room === 'all' ? 'Say hi to the team 👋' : isDm(C.room) ? `This is the start of your conversation with ${esc(roomName(C.room))}.` : 'This group is quiet. Start it off!'}</div>`;
    html += '<div class="seen" id="seen"></div>';
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = html;
    loadMedia(el); paintSeen();
    if (scroll || atBottom) el.scrollTop = el.scrollHeight;
  }
  function appendMsg(m) {
    const el = $('msgs'); if (!el || C.find) return paintMsgs();
    const list = C.msgs[C.room]; const prev = list[list.length - 2];
    if (!prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()) return paintMsgs(true);
    el.querySelector('.empty')?.remove();
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120 || m.sender === me();
    $('seen').insertAdjacentHTML('beforebegin', msgHtml(m, prev));
    loadMedia(el); paintSeen();
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function repaintMsg(m) {
    const node = document.querySelector(`.m[data-id="${m.id}"]`); if (!node) return;
    const list = C.msgs[C.room]; const i = list.findIndex(x => x.id === m.id);
    node.outerHTML = msgHtml(m, list[i - 1] && new Date(list[i - 1].created_at).toDateString() === new Date(m.created_at).toDateString() ? list[i - 1] : null);
    loadMedia($('msgs'));
  }
  // Seen-by: little avatars under the newest message each person has read (if read receipts are on for you and them)
  function paintSeen() {
    const el = $('seen'); if (!el) return;
    document.querySelectorAll('.m .seenat').forEach(x => x.remove());
    if (!A.prefs.read_receipts) { el.innerHTML = ''; return; }
    const list = C.msgs[C.room] || []; if (!list.length) { el.innerHTML = ''; return; }
    const reads = C.reads[C.room] || {}, last = list[list.length - 1];
    const others = roomPeople(C.room).filter(a => a && a.id !== me() && a.read_receipts !== false && reads[a.id]);
    const atLast = others.filter(a => reads[a.id] >= last.id);
    if (isDm(C.room)) { el.innerHTML = last.sender === me() && atLast.length ? '<span>Seen</span>' + atLast.map(a => av(a, 'sm')).join('') : ''; return; }
    el.innerHTML = atLast.length ? `<span>Seen by ${atLast.length === others.length && others.length > 1 ? 'everyone' : esc(atLast.slice(0, 3).map(nameOf).join(', ')) + (atLast.length > 3 ? ` +${atLast.length - 3}` : '')}</span>` + atLast.slice(0, 8).map(a => av(a, 'sm')).join('') : '';
  }
  // Images: encrypted ones are downloaded and decrypted here (Supabase only has scrambled bytes); older ones use a signed link
  function loadMedia(root) {
    const need = [...root.querySelectorAll('[data-img]:not([data-done])')];
    need.forEach(n => { n.dataset.done = 1; const path = n.dataset.img; mediaUrl(path).then(u => {
      if (!u) { n.innerHTML = '<span class="muted">image unavailable</span>'; return; }
      const img = new Image(); img.src = u; img.alt = ''; img.dataset.full = path; img.style.cssText = n.getAttribute('style') || ''; n.replaceWith(img);
    }); });
  }
  const findAtt = path => { for (const list of Object.values(C.msgs)) for (const m of list) for (const a of m.attachments || []) if (a.path === path) return a; return null; };
  async function mediaUrl(path) {
    if (C.urls[path]) return C.urls[path];
    const a = findAtt(path);
    if (a?.e) {
      if (!E.ready()) return null;
      const { data, error } = await sb.storage.from('admin-files').download(path); if (error || !data) return null;
      try { const buf = await E.decBytes(await data.arrayBuffer()); return C.urls[path] = URL.createObjectURL(new Blob([buf], { type: metaOf(a).mime || 'application/octet-stream' })); } catch { return null; }
    }
    const { data } = await sb.storage.from('admin-files').createSignedUrl(path, 3600);
    if (data?.signedUrl) { C.urls[path] = data.signedUrl; setTimeout(() => { delete C.urls[path]; }, 50 * 60e3); }
    return data?.signedUrl || null;
  }

  // ---------- compose
  function paintReply() {
    const el = $('replying'); if (!el) return;
    const m = C.replyTo; el.hidden = !m;
    if (m) el.innerHTML = `↪ Replying to <b>${esc(m.sender_name)}</b>: <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(txt(m) || '📎 attachment')}</span><button class="btn sm ghost" id="noReply">✕</button>`;
  }
  function paintPending() {
    const el = $('pend'); if (!el) return;
    el.hidden = !C.pending.length;
    el.innerHTML = C.pending.map((f, i) => `<span class="pf">${f.preview ? `<img src="${f.preview}" alt="">` : '📄'}<span>${esc(f.file.name.slice(0, 28))}<small class="muted"> ${fmtSize(f.file.size)}</small></span><button data-unpend="${i}" title="Remove">✕</button></span>`).join('');
  }
  function addFiles(files) {
    for (const file of files) {
      if (file.size > MAX_FILE) { toast(`${file.name} is over 10 MB.`, true); continue; }
      if (C.pending.length >= 10) { toast('Up to 10 files per message.', true); break; }
      const f = { file, preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' };
      C.pending.push(f);
    }
    paintPending(); $('ct')?.focus();
  }
  const imgSize = url => new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = url; });
  async function send() {
    if (C.sending) return;
    const t = $('ct'), body = t.value.trim();
    if (!body && !C.pending.length) return;
    C.sending = true; $('cSend').disabled = true;
    const room = C.room, files = C.pending.slice(), reply = C.replyTo;
    try {
      const attachments = [];
      for (const f of files) {
        const path = `${room}/${crypto.randomUUID()}/file.bin`;   // the real name and type are inside the encrypted metadata
        const meta = { name: f.file.name.slice(0, 120), mime: f.file.type || '', size: f.file.size };
        if (f.preview) { const [w, h] = await imgSize(f.preview); if (w) Object.assign(meta, { w, h }); }
        const sealed = await E.encBytes(await f.file.arrayBuffer());
        const { error } = await sb.storage.from('admin-files').upload(path, new Blob([sealed], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false });
        if (error) throw new Error(`Couldn't upload ${f.file.name}: ${error.message}`);
        attachments.push({ path, size: sealed.length, e: await E.enc(JSON.stringify(meta)) });
        attMeta.set(path, meta); if (f.preview) C.urls[path] = f.preview;
      }
      let agent = NX.nexusChat?.mentioned(body);       // 1.9: "@paragon …" → this message (and the recent chat) goes to that model
      const row = { room, body: body ? await E.enc(body) : '', sender_name: nameOf(A.me).slice(0, 60), attachments, reply_to: reply?.id || null };
      let { data, error } = await sb.from('admin_messages').insert({ ...row, ...(agent ? { ai_sent: true } : {}) }).select().single();
      if (error && agent && /ai_sent|schema cache|column/i.test(error.message)) { ({ data, error } = await sb.from('admin_messages').insert(row).select().single()); if (!error) { toast('Models answer in chat once supabase/nexus-v3.2.sql is run.', true); agent = null; } }
      if (error) throw new Error(error.message);
      if (agent) setTimeout(() => NX.nexusChat.groupReply({ room, agent, trigger: data }), 50);
      document.querySelector('.mentions')?.remove();
      t.value = ''; autosize(); C.pending = []; C.replyTo = null; paintPending(); paintReply();
      onMsg({ eventType: 'INSERT', new: data });
    } catch (e) { toast(e.message, true); }
    finally { C.sending = false; const b = $('cSend'); if (b) b.disabled = false; }
  }
  const autosize = () => { const t = $('ct'); if (!t) return; t.style.height = '42px'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; };

  // @mention picker
  let mentionSel = 0;
  function mentionState() {
    const t = $('ct'); const before = t.value.slice(0, t.selectionStart); const m = before.match(/(^|\s)@([\w.\-]{0,30})$/);
    if (!m) return null;
    const q = m[2].toLowerCase();
    const people = [{ id: '@everyone', nickname: 'everyone', special: true }, ...AGENTS().map(g => ({ id: '@' + g.id, nickname: g.id, agent: g })), ...roomPeople(C.room).filter(a => a && a.id !== me())].filter(a => nameOf(a).toLowerCase().startsWith(q)).slice(0, 7);
    return people.length ? { q, people, start: before.length - m[2].length - 1 } : null;
  }
  function paintMentions() {
    document.querySelector('.mentions')?.remove();
    const s = mentionState(); if (!s) return;
    mentionSel = Math.min(mentionSel, s.people.length - 1);
    const box = document.createElement('div'); box.className = 'mentions';
    box.innerHTML = s.people.map((a, i) => `<button data-mn="${esc(nameOf(a))}" class="${i === mentionSel ? 'on' : ''}">${a.special ? '<span class="av sm" style="--c:var(--gold)">@</span>' : a.agent ? `<span class="av sm" style="--c:${esc(a.agent.color)}">${esc(a.agent.short[0])}</span>` : av(a, 'sm', true)}<span>${esc(nameOf(a))}${a.special ? ' <small class="muted">notify everyone here</small>' : a.agent ? ` <small class="muted">${esc(a.agent.short)} answers here (AI)</small>` : ''}</span></button>`).join('');
    $('thread').appendChild(box);
  }
  function pickMention(name) {
    const t = $('ct'), s = mentionState(); if (!s) return;
    t.value = t.value.slice(0, s.start) + '@' + name.replace(/\s+/g, '') + ' ' + t.value.slice(t.selectionStart);
    const pos = s.start + name.replace(/\s+/g, '').length + 2; t.setSelectionRange(pos, pos); t.focus();
    document.querySelector('.mentions')?.remove();
  }
  function emojiPicker(anchor, pick) {
    document.querySelector('.emojis')?.remove();
    const box = document.createElement('div'); box.className = 'emojis';
    box.innerHTML = [...QUICK, ...MORE].map(e => `<button data-e="${e}">${e}</button>`).join('');
    const r = anchor.getBoundingClientRect(), tr = $('thread').getBoundingClientRect();
    box.style.right = Math.max(6, tr.right - r.right) + 'px';
    box.style.bottom = Math.max(6, tr.bottom - r.top + 6) + 'px';
    $('thread').appendChild(box);
    box.onclick = e => { const b = e.target.closest('[data-e]'); if (b) { pick(b.dataset.e); box.remove(); } };
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }

  // ---------- group modal
  function groupModal(g) {
    const COL = ['#3dffa0', '#5ce1ff', '#ffd36b', '#ff8fd0', '#b69cff', '#ff9f6b', '#9bd65c', '#ff5c6c'];
    const memberIds = g ? (C.members[g.id] || []).map(m => m.user_id) : [];
    const owner = g && ((C.members[g.id] || []).find(m => m.user_id === me())?.role === 'owner' || A.level === 'high-admin');
    let color = g?.color || COL[Math.floor(Math.random() * COL.length)];
    const others = A.admins.filter(a => a.id !== me());
    const { el, close } = NX.modal(`<h3>${g ? 'Group settings' : 'New group chat'}</h3>
      <div class="row"><input class="field" id="gEmoji" placeholder="🛠" maxlength="4" style="width:56px;text-align:center" value="${esc(g?.emoji || '')}"><input class="field" id="gName" placeholder="Group name, e.g. Beta team" maxlength="40" style="flex:1" value="${esc(g?.name || '')}"></div>
      <div class="swatches" id="gCol" style="margin:10px 0">${COL.map(c => `<button data-c="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}</div>
      <b style="font-size:13px">${g ? 'Members' : 'Add people'}</b>
      <div class="checks">${others.map(a => `<label>${av(a, 'sm', true)}<span style="flex:1">${esc(nameOf(a))} <small class="muted">${esc(a.level)}</small></span><input type="checkbox" value="${esc(a.id)}" ${memberIds.includes(a.id) ? 'checked' : ''} ${g && memberIds.includes(a.id) && !owner ? 'disabled title="Only the owner can remove people"' : ''}></label>`).join('') || '<p class="muted">No other admins yet.</p>'}</div>
      <div class="row"><span class="muted" id="gErr" style="flex:1"></span>${g ? '<button class="btn danger" id="gLeave">Leave group</button>' : ''}<button class="btn primary" id="gSave">${g ? 'Save' : 'Create group'}</button></div>`);
    el.querySelector('#gCol').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; el.querySelectorAll('#gCol button').forEach(x => x.classList.toggle('on', x === b)); };
    el.querySelector('#gSave').onclick = async () => {
      const name = el.querySelector('#gName').value.trim(), emoji = el.querySelector('#gEmoji').value.trim();
      const picked = [...el.querySelectorAll('.checks input:checked')].map(i => i.value);
      if (!name) { el.querySelector('#gErr').textContent = 'Give the group a name.'; return; }
      try {
        if (g) await NX.rpc('admin_update_group', { p_group: g.id, p_name: name, p_color: color, p_emoji: emoji, p_add: picked.filter(id => !memberIds.includes(id)), p_remove: memberIds.filter(id => id !== me() && !picked.includes(id)) });
        else { const r = await NX.rpc('admin_create_group', { p_name: name, p_members: picked, p_color: color, p_emoji: emoji }); C.room = r.room; }
        await loadGroups(); close(); paintRooms(); openRoom(C.room, true); toast(g ? '✓ Saved' : '✓ Group created');
      } catch (e) { el.querySelector('#gErr').textContent = e.message; }
    };
    el.querySelector('#gLeave')?.addEventListener('click', async () => {
      if (!confirm(`Leave ${g.name}? You won't see its messages anymore.`)) return;
      try { await NX.rpc('admin_update_group', { p_group: g.id, p_remove: [me()] }); await loadGroups(); close(); C.room = 'all'; C.open = false; paintRooms(); openRoom('all'); } catch (e) { toast(e.message, true); }
    });
  }
  function peopleModal() {
    const list = A.admins.slice().sort((a, b) => ({ online: 0, idle: 1, dnd: 2, offline: 3 })[presence(a)] - ({ online: 0, idle: 1, dnd: 2, offline: 3 })[presence(b)]);
    const { el, close } = NX.modal(`<h3>Admins (${list.length})</h3><div class="members">${list.map(a => { const p = presence(a); return `<div>${av(a, '', true)}<span class="nm">${esc(nameOf(a))}${a.id === me() ? ' <small class="muted">(you)</small>' : ''}<small><span class="prtxt ${p}">${PRES[p]}</span>${a.status_text ? ' · ' + esc(a.status_text) : ''} · ${esc(a.level)}</small></span>${a.id !== me() ? `<button class="btn sm" data-dm="${esc(a.id)}">Message</button>` : ''}</div>`; }).join('')}</div>`);
    el.onclick = e => { const b = e.target.closest('[data-dm]'); if (b) { close(); openRoom(dmRoom(b.dataset.dm), true); } };
  }

  // ---------- events
  function wire() {
    $('rooms').addEventListener('click', e => {
      if (e.target.closest('#newGroup')) return groupModal(null);
      const b = e.target.closest('[data-room]'); if (b) openRoom(b.dataset.room, true);
    });
    $('rooms').addEventListener('input', e => { if (e.target.id === 'rq') paintRooms(); });
    $('ttop').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'tBack') { C.open = false; $('chat').classList.remove('open'); paintRooms(); }
      if (b.id === 'tFind') { const f = $('tfind'); f.hidden = !f.hidden; if (!f.hidden) $('tfq').focus(); else { C.find = ''; $('tfq').value = ''; paintMsgs(true); } }
      if (b.id === 'tMute') { const list = new Set(A.prefs.muted_rooms || []); list.has(C.room) ? list.delete(C.room) : list.add(C.room); await NX.savePrefs({ muted_rooms: [...list] }); paintTop(); paintRooms(); recount(); toast(list.has(C.room) ? '🔕 Muted (you still get @mentions)' : '🔔 Notifications on'); }
      if (b.id === 'tPins') return pinsModal();
      if (b.id === 'tInfo') { if (isGroup(C.room)) groupModal(groupOf(C.room)); else peopleModal(); }
    });
    $('tfq').addEventListener('input', e => { C.find = e.target.value; paintMsgs(true); });
    const msgs = $('msgs');
    msgs.addEventListener('scroll', () => { if (msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40) markRead(); });
    msgs.addEventListener('click', async e => {
      if (e.target.id === 'older') {
        const list = C.msgs[C.room]; const first = list[0]?.id; if (!first) return;
        const { data } = await sb.from('admin_messages').select('*').eq('room', C.room).lt('id', first).order('id', { ascending: false }).limit(PAGE);
        const h = msgs.scrollHeight; C.msgs[C.room] = [...(data || []).reverse(), ...list]; C.more[C.room] = (data || []).length === PAGE; paintMsgs(); msgs.scrollTop = msgs.scrollHeight - h; return;
      }
      const img = e.target.closest('img[data-full]');
      if (img) { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${img.src}" alt=""><a class="btn primary" href="${img.src}" target="_blank" rel="noopener" download>Open</a>`; lb.onclick = ev => { if (!ev.target.closest('a')) lb.remove(); }; document.body.appendChild(lb); return; }
      const file = e.target.closest('[data-file]');
      if (file) {
        e.preventDefault(); const a = findAtt(file.dataset.file);
        if (a?.e) { const u = await mediaUrl(file.dataset.file); if (!u) return toast('Couldn\'t open that file.', true); const link = document.createElement('a'); link.href = u; link.download = file.dataset.name || 'file'; link.click(); return; }
        const { data, error } = await sb.storage.from('admin-files').createSignedUrl(file.dataset.file, 300, { download: file.dataset.name }); if (error) return toast(error.message, true); location.href = data.signedUrl; return;
      }
      const jump = e.target.closest('[data-jump]'); if (jump) { document.querySelector(`.m[data-id="${jump.dataset.jump}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      const node = e.target.closest('.m'); if (!node) return;
      const m = (C.msgs[C.room] || []).find(x => x.id === +node.dataset.id); if (!m) return;
      if (innerWidth <= 760 && !e.target.closest('.tools,.rx')) { document.querySelectorAll('.m.tools-on').forEach(x => x !== node && x.classList.remove('tools-on')); node.classList.toggle('tools-on'); return; }
      const rx = e.target.closest('[data-rx]'); if (rx) { NX.rpc('admin_react', { p_message: m.id, p_emoji: rx.dataset.rx }).catch(err => toast(err.message, true)); return; }
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      if (act === 'react') emojiPicker(e.target.closest('button'), em => NX.rpc('admin_react', { p_message: m.id, p_emoji: em }).catch(err => toast(err.message, true)));
      if (act === 'pin') { const pin = !m.pinned_at; NX.rpc('admin_pin_message', { p_message: m.id, p_pin: pin }).then(() => { Object.assign(m, { pinned_at: pin ? new Date().toISOString() : null, pinned_by: pin ? me() : null }); repaintMsg(m); paintPinCount(); toast(pin ? '📌 Pinned for everyone in this chat' : 'Unpinned'); })
        .catch(err => toast(NX.needSql(err.message) || /admin_pin_message/.test(err.message) ? 'Run supabase/apoji-admin-1.1.sql to pin messages.' : err.message, true)); return; }
      if (act === 'reply') { C.replyTo = m; paintReply(); $('ct').focus(); }
      if (act === 'copy') { navigator.clipboard?.writeText(txt(m)); toast('Copied'); }
      if (act === 'del') { if (confirm('Delete this message for everyone?')) NX.rpc('admin_delete_message', { p_message: m.id }).then(() => { Object.assign(m, { deleted: true, body: '', attachments: [] }); repaintMsg(m); }).catch(err => toast(err.message, true)); }
      if (act === 'edit') {
        const tx = node.querySelector('.tx'); tx.innerHTML = `<textarea class="field" style="width:100%" rows="2" maxlength="4000">${esc(txt(m))}</textarea><small class="muted">Enter to save · Esc to cancel</small>`;
        const ta = tx.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.onkeydown = async ev => {
          if (ev.key === 'Escape') return repaintMsg(m);
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const v = ta.value.trim(); if (!v || v === txt(m)) return repaintMsg(m);
            try { const sealed = await E.enc(v); await NX.rpc('admin_edit_message', { p_message: m.id, p_body: sealed }); Object.assign(m, { body: sealed, edited_at: new Date().toISOString() }); plain.set(m.id, { raw: sealed, t: v }); repaintMsg(m); } catch (err) { toast(err.message, true); } }
        };
      }
    });
    const t = $('ct');
    t.addEventListener('input', () => { autosize(); paintMentions(); });
    t.addEventListener('keydown', e => {
      const box = document.querySelector('.mentions');
      if (box) {
        const n = box.children.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionSel = (mentionSel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; paintMentions(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(box.children[mentionSel].dataset.mn); return; }
        if (e.key === 'Escape') { box.remove(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && innerWidth > 760) { e.preventDefault(); send(); }
      if (e.key === 'ArrowUp' && !t.value) { const mine = (C.msgs[C.room] || []).filter(m => m.sender === me() && !m.deleted && plain.has(m.id) && plain.get(m.id).t).pop(); if (mine) { e.preventDefault(); document.querySelector(`.m[data-id="${mine.id}"] [data-act="edit"]`)?.click(); } }
      if (e.key === 'Escape' && C.replyTo) { C.replyTo = null; paintReply(); }
    });
    t.addEventListener('paste', e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } });
    $('thread').addEventListener('click', e => {
      const mn = e.target.closest('[data-mn]'); if (mn) return pickMention(mn.dataset.mn);
      if (e.target.closest('#noReply')) { C.replyTo = null; paintReply(); }
      const up = e.target.closest('[data-unpend]'); if (up) { const f = C.pending.splice(+up.dataset.unpend, 1)[0]; if (f?.preview) URL.revokeObjectURL(f.preview); paintPending(); }
    });
    $('cSend').onclick = send;
    $('cAttach').onclick = () => $('cFile').click();
    $('cFile').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
    $('cSaved').onclick = e => NX.replies?.picker(e.currentTarget, t);
    $('cEmoji').onclick = e => emojiPicker(e.currentTarget, em => { const s = t.selectionStart; t.value = t.value.slice(0, s) + em + t.value.slice(t.selectionEnd); t.setSelectionRange(s + em.length, s + em.length); t.focus(); });
    const th = $('thread'); let depth = 0;
    th.addEventListener('dragenter', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); if (depth++ === 0) th.insertAdjacentHTML('beforeend', '<div class="drop">Drop to attach</div>'); });
    th.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    th.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; th.querySelector('.drop')?.remove(); } });
    th.addEventListener('drop', e => { e.preventDefault(); depth = 0; th.querySelector('.drop')?.remove(); addFiles([...e.dataTransfer.files]); });
  }

  // Pinned messages: everything pinned in this chat (even ones older than what's loaded)
  async function paintPinCount() {
    const el = $('tPinN'); if (!el) return;
    const { count } = await sb.from('admin_messages').select('id', { count: 'exact', head: true }).eq('room', C.room).not('pinned_at', 'is', null).eq('deleted', false);
    if ($('tPinN')) { $('tPinN').textContent = count ? ' ' + count : ''; $('tPins').hidden = !count; }
  }
  async function pinsModal() {
    const { data, error } = await sb.from('admin_messages').select('*').eq('room', C.room).not('pinned_at', 'is', null).eq('deleted', false).order('pinned_at', { ascending: false }).limit(50);
    if (error) return toast(error.message, true);
    await reveal(data || []);
    const { el, close } = NX.modal(`<h3>📌 Pinned in ${esc(roomName(C.room))}</h3><div class="pins">${(data || []).map(m => `<div class="pin" data-pin="${m.id}">${av(adminById(m.sender) || { id: m.sender, nickname: m.sender_name }, 'sm')}<div style="flex:1;min-width:0"><b>${esc(m.sender_name)}</b> <small class="muted">${NX.when(m.created_at)}</small><div class="tx">${linkify(txt(m) || '📎 attachment')}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px"><button class="btn sm" data-jumpto="${m.id}">Show</button><button class="btn sm ghost" data-unpin="${m.id}">Unpin</button></div></div>`).join('') || '<p class="muted">Nothing pinned yet. Hover a message and press 📌.</p>'}</div>`);
    el.onclick = async e => {
      const j = e.target.closest('[data-jumpto]'); if (j) { close(); const node = document.querySelector(`.m[data-id="${j.dataset.jumpto}"]`); if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); node.classList.add('flash'); setTimeout(() => node.classList.remove('flash'), 1600); } else toast('That one is further back. Scroll up and press "Load older messages".'); return; }
      const u = e.target.closest('[data-unpin]'); if (u) { await NX.rpc('admin_pin_message', { p_message: +u.dataset.unpin, p_pin: false }).catch(err => toast(err.message, true)); u.closest('.pin').remove(); const m = (C.msgs[C.room] || []).find(x => x.id === +u.dataset.unpin); if (m) { m.pinned_at = null; repaintMsg(m); } paintPinCount(); }
    };
  }

  // Unlock / first-time setup of the team passphrase
  async function lockScreen() {
    let cfg = null, err = '';
    try { cfg = await E.config(true); } catch (e) { err = e.message; }
    const high = A.level === 'high-admin';
    NX.main(`<h1>🔒 Team chat</h1><p>Team chat is end-to-end encrypted. Messages and files are scrambled in your browser before they're sent, so nobody can read them in Supabase, not even with database access.</p>
      <div class="card" style="max-width:520px">${err ? `<div class="err">${esc(err)}</div>` : cfg ? `<h3>Unlock the chat</h3><p class="muted" style="margin-top:0">Type the team passphrase. You only need to do this once on this device.</p>
        <form id="unl" class="row"><input class="field" id="pp" type="password" autocomplete="current-password" placeholder="Team passphrase" style="flex:1" required><button class="btn primary">Unlock</button></form><div class="err" id="ppErr" style="margin-top:8px"></div>
        <p class="muted">Don't know it? Ask another admin in person or on a call, never in a message.</p>`
      : high ? `<h3>Set the team passphrase</h3><p class="muted" style="margin-top:0">Pick a passphrase every admin will use to read the chat. Make it long (a short sentence is great) and share it with admins in person. If it's lost, encrypted messages can't be recovered, by anyone.</p>
        <form id="set" style="display:grid;gap:8px"><input class="field" id="p1" type="password" autocomplete="new-password" placeholder="Team passphrase (12+ characters)" required><input class="field" id="p2" type="password" autocomplete="new-password" placeholder="Type it again" required>
        <label class="muted" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pok" required> I've saved it somewhere safe. Lost passphrase = lost messages.</label><button class="btn primary">Turn on encryption</button></form><div class="err" id="ppErr" style="margin-top:8px"></div>`
      : '<h3>Not set up yet</h3><p class="muted" style="margin:0">A high-admin needs to open Admin chat once to set the team passphrase.</p>'}</div>`);
    $('unl')?.addEventListener('submit', async e => { e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Unlocking…';
      try { await E.unlock($('pp').value); toast('🔓 Unlocked on this device'); NX.pages.chat(); } catch (x) { $('ppErr').textContent = x.message; b.disabled = false; b.textContent = 'Unlock'; } });
    $('set')?.addEventListener('submit', async e => { e.preventDefault(); if ($('p1').value !== $('p2').value) { $('ppErr').textContent = "Those don't match."; return; }
      const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Turning it on…';
      try { await E.setup($('p1').value); toast('🔐 Encryption is on'); NX.pages.chat(); } catch (x) { $('ppErr').textContent = x.message; b.disabled = false; b.textContent = 'Turn on encryption'; } });
  }
  function recountAll() {
    for (const k of Object.keys(C.meta)) C.meta[k] = { last: null, unread: 0, mention: false };
    for (const m of C.recent || []) bumpMeta(m, false);
    recount();
  }
  // High-admins: encrypt messages and files from before encryption was turned on
  async function encryptOld(progress = () => {}) {
    if (!E.ready()) throw new Error('Unlock the chat first.');
    let done = 0, files = 0, from = 0;
    for (;;) {
      const { data, error } = await sb.from('admin_messages').select('*').eq('deleted', false).order('id').gt('id', from).limit(200);
      if (error) throw new Error(error.message);
      if (!data.length) break;
      for (const m of data) {
        from = m.id;
        const needBody = m.body && !E.isEnc(m.body), needAtt = (m.attachments || []).some(a => !a.e);
        if (!needBody && !needAtt) continue;
        const atts = [];
        for (const a of m.attachments || []) {
          if (a.e) { atts.push(a); continue; }
          const { data: blob } = await sb.storage.from('admin-files').download(a.path);
          if (!blob) continue;
          const path = `${m.room}/${crypto.randomUUID()}/file.bin`, sealed = await E.encBytes(await blob.arrayBuffer());
          const up = await sb.storage.from('admin-files').upload(path, new Blob([sealed], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream' });
          if (up.error) continue;
          await sb.storage.from('admin-files').remove([a.path]).catch(() => {});
          atts.push({ path, size: sealed.length, e: await E.enc(JSON.stringify({ name: a.name, mime: a.mime, size: a.size, w: a.w, h: a.h })) }); files++;
        }
        await NX.rpc('admin_encrypt_message', { p_message: m.id, p_body: needBody ? await E.enc(m.body) : m.body, p_attachments: atts });
        done++; progress(done, files);
      }
    }
    return { messages: done, files };
  }
  async function lock() { await E.lock(); plain.clear(); attMeta.clear(); Object.values(C.urls).forEach(u => u.startsWith('blob:') && URL.revokeObjectURL(u)); C.urls = {}; C.revealed = false; }

  // 1.9: for models in team chat. The room's recent messages as plain text (decrypted here, in this browser), and a way
  // to post a model's reply (encrypted like every other message).
  function contextFor(room, n = 20) {
    return (C.msgs[room] || []).filter(m => !m.deleted).slice(-n).map(m => ({ who: m.bot ? (NX.nexusChat?.agentInfo(m.bot)?.name || m.bot) : m.sender === me() ? nameOf(A.me) : m.sender_name || 'Admin', bot: m.bot || null, text: String(txt(m)).slice(0, 2000) }));
  }
  async function postBot({ room, bot, text, replyTo }) {
    const { data, error } = await sb.from('admin_messages').insert({ room, body: await E.enc(String(text).slice(0, 3900)), sender_name: (NX.nexusChat?.agentInfo(bot)?.name || bot).slice(0, 60), attachments: [], reply_to: replyTo || null, bot }).select().single();
    if (error) throw new Error(/axiom_not_allowed/.test(error.message) ? 'Axiom only answers for people allowed to use him.' : error.message);
    onMsg({ eventType: 'INSERT', new: data });
    return data;
  }
  function thinking(room, info, on) {
    if (C.room !== room || !$('msgs')) return;
    document.getElementById('botThinking')?.remove();
    if (on) { $('seen')?.insertAdjacentHTML('beforebegin', `<div class="m bot" id="botThinking"><span class="av" style="--c:${esc(info.color)}">${esc(info.short[0])}</span><div class="mb"><div class="by"><b style="color:${esc(info.color)}">${esc(info.name)}</b></div><div class="tx"><span class="typing"><i></i><i></i><i></i></span></div></div></div>`); const el = $('msgs'); el.scrollTop = el.scrollHeight; }
  }
  NX.chat = { init, encryptOld, lock, openRoom: (r, u) => openRoom(r, u), dmRoom, state: C, contextFor, postBot, thinking };
})();
