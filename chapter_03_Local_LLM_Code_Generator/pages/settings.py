"""
Settings screen — configure Jira credentials and LLM provider.
Includes connection test buttons for Jira, Ollama, and Groq.
"""
import base64

import requests
import streamlit as st

from config_store import load_config, save_config

st.set_page_config(page_title="Settings", page_icon="⚙️")
st.title("⚙️ Settings")

cfg = load_config()

# --- Store test results in session state so they survive reruns ---
if "test_results" not in st.session_state:
    st.session_state.test_results = {}


def test_jira(url: str, email: str, token: str) -> tuple[bool, str]:
    """Try to reach the Jira REST API."""
    if not url or not email or not token:
        return False, "Missing credentials — fill in all Jira fields."
    try:
        auth = base64.b64encode(f"{email}:{token}".encode()).decode()
        resp = requests.get(
            f"{url.rstrip('/')}/rest/api/3/myself",
            headers={"Authorization": f"Basic {auth}"},
            timeout=10,
        )
        if resp.status_code == 200:
            name = resp.json().get("displayName", "unknown")
            return True, f"Connected as **{name}**"
        elif resp.status_code == 401:
            return False, "Authentication failed — check email/token."
        else:
            return False, f"HTTP {resp.status_code}: {resp.text[:120]}"
    except requests.exceptions.ConnectionError:
        return False, "Cannot reach Jira — check the URL."
    except Exception as e:
        return False, str(e)


def test_ollama(url: str, model: str) -> tuple[bool, str]:
    """Try to reach the local Ollama server."""
    if not url:
        return False, "Ollama URL is empty."
    try:
        resp = requests.get(f"{url.rstrip('/')}/api/tags", timeout=5)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            model_found = any(model in m for m in models)
            models_str = ", ".join(models[:5])
            if model_found:
                return True, f"Ollama reachable. Model **{model}** found. Available: {models_str}"
            else:
                return True, f"Ollama reachable, but model **{model}** not found. Available: {models_str}"
        return False, f"HTTP {resp.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "Cannot reach Ollama — is it running?"
    except Exception as e:
        return False, str(e)


def test_groq(api_key: str) -> tuple[bool, str]:
    """Try a minimal Groq chat completion."""
    if not api_key:
        return False, "Groq API key is empty."
    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": "Say OK"}],
            max_tokens=5,
        )
        return True, "Groq API key works — chat completion succeeded."
    except Exception as e:
        return False, str(e)


# ============================================================
#  FORM: settings fields + action buttons
# ============================================================
with st.form("settings_form"):
    st.subheader("🔌 Jira Connection")
    c1, c2 = st.columns([3, 1])
    with c1:
        jira_url = st.text_input("Jira Base URL", value=cfg.get("jira_url", ""),
                                 placeholder="https://your-domain.atlassian.net",
                                 key="jira_url")
        jira_email = st.text_input("Jira Email", value=cfg.get("jira_email", ""),
                                   placeholder="you@example.com", key="jira_email")
        jira_token = st.text_input("Jira API Token", value=cfg.get("jira_token", ""),
                                   type="password", key="jira_token")
    with c2:
        st.write("")  # spacer
        st.write("")
        test_jira_btn = st.form_submit_button("🔍 Test Jira", type="secondary")

    st.subheader("🤖 LLM Provider")
    provider = st.radio("Select Provider",
                        options=["ollama", "groq"],
                        index=0 if cfg.get("provider", "ollama") == "ollama" else 1,
                        format_func=lambda x: f"🖥️ Ollama (local)" if x == "ollama" else "☁️ Groq (cloud)",
                        key="provider_radio")

    groq_key = ""
    if provider == "groq":
        groq_key = st.text_input("Groq API Key", value=cfg.get("groq_key", ""),
                                 type="password", placeholder="gsk_...", key="groq_key")

    st.subheader("🦙 Ollama")
    oc1, oc2 = st.columns([3, 1])
    with oc1:
        ollama_url = st.text_input("Ollama URL", value=cfg.get("ollama_url", "http://localhost:11434"),
                                   key="ollama_url")
        ollama_model = st.text_input("Model", value=cfg.get("ollama_model", "gemma"),
                                     key="ollama_model")
    with oc2:
        st.write("")
        test_ollama_btn = st.form_submit_button("🔍 Test Ollama", type="secondary")

    st.subheader("☁️ Groq")
    gc1, gc2 = st.columns([3, 1])
    with gc1:
        if provider != "groq":
            groq_key_display = st.text_input("Groq API Key", value=cfg.get("groq_key", ""),
                                             type="password", placeholder="gsk_...", key="groq_key_display")
        else:
            groq_key_display = groq_key  # already captured above
    with gc2:
        st.write("")
        test_groq_btn = st.form_submit_button("🔍 Test Groq", type="secondary")

    st.markdown("---")
    save_btn = st.form_submit_button("💾 Save Settings", type="primary")

# ============================================================
#  Handle form actions
# ============================================================
effective_groq_key = groq_key if provider == "groq" else cfg.get("groq_key", "")

if test_jira_btn:
    with st.spinner("Testing Jira connection..."):
        ok, msg = test_jira(jira_url, jira_email, jira_token)
        st.session_state.test_results["jira"] = (ok, msg)

if test_ollama_btn:
    with st.spinner("Testing Ollama connection..."):
        ok, msg = test_ollama(ollama_url, ollama_model)
        st.session_state.test_results["ollama"] = (ok, msg)

if test_groq_btn:
    key_to_test = groq_key_display if provider != "groq" else groq_key
    with st.spinner("Testing Groq connection..."):
        ok, msg = test_groq(key_to_test)
        st.session_state.test_results["groq"] = (ok, msg)

if save_btn:
    new_cfg = {
        "jira_url": jira_url.strip().rstrip("/"),
        "jira_email": jira_email.strip(),
        "jira_token": jira_token.strip(),
        "provider": provider,
        "groq_key": effective_groq_key.strip() if provider == "groq" else cfg.get("groq_key", ""),
        "ollama_url": ollama_url.strip().rstrip("/"),
        "ollama_model": ollama_model.strip(),
    }
    # Preserve groq_key if not in groq mode
    if provider != "groq":
        new_cfg["groq_key"] = cfg.get("groq_key", "")
    save_config(new_cfg)
    st.success("✅ Settings saved! Switch to the Chat tab to start.")
    st.rerun()

# ============================================================
#  Display test results (outside form, survives reruns)
# ============================================================
if st.session_state.test_results:
    st.divider()
    st.subheader("🔍 Connection Test Results")
    for svc, (ok, msg) in st.session_state.test_results.items():
        icon = "✅" if ok else "❌"
        st.markdown(f"{icon} **{svc.upper()}**: {msg}")

# Show current status
st.divider()
st.caption(f"Provider: **{cfg.get('provider', 'ollama').upper()}** | "
           f"Jira: {'✅ Configured' if cfg.get('jira_token') else '❌ Not configured'} | "
           f"Ollama: {'✅ Configured' if cfg.get('ollama_url') else '❌ Not configured'} | "
           f"Groq: {'✅ Configured' if cfg.get('groq_key') else '❌ Not configured'}")
