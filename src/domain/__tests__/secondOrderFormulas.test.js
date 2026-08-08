import { describe, expect, it } from 'vitest'
import { deriveDynamicHoldingState, gammaPnl, meanReversionHalfLife, volConfidence } from '../formulas/core.js'

describe('deriveDynamicHoldingState second-order regressions', () => {
  const repairDrawdown = {
    status: 'ok',
    drawdownDepth: -0.22,
    drawdownSpeed5: 0.002,
    drawdownSpeed20: 0.04,
    drawdownRepair: 0.22,
    drawdownAge: { peakDays: 58, troughDays: 6 },
  }

  it('站上成本锚后保留 post-anchor-extension，而不是误报数据不足', () => {
    const state = deriveDynamicHoldingState({
      zScore: 0.8,
      halfLifeDays: 12,
      entryPrice: 101,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
    })

    expect(state.status).toBe('等待')
    expect(state.phase).toBe('post-anchor-extension')
    expect(state.state.drawdown).toBe(repairDrawdown)
    expect(state.blockedReasons).toContain('post-anchor-extension')
    expect(state.blockedReasons).not.toContain('insufficient-history')
    expect(state.holdingPlan.shortTrade.expectedReturnPct).toBeNull()
    expect(state.expectation.stretchReturnPct).toBeNull()
  })

  it('低位压缩阶段不再把现价下方的 costLower 当作修复目标', () => {
    const state = deriveDynamicHoldingState({
      zScore: -2.2,
      halfLifeDays: 2,
      entryPrice: 99,
      anchorPrice: 100,
      targetPrices: { costLower: 98, anchor: 100, lpUpper: 103 },
      drawdown: { ...repairDrawdown, drawdownRepair: 0.1 },
      profiles: { shortTrade: { minGrossReturn: 0.005 } },
    })

    expect(state.phase).toBe('low-compression')
    expect(state.holdingPlan.shortTrade.status).toBe('观察')
    expect(state.holdingPlan.shortTrade.targetId).toBe('baseAnchor')
    expect(state.holdingPlan.shortTrade.expectedReturnPct).toBeGreaterThan(0)
    expect(state.expectation.baseReturnPct).toBe('0.88%')
  })
})

describe('meanReversionHalfLife', () => {
  it('返回未裁剪的 AR(1) rho 与正确半衰期', () => {
    const result = meanReversionHalfLife({ costDistanceSeries: [1, 0.5, 0.25, 0.125, 0.0625] })

    expect(result.rho).toBeCloseTo(0.5, 8)
    expect(result.theta).toBeCloseTo(Math.log(2), 8)
    expect(result.halfLifeDays).toBeCloseTo(1, 8)
    expect(result.isMeanReverting).toBe(true)
    expect(result.decayMode).toBe('monotonic-decay')
  })

  it('对 |rho| >= 1 的非平稳序列不伪造半衰期', () => {
    const result = meanReversionHalfLife({ costDistanceSeries: [1, 1.1, 1.21, 1.331, 1.4641] })

    expect(result.rho).toBeCloseTo(1.1, 8)
    expect(result.isMeanReverting).toBe(false)
    expect(result.halfLifeDays).toBeNull()
    expect(result.speed).toBe('无回归')
  })
})

describe('gammaPnl', () => {
  it('区分持仓 Gamma、Dollar Gamma 与绝对价格情景 PnL', () => {
    const result = gammaPnl({ gamma: 0.02, markPrice: 100, priceChange: 5, positionSize: 10 })

    expect(result.positionGamma).toBeCloseTo(0.2, 8)
    expect(result.dollarGamma).toBeCloseTo(2000, 8)
    expect(result.priceChangePct).toBeCloseTo(0.05, 8)
    expect(result.gammaPnl).toBeCloseTo(2.5, 8)
    expect(result.gammaPnl).toBeCloseTo(0.5 * result.dollarGamma * result.priceChangePct ** 2, 8)
  })

  it('未给标的价格时不把持仓 Gamma 冒充 Dollar Gamma', () => {
    const result = gammaPnl({ gamma: 0.02, priceChange: 5, positionSize: 10 })

    expect(result.positionGamma).toBeCloseTo(0.2, 8)
    expect(result.dollarGamma).toBeNull()
    expect(result.gammaPnl).toBeCloseTo(2.5, 8)
  })
})

describe('volConfidence', () => {
  it('按任意置信水平计算双侧 z 临界值和标准误', () => {
    const result = volConfidence({ annualVol: 0.4, sampleSize: 120, confidenceLevel: 0.95 })

    expect(result.se).toBeCloseTo(0.4 / Math.sqrt(240), 8)
    expect(result.zScore).toBeCloseTo(1.96, 2)
    expect(result.lower).toBeCloseTo(result.annualVol - result.zScore * result.se, 8)
    expect(result.upper).toBeCloseTo(result.annualVol + result.zScore * result.se, 8)
    expect(result.quality).toBe('高精度')
  })

  it('精度标签随样本量变化，不再恒为高精度', () => {
    expect(volConfidence({ annualVol: 0.4, sampleSize: 20 }).quality).toBe('中精度')
    expect(volConfidence({ annualVol: 0.4, sampleSize: 5 }).quality).toBe('不可靠')
  })
})
