# ORVEX Agent backend setup

The repository now contains a Vercel Node.js API layer for Telegram-authenticated profiles. It is deliberately fail-closed: profile requests return `503` until all required server-side environment variables are configured.

## 1. Create the database

1. Create a Supabase project.
2. Open its SQL Editor.
3. Run the contents of `supabase/schema.sql`.
4. In Project Settings, copy the project URL and the service-role key.

The tables have Row Level Security enabled and no public access. Only server-side API routes use the service-role key. Telegram records use Telegram IDs; Google and guest records use Supabase Auth UUIDs in separate tables. The SQL setup also creates an atomic account deletion function and grants its execution only to the Supabase service role.

## 2. Configure Vercel

In the Vercel project settings, add these Environment Variables for Production and Preview as appropriate:

- `TELEGRAM_BOT_TOKEN`: the token of the ORVEX Agent Telegram bot.
- `SUPABASE_URL`: the Supabase project URL, for example `https://your-project.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key. Keep it private and server-side.
- `SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (`sb_publishable_...`) used by the browser authentication client. It is safe to expose, but must never be confused with the service-role key.
- `ORVEX_TELEGRAM_BOT_URL`: the public Telegram bot link, for example `https://t.me/your_bot_username`, used when someone opens the site outside Telegram.
- `OPENROUTER_API_KEY`: the server-side OpenRouter key used by the AI chat. Never put this key in the browser or Git.
- `ORVEX_BOT_API_SECRET`: a random secret of at least 32 characters, shared only with the Telegram bot worker. Use the same value in Vercel and the worker; never put it in the Mini App or Git.

Keep `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN` and `ORVEX_BOT_API_SECRET` server-side. Never add them to `index.html`, commit them to Git, or send them in chat. The publishable key is intentionally public and is returned by `GET /api/auth-config`. Redeploy after saving the variables.


## Telegram, Google and guest sign-in

The sign-in methods are presented in this order: Telegram, Google, then guest. When ORVEX is opened inside Telegram, the verified Telegram identity is used automatically. Google and guest sign-in are offered in a normal browser so a guest session cannot accidentally inherit access to Telegram profile, memory or balance endpoints.

1. In Supabase Dashboard, open Authentication → Sign In / Providers and enable **Anonymous Sign-Ins**.
2. Enable the **Google** provider and enter the Google OAuth Client ID and Client Secret in the Supabase Dashboard. Do not put the Google Client Secret in Vercel or Git.
3. In Google Cloud, configure the OAuth client as a Web application. Add the ORVEX site origin to Authorized JavaScript origins and add the Supabase callback URL shown on the Supabase Google provider page to Authorized redirect URIs.
4. In Supabase Authentication → URL Configuration, add the ORVEX production URL and the Vercel Preview URL to the allowed Redirect URLs.
5. Add `SUPABASE_PUBLISHABLE_KEY` and `ORVEX_TELEGRAM_BOT_URL` to Vercel as described above. The Telegram URL must be the public `https://t.me/<bot_username>` link for the ORVEX bot.
6. Redeploy the Vercel project.

Anonymous users receive a separate Supabase Auth identity. Supabase documents that this identity cannot be recovered after the user signs out, clears browser data or changes device. Do not store important personal data in a guest account until an account-linking and recovery flow is implemented. Google sign-in and guest sign-in are separate sessions in this first stage; automatic migration of guest data into a Google account is not included yet.

The current Telegram profile, memory and balance APIs still use verified Telegram Mini App `initData`. Google and guest sessions do not gain access to those Telegram-only endpoints. The AI chat accepts Telegram sessions and Supabase sessions separately. Guest sessions are limited to 20 requests per UTC day; the 21st request is rejected by the server. The quota counter is stored in `orvex_guest_usage`, and the database function updates it atomically.

## 3. API endpoints

- `GET /api/health`: reports Telegram-auth and profile-storage configuration separately. It never returns secret values.
- `GET /api/auth-config`: returns the Supabase project URL and publishable key for browser authentication, plus the optional public Telegram bot link. It never returns server-side secrets.
- `GET /api/guest-quota`: returns the authenticated anonymous user's remaining daily AI requests. It accepts only a verified Supabase anonymous session.
- `POST /api/ai-chat`: verifies Telegram `initData` or a Supabase access token, allows only `openrouter/free`, calls OpenRouter server-side, enforces the guest quota and stores successful Google/guest chat exchanges.
- `GET /api/user-data`: verifies a Google or guest Supabase session and returns only that user's profile and latest 100 chat messages.
- `PUT /api/user-data`: validates and stores the profile under the authenticated Supabase Auth UUID.
- `GET /api/session`: verifies the current Telegram Mini App session and returns a minimal user identity without storing it.
- `GET /api/profile`: verifies Telegram Web App `initData` and returns the authenticated Telegram user's profile.
- `PUT /api/profile`: verifies Telegram Web App `initData`, validates the submitted profile, and upserts it by Telegram user ID.
- `DELETE /api/profile`: verifies Telegram Web App `initData` and deletes only that Telegram user's profile.
- `GET /api/memory`: returns up to 50 memories belonging to the authenticated Telegram user.
- `POST /api/memory`: stores a validated memory (maximum 1,000 characters) under that Telegram user.
- `DELETE /api/memory?id=<uuid>`: deletes only the specified memory owned by the authenticated Telegram user.
- `GET /api/balance`: returns the authenticated user's balance as `{ balance: { rub, usd, rate } }`. The balance is stored in kopecks in `orvex_balances`; the dollar amount is calculated on the server from the Central Bank of Russia rate (cached for one hour) and is `null` if the rate cannot be loaded. A user without a row has a zero balance.
- `GET /api/account`: exports the authenticated user's profile and all memory records as JSON.
- `DELETE /api/account`: deletes the authenticated user's profile, memories and stored chat history in one database transaction using a restricted SQL function.
- `POST /api/bot`: private server-to-server endpoint for the Telegram worker. It loads the Telegram user's profile, preferences, relevant memories and recent chat; saves exchanges and explicit memory notes; and clears chat history. It requires `Authorization: Bearer <ORVEX_BOT_API_SECRET>` and does not accept browser `initData` as a substitute.

The profile API accepts the `Authorization: tma <initData>` header. It validates the Telegram HMAC signature and rejects data older than 24 hours or dated more than 60 seconds in the future.

## 4. Checks

Run:

```sh
node scripts/validate-site.mjs
node --test scripts/backend-auth.test.cjs scripts/health-api.test.cjs scripts/session-api.test.cjs scripts/profile-api.test.cjs scripts/memory-api.test.cjs scripts/account-api.test.cjs scripts/balance-api.test.cjs scripts/auth-config-api.test.cjs scripts/guest-quota-api.test.cjs scripts/guest-quota-migration.test.cjs scripts/ai-chat-api.test.cjs scripts/user-data-api.test.cjs scripts/index-html-regressions.test.cjs
```

The automated tests use fake test tokens and mocked storage responses. They do not require live Telegram or Supabase credentials.


## Guest AI quota and free model access

For an existing Supabase project, apply `supabase/migrations/20261114_add_orvex_guest_usage_quota.sql` and `supabase/migrations/20261114_add_external_auth_user_data.sql` after the Telegram chat migrations. For a new project, the same table and function are included in `supabase/schema.sql`. The migration is additive and does not change Telegram profiles, memories or balances.

The guest quota is **20 AI requests per UTC calendar day**, resetting at 00:00 UTC. The database function performs an atomic increment, so parallel requests cannot exceed the limit. The quota is tied to the Supabase anonymous user ID, not a browser-supplied ID. If a guest clears browser data or signs out, Supabase cannot recover that anonymous identity. Supabase recommends CAPTCHA or Cloudflare Turnstile for anonymous sign-ups before public launch because users can create additional anonymous identities.

The Mini App currently exposes only `openrouter/free` to the chat API. The server rejects other model IDs, keeps the OpenRouter key private and returns the remaining guest quota. OpenRouter can choose among its currently available free models; availability and provider rate limits can change. Google and guest profiles are stored in `orvex_auth_profiles`, and their successful AI exchanges are stored in `orvex_auth_chat_messages`. The interface loads the latest 100 messages after authentication. These tables are separate from Telegram profile and memory tables.

Before enabling this feature, add `OPENROUTER_API_KEY` to Vercel Production and Preview, apply the database migration, enable Supabase Anonymous Sign-Ins and configure the Google provider as described above. The AI endpoint returns a setup error until the required server-side variables and database function are available.

## Balance

Run the updated `supabase/schema.sql` again on existing projects: it adds the `orvex_balances` table and updates `delete_orvex_account` so account deletion also removes the balance. Payments are not connected yet, so the top-up window in the app only previews the amount and its dollar equivalent. Until payments exist, a balance can be set manually in the Supabase SQL Editor (amount in kopecks, 50000 = 500 RUB):

```sql
insert into public.orvex_balances (telegram_id, balance_kopecks)
values ('123456789', 50000)
on conflict (telegram_id) do update
  set balance_kopecks = excluded.balance_kopecks, updated_at = now();
```

## Current boundary

The profile and memory APIs and database schema are prepared, but live profile persistence and memory access are not active until the Supabase tables exist and the three Vercel environment variables are configured. The profile form uses the Telegram-authenticated profile API inside the Mini App and the Supabase-authenticated user-data API in a normal browser. Google and guest profiles are saved by Auth UUID. The app loads stored Google/guest profiles and the latest 100 chat messages. Applying the external-auth migration is required before this storage becomes available. Real-device and in-Telegram checks still need to be performed. AI chat uses the OpenRouter Free Models Router (`openrouter/free`). The API rejects any other model ID, so a guest cannot change the request to a paid model. The browser never receives the OpenRouter key.


## Telegram bot synchronization

Apply these migrations in order before enabling persistent bot synchronization: `supabase/migrations/20261113_add_orvex_chat_messages_and_lock_down_access.sql` creates the chat-history table, revokes direct browser-role grants and extends account deletion; `supabase/migrations/20261113_add_service_role_policies_for_orvex_data.sql` adds explicit service-role-only RLS policies.

Configure `ORVEX_BOT_API_SECRET` in Vercel and the Telegram worker with the exact same random value. The worker receives only this scoped API secret, not the Supabase service-role key. Set `ORVEX_API_URL` in the worker to `https://orvex-agent.vercel.app/api/bot`.

The bot keeps at most 100 recent chat messages per Telegram user. `/reset` clears only that conversation history. Profile data and saved memories remain until the user changes or deletes them in the Mini App. The `/remember` command writes a note to the same memory table used by the Mini App.
