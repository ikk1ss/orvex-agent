# ORVEX Agent Telegram bot

The Telegram bot is the conversational interface for ORVEX Agent. The Mini App remains the control center.

## Current capabilities

- Natural-language private chat powered by OpenRouter's OpenAI-compatible Chat Completions API.
- ORVEX personality and response rules in `personality.py`.
- Loads the user's profile, response preferences and relevant saved memories from the shared ORVEX backend.
- Stores up to 100 recent chat messages per Telegram user in Supabase when the bot backend is configured.
- `/reset` deletes chat history but leaves the profile and separately saved memories intact.
- `/remember text` saves a note to the same personal memory used by the Mini App.
- `/start`, `/app`, `/help`, and `/privacy` commands.
- Telegram menu button opens the Mini App.
- Group messages are not processed.

If `ORVEX_BOT_API_SECRET` is not configured, the bot uses temporary in-memory conversation context. Profile and memory synchronization are unavailable in that mode.

## Requirements

- Python 3.10+
- A Telegram bot token created with BotFather
- An OpenRouter API key
- An ORVEX server API URL and a shared bot API secret for persistent history and profile/memory synchronization

## Run locally

From this directory:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set environment variables. Never commit real credentials:

```sh
export TELEGRAM_BOT_TOKEN="your-telegram-token"
export OPENROUTER_API_KEY="your-openrouter-key"
export OPENROUTER_MODEL="openrouter/free"
export ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app"
export ORVEX_API_URL="https://orvex-agent.vercel.app/api/bot"
export ORVEX_BOT_API_SECRET="your-random-secret-at-least-32-characters-long"
python bot.py
```

Generate one strong random secret and add the exact same value as `ORVEX_BOT_API_SECRET` to the Vercel project environment and the bot worker environment. Keep it private. The endpoint rejects requests without this secret. `ORVEX_API_URL` defaults to `https://orvex-agent.vercel.app/api/bot`.

`OPENROUTER_MODEL` is optional and defaults to `openrouter/free`. Without `OPENROUTER_API_KEY`, the bot keeps its commands available but reports that AI is not configured.

## Database

The migration `supabase/migrations/20261113_add_orvex_chat_messages_and_lock_down_access.sql` creates the bounded chat-history table, keeps it inaccessible to browser roles, and extends account deletion to remove chat history. Apply the migration before enabling persistent bot synchronization.

The bot API uses the server-side Supabase service key already configured for the Vercel API. Never put that key in the Telegram worker or browser. The worker only receives the separate, narrowly scoped `ORVEX_BOT_API_SECRET`.

## Docker

Build from this directory:

```sh
docker build -t orvex-agent-telegram .
docker run --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -e OPENROUTER_MODEL="openrouter/free" \
  -e ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app" \
  -e ORVEX_API_URL="https://orvex-agent.vercel.app/api/bot" \
  -e ORVEX_BOT_API_SECRET="$ORVEX_BOT_API_SECRET" \
  orvex-agent-telegram
```

Use a worker/container host that supports a continuously running process. This polling bot should not be deployed as a Vercel serverless function. Configure `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ORVEX_BOT_API_SECRET` in Vercel. Configure the Telegram token, OpenRouter key and matching bot API secret in the worker.

## Tests

From the repository root:

```sh
node --test scripts/bot-api.test.cjs
python -m py_compile telegram_bot/config.py telegram_bot/messages.py telegram_bot/personality.py telegram_bot/ai.py telegram_bot/backend.py telegram_bot/bot.py
python -m unittest discover -s telegram_bot/tests -v
```

Automated tests use mocked Telegram/OpenRouter/Supabase responses. They do not prove that a live Telegram bot has been deployed or tested end to end.
