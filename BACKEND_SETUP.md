# ORVEX Agent backend setup

The repository now contains a Vercel Node.js API layer for Telegram-authenticated profiles. It is deliberately fail-closed: profile requests return `503` until all required server-side environment variables are configured.

## 1. Create the database

1. Create a Supabase project.
2. Open its SQL Editor.
3. Run the contents of `supabase/schema.sql`.
4. In Project Settings, copy the project URL and the service-role key.

The tables have Row Level Security enabled and no public policies. Only the server-side API uses the service-role key. The SQL setup also creates an atomic account deletion function and grants its execution only to the Supabase service role.

## 2. Configure Vercel

In the Vercel project settings, add these Environment Variables for Production and Preview as appropriate:

- `TELEGRAM_BOT_TOKEN`: the token of the ORVEX Agent Telegram bot.
- `SUPABASE_URL`: the Supabase project URL, for example `https://your-project.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key.
- `ORVEX_BOT_API_SECRET`: a random secret of at least 32 characters, shared only with the Telegram bot worker. Use the same value in Vercel and the worker; never put it in the Mini App or Git.

Keep all three values server-side. Never add them to `index.html`, commit them to Git, or send them in chat. Redeploy after saving the variables.

## 3. API endpoints

- `GET /api/health`: reports Telegram-auth and profile-storage configuration separately. It never returns secret values.
- `GET /api/session`: verifies the current Telegram Mini App session and returns a minimal user identity without storing it.
- `GET /api/profile`: verifies Telegram Web App `initData` and returns the authenticated Telegram user's profile.
- `PUT /api/profile`: verifies Telegram Web App `initData`, validates the submitted profile, and upserts it by Telegram user ID.
- `DELETE /api/profile`: verifies Telegram Web App `initData` and deletes only that Telegram user's profile.
- `GET /api/memory`: returns up to 50 memories belonging to the authenticated Telegram user.
- `POST /api/memory`: stores a validated memory (maximum 1,000 characters) under that Telegram user.
- `DELETE /api/memory?id=<uuid>`: deletes only the specified memory owned by the authenticated Telegram user.
- `GET /api/account`: exports the authenticated user's profile and all memory records as JSON.
- `DELETE /api/account`: deletes the authenticated user's profile, memories and stored chat history in one database transaction using a restricted SQL function.
- `POST /api/bot`: private server-to-server endpoint for the Telegram worker. It loads the Telegram user's profile, preferences, relevant memories and recent chat; saves exchanges and explicit memory notes; and clears chat history. It requires `Authorization: Bearer <ORVEX_BOT_API_SECRET>` and does not accept browser `initData` as a substitute.

The profile API accepts the `Authorization: tma <initData>` header. It validates the Telegram HMAC signature and rejects data older than 24 hours or dated more than 60 seconds in the future.

## 4. Checks

Run:

```sh
node scripts/validate-site.mjs
node --test scripts/backend-auth.test.cjs scripts/health-api.test.cjs scripts/session-api.test.cjs scripts/profile-api.test.cjs scripts/memory-api.test.cjs scripts/account-api.test.cjs
```

The automated tests use fake test tokens and mocked storage responses. They do not require live Telegram or Supabase credentials.

## Current boundary

The profile and memory APIs and database schema are prepared, but live profile persistence and memory access are not active until the Supabase tables exist and the three Vercel environment variables are configured. The profile form now uses the Telegram-authenticated profile API inside the Mini App. It loads the server profile and migrates an existing local profile when the server record is empty. In a normal browser, the profile remains local and is clearly labelled as such. Real-device and in-Telegram checks still need to be performed. AI-provider integration remains intentionally separate and is not enabled by this backend setup.


## Telegram bot synchronization

Apply these migrations in order before enabling persistent bot synchronization: `supabase/migrations/20261113_add_orvex_chat_messages_and_lock_down_access.sql` creates the chat-history table, revokes direct browser-role grants and extends account deletion; `supabase/migrations/20261113_add_service_role_policies_for_orvex_data.sql` adds explicit service-role-only RLS policies.

Configure `ORVEX_BOT_API_SECRET` in Vercel and the Telegram worker with the exact same random value. The worker receives only this scoped API secret, not the Supabase service-role key. Set `ORVEX_API_URL` in the worker to `https://orvex-agent.vercel.app/api/bot`.

The bot keeps at most 100 recent chat messages per Telegram user. `/reset` clears only that conversation history. Profile data and saved memories remain until the user changes or deletes them in the Mini App. The `/remember` command writes a note to the same memory table used by the Mini App.
