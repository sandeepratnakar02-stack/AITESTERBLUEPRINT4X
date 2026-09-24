import { formatMs } from '../lib/api.js'

/** Horizontal view of each ingestion stage with its measured cost. */
export default function PipelineStepper({ timeline, totalMs }) {
  if (!timeline?.length) return null
  const max = Math.max(...timeline.map((step) => step.ms), 1)

  return (
    <div className="stack">
      <div className="between">
        <p className="section-title" style={{ margin: 0 }}>Pipeline stages</p>
        <span className="small muted">
          total <b className="mono">{formatMs(totalMs)}</b>
        </span>
      </div>
      <div className="stepper">
        {timeline.map((step) => (
          <div className="step" key={step.stage}>
            <div className="step-label">{step.label}</div>
            <div className="step-ms">{formatMs(step.ms)}</div>
            <div className="step-bar">
              <i style={{ width: `${Math.max(3, (step.ms / max) * 100)}%` }} />
            </div>
            <div className="tiny muted">{step.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
