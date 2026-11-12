# ORVEX Agent Telegram bot

A small Python launcher for the ORVEX Agent Telegram Mini App.

## What it does

- Responds to `/start`, `/app`, `/help`, and `/privacy`.
- Adds an inline Web App button to open `https://orvex-agent.vercel.app`.
- Configures Telegram's menu button to open the Mini App.
- Does not store chat messages or user profiles.
- Does not call an AI provider. AI features remain intentionally disabled until the provider and server-side request flow are ready.

## Requirements

- Python 3.10+
- A Telegram bot token created with BotFather
- The ORVEX Agent Mini App URL

## Run locally

From this directory:

```sh
python -m venv .venv
```

Activate the virtual environment, then install dependencies:

```sh
# Linux / macOS / Termux
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell, activate with:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Set environment variables. Do not put the real token in source files:

```sh
export TELEGRAM_BOT_TOKEN="your-token"
export ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app"
python bot.py
```

PowerShell:

```powershell
$env:TELEGRAM_BOT_TOKEN="your-token"
$env:ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app"
python bot.py
```

## Deploy with Docker

Build from this directory:

```sh
docker build -t orvex-agent-telegram .
docker run --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  -e ORVEX_WEBAPP_URL="https://orvex-agent.vercel.app" \
  orvex-agent-telegram
```

Use a worker/container host that supports a continuously running process. This polling bot should not be deployed as a Vercel serverless function. Configure the same bot token separately in Vercel as `TELEGRAM_BOT_TOKEN` for validating Mini App `initData`.

## Tests

Run the dependency-free unit tests from the repository root:

```sh
python -m unittest discover -s telegram_bot/tests -v
python -m py_compile telegram_bot/config.py telegram_bot/messages.py telegram_bot/bot.py
```
