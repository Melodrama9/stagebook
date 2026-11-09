# Сцена — простір вистави

A Ukrainian rehearsal workspace for 36 characters, hosted as a static website on GitHub Pages. Supabase supplies secure email/password login and shared storage.

## Features

- Three tabs: Основна історія, Персонаж, Список реквізиту.
- Add, edit, delete, and reorder story focal points. All 36 character timelines derive from the same point IDs and stay aligned; deleting a point also deletes its character notes after confirmation.
- Character search, editable name/actor/biography, optional HTTPS portrait URL, and individual actions at every focal point. Profiles appear beside timelines on desktop and above them on mobile.
- Add/edit/delete props with readiness checkboxes. Guests can read every section; only the designated editor can change anything.
- Server-enforced single editor, atomic updates, and optimistic concurrency protection. Credentials stay in memory; reloading requires logging in again. Guests see current content on page load/refresh.
- Without Supabase configuration, a clearly marked, read-only demonstration appears. Demonstration stories are illustrative; the real database starts with 36 blank character profiles and no story points or props.

## Current setup

The site is connected to Supabase project `pnglmawhqzrhmdszpdxr`. The database migration is applied and contains 36 blank characters. Live API checks confirmed public reads work and anonymous saves, direct updates, and editor-membership reads are denied. One confirmed account is assigned as the sole editor. Database checks verified editor saves and stale-write rejection inside a rolled-back transaction. GitHub Pages is configured to deploy from Actions at https://melodrama9.github.io/stagebook/. Sign in with the editor email and the password chosen in Supabase. Full password sign-in should be checked by the account owner; no password was shared with the development agent.

The security advisor flags `save_play` as an authenticated SECURITY DEFINER function. This is intentional: the function checks the caller against the sole editor membership before any write, uses an empty search path, and enforces optimistic concurrency. See [Supabase’s advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Activate login and storage (or configure another project)

1. Create a Supabase project at https://supabase.com/dashboard.
2. Run `supabase/setup.sql` in its SQL editor.
3. In **Authentication → Providers → Email**, disable public sign-ups. In **Authentication → Users**, create your single editor with an email and password (confirm the account). Keep the password private.
4. Copy the editor's user UUID and run this SQL, replacing the placeholder:
   ```sql
   insert into public.editors(singleton,user_id)
   values (true, 'YOUR-EDITOR-USER-UUID');
   ```
   The database permits only one editor. To replace that editor, update the existing row through the SQL editor.
5. In `config.js`, set `supabaseUrl` to your project URL and `supabaseAnonKey` to its **publishable key** or legacy **anon key**. These settings are public. Never use a service-role or secret key.
6. Commit the configuration. After Pages redeploys, select **Вхід для редактора** and use the email/password you created.

The app reads `/rest/v1/play` and saves only through the `save_play` RPC. No guest or ordinary authenticated user has write access. There is no front-end-only password protection. Photo URLs must be HTTPS and publicly accessible; photos are linked rather than uploaded.

## GitHub Pages

The included workflow builds and deploys on pushes to `main`. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. Project-subpath hosting works because assets and navigation use relative URLs and hash routes.

## Local development

Node 22+ is enough; there are no npm dependencies.

```sh
npm run build
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. Source files are at the repository root; `dist/` is generated. Google Fonts are optional; system fonts work offline.

## Verification after Supabase setup

1. In a signed-out browser, confirm story and all 36 profiles are visible and props cannot be changed.
2. Log in as the editor. Add a point, enter a character note, then reorder the point; the note must follow it.
3. Refresh a second guest browser; verify the changes appear.
4. Add a prop, mark it ready, and verify its state after reload.
5. Open two editor sessions, save in one, then attempt a save in the stale session. The latter must receive a conflict message and preserve the first save.
6. An ordinary authenticated account must be unable to call `save_play`; anonymous calls must also be denied. The editor cannot create another editor through the client API.

Until Supabase is configured, live authentication, authorization, and persistence cannot be verified. Run the SQL once and follow this checklist before using the site for rehearsals. All published play content is readable by anyone with the URL.
