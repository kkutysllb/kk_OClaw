"""
Web Search Tool - Search the web using DuckDuckGo (no API key required).
"""

import json
import logging
import time

from langchain.tools import tool

from kkoclaw.config import get_app_config

logger = logging.getLogger(__name__)

# Circuit-breaker state for DDG search failures
_last_failure_time: float = 0.0
_consecutive_failures: int = 0
_CIRCUIT_BREAK_THRESHOLD = 3  # Open circuit after 3 consecutive failures
_CIRCUIT_BREAK_RESET_SEC = 300.0  # Reset circuit after 5 minutes


def _is_circuit_open() -> bool:
    """Check if the circuit breaker is open (search should be skipped)."""
    global _consecutive_failures, _last_failure_time
    if _consecutive_failures >= _CIRCUIT_BREAK_THRESHOLD:
        # Check if enough time has passed to try again (half-open state)
        if time.monotonic() - _last_failure_time > _CIRCUIT_BREAK_RESET_SEC:
            logger.info("DDG search circuit breaker: half-open, allowing retry")
            return False
        return True
    return False


def _record_failure() -> None:
    """Record a search failure for circuit breaker tracking."""
    global _consecutive_failures, _last_failure_time
    _consecutive_failures += 1
    _last_failure_time = time.monotonic()
    if _consecutive_failures >= _CIRCUIT_BREAK_THRESHOLD:
        logger.warning(
            "DDG search circuit breaker OPEN after %d consecutive failures. "
            "Search will be skipped for %.0f seconds.",
            _consecutive_failures, _CIRCUIT_BREAK_RESET_SEC,
        )


def _record_success() -> None:
    """Record a successful search, resetting the circuit breaker."""
    global _consecutive_failures
    _consecutive_failures = 0


def _search_text(
    query: str,
    max_results: int = 5,
    region: str = "wt-wt",
    safesearch: str = "moderate",
) -> list[dict]:
    """
    Execute text search using DuckDuckGo.

    Args:
        query: Search keywords
        max_results: Maximum number of results
        region: Search region
        safesearch: Safe search level

    Returns:
        List of search results
    """
    # Check circuit breaker before attempting
    if _is_circuit_open():
        logger.warning(
            "DDG search skipped (circuit breaker open, %d consecutive failures). Query: %s",
            _consecutive_failures, query[:80],
        )
        return []

    try:
        from ddgs import DDGS
    except ImportError:
        logger.error("ddgs library not installed. Run: pip install ddgs")
        return []

    ddgs = DDGS(timeout=30)

    try:
        results = ddgs.text(
            query,
            region=region,
            safesearch=safesearch,
            max_results=max_results,
        )
        found = list(results) if results else []
        if found:
            _record_success()
        return found

    except Exception as e:
        logger.error(f"Failed to search web: {e}")
        _record_failure()
        return []


@tool("web_search", parse_docstring=True)
def web_search_tool(
    query: str,
    max_results: int = 5,
) -> str:
    """Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.

    Args:
        query: Search keywords describing what you want to find. Be specific for better results.
        max_results: Maximum number of results to return. Default is 5.
    """
    config = get_app_config().get_tool_config("web_search")

    # Override max_results from config if set
    if config is not None and "max_results" in config.model_extra:
        max_results = config.model_extra.get("max_results", max_results)

    results = _search_text(
        query=query,
        max_results=max_results,
    )

    if not results:
        return json.dumps({
            "error": "No results found",
            "query": query,
            "suggestion": "Web search may be temporarily unavailable. Try rephrasing your query or use alternative information sources.",
        }, ensure_ascii=False)

    normalized_results = [
        {
            "title": r.get("title", ""),
            "url": r.get("href", r.get("link", "")),
            "content": r.get("body", r.get("snippet", "")),
        }
        for r in results
    ]

    output = {
        "query": query,
        "total_results": len(normalized_results),
        "results": normalized_results,
    }

    return json.dumps(output, indent=2, ensure_ascii=False)
