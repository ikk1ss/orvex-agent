"""Environment configuration for the ORVEX Agent Telegram bot."""
from dataclasses import dataclass
from os import environ
from urllib.parse import urlparse

DEFAULT_WEBAPP_URL = "https://orvex-agent.vercel.app"
DEFAULT_AI_MODEL = "openrouter/free"


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    webapp_url: str
    openrouter_api_key: str
    ai_model: str


def load_settings() -> Settings:
    token = environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    webapp_url = environ.get("ORVEX_WEBAPP_URL", DEFAULT_WEBAPP_URL).strip()
    api_key = environ.get("OPENROUTER_API_KEY", "").strip()
    ai_model = environ.get("OPENROUTER_MODEL", DEFAULT_AI_MODEL).strip() or DEFAULT_AI_MODEL
    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN is required")
    parsed = urlparse(webapp_url)
    if (
        parsed.scheme != "https" or not parsed.netloc or parsed.username
        or parsed.password or parsed.fragment
    ):
        raise ValueError("ORVEX_WEBAPP_URL must be a valid HTTPS URL without credentials or fragment")
    return Settings(
        telegram_bot_token=token,
        webapp_url=webapp_url,
        openrouter_api_key=api_key,
        ai_model=ai_model,
    )
