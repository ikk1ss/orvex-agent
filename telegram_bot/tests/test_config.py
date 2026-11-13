import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import DEFAULT_AI_MODEL, DEFAULT_WEBAPP_URL, load_settings
from messages import AI_NOT_CONFIGURED_TEXT, HELP_TEXT, PRIVACY_TEXT, WELCOME_TEXT


class SettingsTests(unittest.TestCase):
    def test_requires_bot_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "TELEGRAM_BOT_TOKEN"):
                load_settings()

    def test_uses_safe_defaults_and_optional_ai_key(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"}, clear=True):
            settings = load_settings()
        self.assertEqual(settings.webapp_url, DEFAULT_WEBAPP_URL)
        self.assertEqual(settings.telegram_bot_token, "test-token")
        self.assertEqual(settings.ai_model, DEFAULT_AI_MODEL)
        self.assertEqual(settings.openrouter_api_key, "")

    def test_reads_openrouter_settings(self):
        env = {
            "TELEGRAM_BOT_TOKEN": "test-token",
            "OPENROUTER_API_KEY": "or-test-key",
            "OPENROUTER_MODEL": "provider/model",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = load_settings()
        self.assertEqual(settings.openrouter_api_key, "or-test-key")
        self.assertEqual(settings.ai_model, "provider/model")

    def test_rejects_non_https_url(self):
        env = {"TELEGRAM_BOT_TOKEN": "test-token", "ORVEX_WEBAPP_URL": "http://example.com"}
        with patch.dict(os.environ, env, clear=True):
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
        for command in ("/start", "/app", "/reset", "/help", "/privacy"):
            self.assertIn(command, HELP_TEXT)

    def test_welcome_introduces_conversation(self):
        self.assertIn("ИИ-помощник", WELCOME_TEXT)

    def test_privacy_discloses_temporary_context(self):
        self.assertIn("оперативной памяти", PRIVACY_TEXT)
        self.assertIn("OpenRouter", PRIVACY_TEXT)

    def test_missing_provider_is_not_misrepresented(self):
        self.assertIn("OPENROUTER_API_KEY", AI_NOT_CONFIGURED_TEXT)


if __name__ == "__main__":
    unittest.main()
