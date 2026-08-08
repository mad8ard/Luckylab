import { describe, expect, it } from 'vitest'
import { SERIES_META, fallbackValue, groupIndicators } from '../mainChartLegendMeta.js'

describe('SERIES_META', () => {
  it('包含全部 24 个 series key 且每个都含 title/color/unit/group', () => {
    const keys = Object.keys(SERIES_META)
    expect(keys).toHaveLength(24)
    for (const k of keys) {
      const meta = SERIES_META[k]
      expect(typeof meta.title).toBe('string')
      expect(typeof meta.color).toBe('string')
      expect(['price', 'pct', 'ratio', 'num']).toContain(meta.unit)
      expect(['price', 'greeks', 'lp', 'carry', 'kdj', 'rsi', 'equity']).toContain(meta.group)
    }
  })
})

describe('fallbackValue', () => {
  const ctx = {
    formulaPath: [
      { costAnchor: 100, costUpper: 102, costLower: 98, deltaUpper: 105, deltaLower: 95,
        lpLowerPrice: 90, lpUpperPrice: 110, lpRealPrice: 100,
        optionDelta: 0.5, optionGamma: 0.02, optionThetaDaily: -0.1,
        lpNormalizedDelta: 0.3, lpValue: 1000, lpRealDivergence: 0.01, capitalEfficiency: 1.5,
        fundingProxy: 0.0001, netCarry: 0.0008 },
      { lpPoolTurnover24h: 0.25, lpPoolTopReserveShare: 0.4 },
    ],
    costPath: [{ anchor: 100, upper: 102, lower: 98 }],
    entryPrice: 99,
  }

  it('cost 系列优先用 costPath 兜底', () => {
    expect(fallbackValue('cost', 0, ctx)).toBe(100)
    expect(fallbackValue('costUpper', 0, ctx)).toBe(102)
    expect(fallbackValue('costLower', 0, ctx)).toBe(98)
  })

  it('LP/期权/Funding 系列从 formulaPath 兜底', () => {
    expect(fallbackValue('lpLower', 0, ctx)).toBe(90)
    expect(fallbackValue('lpUpper', 0, ctx)).toBe(110)
    expect(fallbackValue('bsDelta', 0, ctx)).toBe(0.5)
    expect(fallbackValue('netCarry', 0, ctx)).toBe(0.0008)
  })

  it('entry 直接返回 ctx.entryPrice', () => {
    expect(fallbackValue('entry', 0, ctx)).toBe(99)
  })

  it('真实池覆盖指标只在 latest-only 点显示，避免伪造历史曲线值', () => {
    expect(fallbackValue('lpPoolTurnover', 0, ctx)).toBeNull()
    expect(fallbackValue('lpPoolConcentration', 0, ctx)).toBeNull()
    expect(fallbackValue('lpPoolTurnover', 1, ctx)).toBe(0.25)
    expect(fallbackValue('lpPoolConcentration', 1, ctx)).toBe(0.4)
  })

  it('未知 key 返回 null', () => {
    expect(fallbackValue('unknown-key', 0, ctx)).toBeNull()
  })

  it('ctx 缺数据 / idx 越界 时返回 undefined（而非崩溃）', () => {
    expect(fallbackValue('cost', 99, ctx)).toBeUndefined()
    expect(fallbackValue('cost', 0, {})).toBeUndefined()
  })
})

describe('groupIndicators', () => {
  it('按 price/greeks/lp/carry/kdj/rsi/equity 顺序聚合', () => {
    const indicators = [
      { key: 'rsi',     group: 'rsi',    title: 'RSI', color: '#000', unit: 'num',   value: 50 },
      { key: 'cost',    group: 'price',  title: '成本锚', color: '#000', unit: 'price', value: 100 },
      { key: 'bsDelta', group: 'greeks', title: 'Delta', color: '#000', unit: 'num',   value: 0.5 },
    ]
    const out = groupIndicators(indicators)
    expect(out.map((g) => g.group)).toEqual(['price', 'greeks', 'rsi'])
    expect(out[0].items[0].key).toBe('cost')
    expect(out[1].items[0].key).toBe('bsDelta')
    expect(out[2].items[0].key).toBe('rsi')
  })

  it('空 indicators 返回空数组', () => {
    expect(groupIndicators([])).toEqual([])
  })

  it('未知 group 也会进入 buckets，但顺序排在已知 group 后面', () => {
    const out = groupIndicators([
      { key: 'x', group: 'unknown-group', title: 'x', color: '#000', unit: 'num', value: 1 },
      { key: 'y', group: 'price', title: 'y', color: '#000', unit: 'price', value: 100 },
    ])
    // price 在已知 order 中 → 排首位；unknown-group 不在 order 中 → 不进入返回值
    expect(out.map((g) => g.group)).toEqual(['price'])
  })
})
