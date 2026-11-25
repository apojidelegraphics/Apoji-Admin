// Apoji Admin 3.1 (needs nexus-v4.0.6.sql in the Nexus project):
//   • PEOPLE & CONTENT → Profile uploads: pictures people made for their own frame or profile frame (Nexus 4.0.6
//     "Make your own", beta). Nobody else sees one until an admin approves it here. Approve, say no (with a reason
//     they're told), or take an approved one back down.
(function () {
  const { sb, $, esc, toast } = NX;
  const A = NX.A, P = NX.pages;
  const UP = { status: 'pending' };
  const need = m => /admin_cosmetic|cosmetic_uploads|PGRST20|42P01|42883|does not exist/i.test(m || '');
  const KIND = { frame: 'Picture frame', overlay: 'Profile frame' };
  const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  P.uploads = async () => {
    NX.main(`<h1>Profile uploads</h1><p>Pictures people uploaded for their own picture frame or profile frame. Only they can see one until you approve it. Saying no tells them why.</p>
      <div class="row"><div class="seg" id="upSeg">${[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Not approved']].map(([k, l]) => `<button data-ups="${k}" class="${UP.status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div id="upList"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    $('upSeg').onclick = e => { const b = e.target.closest('[data-ups]'); if (b) { UP.status = b.dataset.ups; P.uploads(); } };
    const { data, error } = await sb.rpc('admin_cosmetic_uploads', { p_status: UP.status });
    if (A.tab !== 'uploads') return;
    if (error) { $('upList').innerHTML = `<div class="card"><p class="muted">${need(error.message) ? 'Run supabase/nexus-v4.0.6.sql (in the Nexus repo) in Supabase → SQL Editor to turn this on.' : esc(error.message)}</p></div>`; return; }
    const list = Array.isArray(data) ? data : [];
    if (!list.length) { $('upList').innerHTML = `<div class="card"><p class="muted">${UP.status === 'pending' ? 'Nothing waiting. New uploads show up here.' : 'Nothing here yet.'}</p></div>`; return; }
    const NC = window.NexusCosmetics;
    const preview = u => {   // the picture on a checkerboard (to see the see-through parts) and on a sample card
      if (!NC) return '';
      const style = u.kind === 'frame' ? { frame: 'frame:mine', custom: { frame: { style: 'image' } }, frame_img: u.url } : { pframe: 'pframe:mine', custom: { pframe: { style: 'image' } }, overlay_img: u.url };
      return NC.card({ username: u.username || '', nickname: u.username || 'Someone', avatar_url: u.avatar_url || '', style }, { size: 'mini' });
    };
    $('upList').innerHTML = `<div class="up-grid">${list.map(u => `<div class="card up-it" data-up="${esc(u.id)}">
      <div class="up-pics"><div class="up-checker"><img src="${esc(u.url)}" alt="" referrerpolicy="no-referrer"></div><div class="up-sample">${preview(u)}</div></div>
      <div class="row"><b>@${esc(u.username || 'someone')}</b><span class="badge">${esc(KIND[u.kind] || u.kind)}</span><span class="sp"></span><span class="muted">${when(u.created_at)}</span></div>
      ${u.note ? `<p class="muted">${esc(u.note)}</p>` : ''}${u.reviewer ? `<p class="muted">Looked at by @${esc(u.reviewer)}${u.reviewed_at ? ' · ' + when(u.reviewed_at) : ''}</p>` : ''}
      <div class="row">${u.status === 'pending' ? `<button class="btn" data-upok="${esc(u.id)}">Approve</button><button class="btn ghost" data-upno="${esc(u.id)}">Say no…</button>`
        : u.status === 'approved' ? `<button class="btn ghost" data-updown="${esc(u.id)}">Take it down…</button>` : ''}<a class="btn ghost" href="${esc(u.url)}" target="_blank" rel="noopener">Open</a></div></div>`).join('')}</div>`;
    $('upList').onclick = async e => {
      const b = e.target.closest('[data-upok],[data-upno],[data-updown]'); if (!b) return;
      let r;
      if (b.dataset.upok) r = await sb.rpc('admin_cosmetic_review', { p_id: b.dataset.upok, p_ok: true, p_note: '' });
      else {
        const note = await NX.ask(b.dataset.upno ? 'Why not? (they see this)' : 'Why take it down? (kept in the log)', { placeholder: 'Not appropriate for profiles', ok: b.dataset.upno ? 'Say no' : 'Take it down', multiline: true });
        if (note === null || note === undefined) return;
        r = b.dataset.upno ? await sb.rpc('admin_cosmetic_review', { p_id: b.dataset.upno, p_ok: false, p_note: String(note).slice(0, 300) }) : await sb.rpc('admin_cosmetic_takedown', { p_id: b.dataset.updown, p_note: String(note).slice(0, 300) });
      }
      if (r.error || r.data?.ok === false) return toast(r.error?.message || r.data?.error || 'That didn’t work', true);
      toast(b.dataset.upok ? 'Approved. It\'s on their profile now.' : b.dataset.upno ? 'Done. They were told.' : 'Taken down.'); P.uploads();
    };
  };
})();
