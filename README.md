# 🧪 Jira Test Case Generator (RICE-POT)

A Streamlit-powered AI tool that fetches Jira tickets and generates structured test cases using local (Ollama) or cloud (Groq) LLMs, with automatic fallback.

## Project Structure

```
chapter_03_Local_LLM_Code_Generator/
├── app.py                    # Chat screen — ChatGPT-style UI
├── pages/
│   └── settings.py           # Settings screen — Jira/LLM config + connection tests
├── config_store.py           # JSON persistence for credentials & preferences
├── jira_client.py            # Jira REST API client (Cloud)
├── llm_client.py             # LLM abstraction — Ollama ↔ Groq fallback
├── templates/
│   └── TestGen.md            # Test case generation template
├── src/
│   ├── .env                  # Credentials (gitignored)
│   ├── Fine_Tuned_Prompt.md  # Original spec
│   ├── Prompt.md             # Combined prompt placeholder
│   └── plan.md               # Implementation plan
├── requirements.txt          # Python dependencies
└── .gitignore                # Excludes config.json, .env, __pycache__
```

## Features

| Feature | Description |
|---|---|
| **Chat UI** | ChatGPT-style interface — type `create test cases for JIRA-123` |
| **Settings Page** | Configure Jira URL/email/token, choose Ollama or Groq |
| **Connection Tests** | 🔍 Test Jira, Ollama, and Groq connections live in Settings |
| **Jira Integration** | Fetches ticket summary, description, acceptance criteria via REST API |
| **Dual LLM** | Ollama (`gemma`) primary → Groq (`llama-3.3-70b-versatile`) fallback |
| **Provider Badge** | Shows which LLM generated the response (🖥️ Ollama / ☁️ Groq) |
| **Credential Safety** | All secrets in `.env` (bootstrap) → `config.json` (gitignored), nothing hardcoded |

## Quick Start

### Prerequisites

- Python 3.10+
- [Ollama](https://ollama.com) running locally (for local LLM)
- Jira Cloud account with API token
- Groq API key (for cloud fallback)

### Setup

```bash
cd chapter_03_Local_LLM_Code_Generator
pip install -r requirements.txt
```

Place your credentials in `src/.env`:

```env
JIRA__EMAIL=you@example.com
JIRA__URL=https://your-domain.atlassian.net
JIRA_API_TOKEN=your-jira-api-token
OLLAMA_URL=http://localhost:11434
GROQ_API_TOKEN=your-groq-api-key
```

### Run

```bash
streamlit run app.py
```

Then open http://localhost:8501.

### Usage

1. Go to **Settings** → configure Jira credentials & pick LLM provider → **Save**
2. Use the **🔍 Test** buttons to verify connections
3. Switch to **Chat** → type `create test cases for PROJ-123` → **Send**
4. Test cases appear in the chat with a provider badge

## Data Flow

```
Chat message → Parse Jira key → Jira API fetch → Merge into template
    → Ollama (or Groq fallback) → Render test cases in chat
```

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Streamlit (multipage) |
| Jira API | `requests` + Basic Auth |
| Local LLM | Ollama (`gemma`) |
| Cloud LLM | Groq (`llama-3.3-70b-versatile`) |
| Config | `python-dotenv` → JSON |
