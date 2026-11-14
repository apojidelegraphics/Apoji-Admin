<p align="center"><img src="icons/icon-192.png" width="96" alt="Apoji Admin"></p>

# Apoji Admin

The admin portal for **Nexus '28** and **N28C**, plus the **Apoji Admin GitHub App**.
Live at **https://apojidelegraphics.github.io/Apoji-Admin/**. Install it like an app from your browser: on a Mac, Chrome's install button or Safari's *File → Add to Dock*; on an iPhone, *Share → Add to Home Screen*.

Only accounts in `public.admin_roles` can use it. Everything goes through Supabase row-level security.

## What's inside

- **Dashboard**: active people (Mac app vs N28C), new accounts, Shared Space posts, versions in use, top agents, who's online and a live activity feed.
- **Admin chat**: group chats, DMs, images and files, replies, reactions, edits, @mentions, read receipts (with an off switch) and online / idle / do-not-disturb / invisible status. **End-to-end encrypted**; see below.
- **Inbox**: beta requests, feedback and bug reports (reply to people in their app, internal notes, assign, prioritize), and content reports.
- **Users**: search, filters, bulk beta/comp, CSV export, profiles with private notes, history, suspend/ban and roles.
- **Moderation**: every Shared Space, post and shared agent.
- **App control**: feature flags, announcements and maintenance switches the apps enforce.
- **GitHub**: the GitHub App's activity, open issues and reports sent to GitHub.
- **Notifications**: pop-ups, desktop notifications, a chime and an app badge.

## Encrypted admin chat

Messages and files are encrypted in your browser before they're sent (AES-256-GCM with a key derived from the team passphrase, PBKDF2-SHA-256 with 600,000 rounds). Supabase only stores scrambled text. Nobody can read the chat in the table editor, in backups or through the API without the passphrase, and the database refuses unencrypted messages.

- A high-admin sets the team passphrase the first time anyone opens Admin chat. Share it with admins in person.
- Each device asks for it once and keeps the key in that browser. *My settings → Lock* forgets it.
- *My settings → Encrypt messages from before* encrypts messages and files sent before encryption was turned on.
- If the passphrase is lost, encrypted messages can't be recovered by anyone.

## The GitHub App

- **Feedback → issue**: one click on a report creates an issue with only its text. No emails, usernames or device details go to GitHub.
- **Issue closed → report fixed**: the person sees "Fixed" in their app. Closed as *not planned* becomes "Won't fix"; reopened goes back to "Working on it".
- **Release published → draft announcement**: turn it on in Announcements.
- **Activity**: issues, comments, pull requests, pushes to the default branch, releases and failed builds, with notifications.

It runs on a Supabase Edge Function (`supabase/functions/apoji-github`). The app's private key and webhook secret are stored in `public.github_app`, which has no API access; only the function reads it.

## Setup

1. **SQL**: in Supabase → SQL Editor, run `supabase/apoji-admin.sql` (after Nexus' `nexus-v2.2.sql`).
2. **Edge function**: install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:
   ```
   supabase login
   supabase functions deploy apoji-github --project-ref yzbnxpkuhlxsuwzbjifx --no-verify-jwt
   ```
   `--no-verify-jwt` is needed because GitHub can't send a Supabase token. The function checks GitHub's signature on webhooks and your admin login on everything else.
3. **GitHub Pages**: repo *Settings → Pages → Deploy from a branch → `main` / root*.
4. **GitHub App**: open the portal → **GitHub** → *Create the GitHub App* (high-admin). GitHub asks you to confirm, then sends you back. Install it on `Nexus-28`. Optionally upload `icons/github-app-logo.png` as the app's logo in its GitHub settings.
5. **Encryption**: open **Admin chat** as a high-admin and set the team passphrase.

## Develop

Static files, no build step. `crypto.js` is the encryption, `chat.js` the chat, `pages.js` every other page, `charts.js` small SVG charts and `admin.js` the shell (sign-in, theme, presence, realtime, notifications).
Function tests: `deno test --allow-env supabase/functions/apoji-github/index.test.ts` (needs `TEST_PEM_PKCS1` / `TEST_PUB_SPKI`; see the test file).
