import { describe, expect, it } from 'vitest'
import { buildLpV3Bounds, buildLpV3Curve } from '../formulaChartGeometry.js'

const layout = { PL: 10, PT: 20, PB: 20, pw: 200 }
const graph = {
  inputs: { entryPrice: 100 },
  rangeV3Il: { lowerPrice: 90, upperPrice: 110 },
}

describe('LP formula chart geometry', () => {
  it('does not invent a default range or liquidity when no LP scenario is declared', () => {
    const researchInputs = { lpValuationMode: 'missing-input', liquidity: 1 }

    expect(buildLpV3Curve({ market: { markPrice: 100 }, graph, researchInputs, layout })).toBe('')
    expect(buildLpV3Bounds({ market: { markPrice: 100 }, graph, researchInputs, layout })).toBeNull()
  })

  it('renders only the declared LP scenario shape', () => {
    const researchInputs = { lpValuationMode: 'explicit-scenario', liquidity: 2 }

    expect(buildLpV3Curve({ market: { markPrice: 100 }, graph, researchInputs, layout })).not.toBe('')
    const bounds = buildLpV3Bounds({ market: { markPrice: 100 }, graph, researchInputs, layout })
    expect(bounds.loX).toBeCloseTo(63.33333333333333, 12)
    expect(bounds.hiX).toBe(90)
  })
})
