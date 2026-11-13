import sys
import unittest
import json
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import BackendClient, BackendError


class BackendClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_loads_context_with_server_secret(self):
        captured = {}

        def handler(request):
            captured["url"] = str(request.url)
            captured["authorization"] = request.headers.get("Authorization")
            captured["payload"] = json.loads(request.read().decode("utf-8"))
            return httpx.Response(200, json={
                "messages": [
                    {"role": "user", "content": "Previous question"},
                    {"role": "assistant", "content": "Previous answer"},
                    {"role": "system", "content": "Must be filtered"}
                ],
                "personalizationContext": "Имя: Аркадий"
            })

        client = BackendClient(
            "https://orvex.example/api/bot",
            "x" * 48,
            transport=httpx.MockTransport(handler),
        )
        result = await client.get_context(123456, "Что ты обо мне знаешь?")
        self.assertEqual(captured["url"], "https://orvex.example/api/bot")
        self.assertEqual(captured["authorization"], "Bearer " + "x" * 48)
        self.assertEqual(captured["payload"]["telegramId"], "123456")
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(result["personalization_context"], "Имя: Аркадий")

    async def test_saves_exchange_and_memory(self):
        captured = []

        def handler(request):
            captured.append(request)
            if '"save_memory"' in request.content.decode("utf-8"):
                return httpx.Response(201, json={"memory": {"id": "m1"}})
            return httpx.Response(200, json={"saved": True})

        client = BackendClient(
            "https://orvex.example/api/bot",
            "x" * 48,
            transport=httpx.MockTransport(handler),
        )
        await client.save_exchange(123456, "Привет", "Здравствуйте")
        memory = await client.save_memory(123456, "Любит короткие ответы")
        self.assertEqual(len(captured), 2)
        self.assertEqual(memory["id"], "m1")

    async def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            BackendClient("http://orvex.example/api/bot", "x" * 48)
        with self.assertRaises(ValueError):
            BackendClient("https://orvex.example/api/bot", "short")

    async def test_sanitizes_backend_errors(self):
        def handler(_request):
            return httpx.Response(503, text="private upstream details")

        client = BackendClient(
            "https://orvex.example/api/bot",
            "x" * 48,
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaisesRegex(BackendError, "ORVEX backend request failed"):
            await client.clear_conversation(123456)


if __name__ == "__main__":
    unittest.main()
