"""
config_store.py — Persisted settings for Jira + LLM provider.
Reads/writes config.json. Seeds from .env on first run.
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv

CONFIG_PATH = Path(__file__).parent / "config.json"
ENV_PATH = Path(__file__).parent / "src" / ".env"

# Load .env at module level so os.getenv works everywhere
load_dotenv(ENV_PATH, override=True)

DEFAULTS = {
    "jira_url": "",
    "jira_email": "",
    "jira_token": "",
    "provider": "ollama",      # "ollama" | "groq"
    "groq_key": "",
    "ollama_url": "http://localhost:11434",
    "ollama_model": "gemma",
}


def _seed_from_env() -> dict:
    """Bootstrap config from .env file if it exists."""
    raw_url = os.getenv("JIRA__URL", "")
    # Strip path segments — keep only scheme + host
    if "://" in raw_url:
        parts = raw_url.split("://", 1)
        host = parts[1].split("/")[0]
        jira_url = f"{parts[0]}://{host}"
    else:
        jira_url = raw_url
    return {
        "jira_url": jira_url,
        "jira_email": os.getenv("JIRA__EMAIL", ""),
        "jira_token": os.getenv("JIRA_API_TOKEN", ""),
        "provider": "ollama",
        "groq_key": os.getenv("GROQ_API_TOKEN", ""),
        "ollama_url": os.getenv("OLLAMA_URL", DEFAULTS["ollama_url"]),
        "ollama_model": DEFAULTS["ollama_model"],
    }


def load_config() -> dict:
    """Return the current config, seeding from .env if config.json missing."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        # Merge in any missing keys from defaults
        for k, v in DEFAULTS.items():
            cfg.setdefault(k, v)
        return cfg

    # First run — seed from .env
    cfg = _seed_from_env()
    save_config(cfg)
    return cfg


def save_config(cfg: dict) -> None:
    """Persist config dictionary to config.json."""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def get(key: str):
    """Convenience getter for a single key."""
    return load_config().get(key, DEFAULTS.get(key))
