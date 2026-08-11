"""
llm_client.py — LLM abstraction: Ollama (primary) → Groq (fallback).
"""
import json
import logging
from typing import Optional

import requests
from groq import Groq

from config_store import load_config

logger = logging.getLogger(__name__)


def _call_ollama(prompt: str) -> Optional[str]:
    """Call local Ollama server. Returns response text or None on failure."""
    cfg = load_config()
    url = cfg.get("ollama_url", "http://localhost:11434").rstrip("/")
    model = cfg.get("ollama_model", "gemma")

    try:
        resp = requests.post(
            f"{url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "").strip()
    except requests.exceptions.ConnectionError:
        logger.warning("Ollama not reachable at %s", url)
        return None
    except Exception as e:
        logger.warning("Ollama call failed: %s", e)
        return None


def _call_groq(prompt: str) -> Optional[str]:
    """Call Groq cloud API. Returns response text or None on failure."""
    cfg = load_config()
    api_key = cfg.get("groq_key", "")

    if not api_key:
        logger.warning("Groq API key not configured")
        return None

    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a Senior QA Engineer. Output structured test cases only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=4096,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        logger.warning("Groq call failed: %s", e)
        return None


def generate(prompt: str) -> tuple[str, str, str]:
    """
    Generate a response using the configured provider.
    Falls back automatically: Ollama → Groq (or Groq → Ollama).

    Returns: (response_text, provider_used, model_used)
    """
    cfg = load_config()
    provider = cfg.get("provider", "ollama")

    result: Optional[str] = None
    actual_provider = provider
    model_used = ""

    if provider == "ollama":
        model_used = cfg.get("ollama_model", "gemma")
        result = _call_ollama(prompt)
        if result is None:
            logger.info("Ollama unavailable, falling back to Groq...")
            result = _call_groq(prompt)
            actual_provider = "groq (fallback)"
            model_used = "llama-3.3-70b-versatile"

    elif provider == "groq":
        model_used = "llama-3.3-70b-versatile"
        result = _call_groq(prompt)
        if result is None:
            logger.info("Groq failed, falling back to Ollama...")
            result = _call_ollama(prompt)
            actual_provider = "ollama (fallback)"
            model_used = cfg.get("ollama_model", "gemma")

    if result is None:
        raise RuntimeError(
            "Both LLM providers are unavailable. "
            "Check that Ollama is running or your Groq API key is valid."
        )

    return result, actual_provider, model_used
