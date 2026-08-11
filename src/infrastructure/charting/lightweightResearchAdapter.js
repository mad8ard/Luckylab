export function toLightweightPathLineSegments(rows, path, field) {
  const valuesByDate = new Map()
  for (const point of Array.isArray(path) ? path : []) {
    const time = point?.date ?? point?.time
    if (typeof time !== 'string' || !time) continue
    valuesByDate.set(time, point?.[field])
  }

  return toLightweightLineSegments(
    rows,
    (Array.isArray(rows) ? rows : []).map((row) => valuesByDate.get(row?.date)),
  )
}

export function toLightweightLineSegments(rows, values) {
  if (!Array.isArray(rows)) return []
  const segments = []
  let current = []

  for (let index = 0; index < rows.length; index += 1) {
    const time = rows[index]?.date
    const value = values?.[index]
    if (typeof time === 'string' && time && Number.isFinite(value)) {
      current.push({ time, value })
      continue
    }
    if (current.length) segments.push(current)
    current = []
  }

  if (current.length) segments.push(current)
  return segments
}
