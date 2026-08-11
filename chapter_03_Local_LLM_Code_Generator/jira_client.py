"""
jira_client.py — Fetches Jira ticket details via REST API (Cloud).
"""
import base64
import re
from typing import Any, Dict, Optional

import requests

from config_store import load_config


def _adf_to_plain(adf_doc: Optional[Dict[str, Any]]) -> str:
    """Recursively extract plain text from Atlassian Document Format JSON."""
    if not adf_doc:
        return ""

    text_parts = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text" and "text" in node:
                text_parts.append(node["text"])
            for child in node.get("content", []):
                walk(child)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(adf_doc)
    return "".join(text_parts)


def fetch_ticket(ticket_key: str) -> dict:
    """
    Fetch a Jira ticket and return:
        { "summary": str, "description": str, "acceptance_criteria": str }
    """
    cfg = load_config()
    base_url = cfg["jira_url"].rstrip("/")
    email = cfg["jira_email"]
    token = cfg["jira_token"]

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
    }

    url = f"{base_url}/rest/api/3/issue/{ticket_key}"
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()

    data = resp.json()
    fields = data.get("fields", {})

    summary = fields.get("summary", "")
    description_adf = fields.get("description", {})
    description = _adf_to_plain(description_adf)

    # Acceptance criteria — try common custom field names
    acceptance_criteria = ""
    for key, value in fields.items():
        if "acceptance" in key.lower() or "criteria" in key.lower():
            if isinstance(value, dict):
                acceptance_criteria = _adf_to_plain(value)
            elif isinstance(value, str):
                acceptance_criteria = value
            break

    return {
        "summary": summary,
        "description": description,
        "acceptance_criteria": acceptance_criteria,
    }


def parse_ticket_key(text: str) -> Optional[str]:
    """Extract a Jira ticket key (e.g. QA-102) from a chat message."""
    match = re.search(r"[A-Z]+-\d+", text)
    return match.group(0) if match else None
