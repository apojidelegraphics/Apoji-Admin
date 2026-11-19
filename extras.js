// Apoji Admin 1.1: the task board, the command palette (⌘K), keyboard shortcuts and saved replies.
(function () {
  const { sb, $, esc, ago, toast, av, nameOf, rpc } = NX;
  const A = NX.A, P = NX.pages;

  // =========================================================== Tasks
  const T = { list: [], loaded: false, filter: NX.store.get('taskFilter', 'all') };
  const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];
  const PRI = { urgent: '🔴 Urgent', high: '🟠 High', normal: 'Normal', low: 'Low' };
  const today = () => new Date().toISOString().slice(0, 10);
  const overdue = t => t.due && t.status !== 'done' && t.due < today();
  async function loadTasks() {
    const { data, error } = await sb.from('admin_tasks').select('*').order('position');
    if (error) { T.error = NX.needSql(error.message) ? 'Run supabase/apoji-admin-1.1.sql to turn on Tasks.' : error.message; return; }
    T.list = data || []; T.loaded = true; T.error = ''; countMine();
  }
  function countMine() { A.counts.tasks = T.list.filter(t => t.assignee === A.user.id && t.status !== 'done').length; NX.updateTitle(); }
  NX.on('admin_tasks', p => {
    const t = p.new?.id ? p.new : null, old = T.list.find(x => x.id === (t?.id ?? p.old?.id));
    if (p.eventType === 'DELETE') T.list = T.list.filter(x => x.id !== p.old?.id);
    else if (t) {
      if (t.assignee === A.user.id && t.created_by !== A.user.id && old?.assignee !== A.user.id && t.status !== 'done')
        NX.notify({ kind: 'tasks', title: '✅ New task for you', body: `${t.title}${t.due ? ' · due ' + t.due : ''}`, who: NX.adminById(t.created_by), tab: 'tasks' });
      if (old) Object.assign(old, t); else T.list.push(t);
    }
    countMine();
    if (A.tab === 'tasks' && !document.querySelector('.modal')) paintBoard();
    if (A.tab === 'dashboard') paintMyDay();
  });

  P.tasks = async () => {
    if (!T.loaded) { NX.main('<h1>✅ Tasks</h1><p>Loading…</p>'); await loadTasks(); }
    NX.main(`<h1>✅ Tasks <span class="sp" style="flex:1"></span><button class="btn primary" id="tNew">＋ New task</button></h1><p>The team's to-do board. Drag cards between columns. Press <kbd>N</kbd> for a new task.</p>
      ${T.error ? `<div class="card err">${esc(T.error)}</div>` : `<div class="row" style="margin-bottom:12px"><div class="tabsub" id="tF" style="margin:0">${[['all', 'Everything'], ['mine', 'Mine'], ['none', 'Unassigned'], ['late', 'Overdue']].map(([k, l]) => `<button data-f="${k}" class="${T.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="sp"></span><input class="field" id="tQ" placeholder="Filter tasks" style="min-width:160px"></div><div class="board" id="board"></div>`}`, { cards: false });
    if (T.error) return;
    paintBoard();
    $('tF').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; T.filter = b.dataset.f; NX.store.set('taskFilter', T.filter); document.querySelectorAll('#tF button').forEach(x => x.classList.toggle('on', x === b)); paintBoard(); };
    $('tQ').oninput = () => paintBoard();
    $('tNew').onclick = () => taskModal();
    const board = $('board');
    board.onclick = e => {
      const add = e.target.closest('[data-add]'); if (add) return taskModal({ status: add.dataset.add });
      const c = e.target.closest('[data-task]'); if (c) taskModal(T.list.find(t => t.id === +c.dataset.task));
    };
    board.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.qadd')) { const v = e.target.value.trim(); if (v) { quickAdd(v, e.target.dataset.col); e.target.value = ''; } } });
    // drag and drop between columns
    board.addEventListener('dragstart', e => { const c = e.target.closest('[data-task]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.task); c.classList.add('dragging'); } });
    board.addEventListener('dragend', e => e.target.closest('[data-task]')?.classList.remove('dragging'));
    board.addEventListener('dragover', e => { const col = e.target.closest('[data-col]'); if (col) { e.preventDefault(); document.querySelectorAll('.tcol.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); } });
    board.addEventListener('dragleave', e => { const col = e.target.closest('[data-col]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
    board.addEventListener('drop', async e => {
      const col = e.target.closest('[data-col]'); if (!col) return; e.preventDefault(); col.classList.remove('over');
      const t = T.list.find(x => x.id === +e.dataTransfer.getData('text/plain')); if (!t) return;
      // position: drop above the card under the pointer, else at the end of the column
      const after = [...col.querySelectorAll('[data-task]:not(.dragging)')].find(c => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
      const colTasks = T.list.filter(x => x.status === col.dataset.col && x.id !== t.id).sort((a, b) => a.position - b.position);
      const i = after ? colTasks.findIndex(x => x.id === +after.dataset.task) : colTasks.length;
      const before = colTasks[i - 1]?.position, next = colTasks[i]?.position;
      const pos = before == null && next == null ? Date.now() / 1000 : before == null ? next - 1 : next == null ? before + 1 : (before + next) / 2;
      await saveTask(t, { status: col.dataset.col, position: pos });
    });
  };
  function visible() {
    const q = ($('tQ')?.value || '').toLowerCase();
    return T.list.filter(t => (T.filter === 'mine' ? t.assignee === A.user.id : T.filter === 'none' ? !t.assignee : T.filter === 'late' ? overdue(t) : true)
      && (!q || (t.title + ' ' + t.notes + ' ' + t.link_label).toLowerCase().includes(q)));
  }
  function card(t) {
    const who = t.assignee ? NX.adminById(t.assignee) || { id: t.assignee } : null;
    const link = t.link_kind ? `<span class="tlink">${{ feedback: '📮', user: '👤', report: '🚩' }[t.link_kind]} ${esc(t.link_label || t.link_kind + ' ' + t.link_id)}</span>` : '';
    return `<div class="tcard ${t.status === 'done' ? 'done' : ''} p-${t.priority}" draggable="true" data-task="${t.id}" tabindex="0">
      <b>${esc(t.title)}</b>${t.notes ? `<small class="muted tnotes">${esc(t.notes.slice(0, 120))}</small>` : ''}${link}
      <div class="tmeta">${t.priority !== 'normal' ? `<span class="pill p-${t.priority}">${t.priority.toUpperCase()}</span>` : ''}${t.due ? `<span class="${overdue(t) ? 'err' : 'muted'}">📅 ${t.due === today() ? 'Today' : new Date(t.due + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` : ''}<span class="sp"></span>${who ? av(who, 'sm') : '<span class="muted" title="Unassigned">—</span>'}</div></div>`;
  }
  function paintBoard() {
    const el = $('board'); if (!el) return;
    const list = visible();
    el.innerHTML = COLS.map(([k, l]) => { const items = list.filter(t => t.status === k).sort((a, b) => k === 'done' ? new Date(b.done_at) - new Date(a.done_at) : a.position - b.position);
      return `<div class="tcol" data-col="${k}"><h4>${l} <span class="muted">${items.length}</span><button data-add="${k}" title="Add a task">＋</button></h4>
        ${items.slice(0, k === 'done' ? 30 : 200).map(card).join('')}${k !== 'done' ? `<input class="field qadd" data-col="${k}" placeholder="＋ Quick add, press Enter">` : items.length > 30 ? `<p class="muted">${items.length - 30} older done tasks hidden</p>` : ''}</div>`; }).join('');
  }
  async function quickAdd(title, status) {
    const { error } = await sb.from('admin_tasks').insert({ title: title.slice(0, 200), status, created_by: A.user.id, assignee: T.filter === 'mine' ? A.user.id : null });
    if (error) toast(error.message, true); else { await loadTasks(); paintBoard(); }
  }
  async function saveTask(t, patch) {
    Object.assign(t, patch); paintBoard();
    const { error } = await sb.from('admin_tasks').update(patch).eq('id', t.id);
    if (error) { toast(error.message, true); await loadTasks(); paintBoard(); }
  }
  // New or edit. seed: { title, notes, status, link_kind, link_id, link_label }
  function taskModal(t = {}) {
    const isNew = !t.id;
    const { el, close } = NX.modal(`<h3>${isNew ? '✅ New task' : '✅ Task'}</h3>
      <div style="display:grid;gap:8px"><input class="field" id="mtT" maxlength="200" placeholder="What needs doing?" value="${esc(t.title || '')}">
      <textarea class="field" id="mtN" rows="3" maxlength="4000" placeholder="Notes (optional)">${esc(t.notes || '')}</textarea>
      <div class="row"><select class="field" id="mtS">${COLS.map(([k, l]) => `<option value="${k}" ${(t.status || 'todo') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="field" id="mtP">${Object.entries(PRI).map(([k, l]) => `<option value="${k}" ${(t.priority || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="field" id="mtD" type="date" value="${esc(t.due || '')}" title="Due date"></div>
      <select class="field" id="mtA"><option value="">Unassigned</option>${A.admins.map(a => `<option value="${esc(a.id)}" ${t.assignee === a.id ? 'selected' : ''}>${esc(nameOf(a))}${a.id === A.user.id ? ' (me)' : ''}</option>`).join('')}</select>
      ${t.link_kind ? `<div class="row"><span class="tlink">${{ feedback: '📮 Feedback', user: '👤 User', report: '🚩 Report' }[t.link_kind]}: ${esc(t.link_label || t.link_id)}</span><button class="btn sm" id="mtOpen">Open</button></div>` : ''}
      ${!isNew ? `<p class="muted" style="margin:0">Added by ${esc(nameOf(NX.adminById(t.created_by)))} ${ago(t.created_at)}${t.done_at ? ` · done ${ago(t.done_at)}` : ''}</p>` : ''}
      <div class="row"><span class="err" id="mtE" style="flex:1"></span>${!isNew ? '<button class="btn danger" id="mtDel">Delete</button>' : ''}<button class="btn primary" id="mtGo">${isNew ? 'Add task' : 'Save'}</button></div></div>`);
    setTimeout(() => $('mtT')?.focus(), 30);
    el.querySelector('#mtGo').onclick = async () => {
      const row = { title: $('mtT').value.trim(), notes: $('mtN').value.trim(), status: $('mtS').value, priority: $('mtP').value, due: $('mtD').value || null, assignee: $('mtA').value || null };
      if (!row.title) return ($('mtE').textContent = 'Give it a title.');
      const res = isNew ? await sb.from('admin_tasks').insert({ ...row, created_by: A.user.id, link_kind: t.link_kind || '', link_id: t.link_id || '', link_label: t.link_label || '' })
        : await sb.from('admin_tasks').update(row).eq('id', t.id);
      if (res.error) return ($('mtE').textContent = NX.needSql(res.error.message) ? 'Run supabase/apoji-admin-1.1.sql to turn on Tasks.' : res.error.message);
      close(); toast(isNew ? '✓ Task added' : '✓ Saved'); await loadTasks(); if (A.tab === 'tasks') paintBoard();
    };
    el.querySelector('#mtDel')?.addEventListener('click', async () => { if (!confirm('Delete this task?')) return; const { error } = await sb.from('admin_tasks').delete().eq('id', t.id); if (error) return toast(error.message, true); close(); await loadTasks(); paintBoard(); });
    el.querySelector('#mtOpen')?.addEventListener('click', () => { close(); openLink(t); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el.querySelector('#mtGo').click(); });
  }
  function openLink(t) {
    if (t.link_kind === 'feedback') NX.go('feedback', { arg: t.link_id });
    else if (t.link_kind === 'user') NX.userDrawer(t.link_id);
    else if (t.link_kind === 'report') NX.go('reports');
  }
  // "Your day" on the dashboard
  async function paintMyDay() {
    const el = $('myDay'); if (!el) return;
    if (!T.loaded) await loadTasks();
    const mine = T.list.filter(t => t.assignee === A.user.id && t.status !== 'done').sort((a, b) => (a.due || '9') .localeCompare(b.due || '9'));
    const { count: fb } = await sb.from('feedback_reports').select('*', { count: 'exact', head: true }).eq('assignee', A.user.id).in('status', ['new', 'triaged', 'working']);
    const hi = new Date().getHours(), hello = hi < 12 ? 'Good morning' : hi < 18 ? 'Good afternoon' : 'Good evening';
    el.innerHTML = `<h3>${hello}, ${esc(nameOf(A.me))} <span class="sp"></span><button class="btn sm" data-go="tasks">Board</button></h3>
      <div class="row" style="gap:16px;margin-bottom:8px"><span><b>${mine.length}</b> <span class="muted">open task${mine.length === 1 ? '' : 's'}</span></span><span><b class="${mine.some(overdue) ? 'err' : ''}">${mine.filter(overdue).length}</b> <span class="muted">overdue</span></span>
        <span><b>${fb || 0}</b> <span class="muted">feedback assigned to you</span></span><span><b>${A.counts.chat || 0}</b> <span class="muted">unread in chat</span></span></div>
      ${mine.slice(0, 5).map(t => `<div class="row mdt" data-task="${t.id}"><span>${t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '•'}</span><span style="flex:1">${esc(t.title)}</span>${t.due ? `<span class="${overdue(t) ? 'err' : 'muted'}">${t.due === today() ? 'today' : (overdue(t) ? 'was due ' : '') + new Date(t.due + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">Nothing on your plate. ✨</p>'}`;
    el.onclick = e => { const g = e.target.closest('[data-go]'); if (g) return NX.go(g.dataset.go); const r = e.target.closest('[data-task]'); if (r) taskModal(T.list.find(t => t.id === +r.dataset.task)); };
  }

  // =========================================================== Saved replies
  const replies = () => Array.isArray(A.prefs.saved_replies) ? A.prefs.saved_replies : [];
  // A small picker anchored to a button; pick → insert into the textarea
  function replyPicker(anchor, textarea) {
    document.querySelector('.rpick')?.remove();
    const list = replies();
    const box = document.createElement('div'); box.className = 'rpick';
    box.innerHTML = (list.map((r, i) => `<button data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.b.slice(0, 90))}</small></button>`).join('') || '<p class="muted">No saved replies yet.</p>') + '<button data-manage><small>⚙︎ Manage saved replies</small></button>';
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, r.left)) + 'px';
    box.style.top = Math.max(8, r.top - box.offsetHeight - 6) + 'px';
    box.onclick = e => {
      if (e.target.closest('[data-manage]')) { box.remove(); return NX.go('me'); }
      const b = e.target.closest('[data-r]'); if (!b) return;
      const text = list[+b.dataset.r].b.replace(/\{name\}/g, textarea.dataset.name || 'there').replace(/\{me\}/g, nameOf(A.me));
      const s = textarea.selectionStart ?? textarea.value.length;
      textarea.value = textarea.value.slice(0, s) + text + textarea.value.slice(textarea.selectionEnd ?? s); textarea.focus(); textarea.dispatchEvent(new Event('input', { bubbles: true })); box.remove();
    };
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  function repliesCard() {
    return `<div class="card"><h3>⚡ Saved replies</h3><p class="muted" style="margin-top:0">Snippets for feedback replies and chat (the ⚡ button). <code>{name}</code> becomes the person's name, <code>{me}</code> yours.</p>
      <div id="srList">${replies().map((r, i) => `<div class="row" style="padding:5px 0;border-bottom:1px solid rgba(var(--rgb),.07);flex-wrap:nowrap"><span style="flex:1;min-width:0"><b>${esc(r.t)}</b><small class="muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.b)}</small></span><button class="btn sm ghost" data-srdel="${i}">🗑</button></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
      <div style="display:grid;gap:6px;margin-top:10px"><input class="field" id="srT" maxlength="40" placeholder="Name, e.g. Thanks + looking into it"><textarea class="field" id="srB" rows="2" maxlength="2000" placeholder="Hi {name}! Thanks for the report, we're looking into it."></textarea><div class="row"><span class="sp"></span><button class="btn primary" id="srAdd">Save reply</button></div></div></div>`;
  }
  async function repliesClick(e) {
    const del = e.target.closest('[data-srdel]');
    if (del) { const next = replies().filter((_, i) => i !== +del.dataset.srdel); if (await NX.savePrefs({ saved_replies: next })) P.me(); return true; }
    if (e.target.id === 'srAdd') {
      const t = $('srT').value.trim(), b = $('srB').value.trim(); if (!t || !b) { toast('Give it a name and some text.', true); return true; }
      if (replies().length >= 50) { toast('50 saved replies max.', true); return true; }
      if (await NX.savePrefs({ saved_replies: [...replies(), { t, b }] })) { toast('✓ Saved'); P.me(); }
      return true;
    }
    return false;
  }

  // =========================================================== Command palette (⌘K) + shortcuts
  const PAGES = [['dashboard', '◎', 'Dashboard'], ['chat', '💬', 'Team chat'], ['tasks', '✅', 'Tasks'], ['notes', '📓', 'Team notes'], ['requests', '🧪', 'Beta requests'], ['feedback', '📮', 'Feedback & bugs'], ['reports', '🚩', 'Reports'],
    ['users', '👤', 'Users'], ['moderation', '🛡', 'Moderation'], ['perms', '🔐', 'Admin access'], ['testing', '🧪', 'Testing'], ['training', '🧠', 'Training'], ['flags', '⚑', 'Feature flags'], ['beta', 'β', 'Beta'], ['announce', '📣', 'Announcements'], ['broadcast', '📡', 'Broadcasts'], ['maint', '🛠', 'Maintenance'], ['status', '🟢', 'Status page'], ['schedules', '⏰', 'Schedules'],
    ['health', '🩺', 'Health'], ['releases', '🚀', 'Releases'], ['axiom', '🔺', 'Axiom (Apex) · Containment Sector 28'], ['prompts', '✍', 'Agent prompts'], ['access', '🔑', 'Access requests'], ['audit', '📜', 'Audit log'], ['hub', '🖥', window.apojiDesktop ? (/Windows/.test(navigator.userAgent) ? 'This PC' : 'This Mac') : 'Desktop hub'], ['me', '⚙︎', 'My settings']];
  function actions() {
    return [
      { ic: '✅', label: 'New task', words: 'add todo', run: () => taskModal() },
      { ic: '👥', label: 'New group chat', words: 'create room', run: () => { NX.go('chat'); setTimeout(() => document.getElementById('newGroup')?.click(), 400); } },
      { ic: '⛔', label: 'Status: Do not disturb', words: 'dnd quiet mute', run: () => NX.savePrefs({ status: 'dnd' }).then(() => toast('⛔ Do not disturb')) },
      { ic: '🟢', label: 'Status: Automatic', words: 'online available', run: () => NX.savePrefs({ status: 'auto' }).then(() => toast('🟢 Online')) },
      { ic: '⚪', label: 'Status: Invisible', words: 'hide offline', run: () => NX.savePrefs({ status: 'invisible' }).then(() => toast('⚪ Invisible')) },
      { ic: '🔒', label: 'Lock admin chat on this device', words: 'encryption passphrase', run: async () => { await NX.chat.lock(); toast('🔒 Locked'); if (A.tab === 'chat') NX.pages.chat(); } },
      { ic: '📡', label: 'New broadcast', words: 'notify everyone push message', run: () => NX.go('broadcast') },
      { ic: '⏰', label: 'Run due schedules now', words: 'jobs schedule', run: () => NX.hub?.runNow() },
      { ic: '📓', label: 'New team note', words: 'doc playbook write', run: () => { NX.go('notes'); setTimeout(() => document.getElementById('nNew')?.click(), 500); } },
      { ic: '⌨', label: 'Keyboard shortcuts', words: 'help keys', run: () => shortcutsHelp() }
    ];
  }
  let palSeq = 0;
  function palette() {
    if (document.querySelector('.palette')) return;
    const { el, close } = NX.modal('<input class="field" id="palQ" placeholder="Jump to a page, person, user, report or task…" autocomplete="off" style="width:100%;font-size:16px"><div class="palres" id="palR"></div><p class="muted" style="margin:8px 0 0;font-size:12px">↑↓ to move · Enter to open · Esc to close</p>');
    el.classList.add('palette'); el.querySelector('[data-x]')?.remove();
    let items = [], sel = 0;
    const paint = () => { $('palR').innerHTML = items.map((it, i) => `${it.group && it.group !== items[i - 1]?.group ? `<h6>${esc(it.group)}</h6>` : ''}<button data-i="${i}" class="${i === sel ? 'on' : ''}"><span class="pic">${it.icHtml || esc(it.ic || '•')}</span><span class="pl">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('') || '<p class="muted" style="padding:10px">Nothing found.</p>';
      $('palR').querySelector('.on')?.scrollIntoView({ block: 'nearest' }); };
    const run = it => { if (!it) return; close(); it.run(); };
    async function search(q) {
      const seq = ++palSeq, ql = q.toLowerCase().trim();
      const m = s => !ql || s.toLowerCase().includes(ql);
      items = [
        ...PAGES.filter(([, , l]) => m(l)).map(([k, ic, l]) => ({ group: 'Pages', ic, label: l, run: () => NX.go(k) })),
        ...actions().filter(a => m(a.label + ' ' + a.words)).map(a => ({ group: 'Actions', ...a })),
        ...A.admins.filter(a => a.id !== A.user.id && m(nameOf(a) + ' ' + (a.email || ''))).slice(0, 6).map(a => ({ group: 'Message an admin', icHtml: av(a, 'sm', true), label: nameOf(a), sub: a.level, run: () => { NX.go('chat'); setTimeout(() => NX.chat.openRoom(NX.chat.dmRoom(a.id), true), 300); } })),
        ...(ql ? T.list.filter(t => m(t.title)).slice(0, 5).map(t => ({ group: 'Tasks', ic: t.status === 'done' ? '☑' : '☐', label: t.title, sub: t.status, run: () => { NX.go('tasks'); setTimeout(() => taskModal(t), 300); } })) : [])
      ];
      sel = 0; paint();
      if (ql.length < 2) return;
      const [u, f] = await Promise.all([rpc('admin_list_users', { p_search: ql, p_filter: 'all', p_limit: 5, p_offset: 0, p_sort: 'new' }).catch(() => null),
        sb.from('feedback_reports').select('id,title,status').ilike('title', `%${ql.replace(/[%_,()]/g, '')}%`).order('updated_at', { ascending: false }).limit(5)]);
      if (seq !== palSeq) return;
      items.push(...(u?.users || []).map(x => ({ group: 'Users', icHtml: av({ id: x.id, nickname: x.nickname || x.username, avatar_url: x.avatar_url }, 'sm'), label: x.nickname || x.username || x.email, sub: x.email, run: () => NX.userDrawer(x.id) })),
        ...(f.data || []).map(x => ({ group: 'Feedback', ic: '📮', label: x.title, sub: `#${x.id} · ${x.status}`, run: () => NX.go('feedback', { arg: x.id }) })));
      paint();
    }
    const q = $('palQ'); let t;
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => search(q.value), 120); };
    q.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
      if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
    };
    $('palR').onclick = e => { const b = e.target.closest('[data-i]'); if (b) run(items[+b.dataset.i]); };
    search(''); setTimeout(() => q.focus(), 20);
  }
  const KEYS = { d: 'dashboard', c: 'chat', t: 'tasks', o: 'notes', b: 'requests', f: 'feedback', r: 'reports', u: 'users', m: 'moderation', a: 'announce', p: 'broadcast', j: 'schedules', h: 'health', l: 'releases', x: 'hub', s: 'me' };
  function shortcutsHelp() {
    NX.modal(`<h3>⌨ Keyboard shortcuts</h3><div class="keys">
      <div><kbd>⌘</kbd><kbd>K</kbd> or <kbd>Ctrl</kbd><kbd>K</kbd><span>Search and jump anywhere</span></div>
      ${Object.entries(KEYS).map(([k, t]) => `<div><kbd>G</kbd><kbd>${k.toUpperCase()}</kbd><span>Go to ${esc(PAGES.find(p => p[0] === t)[2])}</span></div>`).join('')}
      <div><kbd>N</kbd><span>New task</span></div><div><kbd>?</kbd><span>This list</span></div><div><kbd>Esc</kbd><span>Close a panel</span></div></div>`);
  }
  let gAt = 0;
  addEventListener('keydown', e => {
    if (!A.user) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return palette(); }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.modal, .drawer')) return;
    if (e.key === '?') { e.preventDefault(); return shortcutsHelp(); }
    if (e.key === 'g') { gAt = Date.now(); return; }
    if (Date.now() - gAt < 1200 && KEYS[e.key]) { gAt = 0; e.preventDefault(); return NX.go(KEYS[e.key]); }
    if (e.key === 'n') { e.preventDefault(); taskModal(); }
  });

  NX.tasks = { load: loadTasks, modal: taskModal, paintMyDay };
  NX.replies = { picker: replyPicker, card: repliesCard, click: repliesClick };
  NX.palette = palette; NX.shortcutsHelp = shortcutsHelp;
  // Load tasks once signed in (for the badge, the dashboard and the palette)
  const wait = setInterval(() => { if (A.user && A.admins.length) { clearInterval(wait); loadTasks(); } }, 300);
})();
