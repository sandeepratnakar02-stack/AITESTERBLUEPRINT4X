import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

// The agent answers in Markdown (headings, tables, blockquotes) - render it.
export function renderMarkdown(text) {
  const html = marked.parse(String(text ?? ''), { async: false })
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
