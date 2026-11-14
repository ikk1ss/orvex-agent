"""Authenticated client for the ORVEX server-side bot API."""
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx


class BackendError(RuntimeError):
    """A sanitized ORVEX backend error."""


class BackendClient:
    def __init__(
        self,
        api_url: str,
        secret: str,
        timeout: float = 10.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        parsed = urlparse(api_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("ORVEX_API_URL must be a valid HTTPS URL")
        if not secret or len(secret) < 32:
            raise ValueError("ORVEX_BOT_API_SECRET must contain at least 32 characters")
        self.api_url = api_url
        self.secret = secret
        self.timeout = timeout
        self.transport = transport

    async def _post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                response = await client.post(
                    self.api_url,
                    headers={
                        "Authorization": f"Bearer {self.secret}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise BackendError("ORVEX backend request failed") from exc
        if not isinstance(data, dict):
            raise BackendError("ORVEX backend returned an invalid response")
        return data

    async def get_context(self, user_id: int, user_message: str) -> Dict[str, Any]:
        data = await self._post({
            "action": "context",
            "telegramId": str(user_id),
            "userMessage": user_message[:2000],
        })
        messages = data.get("messages")
        personalization = data.get("personalizationContext")
        if not isinstance(messages, list) or not isinstance(personalization, str):
            raise BackendError("ORVEX backend returned an invalid context")
        clean_messages: List[dict] = []
        for item in messages:
            if (
                isinstance(item, dict)
                and item.get("role") in ("user", "assistant")
                and isinstance(item.get("content"), str)
            ):
                clean_messages.append({
                    "role": item["role"],
                    "content": item["content"][:16000],
                })
        return {
            "messages": clean_messages[-12:],
            "personalization_context": personalization[:12000],
        }

    async def save_exchange(self, user_id: int, user_message: str, assistant_message: str) -> None:
        await self._post({
            "action": "append_exchange",
            "telegramId": str(user_id),
            "userMessage": user_message[:8000],
            "assistantMessage": assistant_message[:16000],
        })

    async def clear_conversation(self, user_id: int) -> None:
        await self._post({
            "action": "clear_conversation",
            "telegramId": str(user_id),
        })

    async def save_memory(self, user_id: int, content: str, category: str = "note") -> Optional[dict]:
        data = await self._post({
            "action": "save_memory",
            "telegramId": str(user_id),
            "content": content[:1000],
            "category": category,
        })
        memory = data.get("memory")
        return memory if isinstance(memory, dict) else None
