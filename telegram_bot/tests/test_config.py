import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import DEFAULT_AI_MODEL, DEFAULT_WEBAPP_URL, load_settings
from messages import (
    AI_NOT_CONFIGURED_TEXT, HELP_TEXT, LOCAL_PRIVACY_TEXT, PRIVACY_TEXT, WELCOME_TEXT,
)


class SettingsTests(unittest.TestCase):
    def test_requires_bot_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "TELEGRAM_BOT_TOKEN"):
                load_settings()

    def test_uses_safe_defaults_and_optional_backend(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"}, clear=True):
            settings = load_settings()
        self.assertEqual(settings.webapp_url, DEFAULT_WEBAPP_URL)
        self.assertEqual(settings.telegram_bot_token, "test-token")
        self.assertEqual(settings.ai_model, DEFAULT_AI_MODEL)
        self.assertEqual(settings.openrouter_api_key, "")
        self.assertEqual(settings.orvex_api_url, DEFAULT_WEBAPP_URL + "/api/bot")
        self.assertEqual(settings.orvex_bot_api_secret, "")

    def test_reads_openrouter_and_backend_settings(self):
        env = {
            "TELEGRAM_BOT_TOKEN": "test-token",
            "OPENROUTER_API_KEY": "or-test-key",
            "OPENROUTER_MODEL": "provider/model",
            "ORVEX_API_URL": "https://orvex.example/api/bot",
            "ORVEX_BOT_API_SECRET": "x" * 48,
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()
        self.assertEqual(settings.openrouter_api_key, "or-test-key")
        self.assertEqual(settings.ai_model, "provider/model")
        self.assertEqual(settings.orvex_api_url, "https://orvex.example/api/bot")
        self.assertEqual(settings.orvex_bot_api_secret, "x" * 48)

    def test_rejects_short_backend_secret(self):
        env = {
            "TELEGRAM_BOT_TOKEN": "test-token",
            "ORVEX_BOT_API_SECRET": "too-short",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(ValueError, "32 characters"):
                load_settings()

    def test_rejects_non_https_urls(self):
        cases = [
            {"TELEGRAM_BOT_TOKEN": "test-token", "ORVEX_WEBAPP_URL": "http://example.com"},
            {
                "TELEGRAM_BOT_TOKEN": "test-token",
                "ORVEX_BOT_API_SECRET": "x" * 48,
                "ORVEX_API_URL": "http://example.com/api/bot",
            },
        ]
        for env in cases:
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                with self.assertRaisesRegex(ValueError, "HTTPS"):
                    load_settings()

    def test_rejects_credentials_and_fragments(self):
        for url in ("https://user:pass@example.com/app", "https://example.com/app#fragment"):
            with self.subTest(url=url), patch.dict(
                os.environ,
                {"TELEGRAM_BOT_TOKEN": "test-token", "ORVEX_WEBAPP_URL": url},
                clear=True,
            ):
                with self.assertRaises(ValueError):
                    load_settings()


class MessageTests(unittest.TestCase):
    def test_commands_are_documented(self):
        for command in ("/start", "/app", "/reset", "/remember", "/help", "/privacy"):
            self.assertIn(command, HELP_TEXT)

    def test_welcome_introduces_conversation(self):
        self.assertIn("ИИ-помощник", WELCOME_TEXT)

    def test_privacy_messages_describe_both_storage_modes(self):
        self.assertIn("OpenRouter", PRIVACY_TEXT)
        self.assertIn("100 последних сообщений", PRIVACY_TEXT)
        self.assertIn("оперативной памяти", LOCAL_PRIVACY_TEXT)

    def test_missing_provider_is_not_misrepresented(self):
        self.assertIn("OPENROUTER_API_KEY", AI_NOT_CONFIGURED_TEXT)


if __name__ == "__main__":
    unittest.main()
