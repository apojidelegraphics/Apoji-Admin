// Apoji Admin 2.6.1 — New models (Agent prompts → New models). Add a model with just a name, a prompt and its
// @features; every Nexus app (desktop, N28C, Test Run) picks it up within 10 minutes and shows a "New model" pop-up the
// first time. Its code ships with the next version of Nexus; until then it runs on a base agent's model and allowance.
// Needs supabase/nexus-v3.11.sql (Nexus repo). The Owner, prompt editors and people with Feature flags can add them.
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const SQL = 'Run supabase/nexus-v3.11.sql (Nexus repo) in Supabase → SQL Editor to turn this on.';
  const STAGES = [['admin', 'Admins only'], ['beta', 'Beta testers'], ['all', 'Everyone'], ['off', 'Off']];
  const BASES = [['lyte', 'Lyte (Standard)'], ['flash', 'Flash (Base, unlimited)'], ['neodela', 'Neodela (Best)']];
  const slug = s => String(s || '').toLowerCase().replace(/^nexus\s*'?\d*\s*/, '').replace(/[^a-z0-9]+/g, '').slice(0, 30);
  const NM = { edit: null, open: false };

  async function render(host) {
    const { data: rows, error } = await sb.from('agent_releases').select('*').order('released_at', { ascending: false });
    if (A.tab !== 'prompts') return;
    if (error) { host.innerHTML = `<div class="card"><h3>New models</h3><p class="muted">${esc(NX.needSql?.(error.message) ? SQL : error.message)}</p></div>`; return; }
    const { data: can } = await sb.rpc('agent_release_can_edit');
    const e = NM.edit;
    const form = can && (NM.open || e) ? `<div class="card nm-form" style="background:var(--panel2)">
        <h3>${e ? 'Edit ' + esc(e.name) : 'Add a new model'}</h3>
        <div class="row"><input class="field" id="nmName" placeholder="Name, e.g. Nexus '28 Orion" value="${esc(e?.name || '')}" maxlength="60" style="flex:2;min-width:180px">
          <input class="field" id="nmId" placeholder="@handle" value="${esc(e?.id || '')}" maxlength="31" ${e ? 'disabled' : ''} style="flex:1;min-width:110px"></div>
        <textarea class="field" id="nmPrompt" placeholder="The model's prompt (how it thinks and talks)" style="min-height:26vh;margin-top:8px" maxlength="20000">${esc(e?.prompt || '')}</textarea>
        <div class="row" style="margin-top:8px"><span class="muted" style="flex:none">@Features</span><input class="field" id="nmFeat" value="${esc((e?.features || []).join(', '))}" placeholder="Seek, OmniBrief, StudyMode" style="flex:1;min-width:200px"></div>
        <details style="margin-top:8px" ${e?.tagline || e?.about ? 'open' : ''}><summary class="muted">Optional: pop-up text, color, base agent</summary>
          <div class="row" style="margin-top:6px"><input class="field" id="nmTag" placeholder="Tagline (one line in the pop-up)" value="${esc(e?.tagline || '')}" maxlength="120" style="flex:1;min-width:200px"><input type="color" id="nmColor" value="${esc(e?.color || '#3dffa0')}" title="Color"></div>
          <textarea class="field" id="nmAbout" placeholder="What's new about it (a few sentences in the pop-up)" maxlength="1200" style="min-height:70px;margin-top:6px">${esc(e?.about || '')}</textarea>
          <div class="row" style="margin-top:6px"><span class="muted" style="flex:none">Runs on</span><select class="field" id="nmBase">${BASES.map(([v, l]) => `<option value="${v}" ${(e?.base || 'lyte') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="muted">until its own code ships in the next Nexus</span></div></details>
        <div class="row" style="margin-top:10px"><span class="muted" style="flex:none">Who gets it</span><select class="field" id="nmStage">${STAGES.map(([v, l]) => `<option value="${v}" ${(e?.stage || 'admin') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="sp"></span><button class="btn" id="nmCancel">Cancel</button><button class="btn primary" id="nmSave">${e ? 'Save' : 'Release'}</button></div></div>` : '';
    host.innerHTML = `<div class="card" style="margin-top:14px"><div class="row"><h3 style="margin:0;flex:1">New models <span class="muted">${rows.length}</span></h3>${can && !form ? '<button class="btn primary" id="nmAdd">Add a new model</button>' : ''}</div>
      <p class="muted" style="margin-top:4px">Just a name, a prompt and its @features. Nexus apps pick it up within 10 minutes and show everyone it reaches a "New model" pop-up once. Its own code ships with the next version of Nexus.</p>
      ${form}
      <div class="plist">${rows.map(r => `<div><span><i class="nm-swatch" style="background:${esc(r.color)}"></i><b>${esc(r.name)}</b> <small>@${esc(r.id)} · on ${esc(r.base)} · ${(r.features || []).length} features · ${esc((STAGES.find(s => s[0] === r.stage) || [])[1] || r.stage)} · ${ago(r.released_at)}</small></span>
        ${can ? `<span><button class="btn sm" data-nmedit="${esc(r.id)}">Edit</button><button class="btn sm ghost" data-nmdel="${esc(r.id)}">Delete</button></span>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">No new models yet.</p>'}</div></div>`;
    const nameIn = $('nmName'), idIn = $('nmId');
    if (nameIn && !e) nameIn.oninput = () => { if (!idIn.dataset.touched) idIn.value = slug(nameIn.value); };
    if (idIn) idIn.oninput = () => { idIn.dataset.touched = 1; idIn.value = slug(idIn.value); };
    host.onclick = async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      ev.stopPropagation();
      if (b.id === 'nmAdd') { NM.open = true; NM.edit = null; return render(host); }
      if (b.id === 'nmCancel') { NM.open = false; NM.edit = null; return render(host); }
      if (b.dataset.nmedit) { NM.edit = rows.find(r => r.id === b.dataset.nmedit); return render(host); }
      if (b.dataset.nmdel) {
        if (!confirm('Delete this model? It disappears from every Nexus app within 10 minutes. Chats people had with it stay.')) return;
        const { error: er } = await sb.from('agent_releases').delete().eq('id', b.dataset.nmdel); if (er) return toast(er.message, true);
        toast('Deleted'); return render(host);
      }
      if (b.id === 'nmSave') {
        const row = { id: e?.id || slug($('nmId').value || $('nmName').value), name: $('nmName').value.trim(), prompt: $('nmPrompt').value.trim(),
          features: $('nmFeat').value.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 40),
          tagline: $('nmTag').value.trim(), about: $('nmAbout').value.trim(), color: $('nmColor').value, base: $('nmBase').value, stage: $('nmStage').value, updated_at: new Date().toISOString() };
        if (!row.name || row.id.length < 2) return toast('Give it a name and an @handle.', true);
        if (['paragon', 'neodela', 'lyte', 'flash', 'axiom'].includes(row.id)) return toast('That @handle is taken by a Nexus agent.', true);
        if (row.prompt.length < 10) return toast('Write its prompt (at least a sentence).', true);
        if (!e && !confirm(`Release ${row.name} to ${(STAGES.find(s => s[0] === row.stage) || [])[1]}? Nexus apps pick it up within 10 minutes.`)) return;
        const q = e ? sb.from('agent_releases').update(row).eq('id', e.id) : sb.from('agent_releases').insert(row);
        const { error: er } = await q; if (er) return toast(/duplicate|unique/.test(er.message) ? 'A model already has that @handle.' : er.message, true);
        NM.open = false; NM.edit = null; toast(e ? 'Saved' : `${row.name} released`); return render(host);
      }
    };
  }
  NX.newModels = render;
  const before = P.prompts;
  if (before) P.prompts = async () => {
    await before();
    if (A.tab !== 'prompts') return;
    const host = document.createElement('div'); host.id = 'newModels';
    $('main').appendChild(host);
    render(host);
  };
})();
