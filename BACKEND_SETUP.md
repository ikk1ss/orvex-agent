# ORVEX Agent backend setup

The repository now contains a Vercel Node.js API layer for Telegram-authenticated profiles. It is deliberately fail-closed: profile requests return `503` until all required server-side environment variables are configured.

## 1. Create the database

1. Create a Supabase project.
2. Open its SQL Editor.
3. Run the contents of `supabase/schema.sql`.
4. In Project Settings, copy the project URL and the service-role key.

The table has Row Level Security enabled and no public policies. Only the server-side API uses the service-role key.

## 2. Configure Vercel

In the Vercel project settings, add these Environment Variables for Production and Preview as appropriate:

- `TELEGRAM_BOT_TOKEN`: the token of the ORVEX Agent Telegram bot.
- `SUPABASE_URL`: the Supabase project URL, for example `https://your-project.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key.

Keep all three values server-side. Never add them to `index.html`, commit them to Git, or send them in chat. Redeploy after saving the variables.

## 3. API endpoints

- `GET /api/health`: reports Telegram-auth and profile-storage configuration separately. It never returns secret values.
- `GET /api/session`: verifies the current Telegram Mini App session and returns a minimal user identity without storing it.
- `GET /api/profile`: verifies Telegram Web App `initData` and returns the authenticated Telegram user's profile.
- `PUT /api/profile`: verifies Telegram Web App `initData`, validates the submitted profile, and upserts it by Telegram user ID.
- `DELETE /api/profile`: verifies Telegram Web App `initData` and deletes only that Telegram user's profile.

The profile API accepts the `Authorization: tma <initData>` header. It validates the Telegram HMAC signature and rejects data older than 24 hours or dated more than 60 seconds in the future.

## 4. Checks

Run:

```sh
node scripts/validate-site.mjs
node --test scripts/backend-auth.test.cjs
```

The authentication tests use a fake test token and do not require live Telegram or Supabase credentials.

## Current boundary

The API and database schema are prepared, but live profile persistence is not active until the Supabase table exists and the three Vercel environment variables are configured. Real-device and in-Telegram checks still need to be performed. AI-provider integration remains intentionally separate and is not enabled by this backend setup.
