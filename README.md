<p align="center"><img src="icons/icon-192.png" width="96" alt="Apoji Admin"></p>

# Apoji Admin

The admin app for **Nexus '28** and **N28C**.
A Mac app (download it from Releases) and a website (GitHub Pages) that works from any browser or phone.

Only accounts in `public.admin_roles` can use it. Everything goes through Supabase row-level security.

## Mac app

Download the latest **Apoji-Admin-…-arm64.dmg** (Apple silicon) or **…-x64.dmg** (Intel) from [Releases](https://github.com/apojidelegraphics/Apoji-Admin/releases/latest), drag it to Applications, then run once:
```
xattr -cr "/Applications/Apoji Admin.app"
codesign --force --deep --sign - "/Applications/Apoji Admin.app"
```
It's the same portal with the files built in, plus a Dock badge for unread items, desktop notifications and an update check (Help → Check for Updates). To publish a new version, bump `version` in `package.json`, then push a tag like `v1.0.1`; GitHub Actions builds it and makes the release.

## What's inside

- **Dashboard**: active people (Mac app vs N28C), new accounts, Shared Space posts, versions in use, top agents, who's online and a live activity feed.
- **Admin chat**: pinned messages, group chats, DMs, images and files, replies, reactions, edits, @mentions, read receipts (with an off switch) and online / idle / do-not-disturb / invisible status. **End-to-end encrypted**; see below.
- **Inbox**: beta requests, feedback and bug reports (reply to people in their app, internal notes, assign, prioritize), and content reports.
- **Users**: search, filters, bulk beta/comp, CSV export, profiles with private notes, history, suspend/ban and roles.
- **Moderation**: every Shared Space, post and shared agent.
- **App control**: feature flags, announcements and maintenance switches the apps enforce.
- **Tasks**: the team's to-do board (To do · Doing · Done) with owners, due dates and priorities, linked to feedback, users or reports. Drag cards between columns.
- **Command palette**: ⌘K / Ctrl+K jumps to any page, admin, user, feedback report or task. `G` then a letter goes to a page, `N` makes a task, `?` lists every shortcut.
- **Saved replies**: your own snippets for feedback replies and chat (⚡).
- **Notifications**: pop-ups, desktop notifications, a chime and an app badge. Phone notifications through your Mac hub (below).
- **Team notes**: playbooks and how-tos, end-to-end encrypted like the chat, saved as you type, with a markdown preview and no silent overwrites.
- **Broadcasts**: a notification in everyone's Nexus Mac app and N28C (everyone, beta testers, admins or people on older versions), now or later.
- **Schedules**: turn announcements, maintenance and feature flags on or off at a set time.
- **Health**: Supabase speed, live updates, the Mac hub, N28C requests waiting, failed schedules, free AI key credit, database and storage size.
- **Releases**: downloads from GitHub, which versions people run and a one-click "please update" broadcast, plus **✉ Email the changelog**: send each release's notes to everyone who opted in, with EmailJS (high-admins; needs `supabase/nexus-v2.7.sql` from the Nexus repo). Setup is in the Nexus repo under `docs/EMAILJS.md`.
- **Status page**: post incidents and updates to the public Nexus status page, and override any component.
- **Axiom (Apex)**: high-admins only. Take Axiom offline (now, for a while or until you bring it back, with a message), switch tool kits off for everyone, read-only mode, block people or give them their own minutes, reset minutes, latest turns, prompt history with restore, who can use it, weekly minutes, providers and its prompt (stored only in Supabase).
- **Audit alerts**: a notification when another admin changes roles, bans someone or removes content.

## Mac hub (Tailscale)

Supabase stays the source of truth, so the website and the Mac app both work from anywhere. Turn on **This Mac → Use this Mac as the hub** and that Mac also:

- runs a small private API on your **tailnet only** (`tailscale serve` on port 8443, with a real HTTPS certificate). Every call needs a Tailscale account (optionally from an allow list) **and** a signed-in Apoji admin;
- sends **phone notifications** (web push from your Mac; phones only see "New message in #room" for chat unless you allow the text);
- runs **schedules** on time (every 30 seconds) and stays **awake**, on battery too down to 20% (or only while plugged in, if you like). The screen can still turn off, or stay on and dim after a while away;
- opens at login and lives in the menu bar when you close the window (⌘Q quits).

The website finds the hub by itself. On a phone with Tailscale on, open the website → **Mac hub** → **Turn on notifications** (on iPhone, add the site to your Home Screen first). From there you can also run schedules right away and see what's new on the Mac. Without a hub, schedules run whenever any Apoji Admin is open.

Setup: install [Tailscale](https://tailscale.com/download) on the Mac and your phone (same account), and in the Tailscale admin console → DNS turn on **MagicDNS** and **HTTPS Certificates**.

## Encrypted admin chat

Messages and files are encrypted in your browser before they're sent (AES-256-GCM with a key derived from the team passphrase, PBKDF2-SHA-256 with 600,000 rounds). Supabase only stores scrambled text. Nobody can read the chat in the table editor, in backups or through the API without the passphrase, and the database refuses unencrypted messages.

- A high-admin sets the team passphrase the first time anyone opens Admin chat. Share it with admins in person.
- Each device asks for it once and keeps the key in that browser. *My settings → Lock* forgets it.
- *My settings → Encrypt messages from before* encrypts messages and files sent before encryption was turned on.
- If the passphrase is lost, encrypted messages can't be recovered by anyone.

## Setup

1. **SQL**: in Supabase → SQL Editor, run `supabase/apoji-admin.sql` (after Nexus' `nexus-v2.2.sql`), then `supabase/apoji-admin-1.1.sql`, then `supabase/apoji-admin-1.2.sql`.
2. **Encryption**: open **Admin chat** as a high-admin and set the team passphrase.
3. **Website**: Settings → Pages → Deploy from a branch → `main` / `(root)`.
4. **Hub** (optional): see above.
5. **1.7**: run `supabase/apoji-admin-1.7.sql`, then deploy the two Supabase functions below.

## High-admin tiers (1.7)

- **👑 Owner** (Apoji_Delegraphics): everything. Only the Owner can change the Owner account or anyone's tier, and the Owner tag can only be given in the Supabase SQL editor.
- **Editor**: what high-admins could always do, plus changing people's accounts.
- **Viewer**: sees every high-admin page but can't change roles, accounts, Axiom or email settings.

The database enforces this (a guard on `admin_roles`, `user_moderation` and every new function), not just the buttons.

## Supabase functions (1.7)

Both live in `supabase/functions/`. Deploy with the Supabase CLI, or in the dashboard: **Edge Functions → Deploy a new function → Via editor**, name it exactly as below, paste the file and deploy.

- **`admin-users`** (`supabase/functions/admin-users/index.ts`): change someone's email, nickname, username or picture, send a password reset email, set a new password without knowing the old one, or delete the account. Editors and the Owner only; every change goes in the audit log. Keep **Verify JWT** on.
- **`changelog-send`** (`supabase/functions/changelog-send/index.ts`): the automatic changelog email. Turn **Verify JWT off** for this one (GitHub calls it with a secret instead).
  1. Supabase → Edge Functions → **Secrets**: add `CHANGELOG_SECRET` = any long random string.
  2. GitHub → Nexus-28 → Settings → Secrets and variables → Actions → **New repository secret**: `CHANGELOG_SECRET` with the same value.
  3. EmailJS → Account → Security: turn on **Allow EmailJS API for non-browser applications** (and keep using the Private Key in Apoji Admin).
  4. Apoji Admin → Releases → Email the changelog → **⚡ Automatic**. From then on, each Nexus release emails subscribers by itself (Nexus' release workflow calls the function after publishing; it never fails the release).

## Axiom managers, select people and access requests (1.8)
Run `supabase/nexus-v3.1.sql` from the Nexus repo first (after `apoji-admin-1.7.sql`).
- **Only select people use Axiom.** Axiom → Who can use it is now Off, Only unlimited, or Select people. The Owner adds people in Axiom → Select people (or approves their request).
- **Axiom managers.** The Owner picks them in Axiom → Axiom managers. Only the Owner and managers change Axiom's settings, prompt and limits, and accept or deny access requests. High-admins can still look.
- **Access requests** (Inbox): people ask from Nexus (Settings → Account → Request access) or N28C for Axiom, an early feature, beta testing, or something else. Approving Axiom adds them to Select people; a feature is turned on for just them; beta makes them a beta tester.
- **Nexus chat:** chat with Nexus from the portal. When your Mac is on (phone link on), the Mac answers with every tool; otherwise the free Nexus key answers and you can hand a message off to the Mac.
- **Users → Redeemed orders:** see each aARgon3 / Mexel order someone redeemed (with its system config) and remove it.
- **Health:** alerts can be dismissed (until they change) and opened. "N28C requests waiting" shows who's stuck and lets Editors clear them.
- **Feedback:** reports sent by GitHub or email (and from people who aren't signed in) land in Feedback & bugs too, marked GITHUB / EMAIL.
- **This Mac → Keep awake** works without the hub, can keep the screen on, and shows whether macOS confirms it.

## Agent prompts, Nexus in Team chat, Axiom's cage (1.9)
Run `supabase/nexus-v3.2.sql` from the Nexus repo first (after `nexus-v3.1.sql`).
- **Agent prompts** (App control): the Owner and the prompt editors the Owner picks change Paragon, Neodela, Lyte, Flash and the classic models, try a draft before saving, and restore any earlier version. Axiom's prompt stays on the Axiom page.
- **Team chat** (was Admin chat): **◆ Nexus** is the first room, your own chat with Nexus, always on the agent and model you last used in Nexus '28 (no picker). In any room, `@paragon`, `@neodela`, `@lyte`, `@flash` (and `@axiom` for people allowed to use him) answer right there. Those messages and the recent chat are decrypted in your browser and sent to the model, so they're marked "→ sent to AI"; everything else stays end-to-end encrypted.
- **Axiom's cage**: Containment Sector 28 (on the Axiom page since 2.0). Update the warden drivers (20–30 minutes), set the security level, lock it down, take it down, patch breaches, and read his escape attempts. Axiom sees the cage's state every turn and remembers his attempts. He writes attempts with no tools; whether one gets through is decided by the database.
  - Deploy the function: `supabase functions deploy axiom-cage --no-verify-jwt`, add the secret `CAGE_SECRET` (any long random string).
  - Schedule it: Supabase → Integrations → Cron → new job, every 4 hours (`0 */4 * * *`), HTTP POST to `https://<project>.supabase.co/functions/v1/axiom-cage` with the header `x-cage-secret: <CAGE_SECRET>`. Without the schedule, use "Run an attempt now" on the Axiom page.
- **Offline:** an OFFLINE chip in the header; chat messages, task and note edits made offline wait in this browser and are sent when you reconnect.
- **This Mac → Lid-closed mode:** with it on and the Mac plugged in, closing the lid keeps it awake (screen off, still locked). Turning it on asks for your Mac password once (it adds one rule that allows only `pmset disablesleep`). Nexus '28 shares the same setting.
- The menu bar menu no longer stretches across the screen.

## Containment Sector 28, reports in the portal, keep awake on battery (2.0)
Run `supabase/nexus-v3.3.sql` from the Nexus repo first (after `nexus-v3.2.sql`), then redeploy the function: `supabase functions deploy axiom-cage --no-verify-jwt`.
- **One Axiom page:** the cage now lives on the Axiom page (old `#cage` links land there).
- **Escapes:** a breach of a weak cage (integrity 30% or less, or two unpatched breaches) can turn into an escape. Axiom is then taken offline for everyone (what the offline switch was set to before is kept), and the page shows **Track** (his trail through the Lentintity network, streamed live with a map) and **Attempt to capture** (hard: a few percent to start, better with a fresh trail, new drivers and lockdown; 10 minutes between tries). Catching him puts the cage back at level 5 and Axiom back online. Only a capture brings him back; the Owner can override (or the SQL Editor).
- **Attempts come back written:** the function reads the model's reasoning when the answer is empty and asks again up to twice. About one attempt in twelve is left unrecorded on purpose.
- **Team chat → ◆ Nexus** looks like every other room (rows with avatars and times, the same compose box).
- **Feedback & bugs → ＋ New report:** add a bug or feedback yourself (it shows as PORTAL).
- The header reads **APOJI ADMIN PORTAL**.
- **Keep awake** works on battery too (it lets go below 20%); turn on "Only while plugged in" if you'd rather it didn't. **Keep the screen on** now dims every screen after a while away (pick 1 to 20 minutes); touch anything and it's back. Lid-closed mode follows the same battery rule.
- **2.0.1:** lid-closed mode can't get stuck on: a small watcher switches it off when the app's process ends (even a crash or force-quit), every check turns it off if no running app wants it, and closing the lid puts the screen to sleep so the Mac locks even with "keep the screen on".

## 2.0.2
Run `supabase/nexus-v3.3.2.sql` from the Nexus repo (adds the Feature & Fix kind).
- **This Mac → Dim when I step away:** a slider from 0% (dark) through 55% to None.
- **Feedback & bugs:** reports written in the portal can be edited (✎ Edit); new kind **🛠 Feature & Fix**.
- **Team chat:** "Maya is typing…" in every room and DM (sent over Realtime, with the room and person sealed with the team key).
- **◆ Nexus** follows the agent and model picked in Nexus '28 right now (the free key only runs free models, so a paid one falls back to `openrouter/free` and says so), and the Nexus orb moves like in the app.

## Develop

Static files, no build step for the website. `npm install && npm start` runs the Mac app from source (`electron/`), `npm test` tests the hub. `crypto.js` is the encryption, `chat.js` the chat, `pages.js` most pages, `extras.js` tasks and the command palette, `features.js` the hub, notes, broadcasts, schedules, health and releases, `charts.js` small SVG charts and `admin.js` the shell (sign-in, theme, presence, realtime, notifications). `electron/hub-core.js` is the hub API, `electron/hub.js` keep-awake, login item and menu bar.
