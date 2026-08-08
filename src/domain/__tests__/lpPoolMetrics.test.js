import { describe, expect, it } from 'vitest'
import { lpPoolCoverageMetrics } from '../market-data/lpPoolMetrics.js'

describe('lpPoolCoverageMetrics', () => {
  it('derives real pool coverage ratios from aggregate snapshot values', () => {
    const metrics = lpPoolCoverageMetrics({
      reserveUsd: 200,
      volumeUsd24h: 50,
      topPoolReserveShare: 0.4,
    })

    expect(metrics.reserveUsd).toBe(200)
    expect(metrics.volumeUsd24h).toBe(50)
    expect(metrics.turnover24h).toBe(0.25)
    expect(metrics.topReserveShare).toBe(0.4)
  })

  it('keeps unsupported flow metrics empty when real pool coverage is missing', () => {
    const metrics = lpPoolCoverageMetrics({})

    expect(metrics.turnover24h).toBeNull()
    expect(metrics.topReserveShare).toBeNull()
  })
})
