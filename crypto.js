// End-to-end encryption for admin chat. Messages and files are encrypted in your browser with a key made from the
// team passphrase (PBKDF2-SHA-256, 600,000 rounds → AES-256-GCM). Supabase only ever stores scrambled text: nobody
// can read the chat in the database, in backups or in the Supabase dashboard without the passphrase.
//   The key never leaves the device. It's kept (non-exportable) in this browser's IndexedDB so you type the
//   passphrase once per device. "Lock" forgets it.
//   Format: body = "enc:v1:<iv base64>:<ciphertext base64>"  ·  files = 12-byte IV + ciphertext
(function () {
  const PREFIX = 'enc:v1:', CHECK = 'apoji-admin:ok', DB = 'apoji-admin', STORE = 'keys';
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  let key = null, cfg = null;

  function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const t = db.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }); } catch { return null; } }
  async function idbSet(k, v) { try { const db = await idb(); await new Promise(res => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE)[v === undefined ? 'delete' : 'put'](v, k); t.oncomplete = res; t.onerror = res; }); } catch {} }

  async function derive(pass, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encWith(k, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); return PREFIX + b64(iv) + ':' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(text))); }
  async function decWith(k, s) { const [ivs, cts] = s.slice(PREFIX.length).split(':'); return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivs) }, k, unb64(cts))); }

  // The team's settings row (salt + a check value; never the key or passphrase)
  async function config(force) {
    if (cfg && !force) return cfg;
    const { data, error } = await NX.sb.from('admin_crypto').select('salt,verifier,iterations,created_at').eq('id', 1).maybeSingle();
    if (error) throw new Error(NX.needSql(error.message) ? 'Run supabase/apoji-admin.sql first to turn on encryption.' : error.message);
    cfg = data || null; return cfg;
  }
  async function load() {
    const c = await config().catch(() => null); if (!c) return false;
    const saved = await idbGet('team');
    if (saved?.key && saved.salt === c.salt) {
      try { if (await decWith(saved.key, c.verifier) === CHECK) { key = saved.key; return true; } } catch {}
    }
    return false;
  }
  async function unlock(pass) {
    const c = await config(true); if (!c) throw new Error('Encryption isn\'t set up yet.');
    const k = await derive(pass, c.salt, c.iterations);
    try { if (await decWith(k, c.verifier) !== CHECK) throw 0; } catch { throw new Error('That passphrase is wrong.'); }
    key = k; await idbSet('team', { key: k, salt: c.salt }); return true;
  }
  // First time only (a high-admin): pick the team passphrase
  async function setup(pass) {
    if (String(pass).length < 12) throw new Error('Use at least 12 characters (a short sentence works great).');
    const salt = b64(crypto.getRandomValues(new Uint8Array(16))), iterations = 600000;
    const k = await derive(pass, salt, iterations);
    await NX.rpc('admin_crypto_setup', { p_salt: salt, p_verifier: await encWith(k, CHECK), p_iterations: iterations });
    cfg = null; await config(true); key = k; await idbSet('team', { key: k, salt }); return true;
  }
  async function lock() { key = null; await idbSet('team', undefined); }

  const isEnc = s => typeof s === 'string' && s.startsWith(PREFIX);
  async function enc(text) { if (!key) throw new Error('Unlock the chat first.'); return encWith(key, String(text)); }
  async function dec(s) { if (!isEnc(s)) return s; if (!key) return null; try { return await decWith(key, s); } catch { return null; } }
  async function encBytes(buf) { if (!key) throw new Error('Unlock the chat first.'); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function decBytes(buf) { const a = new Uint8Array(buf); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, key, a.slice(12)); }

  window.NXCrypto = { config, load, unlock, setup, lock, enc, dec, isEnc, encBytes, decBytes, ready: () => !!key, PREFIX };
})();
