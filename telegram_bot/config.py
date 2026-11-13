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
    orvex_api_url: str
    orvex_bot_api_secret: str


def load_settings() -> Settings:
    token = environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    webapp_url = environ.get("ORVEX_WEBAPP_URL", DEFAULT_WEBAPP_URL).strip()
    api_key = environ.get("OPENROUTER_API_KEY", "").strip()
    ai_model = environ.get("OPENROUTER_MODEL", DEFAULT_AI_MODEL).strip() or DEFAULT_AI_MODEL
    bot_secret = environ.get("ORVEX_BOT_API_SECRET", "").strip()
    api_url = environ.get("ORVEX_API_URL", webapp_url.rstrip("/") + "/api/bot").strip()

    if not token:
        raise ValueError("TELEGRAM_BOT_TOKEN is required")

    parsed_webapp = urlparse(webapp_url)
    if (
        parsed_webapp.scheme != "https" or not parsed_webapp.netloc
        or parsed_webapp.username or parsed_webapp.password or parsed_webapp.fragment
    ):
        raise ValueError("ORVEX_WEBAPP_URL must be a valid HTTPS URL without credentials or fragment")

    if bot_secret:
        if len(bot_secret) < 32:
            raise ValueError("ORVEX_BOT_API_SECRET must contain at least 32 characters")
        parsed_api = urlparse(api_url)
        if (
            parsed_api.scheme != "https" or not parsed_api.netloc
            or parsed_api.username or parsed_api.password or parsed_api.fragment
        ):
            raise ValueError("ORVEX_API_URL must be a valid HTTPS URL without credentials or fragment")

    return Settings(
        telegram_bot_token=token,
        webapp_url=webapp_url,
        openrouter_api_key=api_key,
        ai_model=ai_model,
        orvex_api_url=api_url,
        orvex_bot_api_secret=bot_secret,
    )
