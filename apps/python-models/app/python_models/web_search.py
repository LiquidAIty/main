"""One real Tavily search operation shared by native Harness and AutoGen cards."""

from __future__ import annotations

import asyncio
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def _search_sync(query: str, max_results: int) -> str:
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        return json.dumps({"ok": False, "error": "tavily_api_key_missing"})
    body = json.dumps(
        {
            "api_key": api_key,
            "query": query,
            "max_results": max(1, min(int(max_results or 5), 10)),
            "search_depth": "basic",
        }
    ).encode("utf-8")
    request = Request(
        "https://api.tavily.com/search",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - Tavily API
            raw = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        return json.dumps({"ok": False, "error": f"tavily_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"tavily_unreachable: {err.reason}"})
    except (ValueError, OSError) as err:
        return json.dumps({"ok": False, "error": f"tavily_failed: {err}"})
    results = []
    for item in raw.get("results") or []:
        url = str(item.get("url") or "")
        results.append(
            {
                "url": url,
                "title": str(item.get("title") or ""),
                "domain": urlparse(url).netloc,
                "content": str(item.get("content") or ""),
                "published_date": item.get("published_date"),
                "score": item.get("score"),
            }
        )
    return json.dumps(
        {"ok": True, "query": query, "result_count": len(results), "results": results}
    )


async def web_search(query: str, max_results: int = 5) -> str:
    cleaned = str(query or "").strip()
    if not cleaned:
        return json.dumps({"ok": False, "error": "query_required"})
    return await asyncio.to_thread(_search_sync, cleaned, max_results)
