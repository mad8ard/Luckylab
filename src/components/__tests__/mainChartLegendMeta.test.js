import { describe, expect, it } from 'vitest'
import {
  SERIES_META,
  fallbackValue,
  groupIndicators,
  latestFinitePathPoint,
  resolvePreferredPathValues,
} from '../mainChartLegendMeta.js'

describe('SERIES_META', () => {
  it('包含全部 27 个 series key 且每个都含 title/color/unit/group', () => {
    const keys = Object.keys(SERIES_META)
    expect(keys).toHaveLength(27)
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
    rows: [{ close: 98 }, { close: 101 }],
    formulaPath: [
      {
        costAnchor: 100,
        costUpper: 102,
        costLower: 98,
        deltaUpper: 105,
        deltaLower: 95,
        lpLowerPrice: 90,
        lpUpperPrice: 110,
        lpRealPrice: 100,
        optionDelta: 0.5,
        optionGamma: 0.02,
        optionThetaPerSession: -0.1,
        lpNormalizedDelta: 0.3,
        lpValue: 1000,
        lpRealDivergence: 0.01,
        capitalEfficiency: 1.5,
        cumulativeFundingProxy: 0.0001,
        netCarry: 0.0008,
      },
      { lpPoolTurnover24h: 0.25, lpPoolTopReserveShare: 0.4 },
    ],
    costPath: [{ anchor: 100, upper: 102, lower: 98 }],
    entryPrice: 99,
    position: { targetPrice: 108, stopPrice: 93 },
  }

  it('cost 系列与画线一致：formulaPath 有有限值时整条优先 formulaPath', () => {
    expect(fallbackValue('cost', 0, ctx)).toBe(100)
    expect(fallbackValue('costUpper', 0, ctx)).toBe(102)
    expect(fallbackValue('costLower', 0, ctx)).toBe(98)

    const sparse = {
      formulaPath: [
        { costAnchor: null, costUpper: null, costLower: null },
        { costAnchor: 202, costUpper: 204, costLower: 200 },
      ],
      costPath: [
        { anchor: 100, upper: 102, lower: 98 },
        { anchor: 101, upper: 103, lower: 99 },
      ],
    }
    expect(resolvePreferredPathValues(sparse.formulaPath, 'costAnchor', sparse.costPath, 'anchor')).toEqual([null, 202])
    expect(fallbackValue('cost', 0, sparse)).toBeNull()
    expect(fallbackValue('cost', 1, sparse)).toBe(202)
    expect(fallbackValue('costUpper', 0, sparse)).toBeNull()
    expect(fallbackValue('costUpper', 1, sparse)).toBe(204)
    expect(fallbackValue('costLower', 0, sparse)).toBeNull()
    expect(fallbackValue('costLower', 1, sparse)).toBe(200)
  })

  it('cost 系列仅在 formulaPath 整条无有限值时回退 costPath', () => {
    const emptyFormula = {
      formulaPath: [{ costAnchor: null }, { costAnchor: Number.NaN }],
      costPath: [{ anchor: 100 }, { anchor: 101 }],
    }
    expect(resolvePreferredPathValues(emptyFormula.formulaPath, 'costAnchor', emptyFormula.costPath, 'anchor')).toEqual(
      [100, 101],
    )
    expect(fallbackValue('cost', 0, emptyFormula)).toBe(100)
    expect(fallbackValue('cost', 1, emptyFormula)).toBe(101)
  })

  it('LP/期权/Funding 系列从 formulaPath 兜底', () => {
    expect(fallbackValue('lpLower', 0, ctx)).toBe(90)
    expect(fallbackValue('lpUpper', 0, ctx)).toBe(110)
    expect(fallbackValue('bsDelta', 0, ctx)).toBe(0.5)
    expect(fallbackValue('netCarry', 0, ctx)).toBe(0.0008)
  })

  it('hover fallback 按当前 K 线日期关联 path，不读取同索引的其他日期', () => {
    const dated = {
      rows: [{ date: '2026-08-01' }, { date: '2026-08-02' }, { date: '2026-08-03' }],
      formulaPath: [
        { date: '2026-08-03', deltaUpper: 103, costAnchor: 93 },
        { date: '2026-08-01', deltaUpper: 101, costAnchor: 91 },
      ],
      costPath: [{ date: '2026-08-02', anchor: 92 }],
    }

    expect(fallbackValue('deltaUpper', 0, dated)).toBe(101)
    expect(fallbackValue('deltaUpper', 1, dated)).toBeUndefined()
    expect(fallbackValue('deltaUpper', 2, dated)).toBe(103)
    expect(fallbackValue('cost', 0, dated)).toBe(91)
    expect(fallbackValue('cost', 1, dated)).toBeUndefined()
    expect(
      fallbackValue('deltaUpper', 0, {
        rows: dated.rows,
        formulaPath: [{ deltaUpper: 999 }],
      }),
    ).toBeUndefined()
  })

  it('entry 直接返回 ctx.entryPrice', () => {
    expect(fallbackValue('entry', 0, ctx)).toBe(99)
  })

  it('现价线始终读取当前观察前缀的最后收盘价', () => {
    expect(fallbackValue('mark', 0, ctx)).toBe(101)
  })

  it('模拟目标与失效线从 position 查询结果读取', () => {
    expect(fallbackValue('target', 0, ctx)).toBe(108)
    expect(fallbackValue('stop', 0, ctx)).toBe(93)
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

describe('latestFinitePathPoint', () => {
  it('将 latest-only 快照落在 path 对应观察日，不使用完整 rows 的未来末日', () => {
    const rows = [{ date: '2026-08-01' }, { date: '2026-08-02' }, { date: '2026-08-03' }]
    const path = [
      { date: '2026-08-01', lpPoolTurnover24h: 0.2 },
      { date: '2026-08-03', lpPoolTurnover24h: 0.3 },
    ]

    expect(latestFinitePathPoint(rows, path, 'lpPoolTurnover24h')).toEqual({
      time: '2026-08-03',
      value: 0.3,
    })
    expect(latestFinitePathPoint(rows, path, 'missing')).toBeNull()
    expect(latestFinitePathPoint(rows, [], 'lpPoolTurnover24h')).toBeNull()
    expect(latestFinitePathPoint(rows, [{ lpPoolTurnover24h: 0.4 }], 'lpPoolTurnover24h')).toBeNull()
  })
})

describe('groupIndicators', () => {
  it('按 price/greeks/lp/carry/kdj/rsi/equity 顺序聚合', () => {
    const indicators = [
      { key: 'rsi', group: 'rsi', title: 'RSI', color: '#000', unit: 'num', value: 50 },
      { key: 'cost', group: 'price', title: '成本锚', color: '#000', unit: 'price', value: 100 },
      { key: 'bsDelta', group: 'greeks', title: 'Delta', color: '#000', unit: 'num', value: 0.5 },
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
