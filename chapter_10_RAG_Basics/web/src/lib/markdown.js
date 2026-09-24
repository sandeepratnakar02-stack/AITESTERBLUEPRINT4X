import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

const CITATION = /\[C(\d+)\]/g

/**
 * Render a Groq answer as safe HTML.
 *
 * The model is instructed to cite context blocks as [C1]; after sanitising we turn each marker into
 * a <button class="cite"> so the chat panel can open the underlying chunk on click.
 */
export function renderMarkdown(text) {
  const raw = marked.parse(text || '')
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
  return clean.replace(CITATION, (_match, number) => `<button class="cite" data-cite="C${number}">C${number}</button>`)
}
