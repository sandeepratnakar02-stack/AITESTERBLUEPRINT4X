# Chapter 08 — n8n · Screenshot → Jira Bug Reporter (AI Agent)

> A tester uploads a screenshot (+ optional error logs) → an AI **vision** model analyzes it →
> a structured **Bug** is created in your QA project on Jira (with the screenshot attached).

**Workflow file:** `08_Screenshot_To_Bug_Reporter_AIAgent.json` *(import this into n8n)*
**Sibling file:** `01_FetchJIRACreateTCAIAgent_Local_LLM_ollama.json` (local-LLM + Jira-tool agent)

---

## 1. Model research — which (open, near-free) vision model?

You asked for an **open / free** model available through your **Groq** account. Research (Groq docs,
Sept 2026) found:

| Question | Answer |
|---|---|
| Is there a **$0** vision model left on Groq? | **No.** The old free previews (`llama-3.2-11b/90b-vision-preview`) were shut down **2025-04-14**; Llama 4 Scout/Maverick (their multimodal successors) are deprecated too. |
| Cheapest **open** vision model on Groq today? | **`qwen/qwen3.6-27b`** — ~**$0.60 / 1M input**, **$3.00 / 1M output**, 131K context. Vision, tool use + **JSON mode**. Groq lists it as the recommended replacement. |
| Runner-up | `qwen/qwen3.8-27b` ($0.80 / $4.00) — slightly bigger/better, same features. |
| Cost per bug report | A screenshot = **2 048 input tokens** + a short output. **One full bug report costs well under 1 cent.** |
| Vision input format | OpenAI-compatible `POST https://api.groq.com/openai/v1/chat/completions`; images as base64 `data:` URI in `image_url`. |
| JSON mode with images | ✅ `"response_format": {"type":"json_object"}` works with the image input on `qwen3.6-27b`. |
| Limits | 20 MB per request · max 5 images/req · 2 048 tokens per image · (rate limits ~30 RPM / 1K RPD base; Developer plan higher — check `console.groq.com/settings/limits`). |

> ⚠️ **Verify the model ID in your account.** Model IDs drift. After import, open the `Prepare
> Screenshot` Code node → the `GROQ_MODEL` constant (`qwen/qwen3.6-27b`) and confirm that exact ID
> exists under **console.groq.com/models** (or change it to whichever vision model you see there).

**Why an HTTP Request node instead of n8n's Groq Chat Model node?** The n8n **Groq Chat Model node
is text-only** — it cannot see images. The vision call therefore uses an **HTTP Request** node that
posts the base64 screenshot to Groq's OpenAI-compatible endpoint.

---

## 2. Architecture

```
                        ┌────────────────────────────┐
                        │ Form Trigger (upload page)  │  Screenshot (file) + error logs (textarea)
                        └─────────────┬──────────────┘
                                      ▼
                        ┌────────────────────────────┐
                        │ 1_Prepare Screenshot (Code)│  base64, mime, filename, prompt constants
                        └──────┬──────────────┬──────┘
                               │(branch A)    │(branch B: keeps imageB64/fileName…)
                               ▼              │
                        ┌────────────────────┐│
                        │ 2_Groq Vision HTTP  ││
                        └─────────┬──────────┘│
                                  ▼           │
                        ┌────────────────────┐│
                        │ 3_Parse Bug JSON    ││   builds Summary + Jira ADF description
                        └─────────┬──────────┘│
                                  ▼           │
                        ┌────────────────────┐│
                        │ 4_Create Jira Bug   │◄──── returns { key }
                        └─────────┬──────────┘│
                                  ▼           │
                        ┌──────────────────────────────────────┐
                        │ 5_Merge (issue key + screenshot data) │
                        └───────────────────┬──────────────────┘
                                            ▼
                        ┌────────────────────────────────────────┐
                        │ 6_Build Attachment Payload (Code)       │  json {issueKey,issueUrl,message} + binary(data)
                        └────────┬───────────────────────┬────────┘
                                 ▼                       │
                        ┌────────────────────┐           │
                        │ 7_Attach Screenshot │          │
                        └─────────┬──────────┘           │
                                  ▼                       ▼
                        ┌──────────────────────────────────────┐
                        │ 8_Form Result Summary (Merge)          │  shows Bug key + link back on the form
                        └────────────────────────────────────────┘
```

Node summary (all in the `.json`):

| # | Node (type) | Purpose |
|---|---|---|
| 1 | **Screenshot to Bug Form** (`formTrigger`) | Public upload page: image file + optional error-logs box. Responds when the workflow finishes. |
| 2 | **Prepare Screenshot** (`code`) | Grabs the uploaded file → base64/data-URI, mime, filename, error logs; **config constants** live here (`GROQ_MODEL`, `JIRA_BASE_URL`, system prompt). Validates it is an image and ≤19 MB. |
| 3 | **Groq Vision (analyze)** (`httpRequest`) | `POST api.groq.com/openai/v1/chat/completions`, model from config, image as `image_url` data URI, **JSON mode** on, temp 0.2. |
| 4 | **Parse Bug JSON** (`code`) | `JSON.parse` the AI answer → clean fields + a Jira **ADF** description (`descriptionAdfJson`) with Visual details / Steps to reproduce / Expected vs Actual / logs. |
| 5 | **Create Jira Bug** (`jira`) | Create **Issue** in your QA project (project + Bug issue-type are dropdowns you select), Summary + ADF Description from step 4. |
| 6 | **Merge (key + screenshot)** (`merge`) | Combines the created issue `key` with the screenshot metadata (branch B) so the image survives. |
| 7 | **Build Attachment Payload** (`code`) | Outputs `{ issueKey, issueUrl, message }` **and** a binary property rebuilt from the stored base64. |
| 8 | **Attach Screenshot to Bug** (`jira`) | `Issue Attachment → Add attachment` → uploads the original screenshot onto the created Bug. |
| 9 | **Form Result Summary** (`merge`) | Joins the attachment result + the payload → the tester sees **“Bug created in Jira: QA-123” + link** on the form. |

---

## 3. Prerequisites / credentials

1. **n8n** (Cloud, Desktop, or self-hosted — recent version; the workflow targets current node schemas).
2. **Groq** — a **Header Auth** credential:
   - n8n → *Credentials → New → Header Auth*
   - Name: `Groq Header Auth`
   - **Name:** `Authorization` · **Value:** `Bearer <your-Groq-API-key>`
   - (Alternative: in the HTTP node, switch “Credential Type” to the **Groq API** predefined credential if your n8n lists it.)
3. **Jira Software Cloud** credential (email + API token). You already have one from `01_FetchJIRA…` — reuse the same **Jira SW Cloud** credential.
4. A **QA project** in Jira that allows **Bug** issue type (and attachments enabled).

---

## 4. Import & configure (after importing the JSON)

1. **Import:** n8n → *Workflows → ⋯ → Import from File* → pick `08_Screenshot_To_Bug_Reporter_AIAgent.json`.
2. **Credentials:** click the red/amber nodes and pick:
   - `Groq Vision (analyze)` → your **Groq Header Auth** credential.
   - `Create Jira Bug` and `Attach Screenshot to Bug` → your **Jira SW Cloud** credential.
3. **Jira project + Bug type** (`Create Jira Bug` node):
   - **Project** dropdown → choose your QA project.
   - **Issue Type** dropdown → choose **Bug**.
   - (Replace the `REPLACE_WITH_…` placeholders that the import kept.)
4. **Jira base URL** (`Prepare Screenshot` Code node → `JIRA_BASE_URL`): set `https://<your-domain>.atlassian.net` so the “browse” link on the form is correct.
5. **Model** (`Prepare Screenshot` Code node → `GROQ_MODEL`): keep `qwen/qwen3.6-27b` once you confirm it in your Groq console.
6. **Form URL:** open the workflow → *Test workflow* (fills the form in a pop-up) or *Publish* and copy the **Production Form URL** to send to testers.

---

## 5. How to test end-to-end

1. Activate/execute the Form trigger → open the form URL.
2. Upload a real screenshot (PNG/JPG) — optionally paste an error log.
3. Submit and watch the pipeline:
   - `Groq Vision` returns JSON with `summary`, `severity`, `visualDetails`, `stepsToReproduce`, …
   - `Create Jira Bug` → a Bug is created in your QA project.
   - `Attach Screenshot to Bug` → the original image is on the issue.
   - The form shows **Bug created in Jira: <KEY>** with a link.
4. Open the issue in Jira → verify the description sections (Environment / Visual details / Steps to reproduce / Expected / Actual / Error logs) and the attachment.

**Negative cases**
- Non-image file / no file → clear error message.
- Image > ~19 MB → clear “too large” error (Groq limit is 20 MB).
- AI returns non-JSON → `Parse Bug JSON` errors with the first 300 chars of the answer (retry; or lower `temperature`).

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| “Model not found” (400) | `GROQ_MODEL` id is not in your Groq account. Check console.groq.com/models and update the constant in `Prepare Screenshot`. |
| HTTP node 401 | Header Auth credential not selected, or header value not `Bearer <key>`. |
| Jira “credential” red | Pick your Jira SW Cloud credential on both Jira nodes. |
| Create fails “project/issueType” | In `Create Jira Bug` re-pick **Project** and **Issue Type** from the live dropdowns (placeholder IDs don’t exist in your Jira). |
| Description not filled / ADF error | Description is already sent as valid **ADF** JSON (built in `Parse Bug JSON`). If your Jira variant rejects it, open the Create node → Description and switch its mode, or convert the field to plain text there. |
| Attachment missing | The merge + rebuild steps preserve the image. If `Merge`/order differs after you edit, keep `Prepare Screenshot` fan-out feeding both `Groq Vision` **and** `Merge (key + screenshot)`. |
| Form shows raw JSON | That is normal with “Respond when: Workflow finishes”. For a prettier page, set the Form Trigger’s response, or end with a short HTML note. |
| Runs fine but slow to answer | Vision images = 2 048 tokens each; qwen3.6-27b is fast (~500 t/s). |
| Multi-bug in one go | Currently 1 issue per submission. Loop over `Form Result Summary` items if you enable multiple files later. |

---

## 7. Cost & notes

- Open-source model, near-free: **< 1¢ per bug** at `qwen/qwen3.6-27b` ($0.60/$3.00 per 1M tokens).
- Anti-hallucination: the system prompt instructs the model to describe **only what is visible** and to quote on-screen error text verbatim. Verify AI wording before sending issues you care about (optional: add a human “approve” step later).
- Want truly **$0 / offline**? Swap the Groq HTTP node for the pattern in `01_FetchJIRACreateTCAIAgent_Local_LLM_ollama.json` using a **local Ollama vision model** (e.g., `qwen2.5vl`, `llama3.2-vision`, `minicpm-v`) — same image→base64→prompt flow.

---

## 8. Optional next steps

- Add a Jira **priority** mapping + **labels** (e.g., `from-screenshot`).
- Add a **review gate** (human approves the drafted bug before creation).
- Store the raw screenshot in S3/Supabase and link it, instead of attaching.
- Auto-log the Groq output to an **n8n Data table / Google Sheets** for auditing.
