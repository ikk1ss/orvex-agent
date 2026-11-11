# ORVEX Agent: testing

## Automated validation

Every push to `main` and every pull request runs:

- `node scripts/validate-site.mjs` for the document shell, Russian language and viewport metadata, Telegram WebApp SDK inclusion, duplicate IDs, in-page links, profile controls, local profile handling, accessibility hooks, and inline JavaScript syntax.
- `node --test scripts/backend-auth.test.cjs` for Telegram `initData` signature validation, tamper detection, timestamp expiry, and malformed input.

These are source-level and unit checks. They do not prove that Supabase credentials, live Telegram authentication, profile persistence, or the visual layout work in a real browser.

## Backend checks

- Follow `BACKEND_SETUP.md` to configure Supabase and Vercel environment variables.
- Open `/api/health`. Before configuration, the expected result is `profileService: "setup_required"`; after configuration it should be `"configured"`.
- Test `GET /api/profile` and `PUT /api/profile` only from an authenticated Telegram Mini App session.
- Confirm unauthenticated requests receive HTTP 401.
- Confirm unsupported methods receive HTTP 405.
- Confirm profile data is scoped to the authenticated Telegram user.

## Manual browser and Telegram checks

- Open the deployed site on desktop and mobile.
- On a clean browser profile, confirm the profile dialog opens.
- Submit the form with the name missing and confirm browser validation blocks it.
- Submit with a name and consent, refresh, and confirm the profile remains on that browser.
- Open the profile again and confirm saved values are loaded.
- Confirm the dialog cannot be dismissed before a profile is saved.
- Open the Mini App from the Telegram menu button and check that it renders inside Telegram.
- Resize the Telegram Mini App viewport and confirm the page height follows it.
- Open the profile dialog and confirm Telegram's Back button closes it; confirm the Back button hides after the dialog closes.
- Use Tab and Shift+Tab in the profile dialog and confirm keyboard focus stays inside the dialog.
- Close the dialog and confirm keyboard focus returns to the control that opened it.
- Corrupt or remove the `orvex_agent_profile` localStorage entry and confirm invalid saved data does not bypass first-time profile setup.
- Confirm the current profile form still uses device-local storage until the server-sync flow and privacy requirements are completed.

## Current implementation boundary

The repository contains a static `index.html` plus Vercel Node.js API routes for backend health and Telegram-authenticated profile storage. The profile API requires a Supabase table and three server-side Vercel environment variables. The frontend profile still uses local storage and does not yet send profile data to the API. AI provider requests and agent execution are not implemented. Do not enter API keys or bot tokens into browser code.
