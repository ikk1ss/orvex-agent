# ORVEX Agent: testing

## Automated validation

Every push to `main` and every pull request runs:

- `node scripts/validate-site.mjs` for the document shell, Russian language and viewport metadata, Telegram WebApp SDK inclusion, duplicate IDs, in-page links, profile controls, personal memory UI/API wiring, safe text rendering, local profile handling, accessibility hooks, and inline JavaScript syntax.
- `node --test scripts/backend-auth.test.cjs scripts/memory-api.test.cjs scripts/account-api.test.cjs` for Telegram `initData` signature validation, tamper detection, timestamp expiry, malformed input, memory validation, per-user data scoping, account export, and atomic account deletion.

These are source-level and unit checks. They do not prove that Supabase credentials, live Telegram authentication, profile persistence, or the visual layout work in a real browser.

## Backend checks

- Follow `BACKEND_SETUP.md` to configure Supabase and Vercel environment variables.
- Open `/api/health`. Before configuration, the expected result is `telegramAuth: "setup_required"` and `profileService: "setup_required"`; after configuration each should report `"configured"`.
- Open the Mini App in Telegram and confirm the page reports a verified session only after `GET /api/session` succeeds.
- In the Personal Memory section, create a preference, fact, goal, instruction, and note; confirm they appear after reloading the page.
- Delete one memory and confirm only that record disappears.
- Open the site in a normal browser and confirm the memory editor stays unavailable outside an authenticated Telegram Mini App session.
- Test `GET /api/profile`, `PUT /api/profile`, and `DELETE /api/profile` only from an authenticated Telegram Mini App session.
- Confirm `DELETE /api/profile` removes only the authenticated user's record.
- Test `GET/POST/DELETE /api/memory` and confirm each operation is scoped to the authenticated Telegram ID.
- Export account data and confirm the JSON contains only the signed-in Telegram user's profile and memories.
- Delete account data and confirm both profile and memories are removed together; confirm a different Telegram user cannot delete this account.
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

The repository contains a static `index.html` plus Vercel Node.js API routes for backend health, Telegram session verification, profile storage, and personal memory. The memory UI is available only inside an authenticated Telegram Mini App session and requires the Supabase table plus three server-side Vercel environment variables. The frontend profile still uses local storage and does not yet send profile data to the API. AI provider requests and agent execution are not implemented. Do not enter API keys or bot tokens into browser code.
