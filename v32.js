// Apoji Admin 3.2 (needs supabase/apoji-admin-3.2.sql, after nexus-v4.0.6.sql):
//   • Testing, rebuilt: release chips with progress, one list you open item by item, filters, your own ✅/❌ right there,
//     and "Add from release notes" that reads the Nexus release notes or any release plan, lets you trim each title and pick
//     where it runs, and skips what's already there.
//   • Profiles & frames: everyone's profile looks (custom banners, things made in the shop, bios, reported profiles, pictures
//     waiting for review) with resets that tell the person why.
//   • One Apoji account: your Apoji profile in My settings (status, names, bio, a link code for aARgon3, where you use Apoji),
//     and each user's Apoji profile in their drawer.
//   • Status page: link incidents to known issues and the release that fixes them.
//   • Apoji-wide search in ⌘K: known issues, incidents, release plans, test items, Spaces and profiles.
(function () {
  const { sb, $, esc, ago, when, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL32 = 'Run supabase/apoji-admin-3.2.sql (this repo) in Supabase → SQL Editor to turn this on.';
  const need32 = m => /admin_profiles|admin_profile_|admin_search|PGRST20|42883|does not exist/i.test(m || '');
  const NC = () => window.NexusCosmetics;

  // =========================================================== Testing
  const PLAT = { all: 'Everywhere', mac: 'Mac', windows: 'Windows', web: 'Test Run', phone: 'N28C', admin: 'Apoji Admin' };
  const T = { rel: A.testRel || '', filter: 'all', plat: '', q: '', open: new Set() };
  const vcmp = (a, b) => { const p = v => String(v).replace(/^v/, '').split(/[.-]/).map(x => +x || 0); const x = p(a), y = p(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
  // a short title from a release note: the part before ":" if that's a name, else the first sentence
  NX.testTitle = h => {
    let s = String(h || '').replace(/\s+/g, ' ').trim().replace(/^(fixed|new|fix|feature)\s*[:\-–]\s*/i, '');
    const colon = s.indexOf(': '); if (colon > 3 && colon <= 70) return s.slice(0, colon);
    const dot = s.search(/[.!?](\s|$)/); if (dot > 10 && dot <= 110) s = s.slice(0, dot);
    return s.length > 110 ? s.slice(0, 107).replace(/\s+\S*$/, '') + '…' : s;
  };
  NX.testPlatform = (h, apps = []) => {
    if (/\bwindows\b|\bpc\b/i.test(h) && !/\bmac\b/i.test(h)) return 'windows';
    if (/\bmac\b/i.test(h) && !/\bwindows|\bpc\b/i.test(h)) return 'mac';
    if (/test run/i.test(h)) return 'web';
    if (/N28C|phone/i.test(h)) return 'phone';
    if (/apoji admin|\badmin\b/i.test(h) || (apps.length === 1 && apps[0] === 'admin')) return 'admin';
    return 'all';
  };
  const stateOf = rs => !rs.length ? 'untested' : rs.some(r => r.status === 'fail') ? 'fail' : rs.every(r => r.status === 'skip') ? 'untested' : 'pass';
  P.testing = async () => {
    const [{ data: items, error }, { data: res }] = await Promise.all([
      sb.from('test_items').select('*').eq('archived', false).order('sort').order('id'), sb.from('test_results').select('*')]);
    if (A.tab !== 'testing') return;
    if (error) return NX.main(`<h1>Testing</h1><div class="card">${esc(error.message)}</div>`, { cards: false });
    const rels = [...new Set((items || []).map(i => i.release))].sort(vcmp);
    if (!T.rel || !rels.includes(T.rel)) T.rel = rels[0] || '';
    A.testRel = T.rel;
    const byItem = {}; for (const r of res || []) (byItem[r.item_id] ||= []).push(r);
    const can = NX.can('testing'), all = (items || []).filter(i => i.release === T.rel);
    const relStats = rel => { const its = (items || []).filter(i => i.release === rel), st = its.map(i => stateOf(byItem[i.id] || [])); return { n: its.length, pass: st.filter(s => s === 'pass').length, fail: st.filter(s => s === 'fail').length }; };
    const counts = { all: all.length, untested: 0, fail: 0, pass: 0 }; all.forEach(i => counts[stateOf(byItem[i.id] || [])]++);
    const ql = T.q.toLowerCase();
    const list = all.filter(i => (T.filter === 'all' || stateOf(byItem[i.id] || []) === T.filter) && (!T.plat || i.platform === T.plat || i.platform === 'all') && (!ql || (i.title + ' ' + i.steps).toLowerCase().includes(ql)));
    const name = id => { const a = NX.adminById?.(id); return a ? NX.nameOf(a) : 'a tester'; };
    const ring = s => { const p = s.n ? Math.round(s.pass / s.n * 100) : 0; return `<i class="t-ring ${s.fail ? 'bad' : p === 100 ? 'ok' : ''}" style="--p:${p}"></i>`; };
    NX.main(`<h1>Testing</h1><p>What to check before each release. Beta testers tick items off in Nexus (Settings → Beta → Needs testing) and Test Run. Open an item to see its steps, everyone's results, and to add your own.</p>
      <div class="t-top"><div class="t-rels">${rels.map(r => { const s = relStats(r); return `<button data-trel="${esc(r)}" class="${r === T.rel ? 'on' : ''}">${ring(s)}<b>${esc(r)}</b><small>${s.pass}/${s.n}${s.fail ? ` · ${s.fail} failing` : ''}</small></button>`; }).join('') || '<span class="muted">No releases yet.</span>'}</div>
        <div class="t-acts">${can ? `<button class="btn primary" id="tFill">Add from release notes</button><button class="btn" id="tAdd">Add an item</button>${T.rel ? '<button class="btn" id="tAssign">Assign to testers</button>' : ''}` : (NX.reqButton ? NX.reqButton('testing') : '')}</div></div>
      <div id="tGate"></div>
      ${all.length ? `<div class="t-bar"><div class="seg" id="tFil">${[['all', 'All'], ['untested', 'Needs testing'], ['fail', 'Failing'], ['pass', 'Passed']].map(([k, l]) => `<button data-tf="${k}" class="${T.filter === k ? 'on' : ''}">${l} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
        <select class="field" id="tPlat"><option value="">Every platform</option>${Object.entries(PLAT).filter(([k]) => k !== 'all').map(([k, l]) => `<option value="${k}" ${T.plat === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input class="field" id="tQ" placeholder="Find an item" value="${esc(T.q)}"></div>` : ''}
      <div class="t-list">${list.map(i => {
        const rs = byItem[i.id] || [], st = stateOf(rs), mine = rs.find(r => r.user_id === A.user.id), pass = rs.filter(r => r.status === 'pass').length, fail = rs.filter(r => r.status === 'fail').length, open = T.open.has(i.id);
        return `<div class="t-item ${st} ${open ? 'open' : ''}" data-ti="${i.id}">
          <button class="t-head" data-thead="${i.id}"><i class="t-dot"></i><span class="t-title">${esc(i.title)}</span><span class="t-plat">${esc(PLAT[i.platform] || i.platform)}</span>
            <span class="t-res">${pass ? `<span class="tg pass">✓ ${pass}</span>` : ''}${fail ? `<span class="tg fail">✕ ${fail}</span>` : ''}${!rs.length ? '<span class="muted">not tested</span>' : ''}</span><span class="t-chev">›</span></button>
          ${open ? `<div class="t-body">
            ${i.steps && i.steps !== i.title ? `<div class="t-steps">${esc(i.steps)}</div>` : ''}
            <div class="t-mine"><span class="muted">Your result</span>${['pass', 'fail', 'skip'].map(s => `<button class="btn sm ${mine?.status === s ? 'primary' : ''}" data-tmine="${i.id}" data-st="${s}">${{ pass: '✓ Works', fail: '✕ Broken', skip: 'Skip' }[s]}</button>`).join('')}
              <select class="field" data-tmplat="${i.id}">${Object.entries(PLAT).filter(([k]) => k !== 'all').map(([k, l]) => `<option value="${k}" ${(mine?.platform || (i.platform !== 'all' ? i.platform : 'admin')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <input class="field" data-tmnote="${i.id}" placeholder="Note (what happened)" value="${esc(mine?.note || '')}"></div>
            ${rs.filter(r => r.user_id !== A.user.id || r.image || r.note).length ? rs.map(r => `<div class="test-res ${r.status}"><span><b>${{ pass: '✓', fail: '✕', skip: '–' }[r.status]} ${esc(name(r.user_id))}</b> <span class="muted">${esc(PLAT[r.platform] || r.platform || '')} · ${ago(r.updated_at)}</span></span>${r.note ? `<div>${esc(r.note)}</div>` : ''}${r.image ? `<div class="fb-pic" data-fbimg="${esc(r.image)}"><span class="spinner"></span></div>` : ''}
              <div class="test-acts">${r.status === 'fail' ? `<button class="btn sm" data-tbug="${i.id}|${r.user_id}">Make it a bug report</button>` : ''}${can && r.user_id !== A.user.id ? `<button class="btn sm ghost" data-treply="${i.id}|${r.user_id}">${r.reply ? 'Edit reply' : 'Reply'}</button>` : ''}</div>
              ${r.reply ? `<div class="test-reply"><span class="muted">Reply · ${ago(r.reply_at)}</span><div>${esc(r.reply)}</div></div>` : ''}</div>`).join('') : ''}
            ${can ? `<div class="row t-itacts"><span class="sp"></span><button class="btn sm ghost" data-tedit="${i.id}">Edit</button><button class="btn sm ghost" data-tarch="${i.id}">Archive</button></div>` : ''}</div>` : ''}</div>`; }).join('') || (all.length ? '<div class="card empty">Nothing matches.</div>' : `<div class="card empty">Nothing to test for ${esc(T.rel || 'this release')} yet.${can ? ' Add items from the release notes, or one at a time.' : ''}</div>`)}</div>`, { cards: false });
    if (T.rel && NX.testGateCard) NX.testGateCard(T.rel).then(h => { if ($('tGate') && A.tab === 'testing') $('tGate').innerHTML = h || ''; }).catch(() => {});
    NX.loadPics?.($('main'));
    const main = $('main');
    const tQ = $('tQ'); if (tQ) { let t; tQ.oninput = () => { clearTimeout(t); t = setTimeout(() => { T.q = tQ.value; P.testing().then(() => { const n = $('tQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 250); }; }
    main.onchange = async e => {
      if (e.target.id === 'tPlat') { T.plat = e.target.value; return P.testing(); }
      if (e.target.dataset.tmnote) { const id = +e.target.dataset.tmnote, mine = (byItem[id] || []).find(r => r.user_id === A.user.id); if (mine) await saveMine(id, mine.status); }
    };
    async function saveMine(id, status) {
      const plat = main.querySelector(`[data-tmplat="${id}"]`)?.value || 'admin', note = main.querySelector(`[data-tmnote="${id}"]`)?.value.trim() || '';
      const { error: er } = await sb.from('test_results').upsert({ item_id: id, user_id: A.user.id, status, platform: plat, note: note.slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: 'item_id,user_id' });
      if (er) return toast(er.message, true); toast(status === 'pass' ? 'Marked as working' : status === 'fail' ? 'Marked as broken' : 'Skipped'); P.testing();
    }
    main.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.trel) { T.rel = b.dataset.trel; T.open.clear(); return P.testing(); }
      if (b.dataset.tf) { T.filter = b.dataset.tf; return P.testing(); }
      if (b.dataset.thead) { const id = +b.dataset.thead; T.open.has(id) ? T.open.delete(id) : T.open.add(id); return P.testing(); }
      if (b.dataset.tmine) return saveMine(+b.dataset.tmine, b.dataset.st);
      if (b.id === 'tAssign') return NX.testAssign?.(T.rel);
      if (b.id === 'tAdd' || b.dataset.tedit) return editItem(b.dataset.tedit ? all.find(x => x.id === +b.dataset.tedit) : null);
      if (b.id === 'tFill') return fillModal(items || []);
      if (b.dataset.tarch) { if (!confirm('Archive this item? Its results stay in the database.')) return; const { error: er } = await sb.from('test_items').update({ archived: true }).eq('id', +b.dataset.tarch); if (er) return toast(er.message, true); toast('Archived'); return P.testing(); }
      if (b.dataset.tbug) {
        const [iid, uid] = b.dataset.tbug.split('|'); b.disabled = true;
        const { data, error: er } = await sb.rpc('admin_test_to_bug', { p_item: +iid, p_user: uid }); b.disabled = false;
        if (er || !data?.ok) return toast(er?.message || data?.error || 'Couldn’t make it.', true);
        toast('Bug report made'); return NX.go('feedback', { arg: String(data.id) });
      }
      if (b.dataset.treply) {
        const [iid, uid] = b.dataset.treply.split('|'), r = (byItem[iid] || []).find(x => x.user_id === uid);
        const body = await NX.ask(`Reply to ${name(uid)}`, { value: r?.reply || '', placeholder: 'Fixed in the next build, can you try again?', ok: 'Send reply', note: 'They see it in Nexus with a notification. Empty removes the reply.' });
        if (body === null || body === undefined) return;
        const { data, error: er } = await sb.rpc('admin_test_reply', { p_item: +iid, p_user: uid, p_body: String(body) });
        if (er || !data?.ok) return toast(er?.message || data?.error || 'Couldn’t send it.', true); toast(String(body).trim() ? 'Reply sent' : 'Reply removed'); return P.testing();
      }
    };
    function editItem(it) {
      const { el, close } = NX.modal(`<h3>${it ? 'Edit item' : 'Add a test item'}</h3><div class="acct-grid"><label>Release</label><input class="field" id="tiR" value="${esc(it?.release || T.rel || '')}" placeholder="4.0.7">
        <label>Where</label><select class="field" id="tiP">${Object.entries(PLAT).map(([k, l]) => `<option value="${k}" ${(it?.platform || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>What to check</label><input class="field" id="tiT" value="${esc(it?.title || '')}" maxlength="200" placeholder="Widgets stay where you put them after a restart">
        <label>Steps</label><textarea class="field" id="tiS" rows="5" maxlength="2000" placeholder="1. Drag a widget to the left edge&#10;2. Quit Nexus and open it again&#10;3. The widget is still at the left edge">${esc(it?.steps || '')}</textarea></div>
        <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="tiGo">Save</button></div>`);
      el.querySelector('#tiGo').onclick = async () => {
        const row = { release: el.querySelector('#tiR').value.trim(), platform: el.querySelector('#tiP').value, title: el.querySelector('#tiT').value.trim(), steps: el.querySelector('#tiS').value.trim() };
        if (!row.release || !row.title) return toast('Give it a release and what to check.', true);
        const { error: er } = it ? await sb.from('test_items').update(row).eq('id', it.id) : await sb.from('test_items').insert({ ...row, created_by: A.user.id, sort: all.length });
        if (er) return toast(er.message, true); T.rel = row.release; close(); toast('Saved'); P.testing();
      };
    }
  };
  // Add from release notes: the Nexus release notes (any version) or one of the release plans here
  async function fillModal(items) {
    const { el, close } = NX.modal(`<h3>Add from release notes</h3>
      <div class="seg" id="fSrc"><button data-src="notes" class="on">Nexus release notes</button><button data-src="plans">Release plans</button></div>
      <div class="row" style="margin:10px 0"><select class="field" id="fPick" style="flex:1"><option>Loading…</option></select><span class="sp"></span><button class="btn sm ghost" id="fAll">All</button><button class="btn sm ghost" id="fNone">None</button></div>
      <div id="fRows" class="f-rows"><span class="spinner"></span></div>
      <div class="row" style="margin-top:12px"><span class="muted" id="fN"></span><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="fGo">Add</button></div>`);
    el.classList.add('wide-modal');
    let src = 'notes', notes = null, plans = null, rows = [];
    const have = rel => new Set(items.filter(i => i.release === rel).map(i => i.title.toLowerCase()));
    const paintRows = rel => {
      const h = have(rel);
      el.querySelector('#fRows').innerHTML = rows.length ? rows.map((r, k) => { const dup = h.has(r.title.toLowerCase());
        return `<div class="f-row ${dup ? 'dup' : ''}"><input type="checkbox" data-fk="${k}" ${dup ? 'disabled' : 'checked'}><div class="f-main"><input class="field" data-ft="${k}" value="${esc(r.title)}" maxlength="200">
          <details><summary class="muted">${dup ? 'Already in Testing' : 'Steps (the full note)'}</summary><textarea class="field" data-fs="${k}" rows="3" maxlength="2000">${esc(r.steps)}</textarea></details></div>
          <select class="field" data-fp="${k}">${Object.entries(PLAT).map(([p, l]) => `<option value="${p}" ${r.platform === p ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`; }).join('') : '<p class="muted">Nothing in this one.</p>';
      count();
    };
    const count = () => { el.querySelector('#fN').textContent = `${el.querySelectorAll('[data-fk]:checked').length} to add`; };
    const load = async () => {
      const pick = el.querySelector('#fPick');
      if (src === 'notes') {
        if (!notes) { try { notes = await (await fetch('https://apojidelegraphics.github.io/Nexus-28/whats-new/changes.json', { cache: 'no-store' })).json(); } catch { notes = []; } }
        pick.innerHTML = notes.map((v, k) => `<option value="${k}">Nexus ${esc(v.version)}${v.title ? ' · ' + esc(v.title) : ''}</option>`).join('') || '<option>Couldn’t read the release notes</option>';
      } else {
        if (!plans) { const { data } = await sb.from('admin_release_plans').select('id,version,title,apps,items,status').neq('status', 'dropped').order('updated_at', { ascending: false }).limit(40); plans = data || []; }
        pick.innerHTML = plans.map((p, k) => `<option value="${k}">${esc(p.version)}${p.title ? ' · ' + esc(p.title) : ''} (${esc((p.apps || []).join(', ') || 'no app')})</option>`).join('') || '<option>No release plans</option>';
      }
      pickOne();
    };
    const pickOne = () => {
      const k = +el.querySelector('#fPick').value || 0;
      if (src === 'notes') { const v = notes[k]; if (!v) { rows = []; return paintRows(''); } rows = (v.highlights || []).map(h => ({ release: v.version, title: NX.testTitle(h), steps: h, platform: NX.testPlatform(h) })); el.dataset.rel = v.version; return paintRows(v.version); }
      const p = plans[k]; if (!p) { rows = []; return paintRows(''); }
      rows = (p.items || []).filter(it => (it.text || '').trim() && it.kind !== 'chore').map(it => ({ release: p.version, title: NX.testTitle(it.text), steps: it.text, platform: NX.testPlatform(it.text, p.apps || []) }));
      el.dataset.rel = p.version; paintRows(p.version);
    };
    el.querySelector('#fSrc').onclick = e => { const b = e.target.closest('[data-src]'); if (!b) return; src = b.dataset.src; el.querySelectorAll('#fSrc button').forEach(x => x.classList.toggle('on', x === b)); load(); };
    el.querySelector('#fPick').onchange = pickOne;
    el.querySelector('#fAll').onclick = () => { el.querySelectorAll('[data-fk]:not(:disabled)').forEach(x => { x.checked = true; }); count(); };
    el.querySelector('#fNone').onclick = () => { el.querySelectorAll('[data-fk]').forEach(x => { x.checked = false; }); count(); };
    el.querySelector('#fRows').onchange = count;
    el.querySelector('#fGo').onclick = async () => {
      const rel = el.dataset.rel, start = items.filter(i => i.release === rel).length;
      const add = [...el.querySelectorAll('[data-fk]:checked')].map((x, n) => { const k = +x.dataset.fk; return { release: rel, title: el.querySelector(`[data-ft="${k}"]`).value.trim().slice(0, 200), steps: el.querySelector(`[data-fs="${k}"]`).value.trim().slice(0, 2000), platform: el.querySelector(`[data-fp="${k}"]`).value, sort: start + n, created_by: A.user.id }; }).filter(r => r.title);
      if (!add.length) return toast('Pick something to add.', true);
      const { error: er } = await sb.from('test_items').insert(add); if (er) return toast(er.message, true);
      close(); T.rel = rel; T.filter = 'all'; toast(`Added ${add.length} item${add.length === 1 ? '' : 's'} to ${rel}`); P.testing();
    };
    load();
  }

  // =========================================================== Profiles & frames
  const PR = { tab: 'mine', q: '' };
  const PTABS = [['uploads', 'Pictures waiting'], ['mine', 'Made in the shop'], ['banner', 'Banner pictures'], ['text', 'Bios & statuses'], ['reported', 'Reported'], ['all', 'Everyone']];
  const PARTS = [['banner', 'Banner picture'], ['design', 'Things made in the shop (and their pictures)'], ['bio', 'Bio'], ['status', 'Custom status'], ['display_name', 'Display name'], ['pronouns', 'Pronouns'], ['picture', 'Profile picture'], ['looks', 'Frames, themes and name style']];
  const tabsHtml = cur => `<div class="seg pr-tabs" id="prTabs">${PTABS.map(([k, l]) => `<button data-prt="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const flags = r => { const s = r.style || {}, f = [];
    if (s.banner_url) f.push('banner picture'); if (s.frame_img || s.overlay_img) f.push('own picture frame'); if (s.custom && Object.keys(s.custom).length) f.push('made in the shop');
    if (r.pending) f.push(`${r.pending} waiting`); if (r.reports) f.push(`<b class="err">${r.reports} report${r.reports === 1 ? '' : 's'}</b>`); return f; };
  P.profiles = async () => {
    if (PR.tab === 'uploads') { A.tab = 'uploads'; return P.uploads(); }
    NX.main(`<h1>Profiles & frames</h1><p>How people look across Apoji: frames and effects they made in the shop, banner pictures, bios and statuses. Reset something and they get a notice saying what and why.</p>
      ${tabsHtml(PR.tab)}<div class="row" style="margin:10px 0"><input class="field" id="prQ" placeholder="Find by name, username, bio or status" value="${esc(PR.q)}" style="flex:1;max-width:420px"></div><div id="prList"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    const { data, error } = await sb.rpc('admin_profiles', { p_filter: PR.tab, p_q: PR.q, p_limit: 120 });
    if (A.tab !== 'profiles') return;
    if (error) { $('prList').innerHTML = `<div class="card"><p class="muted">${need32(error.message) ? SQL32 : esc(error.message)}</p></div>`; return; }
    const list = Array.isArray(data) ? data : [];
    $('prList').innerHTML = list.length ? `<div class="pr-grid">${list.map(r => `<div class="card pr-it" data-pr="${esc(r.id)}">
        <div class="pr-card">${NC() ? NC().card({ id: r.id, username: r.username, nickname: r.nickname, avatar_url: r.avatar_url, owner: r.owner, style: r.style || {} }, { size: 'full' }) : ''}</div>
        <div class="row pr-meta"><span class="muted">${flags(r).join(' · ') || 'standard looks'}</span><span class="sp"></span><span class="muted">${r.at ? ago(r.at) : ''}</span></div>
        <div class="row"><button class="btn sm" data-prview="${esc(r.id)}">Open account</button><span class="sp"></span><button class="btn sm ghost" data-prreset="${esc(r.id)}" data-name="${esc(r.username || r.nickname || '')}">Reset…</button></div></div>`).join('')}</div>`
      : `<div class="card empty">${PR.tab === 'reported' ? 'No reported profiles.' : 'Nobody here.'}</div>`;
  };
  NX.profileReset = async (uid, label, after) => {
    const { el, close } = NX.modal(`<h3>Reset part of ${esc(label ? '@' + label : 'this profile')}</h3><p class="muted">They get a notice in every Nexus app saying what was reset and your reason. Open reports about this profile are closed.</p>
      <div class="pr-parts">${PARTS.map(([k, l]) => `<label class="as-row"><input type="checkbox" value="${k}"><span>${l}</span></label>`).join('')}</div>
      <input class="field" id="prNote" maxlength="200" placeholder="Reason they see, e.g. Banner pictures can't show other people" style="width:100%;margin-top:10px">
      <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn danger" id="prGo">Reset</button></div>`);
    el.querySelector('#prGo').onclick = async () => {
      const parts = [...el.querySelectorAll('.pr-parts input:checked')].map(x => x.value); if (!parts.length) return toast('Pick what to reset.', true);
      const { data, error } = await sb.rpc('admin_profile_reset', { p_user: uid, p_parts: parts, p_note: el.querySelector('#prNote').value.trim() });
      if (error || !data?.ok) return toast(error ? (need32(error.message) ? SQL32 : error.message) : data.error, true);
      close(); toast('Reset. They were told.'); after?.();
    };
  };
  const prClick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.prt) { PR.tab = b.dataset.prt; if (PR.tab === 'uploads') { NX.go('uploads'); return; } if (A.tab !== 'profiles') return NX.go('profiles'); return P.profiles(); }
    if (b.dataset.prview) return NX.userDrawer(b.dataset.prview);
    if (b.dataset.prreset) return NX.profileReset(b.dataset.prreset, b.dataset.name, () => P.profiles());
  };
  // the uploads queue (v31) is the first tab of this page
  const uploadsBefore = P.uploads;
  if (uploadsBefore) P.uploads = async (...a) => {
    PR.tab = 'uploads';
    await uploadsBefore(...a);
    if (A.tab !== 'uploads') return;
    document.querySelector('#nav [data-tab="profiles"]')?.classList.add('on');
    const h = $('main').querySelector('h1'); if (h) { h.textContent = 'Profiles & frames'; h.nextElementSibling?.insertAdjacentHTML('afterend', tabsHtml('uploads')); }
    $('prTabs')?.addEventListener('click', prClick);
  };
  // the page's own clicks and search
  const profilesInner = P.profiles;
  P.profiles = async () => {
    await profilesInner(); if (A.tab !== 'profiles') return;
    $('prTabs')?.addEventListener('click', prClick); $('prList')?.addEventListener('click', prClick);
    const q = $('prQ'); if (q) { let t; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { PR.q = q.value.trim(); P.profiles().then(() => { const n = $('prQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 300); }; }
  };

  // =========================================================== One Apoji account
  // the user drawer: their whole Apoji profile
  NX.afterUserDrawer = async (el, uid) => {
    const host = el.querySelector('#swCard'); if (!host) return;
    host.insertAdjacentHTML('afterend', '<div class="card" id="apCard"><h3>Apoji profile</h3><span class="spinner"></span></div>');
    const box = el.querySelector('#apCard');
    const { data, error } = await sb.rpc('admin_profile_detail', { p_user: uid });
    if (!box.isConnected) return;
    if (error || !data?.ok) { box.innerHTML = `<h3>Apoji profile</h3><p class="muted">${error && need32(error.message) ? SQL32 : 'Couldn’t load it.'}</p>`; return; }
    const SURF = { mac: 'Mac', windows: 'Windows PC', phone: 'N28C', test_run: 'Test Run', admin: 'Apoji Admin', aargon3: 'aARgon3', mexel: 'Mexel', linux: 'Linux' };
    const c = data.cirkts || {}, ups = data.uploads || [], reps = (data.reports || []).filter(r => r.status === 'open');
    box.innerHTML = `<h3>Apoji profile <span class="sp"></span></h3>
      ${NC() && data.card ? `<div class="ap-card">${NC().card(data.card)}</div>` : '<p class="muted">They haven’t set up a profile yet.</p>'}
      <div class="kv" style="margin-top:10px"><span>Uses</span><span>${(data.apps || []).map(a => `${esc(SURF[a.surface] || a.surface)}${a.version ? ' ' + esc(a.version) : ''} <span class="muted">(${ago(a.seen_at)})</span>`).join(', ') || '—'}</span>
        <span>Linked apps</span><span>${(data.links || []).map(l => `${esc(l.app || 'an app')} <span class="muted">${ago(l.at)}</span>`).join(', ') || '—'}</span>
        <span>Friends</span><span>${data.friends || 0}</span>
        <span>Cirkts</span><span>${c.earned != null ? `${(c.earned - c.spent).toLocaleString()} to spend · ${c.owned || 0} items` : '—'}</span>
        <span>Pictures</span><span>${ups.map(u => `${u.kind === 'frame' ? 'Frame' : 'Profile frame'}: <b>${esc(u.status)}</b>`).join(', ') || '—'}${ups.some(u => u.status === 'pending') ? ' · <a href="#" data-goup>Review</a>' : ''}</span>
        <span>Reports</span><span>${reps.length ? `<b class="err">${reps.length} open</b> · ${reps.map(r => esc(r.reason)).join(', ')}` : 'none open'}</span></div>
      <div class="row" style="margin-top:10px"><button class="btn sm ghost" data-apreset>Reset part of their profile…</button></div>`;
    box.onclick = e => {
      if (e.target.closest('[data-goup]')) { e.preventDefault(); PR.tab = 'uploads'; return NX.go('uploads'); }
      if (e.target.closest('[data-apreset]')) return NX.profileReset(uid, data.card?.username, () => NX.userDrawer(uid));
    };
  };
  // My settings: your Apoji account
  const meBefore = P.me;
  if (meBefore) P.me = async (...a) => {
    await meBefore(...a); if (A.tab !== 'me') return;
    const host = $('main').querySelector('h1'); if (!host) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'apoAcct'; card.innerHTML = '<h3>Your Apoji account</h3><span class="spinner"></span>';
    (host.nextElementSibling?.tagName === 'P' ? host.nextElementSibling : host).after(card);
    const { data, error } = await sb.rpc('apoji_account');
    if (!card.isConnected) return;
    if (error || !data?.ok) { card.innerHTML = '<h3>Your Apoji account</h3><p class="muted">Couldn’t load your account.</p>'; return; }
    const st = data.card?.style || {}, SURF = { mac: 'Mac', windows: 'Windows PC', phone: 'N28C', test_run: 'Test Run', admin: 'Apoji Admin', aargon3: 'aARgon3', mexel: 'Mexel' };
    card.innerHTML = `<h3>Your Apoji account</h3><p class="muted" style="margin-top:0">One profile for Nexus, N28C, Test Run, Apoji Admin and aARgon3. Frames, themes and effects are picked in Nexus (Settings → Profile → Cirkts shop).</p>
      <div class="apo-grid"><div class="apo-card">${NC() ? NC().card({ ...data.card, self: true, online: true }) : ''}</div>
        <div class="apo-form">
          <label>Display name<input class="field" id="apoDisp" maxlength="32" value="${esc(st.display_name || '')}" placeholder="${esc(data.card?.nickname || data.card?.username || '')}"></label>
          <label>Custom status<input class="field" id="apoStatus" maxlength="60" value="${esc(st.status_text || '')}"></label>
          <label>Pronouns<input class="field" id="apoPron" maxlength="24" value="${esc(st.pronouns || '')}" placeholder="they/them"></label>
          <label>Bio<textarea class="field" id="apoBio" rows="2" maxlength="160">${esc(st.bio || '')}</textarea></label>
          <div class="row"><button class="btn primary" id="apoSave">Save</button><span class="muted" id="apoNote"></span></div></div></div>
      <div class="kv" style="margin-top:12px"><span>You use</span><span>${(data.apps || []).map(a => `${esc(SURF[a.surface] || a.surface)} <span class="muted">${ago(a.seen_at)}</span>`).join(', ') || '—'}</span>
        <span>Cirkts</span><span>${(data.cirkts?.balance ?? 0).toLocaleString()} to spend</span></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="apoLink">Make a link code for aARgon3</button><code id="apoCode" class="pf-code"></code><span class="muted" id="apoLinkNote">Type it into aARgon3 within 15 minutes and your picture, frame and name show up there.</span></div>`;
    card.querySelector('#apoSave').onclick = async () => {
      const { data: r, error: er } = await sb.rpc('profile_style_set', { p_style: { display_name: $('apoDisp').value.trim(), status_text: $('apoStatus').value, pronouns: $('apoPron').value, bio: $('apoBio').value } });
      $('apoNote').textContent = er ? er.message : r?.ok ? 'Saved everywhere' : r?.error || 'Couldn’t save'; if (!er && r?.ok) setTimeout(() => P.me(), 700);
    };
    card.querySelector('#apoLink').onclick = async () => {
      const { data: r, error: er } = await sb.rpc('apoji_link_code'); if (er || !r?.ok) return toast(er?.message || r?.error || 'Couldn’t make a code.', true);
      $('apoCode').textContent = r.code; $('apoLinkNote').textContent = 'Works once, for 15 minutes.';
    };
  };

  // =========================================================== Status page: incidents ↔ known issues and releases
  const statusBefore = P.status;
  if (statusBefore) P.status = async (...a) => {
    await statusBefore(...a); if (A.tab !== 'status') return;
    const [{ data: incs }, { data: known }, { data: plans }] = await Promise.all([
      sb.from('status_incidents').select('id,title,status,started_at,resolved_at,known_issue_ids,release').gte('started_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('started_at', { ascending: false }).limit(30),
      sb.from('known_issues').select('id,title,status,fixed_in').order('updated_at', { ascending: false }).limit(80),
      sb.from('admin_release_plans').select('version,status').neq('status', 'dropped').order('updated_at', { ascending: false }).limit(30)]);
    if (A.tab !== 'status' || !incs) return;
    const kn = Object.fromEntries((known || []).map(k => [k.id, k]));
    const box = document.createElement('div'); box.className = 'card'; box.id = 'incLinks';
    box.innerHTML = `<h3>Incidents, known issues and releases</h3><p class="muted" style="margin-top:0">Link an incident to the known issues behind it and the release that fixes it. The public status page shows those links under the incident.</p>
      ${incs.length ? incs.map(i => `<div class="inc-link"><div><b>${esc(i.title)}</b> <span class="muted">${i.resolved_at ? 'resolved' : esc(i.status)} · ${when(i.started_at)}</span>
        <div class="chips">${(i.known_issue_ids || []).map(k => kn[k] ? `<span class="chip">${esc(kn[k].title)}</span>` : '').join('')}${i.release ? `<span class="chip rel">Fixed in ${esc(i.release)}</span>` : ''}${!(i.known_issue_ids || []).length && !i.release ? '<span class="muted">Not linked</span>' : ''}</div></div>
        <button class="btn sm" data-inclink="${i.id}">Link…</button></div>`).join('') : '<p class="muted">No incidents in the last 90 days.</p>'}`;
    (document.getElementById('knownIssues') || $('main').querySelector('h1 + p'))?.after(box);
    box.onclick = e => {
      const b = e.target.closest('[data-inclink]'); if (!b) return;
      const i = incs.find(x => x.id === +b.dataset.inclink); if (!i) return;
      const vers = [...new Set([...(plans || []).map(p => p.version), ...(known || []).map(k => k.fixed_in).filter(Boolean)])];
      const { el, close } = NX.modal(`<h3>Link “${esc(i.title)}”</h3><label class="muted">Known issues</label>
        <div class="assign-list">${(known || []).map(k => `<label class="as-row"><input type="checkbox" value="${k.id}" ${(i.known_issue_ids || []).includes(k.id) ? 'checked' : ''}><span>${esc(k.title)} <span class="muted">${esc(k.status)}${k.fixed_in ? ' · fixed in ' + esc(k.fixed_in) : ''}</span></span></label>`).join('') || '<span class="muted">No known issues yet (Status → Known issues).</span>'}</div>
        <label class="muted" style="display:block;margin-top:10px">Release that fixes it</label><input class="field" id="ilRel" list="ilVers" value="${esc(i.release || '')}" placeholder="4.0.7" maxlength="40"><datalist id="ilVers">${vers.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
        <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="ilGo">Save</button></div>`);
      el.querySelector('#ilGo').onclick = async () => {
        const ks = [...el.querySelectorAll('.assign-list input:checked')].map(x => +x.value);
        const { data: r, error } = await sb.rpc('admin_link_incident', { p_incident: i.id, p_known: ks, p_release: el.querySelector('#ilRel').value.trim() });
        if (error || r?.ok === false) return toast(error?.message || r?.error || 'Couldn’t link it.', true);
        close(); toast('Linked. It shows on the public status page.'); P.status();
      };
    };
  };

  // =========================================================== Apoji-wide search (⌘K)
  const GO = { known_issue: ['Known issues', '⚠', r => NX.go('status')], incident: ['Incidents', '🟢', () => NX.go('status')], release: ['Release plans', '🚀', () => NX.go('releases')],
    test: ['Testing', '🧪', r => { T.rel = r.release; NX.go('testing'); }], space: ['Spaces', '👥', () => NX.go('moderation')], profile: ['Profiles', '👤', r => NX.userDrawer(r.id)], announcement: ['Announcements', '📣', () => NX.go('announce')] };
  NX.paletteExtra = async q => {
    const { data } = await sb.rpc('admin_search', { p_q: q, p_limit: 6 });
    return (Array.isArray(data) ? data : []).filter(r => GO[r.kind]).map(r => ({ group: GO[r.kind][0], ic: GO[r.kind][1], label: r.title, sub: r.sub, run: () => GO[r.kind][2](r) }));
  };
})();
