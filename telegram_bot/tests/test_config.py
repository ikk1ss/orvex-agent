import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import DEFAULT_WEBAPP_URL, load_settings
from messages import HELP_TEXT, PRIVACY_TEXT, UNKNOWN_TEXT, WELCOME_TEXT


class SettingsTests(unittest.TestCase):
    def test_requires_bot_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "TELEGRAM_BOT_TOKEN"):
                load_settings()

    def test_uses_default_webapp_url(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"}, clear=True):
            settings = load_settings()
        self.assertEqual(settings.webapp_url, DEFAULT_WEBAPP_URL)
        self.assertEqual(settings.telegram_bot_token, "test-token")

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
    def test_required_commands_are_documented(self):
        for command in ("/start", "/app", "/help", "/privacy"):
            self.assertIn(command, HELP_TEXT)

    def test_messages_do_not_claim_ai_is_ready(self):
        self.assertIn("не подключены", UNKNOWN_TEXT)
        self.assertIn("не сохраняет", PRIVACY_TEXT)
        self.assertTrue(WELCOME_TEXT.startswith("Добро пожаловать"))


if __name__ == "__main__":
    unittest.main()
