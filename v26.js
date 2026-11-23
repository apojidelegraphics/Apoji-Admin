// Apoji Admin 2.6:
//   • 🧾 Mexel — the money side, inside Apoji Admin (aARgon3 2.0's staff system): Today, Orders (cancel / refund / free
//     orders), Sell (a Stripe link + QR for the customer), Timesheets (with the clock) and the staff Log. It talks to the
//     aARgon3 `staff` Edge Function with your Nexus sign-in; any admin is staff, high-admins are managers.
//   • 🗓 Release planning on the Releases page (supabase/apoji-admin-2.6.sql)
//   • 👁 Preview as (Owner only): see Apoji Admin the way a High-admin, Viewer, Admin or Moderator does
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const STORE_URL = 'https://yuergfrpfhtcxjkcgjrx.supabase.co', STORE_KEY = 'sb_publishable_tX9wZpRsI3fAlthnz4lQKA_yVdY7768';
  const STORE_SITE = 'https://apojidelegraphics.github.io/aArgon3';
  const money = n => '$' + (+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hm = m => { m = Math.round(+m || 0); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const dt = v => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const local = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

  // =========================================================== 🧾 Mexel
  const M = { tab: 'today', me: null, state: null, overview: null, at: 0, catalog: null, q: '', sale: null, pollT: null };
  NX.mexelState = M;
  async function mexel(action, body = {}) {
    const { data } = await sb.auth.getSession(); const token = data.session?.access_token;
    if (!token) throw new Error('Sign in again.');
    let res;
    try { res = await fetch(`${STORE_URL}/functions/v1/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: STORE_KEY }, body: JSON.stringify({ action, ...body }) }); }
    catch { throw new Error(window.apojiDesktop ? 'Can’t reach aARgon3. In the desktop app this needs the aARgon3 staff function updated to allow Apoji Admin (see the README), or use the website.' : 'Can’t reach aARgon3. Check your internet connection.'); }
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || (res.status === 404 ? 'The aARgon3 staff function isn’t deployed yet (aArgon3 repo → supabase/functions/staff).' : `aARgon3 said ${res.status}.`));
    return r;
  }
  NX.mexel = mexel;
  // QR codes for payment links (qrcode-generator, loaded by index.html)
  NX.qrSvg = text => { try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch { return `<div class="muted" style="word-break:break-all">${esc(text)}</div>`; } };
  async function catalog() {
    if (M.catalog) return M.catalog;
    try { M.catalog = await (await fetch(`${STORE_SITE}/catalog.json`, { cache: 'no-store' })).json(); } catch { M.catalog = null; }
    return M.catalog;
  }
  // 2.7: Sales, Promotions and You (v27.js); Timesheets moved to STAFF → Shifts; m = managers only
  const TABS = [['today', 'Today'], ['sales', 'Sales'], ['orders', 'Orders'], ['sell', 'Sell'], ['promos', 'Promotions', 'm'], ['you', 'You'], ['log', 'Log', 'm']];
  NX.mexelTabs = NX.mexelTabs || {};
  P.mexel = async () => {
    if (A.arg === 'time') return NX.go('shifts');
    if (A.arg && TABS.some(t => t[0] === A.arg)) M.tab = A.arg;
    const tabsFor = () => TABS.filter(t => t[2] !== 'm' || !M.me || M.me.manager);
    NX.main(`<h1>🧾 Mexel</h1><p class="mx-intro">The money side of Apoji: aARgon3 store orders, sales, promotions and the clock. Shifts and employees are under STAFF. Only the Owner and the staff the Owner adds can open it.</p>
      <div class="seg mx-tabs">${tabsFor().map(([k, l]) => `<button class="${M.tab === k ? 'on' : ''}" data-mxtab="${k}">${l}</button>`).join('')}</div><div id="mx" class="mx-body"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    $('main').querySelector('.mx-tabs').onclick = e => { const b = e.target.closest('[data-mxtab]'); if (!b) return; M.tab = b.dataset.mxtab; NX.go('mexel', { arg: M.tab }); };
    try {
      const r = await mexel('me'); M.me = r.user; M.state = r.state; M.overview = r.overview; M.at = Date.now();
      const tabs = $('main').querySelector('.mx-tabs'); if (tabs) tabs.innerHTML = tabsFor().map(([k, l]) => `<button class="${M.tab === k ? 'on' : ''}" data-mxtab="${k}">${l}</button>`).join('');
      if (!tabsFor().some(t => t[0] === M.tab)) M.tab = 'today';
      await (({ today, orders, sell, log, ...NX.mexelTabs })[M.tab] || today)();
    } catch (e) { if ($('mx')) $('mx').innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  };
  const mgr = () => !!M.me?.manager;
  const box = () => $('mx');

  // ---------- Today
  async function today() {
    const o = M.overview || {}, s = M.state || {}, sh = s.shift, wk = o.week || [], max = Math.max(1, ...wk.map(d => +d.revenue || 0));
    const worked = sh ? sh.minutes + (sh.on_break ? 0 : (Date.now() - M.at) / 60e3) : 0;
    box().innerHTML = `<div class="stats4"><div class="stat"><b>${money(o.today?.revenue)}</b><span>sales today</span></div><div class="stat"><b>${o.today?.orders || 0}</b><span>orders today</span></div>
        <div class="stat"><b>${o.active_subscriptions || 0}</b><span>active subscriptions</span></div><div class="stat"><b>${(o.on_clock || []).length}</b><span>on the clock</span></div></div>
      <div class="grid2">
        <div class="card"><h3>⏰ Your shift</h3>${sh ? `<p><b>${sh.on_break ? 'On break' : 'Clocked in'}</b> at ${esc(sh.store || sh.store_code || 'no store')} since ${dt(sh.clock_in)} · <b>${hm(worked)}</b> worked${sh.orders ? ` · ${sh.orders} sale${sh.orders === 1 ? '' : 's'} (${money(sh.sales)})` : ''}</p>
          <div class="row"><button class="btn" id="mxBreak">${sh.on_break ? '▶ End break' : '☕ Start break'}</button><button class="btn primary" id="mxOut">Clock out</button></div>`
        : `<p class="muted">You’re not clocked in. This week: ${hm(s.week_minutes)}.</p><div class="row"><select class="field" id="mxStore">${(s.stores || []).map(st => `<option value="${esc(st.code)}" ${st.code === s.last_store ? 'selected' : ''}>${esc(st.name)}${st.region ? ' · ' + esc(st.region) : ''}</option>`).join('') || '<option value="">No store</option>'}</select><button class="btn primary" id="mxIn">Clock in</button></div>`}</div>
        <div class="card"><h3>👥 On the clock</h3>${(o.on_clock || []).map(x => `<div class="row mx-oc"><b>${esc(x.name || 'Staff')}</b><span class="muted">${esc(x.store || '')} · since ${dt(x.clock_in)} · ${hm(x.minutes)}</span>${x.on_break ? '<span class="pill p-pending">BREAK</span>' : ''}</div>`).join('') || '<p class="muted">Nobody right now.</p>'}</div></div>
      <div class="card"><h3>📊 Last 7 days</h3><div class="mx-week">${wk.map(d => `<div><i style="height:${Math.round((+d.revenue || 0) / max * 100)}%" title="${money(d.revenue)} · ${d.orders} orders"></i><span>${new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</span><b>${money(d.revenue).replace('.00', '')}</b></div>`).join('')}</div></div>`;
    box().onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.id === 'mxIn') { await mexel('clock_in', { store: $('mxStore')?.value || '' }); toast('⏰ Clocked in'); }
        if (b.id === 'mxBreak') { await mexel('break', { on: !sh.on_break }); toast(sh.on_break ? 'Back to work' : '☕ On break'); }
        if (b.id === 'mxOut') return clockOut(sh);
        P.mexel();
      } catch (er) { toast(er.message, true); }
    };
  }
  function clockOut(sh) {
    const { el, close } = NX.modal(`<h3>Clock out</h3><div class="acct-grid"><label>Note</label><input class="field" id="coN" maxlength="500" placeholder="Anything to add? (optional)">
      <label>Forgot?</label><div><label class="row"><input type="checkbox" id="coF"> I forgot to clock out. I left at</label><input class="field" type="datetime-local" id="coAt" value="${local(Date.now())}" min="${local(sh.clock_in)}" disabled></div></div>
      <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="coGo">Clock out</button></div>`);
    el.querySelector('#coF').onchange = e => { el.querySelector('#coAt').disabled = !e.target.checked; };
    el.querySelector('#coGo').onclick = async () => {
      try { await mexel('clock_out', { note: el.querySelector('#coN').value.trim(), at: el.querySelector('#coF').checked ? new Date(el.querySelector('#coAt').value).toISOString() : null }); close(); toast('✓ Clocked out'); P.mexel(); }
      catch (er) { toast(er.message, true); }
    };
  }

  // ---------- Orders
  const ST = s => { s = String(s || '').toUpperCase(); return `<span class="pill ${s === 'ACTIVE' ? 'p-approved' : s === 'PENDING' ? 'p-pending' : 'p-declined'}">${esc(s || '—')}</span>`; };
  async function orders() {
    box().innerHTML = `<div class="row" style="margin-bottom:10px"><input class="field" id="mxQ" placeholder="Search order number, email or name" value="${esc(M.q)}" style="flex:1"><button class="btn" id="mxFind">Search</button>${mgr() ? '<button class="btn" id="mxComp">🎁 Free order</button>' : ''}</div><div id="mxList"><div class="card"><span class="spinner"></span></div></div>`;
    const paint = async () => {
      const list = await mexel('orders', { q: M.q });
      $('mxList').innerHTML = `<div class="card"><table class="cards"><tr><th>Order</th><th>Plan</th><th>Customer</th><th>Amount</th><th>Status</th><th>When</th></tr>${list.map(o => `<tr class="click" data-order="${esc(o.order_id)}"><td><b style="font-family:var(--mono)">${esc(o.order_id)}</b></td><td>${esc(o.plan || '—')} ${esc(o.tier || '')}<div class="muted">${esc(o.billing || '')}${o.source ? ' · ' + esc(o.source) : ''}</div></td>
        <td>${esc(o.customer_name || '')}<div class="muted">${esc(o.customer_email || '')}</div></td><td>${money(o.amount)}</td><td>${ST(o.status)}</td><td class="muted">${ago(o.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No orders.</td></tr>'}</table></div>`;
      NX.labelTables?.();
    };
    box().onclick = async e => {
      const b = e.target.closest('button'), row = e.target.closest('[data-order]');
      if (b?.id === 'mxFind') { M.q = $('mxQ').value.trim(); return paint().catch(er => toast(er.message, true)); }
      if (b?.id === 'mxComp') return compModal();
      if (row) return orderDrawer(row.dataset.order);
    };
    box().onkeydown = e => { if (e.target.id === 'mxQ' && e.key === 'Enter') $('mxFind').click(); };
    await paint();
  }
  async function orderDrawer(id) {
    let o; try { o = await mexel('order', { order_id: id }); } catch (e) { return toast(e.message, true); }
    const c = o.config || {}, canAct = mgr() && String(o.status).toUpperCase() === 'ACTIVE';
    const { el, close } = NX.drawer(`<h3 style="font-family:var(--mono)">${esc(o.order_id)}</h3><div class="row">${ST(o.status)}<span class="muted">${dt(o.created_at)}</span></div>
      <div class="card"><div class="kv"><span>Plan</span><span>${esc(o.plan || '—')} · ${esc(o.tier || '')} · ${esc(o.billing || '')}</span><span>Amount</span><span>${money(o.amount)}${o.subscription ? ' · subscription' : ''}</span>
        <span>Customer</span><span>${esc(o.customer_name || '—')}<br><span class="muted">${esc(o.customer_email || '')}</span></span><span>Sold by</span><span>${esc(o.operator || (o.source === 'web' ? 'Online store' : '—'))}${o.store ? ' · ' + esc(o.store) : ''}</span>
        <span>System</span><span>${esc([c.os, c.chip, c.connection, c.service_tier].filter(Boolean).join(' · ') || '—')}</span><span>Models</span><span>${esc((o.models || []).join(', ') || '—')}</span></div></div>
      ${canAct ? `<div class="card"><h3>Manager</h3><p class="muted">Cancelling stops the subscription in Stripe. Refunding also gives back the last payment. The customer’s Nexus perks stop.</p><div class="row"><button class="btn" id="odCancel">Cancel</button><button class="btn danger" id="odRefund">Cancel + refund</button></div></div>` : ''}
      <div class="row"><button class="btn" id="odCopy">Copy order number</button><span class="sp"></span><button class="btn" data-close>Close</button></div>`);
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'odCopy') { navigator.clipboard?.writeText(o.order_id); return toast('Copied'); }
      if (b.id === 'odCancel' || b.id === 'odRefund') {
        const refund = b.id === 'odRefund';
        if (!confirm(refund ? `Cancel ${o.order_id} and refund the last payment? This can’t be undone.` : `Cancel ${o.order_id}? The subscription stops and their Nexus perks end.`)) return;
        try { const r = await mexel('cancel', { order_id: o.order_id, refund }); close(); toast(refund ? `✓ Refunded${r.refunded != null ? ' ' + money(r.refunded) : ''}` : '✓ Cancelled'); if (M.tab === 'orders') orders(); }
        catch (er) { toast(er.message, true); }
      }
    };
  }
  async function pickers(prefix, { billing = true, email = true } = {}) {
    const C = await catalog(); if (!C) return '<p class="err">Couldn’t load the aARgon3 catalog.</p>';
    const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="acct-grid"><label>Plan</label><select class="field" id="${prefix}P">${opt(C.planOrder.filter(p => !C.plans[p].quote).map(p => [p, C.plans[p].name]), 'personal')}</select>
      <label>Tier</label><select class="field" id="${prefix}T">${opt(C.tierOrder.map(t => [t, `${C.tiers[t].name} · ${C.tiers[t].chip}`]), 'plus')}</select>
      ${billing ? `<label>Billing</label><select class="field" id="${prefix}B"><option value="month">Monthly</option><option value="year">Yearly (${C.yearlyMonths} × monthly)</option></select>` : ''}
      <label>LentOS</label><select class="field" id="${prefix}O">${opt(C.os.map(o => [o.id, o.id]), C.os[0]?.id)}</select>
      <label>Connection</label><select class="field" id="${prefix}C">${opt(C.connections.map(o => [o.id, o.id]), C.connections[0]?.id)}</select>
      ${email ? `<label>Customer email</label><input class="field" id="${prefix}E" type="email" placeholder="Optional: Stripe fills it in">` : ''}</div>`;
  }
  const priceOf = (C, plan, tier, billing) => { const m = C?.plans[plan]?.monthly?.[tier]; return m == null ? null : billing === 'year' ? m * C.yearlyMonths : m; };

  // ---------- Sell (a Stripe link + QR the customer pays on their phone)
  async function sell() {
    if (!M.state?.shift) { box().innerHTML = `<div class="card"><h3>💳 New sale</h3><p class="muted">Clock in first (Today tab): every sale belongs to a shift.</p><button class="btn primary" data-mxgo="today">Go to Today</button></div>`; box().onclick = e => { if (e.target.closest('[data-mxgo]')) { M.tab = 'today'; P.mexel(); } }; return; }
    const C = await catalog();
    box().innerHTML = `<div class="grid2"><div class="card"><h3>💳 New sale</h3>${await pickers('sl')}<div class="row" style="margin-top:12px"><b id="slPrice"></b><span class="sp"></span><button class="btn primary" id="slGo">Make payment link</button></div></div>
      <div class="card" id="slOut"><h3>Customer pays here</h3><p class="muted">Make a link and the customer scans the QR code (or you send them the link). This updates when they’ve paid.</p></div></div>`;
    const price = () => { const p = priceOf(C, $('slP').value, $('slT').value, $('slB').value); $('slPrice').textContent = p == null ? '' : `${money(p)} / ${$('slB').value === 'year' ? 'year' : 'month'}`; };
    box().onchange = price; price();
    box().onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'slGo') {
        b.disabled = true;
        try {
          const r = await mexel('sale', { plan: $('slP').value, tier: $('slT').value, billing: $('slB').value, os: $('slO').value, connection: $('slC').value, email: $('slE').value.trim() });
          M.sale = r; paintSale(); pollSale();
        } catch (er) { toast(er.message, true); } finally { b.disabled = false; }
      }
      if (b.id === 'slCopy') { navigator.clipboard?.writeText(M.sale?.url || ''); toast('Link copied'); }
    };
  }
  function paintSale() {
    const s = M.sale, out = $('slOut'); if (!s || !out) return;
    out.innerHTML = `<h3>Customer pays here</h3><div class="row" style="align-items:flex-start;gap:16px"><div class="qr" id="slQr"></div><div style="flex:1;min-width:0"><div class="muted">Order</div><b style="font-family:var(--mono);font-size:18px">${esc(s.order_id)}</b>
      ${s.amount != null ? `<div class="muted" style="margin-top:6px">${money(s.amount)}</div>` : ''}<p id="slSt" class="muted">Waiting for payment…</p><div class="row"><button class="btn" id="slCopy">Copy link</button><a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">Open</a></div></div></div>`;
    $('slQr').innerHTML = NX.qrSvg(s.url);
  }
  function pollSale() {
    clearTimeout(M.pollT);
    const tick = async () => {
      if (!M.sale || A.tab !== 'mexel') return;
      try {
        const r = await mexel('sale_status', { session_id: M.sale.session_id });
        const el = $('slSt'); if (el && r) el.innerHTML = r.ready ? `<b class="ok">✅ Paid</b> · order ${esc(r.order?.order_id || M.sale.order_id)} is active` : r.state === 'expired' ? '<span class="err">The link expired. Make a new one.</span>' : r.state === 'processing' ? 'Paid, finishing up…' : 'Waiting for payment…';
        if (r?.ready || r?.state === 'expired') { if (r.ready) toast('✅ Paid'); return; }
      } catch {}
      M.pollT = setTimeout(tick, 4000);
    };
    M.pollT = setTimeout(tick, 4000);
  }
  async function compModal() {
    const { el, close } = NX.modal(`<h3>🎁 Free order</h3><p class="muted">A comp order: no payment. It works in Nexus like a paid one.</p>${await pickers('cp', { billing: false })}
      <div class="acct-grid" style="margin-top:8px"><label>Name</label><input class="field" id="cpN" maxlength="120"><label>Why</label><input class="field" id="cpW" maxlength="500" placeholder="e.g. tester thank-you"></div>
      <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="cpGo">Make it</button></div>`);
    el.querySelector('#cpGo').onclick = async () => {
      try { const r = await mexel('comp', { plan: el.querySelector('#cpP').value, tier: el.querySelector('#cpT').value, os: el.querySelector('#cpO').value, connection: el.querySelector('#cpC').value, email: el.querySelector('#cpE').value.trim(), name: el.querySelector('#cpN').value.trim(), note: el.querySelector('#cpW').value.trim() });
        close(); toast(`🎁 Free order ${r.order_id}`); navigator.clipboard?.writeText(r.order_id); orders(); }
      catch (er) { toast(er.message, true); }
    };
  }

  // ---------- Timesheets
  M.from = M.from || (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  M.to = M.to || new Date(M.from.getTime() + 7 * 864e5);
  async function time(host = box()) {
    const day = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    host.innerHTML = `<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><label class="muted">From <input class="field" type="date" id="tsF" value="${day(M.from)}"></label><label class="muted">to <input class="field" type="date" id="tsT" value="${day(new Date(M.to - 864e5))}"></label>
      ${mgr() ? `<label class="row"><input type="checkbox" id="tsAll" ${M.everyone ? 'checked' : ''}> Everyone</label>` : ''}<button class="btn" id="tsGo">Show</button><span class="sp"></span><button class="btn" id="tsCsv">⬇ CSV</button></div><div id="tsList"><div class="card"><span class="spinner"></span></div></div>`;
    let rows = [];
    const paint = async () => {
      rows = await mexel('shifts', { from: M.from.toISOString(), to: M.to.toISOString(), everyone: !!M.everyone });
      const by = {}; for (const s of rows) (by[s.name || 'Staff'] ||= []).push(s);
      host.querySelector('#tsList').innerHTML = Object.entries(by).map(([name, list]) => `<div class="card"><div class="row"><h3 style="margin:0">${esc(name)}</h3><span class="sp"></span><b>${hm(list.reduce((n, s) => n + s.minutes, 0))}</b><span class="muted">· ${money(list.reduce((n, s) => n + (+s.sales || 0), 0))} in sales</span></div>
        <table class="cards"><tr><th>Day</th><th>Store</th><th>In</th><th>Out</th><th>Breaks</th><th>Worked</th><th></th></tr>${list.map(s => `<tr><td>${new Date(s.clock_in).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${esc(s.store || s.store_code || '—')}</td>
          <td>${new Date(s.clock_in).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td><td>${s.clock_out ? new Date(s.clock_out).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '<span class="pill p-approved">ON</span>'}${s.forgot ? ' <span class="pill p-pending" title="Clocked out later with the real time">FORGOT</span>' : ''}${s.edited_by ? ` <span class="muted" title="Fixed by ${esc(s.edited_by)}">✎</span>` : ''}</td>
          <td>${(s.breaks || []).length}</td><td><b>${hm(s.minutes)}</b></td><td>${mgr() ? `<button class="btn sm" data-edit="${s.id}">Fix</button>` : ''}</td></tr>${s.note ? `<tr><td colspan="7" class="muted">“${esc(s.note)}”</td></tr>` : ''}`).join('')}</table></div>`).join('') || '<div class="card"><p class="muted">No shifts in these dates.</p></div>';
      NX.labelTables?.();
      NX.afterTimesheets?.(host, rows, { from: M.from, to: M.to, everyone: !!M.everyone, mgr: mgr() });   // 2.8: payroll export
    };
    host.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'tsGo') { M.from = new Date(host.querySelector('#tsF').value + 'T00:00'); M.to = new Date(new Date(host.querySelector('#tsT').value + 'T00:00').getTime() + 864e5); M.everyone = !!host.querySelector('#tsAll')?.checked; return paint().catch(er => toast(er.message, true)); }
      if (b.id === 'tsCsv') {
        const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv = ['Name,Store,Clock in,Clock out,Breaks,Minutes,Sales,Orders,Note,Forgot,Fixed by', ...rows.map(s => [s.name, s.store || s.store_code, s.clock_in, s.clock_out, (s.breaks || []).length, s.minutes, s.sales, s.orders, s.note, s.forgot ? 'yes' : '', s.edited_by].map(q).join(','))].join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `mexel-timesheets-${host.querySelector('#tsF').value}.csv`; a.click(); return;
      }
      if (b.dataset.edit) {
        const s = rows.find(x => x.id === +b.dataset.edit); if (!s) return;
        const { el, close } = NX.modal(`<h3>Fix ${esc(s.name || 'a')} shift</h3><div class="acct-grid"><label>Clock in</label><input class="field" type="datetime-local" id="esI" value="${local(s.clock_in)}">
          <label>Clock out</label><input class="field" type="datetime-local" id="esO" value="${s.clock_out ? local(s.clock_out) : ''}"><label>Note</label><input class="field" id="esN" maxlength="500" value="${esc(s.note || '')}"></div>
          <p class="muted">The fix is logged with your name.</p><div class="row"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="esGo">Save</button></div>`);
        el.querySelector('#esGo').onclick = async () => {
          try { await mexel('edit_shift', { id: s.id, clock_in: new Date(el.querySelector('#esI').value).toISOString(), clock_out: el.querySelector('#esO').value ? new Date(el.querySelector('#esO').value).toISOString() : null, note: el.querySelector('#esN').value.trim() }); close(); toast('✓ Fixed'); paint(); }
          catch (er) { toast(er.message, true); }
        };
      }
    };
    await paint();
  }
  NX.mexelTimesheets = time;

  // ---------- Log (managers)
  async function log() {
    if (!mgr()) { box().innerHTML = '<div class="card"><p class="muted">Only managers (high-admins) can see the staff log.</p></div>'; return; }
    const list = await mexel('log');
    const LBL = { sale_link: '💳 Payment link', comp: '🎁 Free order', cancel: '⛔ Cancelled', refund: '↶ Refunded', edit_shift: '✎ Fixed a shift' };
    box().innerHTML = `<div class="card"><table class="cards"><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr>${list.map(l => `<tr><td class="muted">${dt(l.at)}</td><td>${esc(l.name || '')}</td><td>${esc(LBL[l.action] || l.action)}</td>
      <td class="muted">${esc(Object.entries(l.details || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')).slice(0, 220)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}</table></div>`;
    NX.labelTables?.();
  }

  // =========================================================== 🗓 Release planning (Releases page)
  const PST = { idea: ['Idea', 'p-closed'], planned: ['Planned', 'p-pending'], building: ['Building', 'p-reviewing'], testing: ['Testing', 'p-reviewing'], released: ['Released', 'p-approved'], done: ['Done', 'p-approved'], dropped: ['Dropped', 'p-declined'] };   // 2.8: Done
  const APPS = { nexus: "Nexus '28", admin: 'Apoji Admin', n28c: 'N28C', test_run: 'Test Run', aargon3: 'aARgon3' };
  const canPlan = () => !A.viewer && (A.owner || NX.can('changelog'));
  // 2.7: a plain-text summary of a plan, to paste anywhere (Copy info)
  const planText = p => {
    const it = p.items || [], grp = k => it.filter(x => (x.kind || 'feature') === k);
    const sec = (h, list) => list.length ? `\n${h}:\n${list.map(x => `- ${x.text}${x.done ? ' (done)' : ''}`).join('\n')}\n` : '';
    return [`${p.version}${p.title ? ' — ' + p.title : ''}`,
      [p.target_date ? 'Target: ' + new Date(p.target_date + 'T12:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '', 'Status: ' + (PST[p.status]?.[0] || p.status), (p.apps || []).length ? 'Apps: ' + p.apps.map(a => APPS[a] || a).join(', ') : ''].filter(Boolean).join(' · ')]
      .join('\n') + '\n' + sec('Features', grp('feature')) + sec('Fixes', grp('fix')) + sec('Other', grp('chore')) + (p.notes ? `\nNotes:\n${p.notes}\n` : '');
  };
  const copyPlan = p => { navigator.clipboard?.writeText(planText(p)); toast('Copied the plan'); };
  NX.planText = planText;
  NX.releasePlans = async host => {
    const { data, error } = await sb.from('admin_release_plans').select('*').order('target_date', { ascending: true, nullsFirst: false }).order('id');
    if (error) { host.innerHTML = `<div class="card"><h3>🗓 Plan releases</h3><p class="muted">${/admin_release_plans|42P01|PGRST20/.test(error.message) ? 'Run supabase/apoji-admin-2.6.sql (this repo) in Supabase → SQL Editor to turn this on.' : esc(error.message)}</p></div>`; return; }
    const FIN = ['released', 'done', 'dropped'];   // 2.8: finished plans live in their own section at the bottom
    const open = (data || []).filter(p => !FIN.includes(p.status)), done = (data || []).filter(p => FIN.includes(p.status)).sort((a, b) => new Date(b.done_at || b.updated_at || 0) - new Date(a.done_at || a.updated_at || 0));
    const view = NX.store?.get?.('planView', 'list') || 'list';
    const days = d => { if (!d) return ''; const n = Math.round((new Date(d + 'T12:00') - Date.now()) / 864e5); return n === 0 ? 'today' : n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : `${-n} day${n === -1 ? '' : 's'} late`; };
    const card = p => { const it = p.items || [], d = it.filter(x => x.done).length, pct = it.length ? Math.round(d / it.length * 100) : 0;
      return `<div class="plan ${p.status}" data-plan="${p.id}"><div class="row"><b class="plan-v">${esc(p.version)}</b><span class="pill ${PST[p.status][1]}">${PST[p.status][0].toUpperCase()}</span>${p.title ? `<span>${esc(p.title)}</span>` : ''}<span class="sp"></span>
        ${p.target_date ? `<span class="muted ${p.status !== 'released' && new Date(p.target_date + 'T23:59') < Date.now() ? 'err' : ''}">🗓 ${new Date(p.target_date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${days(p.target_date)}</span>` : '<span class="muted">no date</span>'}</div>
        <div class="muted">${(p.apps || []).map(a => APPS[a] || a).join(' · ')}</div>
        ${it.length ? `<div class="plan-bar"><i style="width:${pct}%"></i></div><div class="muted">${d}/${it.length} done · ${it.filter(x => x.kind === 'feature').length} features · ${it.filter(x => x.kind === 'fix').length} fixes</div>` : ''}
        <div class="row plan-foot">${FIN.includes(p.status) ? '' : `<div class="gate-slot" data-gate="${esc(p.version)}"></div>`}${FIN.includes(p.status) && p.done_at ? `<span class="muted">${PST[p.status][0]} ${new Date(p.done_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}<span class="sp"></span>
          ${canPlan() ? (FIN.includes(p.status) ? `<button class="btn sm ghost" data-planreopen="${p.id}" title="Back to Planned">Reopen</button>` : `<button class="btn sm" data-plandone="${p.id}" title="Mark this release as done">✓ Mark done</button>`) : ''}<button class="btn sm ghost" data-plancopy="${p.id}" title="Copy the version, features, fixes and notes as text">Copy info</button></div></div>`; };
    // 2.8: the release calendar (target dates, and when finished ones were done)
    const cal = () => {
      const m = NX.planMonth || (NX.planMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(12, 0, 0, 0); return d; })());
      const first = new Date(m), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const on = {}; for (const p of data || []) { const k = FIN.includes(p.status) && p.done_at ? key(new Date(p.done_at)) : p.target_date; if (k) (on[k] = on[k] || []).push(p); }
      const today = key(new Date());
      return `<div class="rcal"><div class="row rcal-nav"><button class="btn sm" data-calm="-1">‹</button><b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button class="btn sm" data-calm="1">›</button><button class="btn sm ghost" data-calm="0">Today</button></div>
        <div class="rcal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="rcal-h">${d}</div>`).join('')}
        ${Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = key(d), list = on[k] || [];
          return `<div class="rcal-d ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}"><span class="rcal-n">${d.getDate()}</span>${list.map(p => `<button class="rcal-p ${p.status}" data-plan="${p.id}" title="${esc(p.version + (p.title ? ' · ' + p.title : '') + ' · ' + PST[p.status][0])}">${FIN.includes(p.status) ? '✓ ' : ''}${esc(p.version)}</button>`).join('')}</div>`; }).join('')}</div>
        <p class="muted rcal-key">Coming releases sit on their target date; finished ones on the day they were done. ${(data || []).filter(p => !p.target_date && !FIN.includes(p.status)).length ? `${(data || []).filter(p => !p.target_date && !FIN.includes(p.status)).length} without a date aren’t shown.` : ''}</p></div>`;
    };
    const showAll = NX.planAllDone;
    host.innerHTML = `<div class="card"><div class="row"><h3 style="margin:0">🗓 Plan releases</h3><span class="muted">${open.length} coming up</span><span class="sp"></span>
        <div class="seg plan-view"><button class="${view === 'list' ? 'on' : ''}" data-planview="list">List</button><button class="${view === 'cal' ? 'on' : ''}" data-planview="cal">Calendar</button></div>${canPlan() ? '<button class="btn primary sm" id="plNew">＋ Plan a release</button>' : ''}</div>
      ${view === 'cal' ? cal() : `<div class="plans">${open.map(card).join('') || '<p class="muted">Nothing planned. Plan the next version: what’s in it, when, and for which apps.</p>'}</div>`}</div>
      ${done.length ? `<div class="card plans-done"><details ${NX.planDoneOpen ? 'open' : ''}><summary><h3 style="display:inline;margin:0">Done</h3> <span class="muted">${done.length} finished · released, done or dropped</span></summary>
        <div class="plans">${(showAll ? done : done.slice(0, 8)).map(card).join('')}</div>${done.length > 8 ? `<button class="btn sm ghost" data-planall>${showAll ? 'Show fewer' : `Show all ${done.length}`}</button>` : ''}</details></div>` : ''}`;
    host.querySelector('.plans-done details')?.addEventListener('toggle', e => { NX.planDoneOpen = e.target.open; });
    // the release gate for planned versions that have tests
    for (const slot of host.querySelectorAll('[data-gate]')) NX.releaseGate?.(slot.dataset.gate).then(g => { if (g?.items) slot.innerHTML = `<span class="pill ${g.ready ? 'p-approved' : 'p-declined'}">${g.ready ? 'TESTS PASS' : `${g.failing} FAILING · ${g.untested} UNTESTED`}</span>`; }).catch(() => {});
    host.onclick = async e => { const cp = e.target.closest('[data-plancopy]'); if (cp) { e.stopPropagation(); return copyPlan((data || []).find(p => p.id === +cp.dataset.plancopy)); }
      const dn = e.target.closest('[data-plandone], [data-planreopen]');
      if (dn) { e.stopPropagation(); const id = +(dn.dataset.plandone || dn.dataset.planreopen), st = dn.dataset.plandone ? 'done' : 'planned';
        const { error } = await sb.from('admin_release_plans').update({ status: st }).eq('id', id);
        if (error) return toast(/check constraint|status_check/.test(error.message) ? 'Run supabase/apoji-admin-2.8.sql to mark releases done.' : error.message, true);
        toast(st === 'done' ? '✓ Marked done' : 'Reopened'); return NX.releasePlans(host); }
      const pv = e.target.closest('[data-planview]'); if (pv) { NX.store?.set?.('planView', pv.dataset.planview); return NX.releasePlans(host); }
      const cm = e.target.closest('[data-calm]'); if (cm) { const d = NX.planMonth || new Date(); if (cm.dataset.calm === '0') NX.planMonth = null; else { const n = new Date(d); n.setMonth(n.getMonth() + +cm.dataset.calm); NX.planMonth = n; } return NX.releasePlans(host); }
      if (e.target.closest('[data-planall]')) { NX.planAllDone = !NX.planAllDone; NX.planDoneOpen = true; return NX.releasePlans(host); }
      const b = e.target.closest('#plNew'); if (b) return planModal(null, host); const c = e.target.closest('[data-plan]'); if (c) planModal((data || []).find(p => p.id === +c.dataset.plan), host); };
  };
  function planModal(p, host) {
    const can = canPlan(), items = (p?.items || []).map(x => ({ ...x }));
    const { el, close } = NX.modal(`<h3 class="pv-head">${p ? `🗓 ${esc(p.version)}` : '🗓 Plan a release'}</h3>
      <div class="acct-grid"><label>Version</label><input class="field" id="pvV" value="${esc(p?.version || '')}" placeholder="3.11.0" ${can ? '' : 'disabled'}>
        <label>Name</label><input class="field" id="pvT" maxlength="120" value="${esc(p?.title || '')}" placeholder="What it's about, e.g. Voice and the Nexus guide" ${can ? '' : 'disabled'}>
        <label>Target date</label><input class="field" type="date" id="pvD" value="${esc(p?.target_date || '')}" ${can ? '' : 'disabled'}>
        <label>Status</label><select class="field" id="pvS" ${can ? '' : 'disabled'}>${Object.entries(PST).map(([k, [l]]) => `<option value="${k}" ${(p?.status || 'planned') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Apps</label><div class="row" style="flex-wrap:wrap">${Object.entries(APPS).map(([k, l]) => `<label class="row"><input type="checkbox" data-app="${k}" ${(p?.apps || ['nexus']).includes(k) ? 'checked' : ''} ${can ? '' : 'disabled'}> ${l}</label>`).join('')}</div></div>
      <h3 class="pv-sec">What’s in it <span class="muted">click any item to change it</span></h3><div id="pvItems" class="pv-items"></div>
      ${can ? `<div class="row pv-add"><select class="field sm" id="pvK" style="width:auto"><option value="feature">Feature</option><option value="fix">Fix</option><option value="chore">Other</option></select><input class="field" id="pvI" maxlength="200" placeholder="Add something, e.g. Live dictation" style="flex:1"><button class="btn" id="pvAdd">Add</button></div>` : ''}
      <label class="muted pv-notes-l">Notes</label><textarea class="field" id="pvN" rows="3" maxlength="4000" ${can ? '' : 'disabled'}>${esc(p?.notes || '')}</textarea>
      <div class="row pv-actions"><span class="muted pv-auto" id="pvAuto">${can ? (p ? 'Changes save by themselves' : 'Saves by itself once it has a version') : ''}</span>${p && can ? '<button class="btn danger" id="pvDel">Delete</button><button class="btn" id="pvTests" title="Adds the unfinished items to Testing for this version">🧪 Add to Testing</button><button class="btn" id="pvNotes" title="Copies What’s New lines for changes.json">📋 Release notes</button>' : ''}<span class="sp"></span><button class="btn" id="pvCopy" title="Copy the version, features, fixes and notes as text">Copy info</button><button class="btn" data-close>Close</button>${can ? '<button class="btn primary" id="pvGo">Done</button>' : ''}</div>`);
    el.classList.add('pv-modal');
    // 2.7: every item can be changed after saving: click its text to edit it, pick a kind, move it up or down
    const KINDS = [['feature', 'FEATURE'], ['fix', 'FIX'], ['chore', 'OTHER']];
    const paintItems = (touch = true) => { if (touch && typeof soon === 'function' && el.querySelector('#pvN')) soon(); el.querySelector('#pvItems').innerHTML = items.map((x, i) => `<div class="plan-item ${x.done ? 'done' : ''}" data-i="${i}"><input type="checkbox" data-done="${i}" ${x.done ? 'checked' : ''} ${can ? '' : 'disabled'}>
        ${can ? `<select class="field sm pi-kind" data-kind="${i}">${KINDS.map(([k, l]) => `<option value="${k}" ${(x.kind || 'feature') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<span class="pill">${(KINDS.find(k => k[0] === (x.kind || 'feature')) || KINDS[0])[1]}</span>`}
        ${can ? `<input class="field pi-text" data-text="${i}" value="${esc(x.text)}" maxlength="200" aria-label="Item">` : `<span class="pi-text">${esc(x.text)}</span>`}
        ${can ? `<span class="pi-tools"><button class="btn sm ghost" data-up="${i}" title="Move up" ${i ? '' : 'disabled'}>↑</button><button class="btn sm ghost" data-down="${i}" title="Move down" ${i < items.length - 1 ? '' : 'disabled'}>↓</button><button class="btn sm ghost" data-rm="${i}" title="Remove">✕</button></span>` : ''}</div>`).join('') || '<p class="muted">Nothing yet.</p>'; };
    el.addEventListener('input', e => { const i = e.target.dataset.text; if (i !== undefined) items[+i].text = e.target.value; soon(); });
    el.addEventListener('change', e => { const i = e.target.dataset.kind; if (i !== undefined) items[+i].kind = e.target.value; soon(); });
    // 2.10: plans save themselves as you type (a second after you stop), and once more when the window closes
    const rowOf = () => ({ version: el.querySelector('#pvV').value.trim(), title: el.querySelector('#pvT').value.trim(), target_date: el.querySelector('#pvD').value || null, status: el.querySelector('#pvS').value,
      apps: [...el.querySelectorAll('[data-app]:checked')].map(x => x.dataset.app), items: items.map(x => ({ ...x, text: x.text.trim() })).filter(x => x.text), notes: el.querySelector('#pvN').value.trim() });
    let savedJson = p ? JSON.stringify(rowOf()) : '', timer = null, busy = null, changed = false;
    const stat = (m, bad) => { const s = el.querySelector('#pvAuto'); if (s) { s.textContent = m; s.classList.toggle('err', !!bad); } };
    async function autosave() {
      clearTimeout(timer); if (!can) return true;
      if (busy) await busy;
      const row = rowOf(), j = JSON.stringify(row);
      if (!row.version) { stat('Give it a version and it saves by itself'); return false; }
      if (j === savedJson) return true;
      stat('Saving…');
      busy = (p ? sb.from('admin_release_plans').update(row).eq('id', p.id).select().single() : sb.from('admin_release_plans').insert(row).select().single()).then(({ data, error }) => {
        if (error) { stat(/duplicate|unique/.test(error.message) ? `${row.version} is already planned.` : error.message, true); return false; }
        if (data) p = data; savedJson = j; changed = true;
        stat('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); return true;
      });
      const ok = await busy; busy = null; return ok;
    }
    const soon = () => { if (!can) return; clearTimeout(timer); stat('Editing…'); timer = setTimeout(autosave, 900); };
    // when the window goes away (✕, Escape, clicking outside, Back), save what's left and refresh the list
    const gone = new MutationObserver(() => { if (el.isConnected) return; gone.disconnect(); autosave().then(() => { if (changed) NX.releasePlans(host); }); });
    gone.observe(document.body, { childList: true, subtree: true });
    paintItems(false);
    const add = () => { const t = el.querySelector('#pvI').value.trim(); if (!t) return; items.push({ text: t, kind: el.querySelector('#pvK').value, done: false }); el.querySelector('#pvI').value = ''; paintItems(); el.querySelector('#pvI').focus(); };
    el.addEventListener('keydown', e => { if (e.target.id === 'pvI' && e.key === 'Enter') { e.preventDefault(); add(); } });
    el.onclick = async e => {
      const t = e.target;
      if (t.dataset.done !== undefined) { items[+t.dataset.done].done = t.checked; return paintItems(); }
      const b = t.closest('button'); if (!b) return;
      if (b.id === 'pvAdd') return add();
      if (b.dataset.rm !== undefined) { items.splice(+b.dataset.rm, 1); return paintItems(); }
      if (b.dataset.up !== undefined || b.dataset.down !== undefined) { const i = +(b.dataset.up ?? b.dataset.down), j = b.dataset.up !== undefined ? i - 1 : i + 1; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; return paintItems(); }
      if (b.id === 'pvCopy') return copyPlan({ ...(p || {}), version: el.querySelector('#pvV').value.trim() || p?.version || 'Next version', title: el.querySelector('#pvT').value.trim(), target_date: el.querySelector('#pvD').value || null, status: el.querySelector('#pvS').value, apps: [...el.querySelectorAll('[data-app]:checked')].map(x => x.dataset.app), items: items.filter(x => x.text.trim()), notes: el.querySelector('#pvN').value.trim() });
      if (b.id === 'pvGo') {
        if (!el.querySelector('#pvV').value.trim()) return toast('Give it a version, like 3.11.0', true);
        if (!(await autosave())) return;
        close(); return;   // the observer refreshes the list
      }
      if (b.id === 'pvDel') { if (!confirm(`Delete the plan for ${p.version}?`)) return; const { error } = await sb.from('admin_release_plans').delete().eq('id', p.id); if (error) return toast(error.message, true); close(); toast('Deleted'); return NX.releasePlans(host); }
      if (b.id === 'pvTests') {
        const todo = items.filter(x => x.kind !== 'chore'); if (!todo.length) return toast('Nothing to test yet.', true);
        const { data: have } = await sb.from('test_items').select('title').eq('release', p.version);
        const seen = new Set((have || []).map(x => x.title));
        const rows = todo.filter(x => !seen.has(x.text)).map((x, i) => ({ release: p.version, platform: 'all', title: x.text.slice(0, 200), steps: '', created_by: A.user.id, sort: (have || []).length + i }));
        if (!rows.length) return toast('They’re all in Testing already.');
        const { error } = await sb.from('test_items').insert(rows); if (error) return toast(error.message, true);
        toast(`🧪 Added ${rows.length} to Testing for ${p.version}`); return;
      }
      if (b.id === 'pvNotes') {
        const lines = items.filter(x => x.done || p.status === 'released').map(x => x.text);
        const snip = JSON.stringify({ version: p.version, date: new Date().toISOString().slice(0, 10), title: p.title || '', highlights: lines }, null, 2);
        navigator.clipboard?.writeText(snip); toast('📋 Copied: paste it at the top of docs/whats-new/changes.json');
      }
    };
  }
  // put the plan at the top of Releases
  const relBefore = P.releases;
  if (relBefore) P.releases = async () => {
    await relBefore();
    if (A.tab !== 'releases') return;
    const host = document.createElement('div'); host.id = 'relPlans';
    const at = $('main').querySelector('h1 + p') || $('main').querySelector('h1'); at?.after(host);
    NX.releasePlans(host);
  };

  // =========================================================== 👁 Preview as (Owner only)
  // Changes what this browser shows (menu, buttons, pages) to match a role. Supabase still knows it's you, so anything
  // you do while previewing is still done as the Owner: the banner says so.
  const ROLES = { 'high-editor': ['High-admin', 'high-admin', 'editor'], 'high-viewer': ['High-admin · Viewer', 'high-admin', 'viewer'], admin: ['Admin', 'admin', ''], mod: ['Moderator', 'mod', ''] };
  NX.previewRoles = ROLES;
  NX.previewAs = role => {
    if (!A.realOwner && !A.owner) return;
    if (!A.real) A.real = { level: A.level, tier: A.tier, owner: A.owner, viewer: A.viewer, manage: A.manage, perms: A.perms };
    if (!role || !ROLES[role]) { Object.assign(A, A.real); A.real = null; A.preview = null; A.realOwner = true; NX.store.set('previewAs', null); }
    else {
      const [, level, tier] = ROLES[role];
      Object.assign(A, { level, tier, owner: false, viewer: tier === 'viewer', manage: false, perms: { all: level === 'high-admin' && tier !== 'viewer', approve: false, perms: [], pending: [] } });
      A.preview = role; A.realOwner = true; NX.store.set('previewAs', role);
    }
    NX.shell(); paintPreview();
  };
  function paintPreview() {
    document.querySelector('.preview-bar')?.remove();
    if (!A.preview) return;
    document.body.insertAdjacentHTML('afterbegin', `<div class="preview-bar">👁 Previewing Apoji Admin as <b>${esc(ROLES[A.preview][0])}</b>. Supabase still sees you as the Owner, so anything you do here is done as you.<button class="btn sm" id="pvStop">Stop previewing</button></div>`);
    document.getElementById('pvStop').onclick = () => NX.previewAs(null);
  }
  // after sign-in: remember the Owner, and resume a preview after a reload
  const termsBefore = NX.termsCheck;
  NX.termsCheck = async () => {
    if (A.owner) A.realOwner = true;
    const saved = NX.store.get('previewAs', null);
    if (A.realOwner && saved && ROLES[saved] && !A.preview) NX.previewAs(saved);
    return termsBefore?.();
  };
  // the switch, in My settings
  const meBefore = P.me;
  if (meBefore) P.me = async (...a) => {
    await meBefore(...a);
    if (!A.realOwner || A.tab !== 'me') return;
    const first = $('main').querySelector('.card');
    first?.insertAdjacentHTML('beforebegin', `<div class="card"><h3>👁 Preview as</h3><p class="muted">See Apoji Admin the way someone else does: their menu, their pages, their locked buttons. Only you see it, and you can stop any time.</p>
      <div class="row" style="flex-wrap:wrap"><button class="btn ${!A.preview ? 'primary' : ''}" data-prev="">👑 Owner (you)</button>${Object.entries(ROLES).map(([k, [l]]) => `<button class="btn ${A.preview === k ? 'primary' : ''}" data-prev="${k}">${esc(l)}</button>`).join('')}</div></div>`);
    $('main').querySelectorAll('[data-prev]').forEach(b => b.addEventListener('click', () => NX.previewAs(b.dataset.prev || null)));
  };
})();
