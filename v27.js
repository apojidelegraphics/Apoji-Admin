// Apoji Admin 2.7:
//   • Mexel: Sales (all-time sales, gross revenue by month, total orders, average order, orders by plan type, by store,
//     tier, source and seller), You (your profile, sales, hours, upcoming shifts and time off) and Promotions (codes).
//   • STAFF in the sidebar: Shifts (this week's schedule, add / copy shifts, timesheets) and Employees (the team, adding
//     people, time off requests). All of it goes through the aARgon3 `staff` function (needs aARgon3 2.1 or newer).
//   • API usage: everything Apoji pays for or shares in one place, the Paragon & Axiom key (usage + which models it runs)
//     and a check of every server function.
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const M = NX.mexelState, mexel = (...a) => NX.mexel(...a);
  const money = n => '$' + (+n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = n => '$' + Math.round(+n || 0).toLocaleString();
  const hm = m => { m = Math.round(+m || 0); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const dt = v => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const tm = v => new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayName = v => new Date(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const ymd = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  const local = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const mgr = () => !!M.me?.manager, owner = () => !!M.me?.owner;
  const box = () => $('mx');
  const NEEDS21 = 'This needs aARgon3 2.1 or newer (aArgon3 repo → supabase/aargon3-2.1.sql, then redeploy the staff function).';
  const friendly = e => /unknown action|not a function|404/i.test(e.message || '') ? NEEDS21 : e.message;
  async function ensureMe() {
    if (M.me && Date.now() - (M.at || 0) < 120e3) return M.me;
    const r = await mexel('me'); M.me = r.user; M.state = r.state; M.overview = r.overview; M.at = Date.now(); return M.me;
  }
  // a simple bar list: [{ key, orders, revenue }]
  const bars = (list, { label = x => x.key, value = x => +x.revenue || 0, sub = x => `${x.orders} order${x.orders === 1 ? '' : 's'}` } = {}) => {
    const max = Math.max(1, ...list.map(value)), total = list.reduce((n, x) => n + value(x), 0) || 1;
    return list.length ? `<div class="mx-bars">${list.map(x => `<div class="mx-bar"><div class="row"><b>${esc(cap(label(x)))}</b><span class="sp"></span><span>${money(value(x))}</span></div>
      <div class="at-bar"><i style="width:${Math.max(2, Math.round(value(x) / max * 100))}%"></i></div><small class="muted">${esc(sub(x))} · ${Math.round(value(x) / total * 100)}% of sales</small></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>';
  };

  // =========================================================== Mexel → Sales
  NX.mexelTabs.sales = async function sales() {
    const mine = !mgr() || !!M.salesMine;
    box().innerHTML = '<div class="card"><span class="spinner"></span></div>';
    let r; try { r = await mexel('sales', { mine }); } catch (e) { box().innerHTML = `<div class="card err">${esc(friendly(e))}</div>`; return; }
    const a = r.all_time || {}, months = r.months || [], paid = Math.max(1, +a.paid_orders || +a.orders || 0);
    const avg = (+a.revenue || 0) / paid, max = Math.max(1, ...months.map(m => +m.revenue || 0));
    let run = 0; const cum = months.map(m => (run += +m.revenue || 0)); const cmax = Math.max(1, run);
    const W = 640, H = 170, step = W / Math.max(1, months.length);
    const line = cum.map((v, i) => `${(i + .5) * step},${H - 8 - (v / cmax) * (H - 24)}`).join(' ');
    const yearRev = months.reduce((n, m) => n + (+m.revenue || 0), 0), yearOrders = months.reduce((n, m) => n + (+m.orders || 0), 0);
    const best = months.reduce((b, m) => (+m.revenue || 0) > (+b?.revenue || 0) ? m : b, null);
    const mName = k => new Date(k + '-15').toLocaleDateString(undefined, { month: 'short' });
    const plans = r.by_plan || [], totalOrders = plans.reduce((n, x) => n + (+x.orders || 0), 0) || 1;
    box().innerHTML = `${mgr() ? `<div class="row mx-scope"><div class="seg sm"><button class="${mine ? '' : 'on'}" data-scope="all">Everyone</button><button class="${mine ? 'on' : ''}" data-scope="mine">Just me</button></div><span class="muted">${mine ? 'Orders you sold yourself.' : 'Every store, every seller and the online store.'}</span></div>` : '<p class="muted mx-scope">Your own sales.</p>'}
      <div class="stats4 mx-stats">
        <div class="stat big"><b>${money(a.revenue)}</b><span>gross revenue, all time</span></div>
        <div class="stat"><b>${(+a.orders || 0).toLocaleString()}</b><span>total orders</span></div>
        <div class="stat"><b>${money(avg)}</b><span>average order</span></div>
        <div class="stat"><b>${money(r.this_month)}</b><span>this month</span></div>
        <div class="stat"><b>${money(r.mrr)}</b><span>monthly recurring</span></div>
        <div class="stat"><b>${(+r.active_subscriptions || 0).toLocaleString()}</b><span>active subscriptions</span></div></div>
      <div class="card"><div class="row"><h3 style="margin:0">Gross revenue</h3><span class="sp"></span><span class="muted">Last 12 months: <b>${money(yearRev)}</b> · ${yearOrders} orders${best ? ` · best month ${mName(best.month)} (${money0(best.revenue)})` : ''}</span></div>
        <div class="mx-rev"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${months.map((m, i) => { const h = ((+m.revenue || 0) / max) * (H - 24); return `<rect x="${i * step + step * .18}" y="${H - 8 - h}" width="${step * .64}" height="${Math.max(1, h)}" rx="4"><title>${esc(m.month)}: ${money(m.revenue)} · ${m.orders} orders</title></rect>`; }).join('')}
          <polyline points="${line}" fill="none" class="mx-cum"/></svg>
          <div class="mx-rev-x">${months.map(m => `<span>${mName(m.month)}<b>${money0(m.revenue)}</b></span>`).join('')}</div></div>
        <p class="muted mx-legend"><i class="sw bar"></i> revenue each month <i class="sw line"></i> running total (${money0(run)})</p></div>
<div class="card mx-store"><h3>By store</h3><div class="mx-scroll">${(r.top_stores || []).length ? `<table class="cards"><tr><th>Store</th><th>Orders</th><th>Revenue</th><th>Average</th></tr>${r.top_stores.map(x => `<tr><td><b>${esc(x.name === '—' ? 'Online / no store' : x.name)}</b></td><td>${x.orders}</td><td>${money(x.revenue)}</td><td>${money((+x.revenue || 0) / Math.max(1, +x.orders || 0))}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing yet.</p>'}</div></div>
      <div class="grid2">
        <div class="card"><h3>Orders by plan type</h3>${plans.length ? `<div class="mx-donut-row">${donut(plans.map(x => +x.orders || 0))}<div class="mx-bars">${plans.map((x, i) => `<div class="mx-bar"><div class="row"><i class="sw" style="background:${PAL[i % PAL.length]}"></i><b>${esc(cap(x.key))}</b><span class="sp"></span><span>${x.orders} · ${Math.round(x.orders / totalOrders * 100)}%</span></div><small class="muted">${money(x.revenue)} · avg ${money((+x.revenue || 0) / Math.max(1, +x.orders || 0))}</small></div>`).join('')}</div></div>` : '<p class="muted">Nothing yet.</p>'}</div>
        <div class="card"><h3>By tier</h3>${bars(r.by_tier || [])}</div>
        <div class="card"><h3>Where orders come from</h3>${bars(r.by_source || [], { label: x => ({ web: 'Online store', staff: 'Sold in store', comp: 'Free orders', quote: 'Custom orders & quotes', legacy: 'Before aARgon3 2.0' })[x.key] || x.key })}</div>
        ${mine ? '' : `<div class="card"><h3>Top sellers</h3>${(r.top_staff || []).length ? `<table class="cards"><tr><th>Seller</th><th>Orders</th><th>Revenue</th></tr>${r.top_staff.map((x, i) => `<tr><td><b>${i + 1}. ${esc(x.name)}</b></td><td>${x.orders}</td><td>${money(x.revenue)}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing yet.</p>'}</div>`}
        <div class="card"><h3>All time</h3><div class="kv"><span>First order</span><span>${a.first_order ? new Date(a.first_order).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</span>
          <span>Paid orders</span><span>${(+a.paid_orders || 0).toLocaleString()}</span><span>Free orders</span><span>${(+a.comp_orders || 0).toLocaleString()}</span><span>Renewals</span><span>${(+a.renewals || 0).toLocaleString()}</span></div>
          <p class="muted" style="margin-bottom:0">Refunded and cancelled-with-refund orders don’t count.</p></div></div>`;
    NX.labelTables?.();
    box().onclick = e => { const s = e.target.closest('[data-scope]'); if (s) { M.salesMine = s.dataset.scope === 'mine'; NX.mexelTabs.sales(); } };
  };
  const PAL = ['#9a80ff', '#3dffa0', '#5ce1ff', '#ffd36b', '#ff8a98', '#9be37b'];
  function donut(vals) {
    const total = vals.reduce((a, b) => a + b, 0) || 1; let a0 = -Math.PI / 2;
    const arcs = vals.map((v, i) => { const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0, r = 42;
      const p = v >= total ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="14"/>` : `<path d="M ${50 + r * Math.cos(a0)} ${50 + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${50 + r * Math.cos(a1)} ${50 + r * Math.sin(a1)}" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="14"/>`;
      a0 = a1; return p; }).join('');
    return `<svg class="mx-donut" viewBox="0 0 100 100" aria-hidden="true">${arcs}<text x="50" y="48" text-anchor="middle">${total}</text><text x="50" y="62" text-anchor="middle" class="s">orders</text></svg>`;
  }

  // =========================================================== Mexel → You
  NX.mexelTabs.you = async function you() {
    box().innerHTML = '<div class="card"><span class="spinner"></span></div>';
    let p, mine; try { [p, mine] = await Promise.all([mexel('profile'), mexel('shifts', { from: new Date(Date.now() - 14 * 864e5).toISOString(), to: new Date(Date.now() + 864e5).toISOString() })]); }
    catch (e) { box().innerHTML = `<div class="card err">${esc(friendly(e))}</div>`; return; }
    const me = p.me || {}, s = M.state || {}, sa = p.sales?.all_time || {}, stores = s.stores || [];
    const roleL = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }[M.me?.role] || cap(M.me?.role);
    const color = /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#9a80ff';
    const upcoming = s.upcoming || [], off = p.timeoff || [];
    const mins = (mine || []).reduce((n, x) => n + (+x.minutes || 0), 0);
    box().innerHTML = `<div class="mx-you-head card"><span class="mx-you-av" style="--c:${color}">${esc((me.name || M.me?.name || '?')[0].toUpperCase())}</span>
        <div><h2>${esc(me.name || M.me?.name || 'You')}</h2><div class="muted">${esc(roleL)}${me.title ? ' · ' + esc(me.title) : ''} · ${esc(me.email || M.me?.email || '')}</div></div><span class="sp"></span>
        ${s.shift ? `<span class="pill p-approved">${s.shift.on_break ? 'ON BREAK' : 'ON THE CLOCK'}</span>` : '<span class="pill">OFF THE CLOCK</span>'}</div>
      <div class="stats4 mx-stats"><div class="stat"><b>${money(sa.revenue)}</b><span>your sales, all time</span></div><div class="stat"><b>${(+sa.orders || 0).toLocaleString()}</b><span>orders you sold</span></div>
        <div class="stat"><b>${money(p.sales?.this_month)}</b><span>this month</span></div><div class="stat"><b>${hm(s.week_minutes)}</b><span>worked this week</span></div></div>
      <div class="grid2">
        <div class="card"><h3>Coming up</h3>${upcoming.length ? upcoming.map(c => `<div class="row mx-oc"><b>${dayName(c.starts_at)}</b><span>${tm(c.starts_at)} – ${tm(c.ends_at)}</span><span class="muted">${esc(storeName(stores, c.store_code))}${c.note ? ' · ' + esc(c.note) : ''}</span></div>`).join('') : '<p class="muted">No shifts scheduled for you.</p>'}
          <div class="row" style="margin-top:10px"><button class="btn sm" data-go="shifts">See this week’s shifts</button></div></div>
        <div class="card"><h3>Last 2 weeks</h3>${(mine || []).length ? `<p><b>${hm(mins)}</b> over ${(mine || []).length} shift${(mine || []).length === 1 ? '' : 's'} · ${money((mine || []).reduce((n, x) => n + (+x.sales || 0), 0))} in sales</p>${(mine || []).slice(0, 6).map(x => `<div class="row mx-oc"><b>${dayName(x.clock_in)}</b><span>${tm(x.clock_in)} – ${x.clock_out ? tm(x.clock_out) : 'now'}</span><span class="muted">${hm(x.minutes)}</span></div>`).join('')}` : '<p class="muted">No shifts in the last 2 weeks.</p>'}</div>
        <div class="card"><h3>Your details</h3><div class="acct-grid mx-form">
          <label>Name</label><input class="field" id="yName" maxlength="80" value="${esc(me.display_name || '')}" placeholder="${esc(me.nexus_name || 'From your Nexus account')}">
          <label>Title</label><input class="field" id="yTitle" maxlength="80" value="${esc(me.title || '')}" placeholder="e.g. Sales lead">
          <label>Phone</label><input class="field" id="yPhone" maxlength="40" value="${esc(me.phone || '')}" placeholder="Optional">
          <label>Usual store</label><select class="field" id="yStore"><option value="">None</option>${stores.map(x => `<option value="${esc(x.code)}" ${me.default_store === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <label>Color</label><div class="row"><input type="color" id="yColor" value="${color}"><span class="muted">Shows on the schedule</span></div></div>
          <div class="row" style="margin-top:12px"><span class="sp"></span><button class="btn primary" id="ySave">Save</button></div></div>
        <div class="card"><h3>Time off</h3>
          <div class="acct-grid mx-form"><label>From</label><input class="field" type="date" id="toS" value="${ymd(Date.now() + 7 * 864e5)}"><label>To</label><input class="field" type="date" id="toE" value="${ymd(Date.now() + 7 * 864e5)}"><label>Why</label><input class="field" id="toR" maxlength="300" placeholder="Optional"></div>
          <div class="row" style="margin-top:10px"><span class="sp"></span><button class="btn" id="toGo">Ask for time off</button></div>
          ${off.length ? `<div class="mx-list">${off.map(t => `<div class="row mx-oc"><b>${t.starts_on === t.ends_on ? esc(t.starts_on) : `${esc(t.starts_on)} → ${esc(t.ends_on)}`}</b><span class="pill ${t.status === 'approved' ? 'p-approved' : t.status === 'pending' ? 'p-pending' : 'p-declined'}">${esc(String(t.status).toUpperCase())}</span><span class="muted">${esc(t.reason || '')}</span><span class="sp"></span>${t.status === 'pending' ? `<button class="btn sm ghost" data-tocancel="${t.id}">Cancel</button>` : ''}</div>`).join('')}</div>` : ''}</div>
      </div>`;
    box().onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.go) return NX.go(b.dataset.go);
        if (b.id === 'ySave') { await mexel('profile_save', { display_name: $('yName').value.trim(), title: $('yTitle').value.trim(), phone: $('yPhone').value.trim(), default_store: $('yStore').value, color: $('yColor').value }); toast('Saved'); M.at = 0; return NX.mexelTabs.you(); }
        if (b.id === 'toGo') { await mexel('timeoff_request', { starts_on: $('toS').value, ends_on: $('toE').value || $('toS').value, reason: $('toR').value.trim() }); toast('Asked. A manager will answer.'); return NX.mexelTabs.you(); }
        if (b.dataset.tocancel) { await mexel('timeoff_decide', { id: +b.dataset.tocancel, status: 'cancelled' }); return NX.mexelTabs.you(); }
      } catch (er) { toast(friendly(er), true); }
    };
  };
  const storeName = (stores, code) => (stores.find(x => x.code === code) || {}).name || code || 'No store';
  NX.staffKit = { mexel, ensureMe, mgr, owner, friendly, money, money0, hm, dt, tm, dayName, ymd, cap, bars, storeName };   // 2.8 (v28.js)

  // =========================================================== Mexel → Promotions (managers)
  NX.mexelTabs.promos = async function promos() {
    if (!mgr()) { box().innerHTML = '<div class="card"><p class="muted">Only managers (high-admins) can make promotion codes.</p></div>'; return; }
    box().innerHTML = '<div class="card"><span class="spinner"></span></div>';
    let list; try { list = await mexel('promos'); } catch (e) { box().innerHTML = `<div class="card err">${esc(friendly(e))}</div>`; return; }
    const live = list.filter(x => x.live), used = list.reduce((n, x) => n + (+x.used || 0), 0);
    const off = x => x.type === 'percentage' ? `${+x.value}% off` : `${money(x.value).replace('.00', '')} off`;
    const how = x => x.duration === 'forever' ? 'every payment' : x.duration === 'repeating' ? `${x.duration_months} months` : 'first payment';
    box().innerHTML = `<div class="stats4 mx-stats"><div class="stat"><b>${live.length}</b><span>live codes</span></div><div class="stat"><b>${list.length}</b><span>codes made</span></div><div class="stat"><b>${used}</b><span>times used</span></div></div>
      <div class="card"><div class="row"><h3 style="margin:0">Promotion codes</h3><span class="sp"></span><button class="btn primary" id="prNew">＋ New code</button></div>
        <p class="muted">Customers type these at checkout on the aARgon3 store (and staff can apply them when selling). Each one is a Stripe promotion code.</p>
        ${list.length ? `<div class="mx-promos">${list.map(x => `<div class="mx-promo ${x.live ? '' : 'off'}"><div class="row"><b class="mx-code">${esc(x.code)}</b><button class="btn sm ghost" data-copycode="${esc(x.code)}" title="Copy the code">Copy</button><span class="sp"></span><span class="pill ${x.live ? 'p-approved' : x.active ? 'p-pending' : ''}">${x.live ? 'LIVE' : x.active ? (x.ends && new Date(x.ends) < Date.now() ? 'ENDED' : x.limit && x.used >= x.limit ? 'USED UP' : 'NOT YET') : 'OFF'}</span></div>
          <div class="mx-promo-off">${off(x)} <span class="muted">· ${how(x)}</span></div>
          <div class="muted">${esc(x.description || '')}</div>
          <div class="muted">${[(x.plans || []).length ? (x.plans || []).map(cap).join(', ') : 'Every plan', (x.tiers || []).length ? (x.tiers || []).map(cap).join(', ') : 'every tier', +x.min_total ? `orders over ${money0(x.min_total)}` : ''].filter(Boolean).join(' · ')}</div>
          <div class="row mx-promo-foot"><span class="muted">Used ${x.used}${x.limit ? ` of ${x.limit}` : ''}${x.ends ? ` · ends ${new Date(x.ends).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''} · by ${esc(x.created_by || '—')}</span><span class="sp"></span><button class="btn sm" data-promo="${x.id}" data-on="${x.active ? 0 : 1}">${x.active ? 'Switch off' : 'Switch on'}</button></div></div>`).join('')}</div>` : '<p class="muted">No codes yet.</p>'}</div>`;
    box().onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.copycode) { navigator.clipboard?.writeText(b.dataset.copycode); return toast('Copied ' + b.dataset.copycode); }
      if (b.id === 'prNew') return promoModal();
      if (b.dataset.promo) { try { await mexel('promo_save', { id: +b.dataset.promo, active: b.dataset.on === '1' }); toast(b.dataset.on === '1' ? 'Switched on' : 'Switched off'); NX.mexelTabs.promos(); } catch (er) { toast(friendly(er), true); } }
    };
    NX.afterPromos?.(box(), list);   // 2.8: promo performance
  };
  async function promoModal() {
    let C = null; try { C = await (await fetch('https://apojidelegraphics.github.io/aArgon3/catalog.json', { cache: 'no-store' })).json(); } catch {}
    const plans = C?.planOrder || ['personal', 'business', 'enterprise'], tiers = C?.tierOrder || ['standard', 'plus', 'pro', 'max'];
    const { el, close } = NX.modal(`<h3>New promotion code</h3><div class="acct-grid mx-form">
      <label>Code</label><input class="field mx-code" id="pcC" maxlength="30" placeholder="SPRING25" style="text-transform:uppercase">
      <label>Discount</label><div class="row"><input class="field" id="pcV" type="number" min="1" step="1" value="20" style="width:110px"><select class="field" id="pcT" style="width:auto"><option value="percentage">% off</option><option value="fixed">$ off</option></select></div>
      <label>For</label><div class="row"><select class="field" id="pcD" style="width:auto"><option value="once">The first payment</option><option value="repeating">Some months</option><option value="forever">Every payment</option></select><input class="field" id="pcM" type="number" min="1" max="36" value="3" style="width:90px" hidden><span class="muted" id="pcMl" hidden>months</span></div>
      <label>Plans</label><div class="row" style="flex-wrap:wrap">${plans.map(x => `<label class="row"><input type="checkbox" data-pp="${esc(x)}"> ${esc(cap(x))}</label>`).join('')}<span class="muted">(none = every plan)</span></div>
      <label>Tiers</label><div class="row" style="flex-wrap:wrap">${tiers.map(x => `<label class="row"><input type="checkbox" data-pt="${esc(x)}"> ${esc(cap(x))}</label>`).join('')}<span class="muted">(none = every tier)</span></div>
      <label>Minimum order</label><input class="field" id="pcMin" type="number" min="0" step="1" placeholder="No minimum">
      <label>Ends</label><input class="field" id="pcE" type="datetime-local">
      <label>Use limit</label><input class="field" id="pcL" type="number" min="1" step="1" placeholder="No limit">
      <label>Description</label><input class="field" id="pcDesc" maxlength="200" placeholder="Shown to customers (optional)"></div>
      <div class="row" style="margin-top:14px"><span class="muted" id="pcPrev"></span><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pcGo">Make code</button></div>`);
    const q = id => el.querySelector('#' + id);
    const prev = () => { const v = +q('pcV').value || 0, t = q('pcT').value, d = q('pcD').value; q('pcM').hidden = q('pcMl').hidden = d !== 'repeating';
      q('pcPrev').textContent = v ? `${t === 'percentage' ? v + '% off' : '$' + v + ' off'} ${d === 'forever' ? 'every payment' : d === 'repeating' ? `for ${+q('pcM').value || 3} months` : 'the first payment'}` : ''; };
    el.addEventListener('input', prev); el.addEventListener('change', prev); prev();
    q('pcGo').onclick = async () => {
      const body = { code: q('pcC').value.trim().toUpperCase(), value: +q('pcV').value, type: q('pcT').value, duration: q('pcD').value, duration_months: +q('pcM').value || 3,
        plans: [...el.querySelectorAll('[data-pp]:checked')].map(x => x.dataset.pp), tiers: [...el.querySelectorAll('[data-pt]:checked')].map(x => x.dataset.pt),
        min_total: +q('pcMin').value || 0, ends: q('pcE').value ? new Date(q('pcE').value).toISOString() : null, limit: +q('pcL').value || null, description: q('pcDesc').value.trim() };
      if (!/^[A-Z0-9_-]{3,30}$/.test(body.code)) return toast('Codes are 3 to 30 letters, numbers, - or _.', true);
      q('pcGo').disabled = true;
      try { await mexel('promo_save', body); close(); toast(`${body.code} is live`); NX.mexelTabs.promos(); }
      catch (er) { q('pcGo').disabled = false; toast(friendly(er), true); }
    };
  }

  // =========================================================== STAFF → Shifts
  const W = { start: null };
  const monday = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  P.shifts = async () => {
    W.start = W.start || monday(Date.now());
    NX.main(`<h1>🗓 Shifts</h1><p>Who’s working when, from the aARgon3 schedule, and the timesheets from the clock.</p>
      <div class="seg mx-tabs sh-tabs"><button class="${W.tab !== 'time' ? 'on' : ''}" data-shtab="week">This week</button><button class="${W.tab === 'time' ? 'on' : ''}" data-shtab="time">Timesheets</button></div><div id="sh" class="mx-body"><div class="card"><span class="spinner"></span></div></div>`, { cards: false });
    $('main').querySelector('.sh-tabs').onclick = e => { const b = e.target.closest('[data-shtab]'); if (b) { W.tab = b.dataset.shtab; P.shifts(); } };
    try { await ensureMe(); } catch (e) { $('sh').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    if (W.tab === 'time') return NX.mexelTimesheets($('sh'));
    return week();
  };
  async function week() {
    const host = $('sh'); if (!host) return;
    const from = W.start, to = new Date(from.getTime() + 7 * 864e5);
    let list, team = []; try { [list, team] = await Promise.all([mexel('schedule', { from: from.toISOString(), to: to.toISOString() }), mgr() ? mexel('team') : Promise.resolve([])]); }
    catch (e) { host.innerHTML = `<div class="card err">${esc(friendly(e))}</div>`; return; }
    if (A.tab !== 'shifts') return;
    const stores = M.state?.stores || [], days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * 864e5));
    const isToday = d => ymd(d) === ymd(Date.now());
    const hours = list.reduce((n, c) => n + (new Date(c.ends_at) - new Date(c.starts_at)) / 36e5, 0);
    const people = new Set(list.map(c => c.user_id)).size;
    const byPerson = {}; for (const c of list) { const k = c.name || 'Staff'; byPerson[k] = (byPerson[k] || 0) + (new Date(c.ends_at) - new Date(c.starts_at)) / 36e5; }
    host.innerHTML = `<div class="row sh-nav"><button class="btn sm" data-wk="-1">‹</button><b>${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(to - 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b><button class="btn sm" data-wk="1">›</button>${ymd(from) !== ymd(monday(Date.now())) ? '<button class="btn sm ghost" data-wk="0">This week</button>' : ''}<span class="sp"></span>
        ${mgr() ? '<button class="btn" id="shCopy" title="Copies last week’s shifts into this week">Copy last week</button><button class="btn primary" id="shAdd">＋ Add a shift</button>' : ''}</div>
      <div class="stats4 mx-stats"><div class="stat"><b>${list.length}</b><span>shifts</span></div><div class="stat"><b>${Math.round(hours * 10) / 10}</b><span>hours scheduled</span></div><div class="stat"><b>${people}</b><span>people working</span></div><div class="stat"><b>${(M.overview?.on_clock || []).length}</b><span>on the clock now</span></div></div>
      <div class="sh-week">${days.map(d => { const today = list.filter(c => ymd(c.starts_at) === ymd(d));
        return `<div class="sh-day ${isToday(d) ? 'today' : ''}"><div class="sh-dh"><b>${d.toLocaleDateString(undefined, { weekday: 'short' })}</b><span>${d.getDate()}</span></div>
          ${today.map(c => `<div class="sh-shift ${c.time_off ? 'off' : ''}" style="--c:${/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : 'var(--accent)'}" ${mgr() ? `data-shift="${c.id}"` : ''}><b>${esc(c.name || 'Staff')}</b><span>${tm(c.starts_at)} – ${tm(c.ends_at)}</span><small>${esc(storeName(stores, c.store_code))}${c.time_off ? ' · time off' : ''}${c.worked != null ? ` · worked ${hm(c.worked)}` : ''}</small>${c.note ? `<small class="muted">${esc(c.note)}</small>` : ''}</div>`).join('') || '<div class="sh-empty">—</div>'}
          ${mgr() ? `<button class="sh-plus" data-addday="${ymd(d)}" title="Add a shift">＋</button>` : ''}</div>`; }).join('')}</div>
      ${Object.keys(byPerson).length ? `<div class="card"><h3>Hours this week</h3><div class="mx-bars">${Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([n, h]) => `<div class="mx-bar"><div class="row"><b>${esc(n)}</b><span class="sp"></span><span>${Math.round(h * 10) / 10} h</span></div><div class="at-bar"><i style="width:${Math.round(h / Math.max(...Object.values(byPerson)) * 100)}%"></i></div></div>`).join('')}</div></div>` : ''}`;
    host.onclick = async e => {
      const b = e.target.closest('button, [data-shift]'); if (!b) return;
      if (b.dataset.wk != null) { W.start = b.dataset.wk === '0' ? monday(Date.now()) : new Date(W.start.getTime() + +b.dataset.wk * 7 * 864e5); return week(); }
      if (b.id === 'shAdd') return shiftModal(null, null, team, stores);
      if (b.dataset.addday) return shiftModal(null, b.dataset.addday, team, stores);
      if (b.dataset.shift) return shiftModal(list.find(c => c.id === +b.dataset.shift), null, team, stores);
      if (NX.shiftsClick && await NX.shiftsClick(e, b, { list, team, week })) return;   // 2.8: swaps
      if (b.id === 'shCopy') { if (!confirm('Copy last week’s shifts into this week?')) return; try { const r = await mexel('schedule_copy', { week_start: W.start.toISOString() }); toast(`Copied ${r.copied} shift${r.copied === 1 ? '' : 's'}`); week(); } catch (er) { toast(friendly(er), true); } }
    };
    NX.afterShiftsWeek?.(host, list, team, { from, to, week, mgr: mgr() });   // 2.8: reminders, swaps, publish to the reminder feed
  }
  function shiftModal(c, day, team, stores) {
    const d = day || (c ? ymd(c.starts_at) : ymd(Date.now()));
    const hhmm = v => new Date(v).toTimeString().slice(0, 5);
    const { el, close } = NX.modal(`<h3>${c ? 'Change a shift' : 'Add a shift'}</h3><div class="acct-grid mx-form">
      <label>Who</label><select class="field" id="sfU">${team.filter(t => t.active && t.user_id).map(t => `<option value="${esc(t.user_id)}" ${c?.user_id === t.user_id ? 'selected' : ''}>${esc(t.name)}${t.title ? ' · ' + esc(t.title) : ''}</option>`).join('') || '<option value="">Nobody on the team yet</option>'}</select>
      <label>Day</label><input class="field" type="date" id="sfD" value="${d}">
      <label>Time</label><div class="row"><input class="field" type="time" id="sfS" value="${c ? hhmm(c.starts_at) : '09:00'}" style="width:auto"><span class="muted">to</span><input class="field" type="time" id="sfE" value="${c ? hhmm(c.ends_at) : '17:00'}" style="width:auto"></div>
      <label>Store</label><select class="field" id="sfStore"><option value="">No store</option>${stores.map(x => `<option value="${esc(x.code)}" ${c?.store_code === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <label>Note</label><input class="field" id="sfN" maxlength="200" value="${esc(c?.note || '')}" placeholder="Optional"></div>
      <div class="row" style="margin-top:14px">${c ? '<button class="btn danger" id="sfDel">Delete</button>' : ''}<span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="sfGo">Save</button></div>`);
    const q = id => el.querySelector('#' + id);
    q('sfGo').onclick = async () => {
      const s = new Date(`${q('sfD').value}T${q('sfS').value}`), e = new Date(`${q('sfD').value}T${q('sfE').value}`);
      if (e <= s) e.setDate(e.getDate() + 1);   // overnight shifts
      try { await mexel('schedule_save', { id: c?.id || null, user_id: q('sfU').value, store_code: q('sfStore').value || null, starts_at: s.toISOString(), ends_at: e.toISOString(), note: q('sfN').value.trim() }); close(); toast('Saved'); week(); }
      catch (er) { toast(friendly(er), true); }
    };
    if (c) q('sfDel').onclick = async () => { if (!confirm('Delete this shift?')) return; try { await mexel('schedule_delete', { id: c.id }); close(); toast('Deleted'); week(); } catch (er) { toast(friendly(er), true); } };
  }

  // =========================================================== STAFF → Employees
  P.employees = async () => {
    NX.main('<h1>👥 Employees</h1><p>Everyone on the aARgon3 staff list: who they are, their hours and sales, and time off.</p><div id="em" class="mx-body"><div class="card"><span class="spinner"></span></div></div>', { cards: false });
    try { await ensureMe(); } catch (e) { $('em').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
    if (!mgr()) { $('em').innerHTML = `<div class="card"><p class="muted">Only managers (high-admins) can see the whole team. Your own details, hours and time off are in Mexel → You.</p><div class="row"><button class="btn" data-go="mexel/you">Open Mexel → You</button></div></div>`; $('em').onclick = () => NX.go('mexel', { arg: 'you' }); return; }
    let team, off; try { [team, off] = await Promise.all([mexel('team'), mexel('timeoff', { everyone: true })]); } catch (e) { $('em').innerHTML = `<div class="card err">${esc(friendly(e))}</div>`; return; }
    if (A.tab !== 'employees') return;
    const stores = M.state?.stores || [], pending = off.filter(t => t.status === 'pending');
    const active = team.filter(t => t.active), onClock = team.filter(t => t.on_clock);
    const ROLE = { owner: 'Owner', manager: 'Manager', employee: 'Employee' };
    $('em').innerHTML = `<div class="stats4 mx-stats"><div class="stat"><b>${active.length}</b><span>on the team</span></div><div class="stat"><b>${onClock.length}</b><span>on the clock now</span></div>
        <div class="stat"><b>${hm(team.reduce((n, t) => n + (+t.week_minutes || 0), 0))}</b><span>worked this week</span></div><div class="stat"><b>${money(team.reduce((n, t) => n + (+t.month_sales || 0), 0))}</b><span>sold this month</span></div></div>
      ${pending.length ? `<div class="card em-pending"><h3>Time off to answer <span class="muted">${pending.length}</span></h3>${pending.map(t => `<div class="row mx-oc"><b>${esc(t.name || 'Someone')}</b><span>${t.starts_on === t.ends_on ? esc(t.starts_on) : `${esc(t.starts_on)} → ${esc(t.ends_on)}`}</span><span class="muted">${esc(t.reason || '')}</span><span class="sp"></span><button class="btn sm" data-todec="${t.id}" data-st="declined">Decline</button><button class="btn sm primary" data-todec="${t.id}" data-st="approved">Approve</button></div>`).join('')}</div>` : ''}
      <div class="card"><div class="row"><h3 style="margin:0">The team</h3><span class="sp"></span><button class="btn primary" id="emAdd">＋ Add someone</button></div>
        <div class="em-grid">${team.map(t => { const c = /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#9a80ff';
          return `<div class="em-card ${t.active ? '' : 'off'}" data-emp="${t.id}"><div class="row"><span class="mx-you-av sm" style="--c:${c}">${esc((t.name || '?')[0].toUpperCase())}</span><div style="min-width:0"><b>${esc(t.name || t.email)}</b><div class="muted em-sub">${esc(ROLE[t.role] || t.role)}${t.title ? ' · ' + esc(t.title) : ''}</div></div><span class="sp"></span>${t.on_clock ? `<span class="pill p-approved">${t.on_clock.on_break ? 'BREAK' : 'ON'}</span>` : ''}${t.active ? '' : '<span class="pill">OFF</span>'}</div>
            <div class="kv em-kv"><span>Email</span><span>${esc(t.email || '—')}</span>${t.phone ? `<span>Phone</span><span>${esc(t.phone)}</span>` : ''}<span>This week</span><span>${hm(t.week_minutes)}</span><span>Sales</span><span>${money(t.month_sales)} this month</span>
              <span>Next shift</span><span>${t.next_shift ? `${dayName(t.next_shift.starts_at)} ${tm(t.next_shift.starts_at)}` : '—'}</span>${owner() && t.pay_rate != null && t.pay_rate !== '' ? `<span>Pay</span><span>${money(t.pay_rate)}/h</span>` : ''}${t.signed_in ? '' : '<span>Account</span><span class="muted">Hasn’t signed in yet</span>'}</div></div>`; }).join('') || '<p class="muted">Nobody yet.</p>'}</div></div>
      ${off.filter(t => t.status !== 'pending').length ? `<div class="card"><h3>Recent time off</h3>${off.filter(t => t.status !== 'pending').slice(0, 12).map(t => `<div class="row mx-oc"><b>${esc(t.name || '')}</b><span>${t.starts_on === t.ends_on ? esc(t.starts_on) : `${esc(t.starts_on)} → ${esc(t.ends_on)}`}</span><span class="pill ${t.status === 'approved' ? 'p-approved' : 'p-declined'}">${esc(String(t.status).toUpperCase())}</span><span class="muted">${esc(t.reason || '')}</span></div>`).join('')}</div>` : ''}`;
    $('em').onclick = async e => {
      const b = e.target.closest('button, [data-emp]'); if (!b) return;
      try {
        if (b.dataset.todec) { await mexel('timeoff_decide', { id: +b.dataset.todec, status: b.dataset.st }); toast(b.dataset.st === 'approved' ? 'Approved' : 'Declined'); return P.employees(); }
        if (b.id === 'emAdd') return empModal(null, stores);
        if (b.dataset.emp) return empModal(team.find(t => t.id === +b.dataset.emp), stores);
      } catch (er) { toast(friendly(er), true); }
    };
    NX.afterEmployees?.($('em'), team, off);   // 2.8: deeper profiles
  };
  function empModal(t, stores) {
    const isOwner = t?.role === 'owner', canRole = owner() && !isOwner && t?.user_id !== M.me?.id;
    const canEdit = !t || owner() || t.role === 'employee';
    const { el, close } = NX.modal(`<h3>${t ? esc(t.name || t.email) : 'Add someone'}</h3>${canEdit ? '' : '<p class="muted">Only the owner can change a manager.</p>'}<div class="acct-grid mx-form">
      <label>Email</label><input class="field" id="epE" type="email" maxlength="200" value="${esc(t?.email || '')}" placeholder="Their Nexus account email" ${t ? 'disabled' : ''}>
      <label>Name</label><input class="field" id="epN" maxlength="80" value="${esc(t?.display_name || '')}" placeholder="${esc(t?.nexus_name || 'Optional')}" ${canEdit ? '' : 'disabled'}>
      <label>Title</label><input class="field" id="epT" maxlength="80" value="${esc(t?.title || '')}" placeholder="e.g. Sales" ${canEdit ? '' : 'disabled'}>
      <label>Phone</label><input class="field" id="epP" maxlength="40" value="${esc(t?.phone || '')}" ${canEdit ? '' : 'disabled'}>
      <label>Usual store</label><select class="field" id="epS" ${canEdit ? '' : 'disabled'}><option value="">None</option>${stores.map(x => `<option value="${esc(x.code)}" ${t?.default_store === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      ${canRole || !t ? `<label>Role</label><select class="field" id="epR" ${owner() ? '' : 'disabled'}><option value="employee">Employee</option><option value="manager" ${t?.role === 'manager' ? 'selected' : ''}>Manager</option></select>` : ''}
      ${owner() ? `<label>Pay rate</label><div class="row"><input class="field" id="epPay" type="number" min="0" step="0.01" value="${esc(t?.pay_rate ?? '')}" style="width:130px"><span class="muted">per hour, only you see it</span></div>` : ''}
      <label>Color</label><input type="color" id="epC" value="${/^#[0-9a-f]{6}$/i.test(t?.color || '') ? t.color : '#9a80ff'}" ${canEdit ? '' : 'disabled'}>
      <label>Notes</label><input class="field" id="epNo" maxlength="300" value="${esc(t?.notes || '')}" placeholder="Managers only" ${canEdit ? '' : 'disabled'}>
      ${t && !isOwner && t.user_id !== M.me?.id ? `<label>Access</label><label class="row"><input type="checkbox" id="epA" ${t.active ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> Can use aARgon3 and Mexel</label>` : ''}</div>
      <p class="muted">${t ? '' : 'They sign in to aARgon3 with the Nexus account that has this email. Nexus admins are added automatically.'}</p>
      <div class="row"><span class="sp"></span><button class="btn" data-close>Cancel</button>${canEdit ? '<button class="btn primary" id="epGo">Save</button>' : ''}</div>`);
    NX.afterEmpModal?.(el, t, { canEdit, close });   // 2.8: more about them
    const q = id => el.querySelector('#' + id);
    if (canEdit) q('epGo').onclick = async () => {
      const body = { ...(t ? { id: t.id } : { email: q('epE').value.trim() }), display_name: q('epN').value.trim(), title: q('epT').value.trim(), phone: q('epP').value.trim(), default_store: q('epS').value, color: q('epC').value, notes: q('epNo').value.trim() };
      if (q('epR') && owner() && (!t || canRole)) body.role = q('epR').value;
      if (q('epPay') && String(q('epPay').value) !== String(t?.pay_rate ?? '')) body.pay_rate = q('epPay').value;
      if (q('epA')) body.active = q('epA').checked;
      if (!t && !/^\S+@\S+\.\S+$/.test(body.email)) return toast('Enter their email.', true);
      try { await mexel('team_save', body); close(); toast('Saved'); P.employees(); } catch (er) { toast(friendly(er), true); }
    };
  }

  // =========================================================== API usage
  const prevApi = P.freeapi;
  if (prevApi) P.freeapi = async () => {
    await prevApi();
    if (A.tab !== 'freeapi') return;
    const main = $('main'), h1 = main.querySelector('h1'); if (h1) h1.innerHTML = h1.innerHTML.replace('Free API usage', 'API usage');
    const intro = main.querySelector('h1 + p');
    if (intro) intro.textContent = 'Every outside service the apps use: the Paragon & Axiom key, Nexus speech (Groq), Test Run and the free Nexus key (OpenRouter), and the server functions behind them. Daily numbers reset at midnight UTC.';
    const host = document.createElement('div'); host.id = 'apiMore'; (intro || h1)?.after(host);
    host.innerHTML = '<div class="card"><span class="spinner"></span></div>';
    const [{ data: pu, error: pe }, { data: pm }] = await Promise.all([sb.rpc('admin_premium_usage'), sb.from('admin_settings').select('value,updated_at').eq('key', 'premium_models').maybeSingle()]);
    if (A.tab !== 'freeapi') return;
    const canEdit = A.owner || (A.level === 'high-admin' && !A.viewer);
    const models = pm?.value || {}, today = pu?.today || {}, dd = pu?.days || [], dmax = Math.max(1, ...dd.map(d => +d.tasks || 0));
    host.innerHTML = `<div class="card api-premium"><div class="row"><h3 style="margin:0">Paragon & Axiom key</h3><span class="sp"></span><span class="pill ${pe ? '' : 'p-approved'}">${pe ? 'NOT SET UP' : 'ON'}</span></div>
        <p class="muted">Pro plans get 10 Paragon tasks a day and Max plans get 25; Axiom runs on it for the people allowed on the Axiom page. The key itself is a Supabase secret (PREMIUM_API_KEY) used only by the premium-chat function.</p>
        ${pe ? `<p class="muted">${esc(/admin_premium_usage|PGRST20|42883/.test(pe.message) ? 'Run supabase/nexus-v3.11.sql (Nexus repo) to turn this on.' : pe.message)}</p>` : `<div class="stats4 mx-stats"><div class="stat"><b>${today.tasks || 0}</b><span>tasks today</span></div><div class="stat"><b>${today.calls || 0}</b><span>model calls today</span></div><div class="stat"><b>${today.people || 0}</b><span>people today</span></div><div class="stat"><b>${(pu.by_agent || {}).axiom || 0}</b><span>Axiom tasks today</span></div></div>
          ${dd.length ? `<div class="tr-days">${dd.map(d => `<i style="height:${Math.round((+d.tasks || 0) / dmax * 100)}%" title="${esc(d.day)}: ${d.tasks} tasks, ${d.calls} calls"></i>`).join('')}</div><p class="muted" style="margin-top:4px">Tasks per day, last 2 weeks</p>` : ''}
          ${(pu.top || []).length ? `<table class="cards"><tr><th>Most today</th><th>Tasks</th><th>Calls</th></tr>${pu.top.map(t => `<tr><td>${esc(t.email)}</td><td>${t.tasks}</td><td>${t.calls}</td></tr>`).join('')}</table>` : ''}`}
        <h3 class="api-sub">Models it runs</h3>
        <div class="acct-grid mx-form"><label>Paragon</label><input class="field" id="pmP" list="orModels" value="${esc(models.paragon || '')}" placeholder="anthropic/claude-sonnet-4.5 (the default)" ${canEdit ? '' : 'disabled'}>
          <label>Axiom</label><input class="field" id="pmA" list="orModels" value="${esc(models.axiom || '')}" placeholder="anthropic/claude-opus-4.1 (the default)" ${canEdit ? '' : 'disabled'}></div><datalist id="orModels"></datalist>
        <div class="row" style="margin-top:10px"><span class="muted" id="pmNote">${pm?.updated_at ? 'Changed ' + ago(pm.updated_at) + '. ' : ''}Any OpenRouter model id. Apps pick up a change within a minute; leave it empty for the default.</span><span class="sp"></span>${canEdit ? '<button class="btn" id="pmTest">Check</button><button class="btn primary" id="pmSave">Save</button>' : '<span class="muted">Only the Owner and high-admin editors can change these.</span>'}</div>
        <div id="pmInfo"></div></div>
      <div class="card"><div class="row"><h3 style="margin:0">Server functions</h3><span class="sp"></span><button class="btn sm" id="fnCheck">Check them all</button></div>
        <p class="muted">Every Supabase Edge Function the apps call, what it does and which secret it needs.</p>
        <table class="cards api-fns"><tr><th>Function</th><th>What it does</th><th>Needs</th><th>Status</th></tr>${FNS.map(f => `<tr><td><b class="mono">${esc(f.name)}</b><div class="muted">${esc(f.project)}</div></td><td>${esc(f.what)}</td><td class="muted">${esc(f.secret || '—')}</td><td data-fn="${esc(f.name)}"><span class="muted">—</span></td></tr>`).join('')}</table></div>`;
    NX.labelTables?.();
    fetch('https://openrouter.ai/api/v1/models').then(r => r.json()).then(j => { const dl = $('orModels'); if (!dl) return; NX.orModels = j.data || []; dl.innerHTML = NX.orModels.filter(m => !/:free$/.test(m.id)).slice(0, 400).map(m => `<option value="${esc(m.id)}">${esc(m.name || '')}</option>`).join(''); }).catch(() => {});
    host.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'pmSave' || b.id === 'pmTest') {
        const v = { paragon: $('pmP').value.trim(), axiom: $('pmA').value.trim() };
        const bad = Object.values(v).find(x => x && !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(x));
        if (bad) return toast(`“${bad}” doesn’t look like a model id (like anthropic/claude-sonnet-4.5).`, true);
        const known = NX.orModels?.length ? Object.fromEntries(NX.orModels.map(m => [m.id, m])) : null;
        $('pmInfo').innerHTML = Object.entries(v).filter(([, id]) => id).map(([k, id]) => { const m = known?.[id]; return `<div class="row mx-oc"><b>${cap(k)}</b><span class="mono">${esc(id)}</span>${known ? (m ? `<span class="muted">${esc(m.name)} · ${m.context_length ? Math.round(m.context_length / 1000) + 'k context · ' : ''}$${(+m.pricing?.prompt * 1e6 || 0).toFixed(2)} in / $${(+m.pricing?.completion * 1e6 || 0).toFixed(2)} out per million tokens</span>` : '<span class="err">Not on OpenRouter</span>') : ''}</div>`; }).join('');
        if (b.id === 'pmTest') return;
        if (known && Object.values(v).some(id => id && !known[id]) && !confirm('One of these isn’t on OpenRouter’s list. Save anyway?')) return;
        const { error } = await sb.from('admin_settings').upsert({ key: 'premium_models', value: v, updated_by: A.user?.id, updated_at: new Date().toISOString() });
        if (error) return toast(error.message, true);
        sb.from('moderation_log').insert({ action: 'premium_models', performed_by: A.user?.id, details: v }).then(() => {}, () => {});
        toast('Saved. Apps use it within a minute.'); $('pmNote').textContent = 'Changed just now.';
      }
      if (b.id === 'fnCheck') {
        const { data } = await sb.auth.getSession(); const token = data.session?.access_token;
        for (const f of FNS) {
          const cell = host.querySelector(`[data-fn="${f.name}"]`); if (!cell) continue;
          if (f.serverOnly) { cell.innerHTML = '<span class="muted">Called by a server, not from here</span>'; continue; }
          cell.innerHTML = '<span class="spinner"></span>';
          const t0 = performance.now();
          try {
            // a harmless check: OPTIONS (the browser's own pre-check) for most; premium-chat has a read-only status
            const res = await fetch(`${f.base}/functions/v1/${f.name}${f.path || ''}`, f.method === 'GET' ? { headers: { apikey: f.key, ...(token ? { Authorization: 'Bearer ' + token } : {}) } } : { method: 'OPTIONS' });
            const ms = Math.round(performance.now() - t0), ok = res.status !== 404 && res.status < 500;
            cell.innerHTML = `<span class="pill ${ok ? 'p-approved' : 'p-declined'}">${res.status === 404 ? 'NOT DEPLOYED' : ok ? 'UP' : 'ERROR ' + res.status}</span> <span class="muted">${ms} ms</span>`;
          } catch { cell.innerHTML = '<span class="pill p-declined">CAN’T REACH</span> <span class="muted">not deployed, or it blocks browsers</span>'; }
        }
      }
    };
  };
  const NEXUS = NX.SB_URL || 'https://yzbnxpkuhlxsuwzbjifx.supabase.co', NKEY = 'sb_publishable_LY-EZORCvEQqW6AeQC5a8w_Z7wmeyjn';
  const STORE = 'https://yuergfrpfhtcxjkcgjrx.supabase.co', SKEY = 'sb_publishable_tX9wZpRsI3fAlthnz4lQKA_yVdY7768';
  const FNS = [
    { name: 'premium-chat', project: 'Nexus', what: 'Paragon & Axiom on Apoji’s key for Pro and Max plans', secret: 'PREMIUM_API_KEY', base: NEXUS, key: NKEY, method: 'GET', path: '/status' },
    { name: 'try-chat', project: 'Nexus', what: 'Test Run answers, web search and page reading on the free key', secret: '— (reads the free key)', base: NEXUS, key: NKEY },
    { name: 'nexus-stt', project: 'Nexus', what: 'Nexus speech (Groq Whisper) for dictation', secret: 'GROQ_API_KEY', base: NEXUS, key: NKEY },
    { name: 'admin-users', project: 'Nexus', what: 'Editing and making accounts from Apoji Admin', secret: '— (service role)', base: NEXUS, key: NKEY },
    { serverOnly: true, name: 'changelog-send', project: 'Nexus', what: 'The changelog email after a release', secret: 'CHANGELOG_SECRET', base: NEXUS, key: NKEY },
    { serverOnly: true, name: 'axiom-cage', project: 'Nexus', what: 'Axiom’s escape attempts (every 3 hours)', secret: 'CAGE_SECRET', base: NEXUS, key: NKEY },
    { name: 'staff', project: 'aARgon3', what: 'Mexel, Shifts and Employees in Apoji Admin, and the staff terminal', secret: 'STRIPE_SECRET_KEY', base: STORE, key: SKEY },
    { name: 'checkout', project: 'aARgon3', what: 'The online store’s Stripe checkout', secret: 'STRIPE_SECRET_KEY', base: STORE, key: SKEY },
    { serverOnly: true, name: 'stripe-webhook', project: 'aARgon3', what: 'Payments and renewals from Stripe', secret: 'STRIPE_WEBHOOK_SECRET', base: STORE, key: SKEY }
  ];
  NX.serverFns = FNS;   // 3.3: Health checks these too
})();

// =========================================================== 2.7.1: Mexel is for the Owner and the staff they pick
// The aARgon3 staff function decides (only the owner and people on its staff list get in; see aargon3-mexel-lockdown.sql).
// Apoji Admin asks it once and hides MONEY and STAFF from everyone else.
(function () {
  const A = NX.A, P = NX.pages, $ = NX.$, esc = NX.esc;
  const TABS = ['mexel', 'shifts', 'employees'];
  let access = null, asking = null;
  NX.mexelAccess = async (fresh = false) => {
    if (A.realOwner || A.owner) return (access = true);
    if (access !== null && !fresh) return access;
    asking = asking || NX.mexel('me').then(r => { NX.mexelState.me = r.user; NX.mexelState.state = r.state; NX.mexelState.overview = r.overview; NX.mexelState.at = Date.now(); return true; }, () => false).finally(() => { asking = null; });
    access = await asking; paintNav(); return access;
  };
  function paintNav() {
    const nav = document.getElementById('nav'); if (!nav) return;
    const show = access === true || A.owner || A.realOwner;
    for (const t of TABS) { const b = nav.querySelector(`[data-tab="${t}"]`); if (b) b.hidden = !show; }
    for (const h of nav.querySelectorAll('h6')) if (/^(MONEY|STAFF)$/.test(h.textContent.trim())) h.hidden = !show;
  }
  const kick = () => { if (access !== null) return; if (A.user) NX.mexelAccess(); else setTimeout(kick, 1500); };
  new MutationObserver(() => { if (document.getElementById('nav') && !document.getElementById('nav').dataset.mx) { document.getElementById('nav').dataset.mx = 1; paintNav(); kick(); } }).observe(document.body, { childList: true, subtree: true });
  const locked = () => NX.main(`<h1>🧾 Mexel</h1><div class="card"><h3>Not on the staff list</h3><p class="muted">Mexel, Shifts and Employees are for the Owner and the staff the Owner adds. Ask them to add you in STAFF → Employees.</p></div>`, { cards: false });
  for (const t of TABS) { const page = P[t]; if (page) P[t] = async (...a) => { if (!(await NX.mexelAccess())) return locked(); return page(...a); }; }

  // =========================================================== 2.7.1: Windows updates, visible (My settings)
  const meBefore = P.me;
  if (meBefore && window.apojiDesktop?.updateState) P.me = async (...a) => {
    await meBefore(...a);
    if (A.tab !== 'me') return;
    const st = await window.apojiDesktop.updateState().catch(() => null); if (!st || A.tab !== 'me') return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'updCard';
    card.innerHTML = `<h3>Updates</h3><div class="kv"><span>This version</span><span>${esc(st.current)}</span><span>Status</span><span>${st.ready ? `${esc(st.ready)} is downloaded and ready` : st.error ? `<span class="err">${esc(st.error)}</span>` : 'Up to date, or checking in the background'}</span><span>How</span><span>${st.auto ? 'Automatic (downloads by itself, installs when you restart or quit)' : 'Download from GitHub'}</span></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="updCheck">Check now</button>${st.ready ? '<button class="btn primary" id="updGo">Restart and update</button>' : ''}<span class="sp"></span>${st.log ? '<button class="btn ghost sm" id="updLog">Show the log</button>' : ''}</div><pre class="info" id="updPre" hidden>${esc(st.log || '')}</pre>`;
    ($('main').querySelector('.card:last-of-type') || $('main')).after(card);
    card.onclick = e => { const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'updCheck') { window.apojiDesktop.checkUpdate(); NX.toast('Checking…'); }
      if (b.id === 'updGo') window.apojiDesktop.installUpdate();
      if (b.id === 'updLog') card.querySelector('#updPre').hidden = !card.querySelector('#updPre').hidden; };
  };
})();

// =========================================================== 2.7.2: Known issues & bugs (Status page)
// Shown on the public status page and in Nexus when someone types a bug report that matches. Mark one Fixed (with the
// release) and everyone who said "I have this too" gets a notice. Needs supabase/nexus-v3.12.sql (Nexus repo).
(function () {
  const { sb, $, esc, ago, toast } = NX;
  const A = NX.A, P = NX.pages;
  const ST = [['investigating', 'Investigating'], ['identified', 'Found the cause'], ['fixing', 'Fix coming'], ['fixed', 'Fixed'], ['wont_fix', 'Won’t fix']];
  const APPS = [['mac', 'Mac app'], ['windows', 'Windows app'], ['n28c', 'N28C'], ['test_run', 'Test Run'], ['admin', 'Apoji Admin'], ['aargon3', 'aARgon3']];
  const SEVS = [['minor', 'Minor'], ['major', 'Major'], ['critical', 'Critical']];
  const pill = s => `<span class="pill ${s === 'fixed' ? 'p-approved' : s === 'wont_fix' ? '' : s === 'investigating' ? 'p-pending' : 'p-declined'}">${esc((ST.find(x => x[0] === s) || [, s])[1]).toUpperCase()}</span>`;
  async function card(host) {
    const [{ data, error }, { data: incs }] = await Promise.all([sb.rpc('admin_known_issues'), sb.from('status_incidents').select('id,title,started_at,resolved_at').order('started_at', { ascending: false }).limit(30)]);
    if (error) { host.innerHTML = `<div class="card"><h3>Known issues &amp; bugs</h3><p class="muted">${esc(NX.needSql?.(error.message) ? 'Run supabase/nexus-v3.12.sql (Nexus repo) in Supabase → SQL Editor to turn this on.' : error.message)}</p></div>`; return; }
    const list = data || [], open = list.filter(i => !['fixed', 'wont_fix'].includes(i.status)), closed = list.filter(i => ['fixed', 'wont_fix'].includes(i.status));
    const row = i => `<div class="ki-row ${['fixed', 'wont_fix'].includes(i.status) ? 'done' : ''}" data-ki="${i.id}"><div class="row"><b>${esc(i.title)}</b>${pill(i.status)}${i.severity !== 'minor' ? `<span class="pill p-declined">${esc(i.severity.toUpperCase())}</span>` : ''}${i.public ? '' : '<span class="pill">HIDDEN</span>'}<span class="sp"></span><span class="muted">${(i.apps || []).map(a => (APPS.find(x => x[0] === a) || [, a])[1]).join(', ') || 'All apps'}${i.fixed_in ? ' · fixed in ' + esc(i.fixed_in) : ''} · ${i.followers} following · ${ago(i.updated_at)}</span></div>${i.workaround ? `<div class="muted">Workaround: ${esc(i.workaround)}</div>` : ''}</div>`;
    host.innerHTML = `<div class="card"><div class="row"><h3 style="margin:0">Known issues &amp; bugs <span class="muted">${open.length} open</span></h3><span class="sp"></span><button class="btn primary" id="kiNew">＋ Add a known issue</button></div>
      <p class="muted">On the public status page and in Nexus's feedback form (“We know about this”). Marking one Fixed tells everyone who follows it.</p>
      <div class="ki-list">${open.map(row).join('') || '<p class="muted">No open issues.</p>'}</div>
      ${closed.length ? `<details style="margin-top:10px"><summary class="muted">Fixed and closed (${closed.length})</summary><div class="ki-list">${closed.map(row).join('')}</div></details>` : ''}</div>`;
    host.onclick = e => { if (e.target.closest('#kiNew')) return modal(null, incs || [], host); const r = e.target.closest('[data-ki]'); if (r) modal(list.find(x => x.id === +r.dataset.ki), incs || [], host); };
  }
  function modal(k, incs, host, preset = {}) {
    const v = { ...preset, ...(k || {}) };
    const { el, close } = NX.modal(`<h3>${k ? 'Known issue' : 'Add a known issue'}</h3><div class="acct-grid mx-form">
      <label>Title</label><input class="field" id="kT" maxlength="140" value="${esc(v.title || '')}" placeholder="e.g. The highlight orb won't start on some Windows PCs">
      <label>What happens</label><textarea class="field" id="kD" rows="3" maxlength="2000" placeholder="What people see">${esc(v.details || '')}</textarea>
      <label>Workaround</label><textarea class="field" id="kW" rows="2" maxlength="1000" placeholder="Optional: what to do until it's fixed">${esc(v.workaround || '')}</textarea>
      <label>Apps</label><div class="row" style="flex-wrap:wrap">${APPS.map(([a, l]) => `<label class="row"><input type="checkbox" data-kapp="${a}" ${(v.apps || []).includes(a) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <label>Versions</label><input class="field" id="kV" maxlength="60" value="${esc(v.versions || '')}" placeholder="e.g. 3.11.0 – 3.11.1">
      <label>Status</label><select class="field" id="kS">${ST.map(([s, l]) => `<option value="${s}" ${(v.status || 'investigating') === s ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Fixed in</label><input class="field" id="kF" maxlength="40" value="${esc(v.fixed_in || '')}" placeholder="e.g. 3.12.0">
      <label>How bad</label><select class="field" id="kSev">${SEVS.map(([s, l]) => `<option value="${s}" ${(v.severity || 'minor') === s ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Match words</label><input class="field" id="kWords" maxlength="300" value="${esc((v.words || []).join(', '))}" placeholder="Extra words people use, e.g. orb, clixml, highlight">
      <label>Incident</label><select class="field" id="kI"><option value="">None</option>${incs.map(i => `<option value="${i.id}" ${+v.incident_id === i.id ? 'selected' : ''}>${esc(i.title)}${i.resolved_at ? ' (resolved)' : ''}</option>`).join('')}</select>
      <label>Reports</label><input class="field" id="kR" value="${esc((v.report_ids || []).join(', '))}" placeholder="Feedback report numbers, e.g. 12, 31">
      <label>Public</label><label class="row"><input type="checkbox" id="kP" ${v.public === false ? '' : 'checked'}> Show it on the status page and in Nexus</label></div>
      <div class="row" style="margin-top:14px">${k ? '<button class="btn danger" id="kDel">Delete</button>' : ''}<span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="kGo">Save</button></div>`);
    const q = id => el.querySelector('#' + id);
    q('kGo').onclick = async () => {
      const row = { title: q('kT').value.trim(), details: q('kD').value.trim(), workaround: q('kW').value.trim(), apps: [...el.querySelectorAll('[data-kapp]:checked')].map(x => x.dataset.kapp),
        versions: q('kV').value.trim(), status: q('kS').value, fixed_in: q('kF').value.trim(), severity: q('kSev').value, words: q('kWords').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 20),
        incident_id: q('kI').value ? +q('kI').value : null, report_ids: q('kR').value.split(/[,\s#]+/).map(Number).filter(n => n > 0), public: q('kP').checked };
      if (row.title.length < 3) return toast('Give it a title.', true);
      if (row.status === 'fixed' && !row.fixed_in && !confirm('Mark it fixed without saying which release has the fix?')) return;
      const { error } = k ? await sb.from('known_issues').update(row).eq('id', k.id) : await sb.from('known_issues').insert(row);
      if (error) return toast(error.message, true);
      close(); toast(row.status === 'fixed' && k?.status !== 'fixed' ? 'Marked fixed. Followers get a notice.' : 'Saved'); if (host) card(host);
    };
    if (k) q('kDel').onclick = async () => { if (!confirm('Delete this known issue?')) return; const { error } = await sb.from('known_issues').delete().eq('id', k.id); if (error) return toast(error.message, true); close(); toast('Deleted'); if (host) card(host); };
  }
  NX.knownIssueFromReport = async report => { const { data: incs } = await sb.from('status_incidents').select('id,title,started_at,resolved_at').order('started_at', { ascending: false }).limit(30); modal(null, incs || [], null, { title: report.title, details: report.body ? String(report.body).slice(0, 600) : '', report_ids: [report.id], apps: /win/i.test(report.source || '') ? ['windows'] : /mac|desktop/i.test(report.source || '') ? ['mac'] : /phone|n28c/i.test(report.source || '') ? ['n28c'] : /web|try/i.test(report.source || '') ? ['test_run'] : [] }); };
  const before = P.status;
  if (before) P.status = async (...a) => {
    await before(...a);
    if (A.tab !== 'status') return;
    const host = document.createElement('div'); host.id = 'knownIssues'; host.style.marginTop = '14px';
    const first = $('main').querySelector('h1 + p'); (first || $('main').querySelector('h1')).after(host);
    card(host);
  };
})();
