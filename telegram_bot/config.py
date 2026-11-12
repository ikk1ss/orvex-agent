"""Environment configuration for the ORVEX Agent Telegram launcher."""
from dataclasses import dataclass
from os import environ
from urllib.parse import urlparse

DEFAULT_WEBAPP_URL = "https://orvex-agent.vercel.app"


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    webapp_url: str


def load_settings() -> Settings:
    token = environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    webapp_url = environ.get("ORVEX_WEBAPP_URL", DEFAULT_WEBAPP_URL).strip()

    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN is required")

    parsed = urlparse(webapp_url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise ValueError("ORVEX_WEBAPP_URL must be a valid HTTPS URL without credentials or fragment")

    return Settings(telegram_bot_token=token, webapp_url=webapp_url)
