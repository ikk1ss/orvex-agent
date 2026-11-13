# ORVEX Agent Telegram bot

The Telegram bot is the conversational interface for ORVEX Agent. The Mini App remains the control center.

## Current capabilities

- Natural-language private chat powered by OpenRouter's OpenAI-compatible Chat Completions API.
- ORVEX personality and response rules in `personality.py`.
- Short-lived conversation context, isolated by Telegram user ID.
- `/reset` clears the current user's in-memory context.
- `/start`, `/app`, `/help`, and `/privacy` commands.
- Telegram menu button opens the Mini App.
- Group messages are not processed.

Conversation context is held in process memory only. It is lost when the bot restarts. Persistent memory, shared Mini App preferences, model selection from the Mini App, and agent tools are not implemented yet.

## Requirements

- Python 3.10+
- A Telegram bot token created with BotFather
- An OpenRouter API key

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
python bot.py
```

`OPENROUTER_MODEL` is optional and defaults to `openrouter/free`. Without `OPENROUTER_API_KEY`, the bot keeps its commands available but clearly reports that AI is not configured.

## Docker

Build from this directory:

```sh
docker build -t orvex-agent-telegram .
docker run --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  -e OPENROUTER_MODEL="openrouter/free" \
  -e ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app" \
  orvex-agent-telegram
```

Use a worker/container host that supports a continuously running process. This polling bot should not be deployed as a Vercel serverless function. Configure `TELEGRAM_BOT_TOKEN` separately in Vercel for validating Mini App `initData`.

## Tests

From the repository root:

```sh
python -m py_compile telegram_bot/config.py telegram_bot/messages.py telegram_bot/personality.py telegram_bot/ai.py telegram_bot/bot.py
python -m unittest discover -s telegram_bot/tests -v
```
