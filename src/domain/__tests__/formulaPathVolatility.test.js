import { describe, expect, it } from 'vitest'
import { deriveFormulaPathLpResearchRange } from '../market-data/formulaPathLpResearchRange.js'
import { resolveFormulaPathVolatility, rollingAnnualVol } from '../market-data/formulaPathVolatility.js'

function flatRows(count, close = 10) {
  return Array.from({ length: count }, (_, index) => ({ date: `session-${index}`, close }))
}

describe('formula path zero-volatility gate', () => {
  it('区分样本齐全的零波动和真正缺输入', () => {
    const rows = flatRows(9)
    expect(rollingAnnualVol(rows, 8, 242, 9)).toBe(0)
    expect(resolveFormulaPathVolatility({ rows, index: 8, tradingDaysPerYear: 242, volWindow: 9 })).toEqual({
      value: null,
      observedValue: 0,
      source: 'rolling-log-return-volatility',
      status: 'model-gate-failed',
      inputMode: 'real',
      isSynthetic: false,
      missingInputs: [],
      blockedReasons: ['degenerate-volatility'],
    })

    expect(
      resolveFormulaPathVolatility({ rows: rows.slice(0, 4), index: 3, tradingDaysPerYear: 242, volWindow: 9 }),
    ).toMatchObject({ status: 'missing-input', missingInputs: ['realized-volatility'], blockedReasons: [] })
  })

  it('零波动是已观测模型门禁，不能被情景 IV 悄悄覆盖', () => {
    const rows = flatRows(9)
    const result = resolveFormulaPathVolatility({
      rows,
      index: 8,
      tradingDaysPerYear: 242,
      volWindow: 9,
      scenarioIv: 0.3,
    })

    expect(result.status).toBe('model-gate-failed')
    expect(result.value).toBeNull()
    expect(result.blockedReasons).toEqual(['degenerate-volatility'])
  })

  it('LP 研究区间继承 GetDelta 的退化波动门禁，不生成零宽路径', () => {
    const result = deriveFormulaPathLpResearchRange({
      bandAnchor: 10,
      horizon: { modelHorizonSessions: 5 },
      iv: null,
      tradingDaysPerYear: 242,
      deltaAvailability: {
        status: 'model-gate-failed',
        missingInputs: [],
        blockedReasons: ['degenerate-volatility'],
      },
    })

    expect(result).toMatchObject({
      status: 'model-gate-failed',
      available: false,
      lowerPrice: null,
      upperPrice: null,
      missingInputs: [],
      blockedReasons: ['degenerate-volatility'],
    })
  })
})
