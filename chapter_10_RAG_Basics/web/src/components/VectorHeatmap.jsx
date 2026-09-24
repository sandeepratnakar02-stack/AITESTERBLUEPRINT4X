/**
 * The "server-side weights", visualised: one cell per dimension of an embedding vector.
 * Cool cells are negative, warm cells positive; brightness scales with magnitude.
 */
function colorFor(value, max) {
  const t = Math.min(1, Math.abs(value) / (max || 1))
  const hue = value >= 0 ? 26 : 212
  const light = 7 + t * 52
  return `hsl(${hue} 88% ${light}%)`
}

export default function VectorHeatmap({ vector, dims = 0, height = 0 }) {
  if (!vector?.length) return <div className="empty">No vector loaded.</div>
  const max = vector.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)

  return (
    <div>
      <div className="heatmap" style={height ? { maxHeight: height, overflow: 'auto' } : undefined}>
        {vector.map((value, index) => (
          <div
            className="heatmap-cell"
            key={index}
            style={{ background: colorFor(value, max) }}
            title={`dim ${index}: ${value}`}
          />
        ))}
      </div>
      <div className="legend">
        <span className="mono">−{max.toFixed(3)}</span>
        <span className="legend-bar" />
        <span className="mono">+{max.toFixed(3)}</span>
        <span style={{ marginLeft: 'auto' }}>
          {dims || vector.length} dimensions · peak |value| {max.toFixed(4)}
        </span>
      </div>
    </div>
  )
}
