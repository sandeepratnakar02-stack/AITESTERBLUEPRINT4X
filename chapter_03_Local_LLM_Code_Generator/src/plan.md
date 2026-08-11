# RICE-POT Jira Test Case Generator — Implementation Plan

## Credentials (from `.env`)

| Variable | Value |
|---|---|
| `JIRA__EMAIL` | `sandeep.ratnakar02@gmail.com` |
| `JIRA__URL` | `https://sandeepratnakar.atlassian.net` |
| `JIRA_API_TOKEN` | `ATATT3xFfGF0qC79...` (provided) |
| `OLLAMA_URL` | `http://localhost:11434` |
| `GROQ_API_TOKEN` | `gsk_0SfkGHNNkY9e...` (provided) |

---

## 1. Proposed File Structure

```
chapter_03_Local_LLM_Code_Generator/
├── app.py                    # Main Streamlit entry — Chat screen (Screen 1)
├── config_store.py           # Persisted settings (JSON file): Jira creds, provider, Groq key
├── jira_client.py            # Jira REST API client — fetches ticket summary/description/acceptance criteria
├── llm_client.py             # LLM abstraction: Ollama primary, Groq fallback
├── settings_page.py          # Streamlit multipage — Settings screen (Screen 2)
├── templates/
│   └── TestGen.md            # Test case template (already exists)
├── src/
│   ├── .env                  # Credentials (already exists — read at startup)
│   ├── Fine_Tuned_Prompt.md  # Spec (already exists)
│   └── Prompt.md             # Combined prompt placeholder (already exists, empty)
├── requirements.txt          # streamlit, requests, groq, python-dotenv
└── plan.md                   # This file
```

> **Note:** Streamlit multipage uses `pages/` folder by default. I will use a single `app.py` with a sidebar radio to switch between Chat and Settings to keep it simpler (two screens, one file + supporting modules). Alternatively, use `app.py` + `pages/settings.py` per Streamlit convention — decided below.

**Final decision:** Use **`app.py` (Chat)** + **`pages/settings.py` (Settings)** following Streamlit's native multipage convention. This auto-creates a sidebar nav.

---

## 2. Two Screens — Description

### Screen 1: Chat (`app.py`)
- **ChatGPT-style UI**: scrollable message history, text input at bottom, Send button.
- Each message rendered as a chat bubble (user / assistant).
- User types e.g. `create test cases for QA-102` → hits Send.
- App:
  1. Parses Jira key (`QA-102`) from message.
  2. Calls `jira_client.fetch_ticket(key)`.
  3. Loads `templates/TestGen.md`.
  4. Merges ticket fields into prompt.
  5. Calls `llm_client.generate(prompt)` — Ollama first, Groq fallback.
  6. Streams/stores the response back into chat.
- Error handling: displays user-friendly messages if Jira not reachable, LLM down, etc.

### Screen 2: Settings (`pages/settings.py`)
- Form fields:
  - Jira Base URL (text input)
  - Jira Email (text input)
  - Jira API Token (password input)
  - LLM Provider (radio: `Ollama` / `Groq`)
  - Groq API Key (password input, shown only when Groq selected)
- Save button → persists to `config.json` via `config_store.py`.
- On load, pre-fill from existing `config.json`.

---

## 3. Data Flow

```
┌──────────────┐     ┌───────────────┐     ┌───────────────┐
│   app.py     │────▶│ jira_client.py │────▶│  Jira REST    │
│  (Chat UI)   │     │ fetch_ticket() │     │  API (Cloud)  │
└──────┬───────┘     └───────┬───────┘     └───────────────┘
       │                     │
       │  ticket JSON        │
       ▼                     ▼
┌──────────────┐     ┌───────────────┐
│ templates/   │────▶│  llm_client   │
│ TestGen.md   │     │  .generate()  │
└──────────────┘     └───┬───────┬───┘
                          │       │
                    Ollama│       │Groq
                  primary │       │fallback
                          ▼       ▼
                    ┌─────────────────┐
                    │  Chat Response  │
                    │  (test cases)   │
                    └─────────────────┘

┌──────────────────┐     ┌───────────────┐
│ pages/settings.py│────▶│ config_store  │
│  (Settings UI)   │     │ (config.json) │
└──────────────────┘     └───────────────┘
```

### Detailed flow for "create test cases for QA-102":

1. **Parse** → regex extract `QA-102` from chat message.
2. **Jira Fetch** → `GET /rest/api/3/issue/QA-102` with Basic Auth (email + API token).
   - Extract: `summary`, `description` (ADF → plain text), `customfield_*` for acceptance criteria if present.
3. **Load Template** → read `templates/TestGen.md`, replace `[PASTE REQUIREMENTS HERE]` with ticket content, `[NUMBER]` with a reasonable default (e.g., 5), `[FEATURE]` with ticket summary.
4. **LLM Generate** → `llm_client.generate(merged_prompt)`:
   - Try Ollama (`POST http://localhost:11434/api/generate`, model `gemma`).
   - If timeout/error → try Groq (`groq` SDK, model `llama3-70b-8192` or `mixtral-8x7b-32768`).
   - Return the generated text.
5. **Render** → display the test cases table in the chat pane.

---

## 4. Step-by-Step Build Order

| Step | Module | What It Does | Depends On |
|------|--------|-------------|------------|
| **1** | `requirements.txt` | List all dependencies: `streamlit`, `requests`, `groq`, `python-dotenv` | — |
| **2** | `config_store.py` | Read/write `config.json`. Functions: `load_config()`, `save_config(data)`. Keys: `jira_url`, `jira_email`, `jira_token`, `provider`, `groq_key`. On first run, seeds from `.env` if no `config.json` exists. | — |
| **3** | `jira_client.py` | `fetch_ticket(ticket_key)` → returns dict `{summary, description, acceptance_criteria}`. Uses `requests` with Basic Auth. Converts ADF to plain text. | `config_store` |
| **4** | `llm_client.py` | `generate(prompt)` → returns `str`. Tries Ollama first (`/api/generate`), falls back to Groq (`groq` SDK). Both calls use streaming internally, but return consolidated string. | `config_store` |
| **5** | `pages/settings.py` | Streamlit form for all 5 settings. Saves via `config_store.save_config()`. Pre-fills from `config_store.load_config()`. | `config_store` |
| **6** | `app.py` | Chat UI with `st.session_state.messages`. On Send: parse Jira key → fetch ticket → load template → call LLM → render response. Shows spinners during processing. | `jira_client`, `llm_client`, `config_store` |
| **7** | Integration test | Run `streamlit run app.py`, verify: Chat → Settings → Save → Chat → "create test cases for QA-102" → response. | All above |

---

## 5. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Streamlit multipage** (`pages/settings.py`) | Native convention, auto sidebar, no custom routing needed. |
| **`config.json` for persistence** | Simpler than SQLite, excluded via `.gitignore`, JSON is human-readable. |
| **Seed from `.env` on first run** | No hardcoded creds in source; `.env` is development bootstrap only. |
| **Ollama model: `gemma`** | As specified in prompt; already running locally. |
| **Groq model: `llama3-70b-8192`** | Good balance of quality/speed on Groq; free tier compatible. |
| **ADF → plain text conversion** | Jira Cloud returns description in Atlassian Document Format (JSON); must strip to plain text for the LLM prompt. |
| **No async, no streaming to UI initially** | Keep simple; can enhance later. |

---

## 6. Ready to Build

All credentials are available. The template (`TestGen.md`) and anti-hallucination rules exist. The source folder has the `.env` file. **Ready to execute Step 1 on your approval.**

> **Your approval requested.** Reply "approved" or "go ahead" and I will build module by module in the order above.
