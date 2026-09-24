import { formatMs } from '../lib/api.js'

/** Token, latency and (configurable-rate) cost read-out for one Groq call. */
export default function CostPanel({ generation, retrievalMs }) {
  if (!generation) return null
  const { usage, latency_ms, cost_usd, model, pricing, grounded, temperature, max_tokens, context_chars, citations } = generation

  return (
    <div className="stack">
      <div className="cost-grid">
        <div className="cost">
          <div className="k">Prompt tokens</div>
          <div className="v">{usage?.prompt_tokens ?? '—'}</div>
        </div>
        <div className="cost">
          <div className="k">Completion</div>
          <div className="v">{usage?.completion_tokens ?? '—'}</div>
        </div>
        <div className="cost">
          <div className="k">Total tokens</div>
          <div className="v">{usage?.total_tokens ?? '—'}</div>
        </div>
        <div className="cost">
          <div className="k">LLM latency</div>
          <div className="v">{formatMs(latency_ms)}</div>
        </div>
        <div className="cost">
          <div className="k">Retrieval</div>
          <div className="v">{formatMs(retrievalMs)}</div>
        </div>
        <div className="cost">
          <div className="k">Context</div>
          <div className="v">{context_chars?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="cost">
          <div className="k">Est. cost</div>
          <div className="v">${(cost_usd ?? 0).toFixed(6)}</div>
        </div>
      </div>

      <div className="tiny muted">
        <span className="mono">{model}</span> · temp {temperature} · max {max_tokens} tokens · rates $
        {pricing?.in_per_mtok}/1M in, ${pricing?.out_per_mtok}/1M out (<i>edit GROQ_PRICE_* in .env — verify current Groq rates</i>) ·{' '}
        {citations?.length ? `${citations.length} citation(s)` : 'no citations emitted'} ·{' '}
        <span style={{ color: grounded ? 'var(--ok)' : 'var(--warn)' }}>
          {grounded ? 'grounded in context' : 'refused / ungrounded'}
        </span>
      </div>
    </div>
  )
}
