import sys
import unittest
import json
from pathlib import Path
import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai import AIConfigurationError, ConversationStore, OpenRouterClient, OPENROUTER_URL
from personality import SYSTEM_PROMPT
from bot import handle_text


class ConversationStoreTests(unittest.TestCase):
    def test_keeps_only_recent_messages(self):
        store = ConversationStore(max_messages=4)
        store.add_exchange(7, "one", "two")
        store.add_exchange(7, "three", "four")
        store.add_exchange(7, "five", "six")
        self.assertEqual(store.get(7), [
            {"role": "user", "content": "three"},
            {"role": "assistant", "content": "four"},
            {"role": "user", "content": "five"},
            {"role": "assistant", "content": "six"},
        ])

    def test_context_is_isolated_and_clearable(self):
        store = ConversationStore()
        store.add_exchange(1, "private", "reply")
        self.assertEqual(store.get(2), [])
        store.clear(1)
        self.assertEqual(store.get(1), [])

    def test_context_is_not_persisted_by_this_store(self):
        first = ConversationStore()
        first.add_exchange(1, "hello", "hi")
        self.assertEqual(ConversationStore().get(1), [])


class AIClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_is_reported_without_network_call(self):
        client = OpenRouterClient(api_key="", model="openrouter/free")
        with self.assertRaises(AIConfigurationError):
            await client.answer("hello", [])

    async def test_sends_personality_history_and_returns_answer(self):
        captured = {}

        def handler(request):
            captured["url"] = str(request.url)
            captured["authorization"] = request.headers.get("Authorization")
            captured["payload"] = request.read().decode("utf-8")
            return httpx.Response(200, json={
                "choices": [{"message": {"content": "Привет! Чем помочь?"}}]
            })

        transport = httpx.MockTransport(handler)
        client = OpenRouterClient("test-secret", "openrouter/free", transport=transport)
        answer = await client.answer("Привет", [{"role": "user", "content": "Ранее"}])
        self.assertEqual(answer, "Привет! Чем помочь?")
        self.assertEqual(captured["url"], OPENROUTER_URL)
        self.assertEqual(captured["authorization"], "Bearer test-secret")
        payload = json.loads(captured["payload"])
        self.assertIn("Ты ORVEX", payload["messages"][0]["content"])
        self.assertIn("Ранее", payload["messages"][1]["content"])

    async def test_provider_error_is_sanitized(self):
        def handler(request):
            return httpx.Response(503, text="provider unavailable with internal details")

        client = OpenRouterClient(
            "test-secret", "openrouter/free", transport=httpx.MockTransport(handler)
        )
        with self.assertRaisesRegex(Exception, "OpenRouter request failed"):
            await client.answer("hello", [])

    async def test_telegram_handler_module_imports(self):
        self.assertTrue(callable(handle_text))

    async def test_personality_has_truthfulness_rules(self):
        self.assertIn("Не выдумывай факты", SYSTEM_PROMPT)
        self.assertIn("языке пользователя", SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
