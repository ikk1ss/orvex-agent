# ORVEX Agent: testing

## Automated validation

Every push to `main` and every pull request runs `node scripts/validate-site.mjs`. The check verifies the document shell, Russian language and viewport metadata, Telegram WebApp SDK inclusion, duplicate IDs, in-page links, required profile controls, local profile storage hooks, and inline JavaScript syntax.

This is a source-level smoke check. It does not prove that Telegram authentication, backend APIs, AI requests, database persistence, or the visual layout work in a real browser.

## Manual browser and Telegram checks

- Open the deployed site on desktop and mobile.
- On a clean browser profile, confirm the profile dialog opens.
- Submit the form with the name missing and confirm browser validation blocks it.
- Submit with a name and consent, refresh, and confirm the profile remains on that browser.
- Open the profile again and confirm saved values are loaded.
- Confirm the dialog cannot be dismissed before a profile is saved.
- Open the Mini App from the Telegram menu button and check that it renders inside Telegram.
- Confirm that profile data is currently device-local and is not synchronized to a server.

## Current implementation boundary

The current repository contains a single static `index.html`. Server-side Telegram `initData` verification, real account registration, shared database storage, AI provider requests, and agent execution are not implemented. Do not enter API keys or bot tokens into the browser code.
