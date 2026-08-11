import { describe, expect, it } from 'vitest'
import { loadCsv } from '../../test/helpers/loadCsv.js'
import { FORMULA_PATH_FIELDS, buildFormulaPath } from '../market-data/formulaPath.js'
import { resolveExplicitScenarioHorizonSessions } from '../market-data/formulaPathScenarioInput.js'

const DEPRECATED_CANONICAL_PATH_ALIASES = [
  'formulaHorizonDays',
  'optionThetaDaily',
  'lpInventoryDelta',
  'impermanentLoss',
  'fundingProxy',
]

function makeRows(count, start = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    const close = 100 + 20 * 0.86 ** index + Math.sin(index / 3) * 0.1
    return {
      date: `session-${String(index).padStart(4, '0')}`,
      timestamp: index,
      open: close + 0.05,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 1000 + index,
    }
  })
}

describe('buildFormulaPath causal horizon contract', () => {
  it('显式 scenario adapter 在关闭时不消费旧周期字段', () => {
    expect(resolveExplicitScenarioHorizonSessions({ formulaHorizonDays: 9, holdingDays: 7 })).toBeNull()
    expect(
      resolveExplicitScenarioHorizonSessions({
        formulaHorizonDays: 9,
        holdingDays: 7,
        pathUsesScenarioInputs: false,
      }),
    ).toBeNull()
    expect(
      resolveExplicitScenarioHorizonSessions({
        formulaHorizonDays: 9,
        holdingDays: 7,
        pathUsesScenarioInputs: true,
      }),
    ).toBe(9)
  })

  it('追加未来极端数据不会改写历史公式路径', () => {
    const prefix = makeRows(80)
    const future = makeRows(20, 80).map((row, offset) => ({
      ...row,
      open: 1000 + offset,
      high: 2000 + offset,
      low: 1,
      close: 1500 + offset,
      volume: 999999,
    }))
    const input = { deltaSlope: 0.3, tradingDaysPerYear: 242 }

    expect(buildFormulaPath([...prefix, ...future], input).slice(0, prefix.length)).toEqual(
      buildFormulaPath(prefix, input),
    )
  })

  it('主图周期只由行情公式推导，显式情景开关也不能消费手填周期', () => {
    const rows = makeRows(100)
    const ordinary = buildFormulaPath(rows, { holdingDays: 7, deltaSlope: 0.3, tradingDaysPerYear: 242 })
    const scenario = buildFormulaPath(rows, {
      holdingDays: 7,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
      pathUsesScenarioInputs: true,
    })
    const ignoredLegacyInput = buildFormulaPath(rows, {
      formulaHorizonDays: 9,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    })
    const explicitLegacyAdapter = buildFormulaPath(rows, {
      formulaHorizonDays: 9,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
      pathUsesScenarioInputs: true,
    })

    expect(scenario).toEqual(ordinary)
    expect(explicitLegacyAdapter).toEqual(ignoredLegacyInput)
    expect(scenario.at(-1).formulaHorizonSessions).not.toBe(7)
    expect(explicitLegacyAdapter.at(-1).formulaHorizonSessions).not.toBe(9)
    expect(scenario.at(-1).fieldStates.formulaHorizonSessions.context).toMatchObject({
      mode: 'formula-derived',
      executionAuthority: 'none',
      status: 'eligible',
      resultClaimClass: 'scenario-proxy',
    })
    expect(scenario.at(-1)).not.toHaveProperty('formulaHorizonDays')
    expect(scenario.at(-1).fieldStates).not.toHaveProperty('formulaHorizonDays')
  })

  it('v2 全区间与 v3 指定区间 IL 只以 canonical 字段输出', () => {
    const row = buildFormulaPath(makeRows(20), {
      lpScenarioEnabled: true,
      lpScenarioStartPrice: 110,
      lpScenarioRangeWidth: 0.2,
      lpScenarioSkew: 1,
      lpScenarioLiquidity: 10,
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      tradingDaysPerYear: 242,
    }).at(-1)

    expect(row.fullRangeV2IlProxy).toBeTypeOf('number')
    expect(row.rangeV3Il).toBeTypeOf('number')
    expect(row).not.toHaveProperty('impermanentLoss')
    expect(row.fieldStates).not.toHaveProperty('impermanentLoss')
    expect(row).not.toHaveProperty('lpInventoryDelta')
    expect(row.fieldStates).not.toHaveProperty('lpInventoryDelta')
  })

  it('不把通用 LP 参数或期权路径情景隐式变成 LP 头寸', () => {
    const row = buildFormulaPath(makeRows(20), {
      startPrice: 110,
      rangeWidth: 0.2,
      skew: 1,
      liquidity: 10,
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      tradingDaysPerYear: 242,
    }).at(-1)

    for (const field of [
      'lpValue',
      'lpInventoryDeltaToken0',
      'lpNormalizedDelta',
      'capitalEfficiency',
      'fullRangeV2IlProxy',
      'rangeV3Il',
    ]) {
      expect(row[field]).toBeNull()
    }
    expect(row.lpLowerPrice).toBeTypeOf('number')
    expect(row.lpUpperPrice).toBeTypeOf('number')
    expect(row.fieldStates.lpLowerPrice).toMatchObject({
      source: 'formula-derived-lp-research-range',
      status: 'research-only',
    })
    expect(row.fieldStates.lpLowerPrice.context).toMatchObject({
      notAPosition: true,
      valuationAuthority: 'none',
      executionAuthority: 'none',
    })
    expect(row.fieldStates.lpValue.status).toBe('missing-input')
    expect(row.fieldStates.lpValue.missingInputs).toEqual(['declared-lp-scenario-or-complete-position'])
  })

  it('池聚合快照只标在观察日，绝不伪造为历史指标路径', () => {
    const path = buildFormulaPath(makeRows(20), {
      lpOnchainSnapshot: {
        hasPool: true,
        quotePrice: 101,
        poolCoverage: { reserveUsd: 1000, volumeUsd24h: 250, topPoolReserveShare: 0.4 },
      },
      tradingDaysPerYear: 242,
    })

    expect(path.slice(0, -1).every((row) => row.lpRealPrice === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpRealDivergence === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpPoolTurnover24h === null)).toBe(true)
    expect(path.slice(0, -1).every((row) => row.lpPoolTopReserveShare === null)).toBe(true)
    expect(path.at(-1)).toMatchObject({
      lpRealPrice: 101,
      lpPoolTurnover24h: 0.25,
      lpPoolTopReserveShare: 0.4,
    })
    expect(path.at(-1).fieldStates.lpRealPrice.source).toBe('lp-pool-coverage')
  })

  it('期权路径只使用明确的每交易会话 Theta 字段', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    }).at(-1)

    expect(row.optionDelta).toBeTypeOf('number')
    expect(row.optionGamma).toBeTypeOf('number')
    expect(row.optionThetaPerSession).toBeTypeOf('number')
    expect(row.fieldStates.optionThetaPerSession.status).toBe('research-only')
    expect(row).not.toHaveProperty('optionThetaDaily')
    expect(row.fieldStates).not.toHaveProperty('optionThetaDaily')
  })

  it('期权期限存在但缺少行权价时不回退成本锚绘制 Greeks', () => {
    const path = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    })
    const row = path.at(-1)

    expect(path.every((point) => point.optionDelta === null)).toBe(true)
    expect(path.every((point) => point.optionGamma === null)).toBe(true)
    expect(path.every((point) => point.optionThetaPerSession === null)).toBe(true)
    expect(row.fieldStates.optionDelta.status).toBe('missing-input')
    expect(row.fieldStates.optionDelta.missingInputs).toContain('scenario-strike')
  })

  it('canonical row、fieldStates 和字段注册表不暴露 deprecated aliases', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      deltaSlope: 0.3,
      tradingDaysPerYear: 242,
    }).at(-1)

    for (const alias of DEPRECATED_CANONICAL_PATH_ALIASES) {
      expect(row).not.toHaveProperty(alias)
      expect(row.fieldStates).not.toHaveProperty(alias)
      expect(FORMULA_PATH_FIELDS).not.toHaveProperty(alias)
    }
  })

  it('缺少 tradingDaysPerYear 时保留路径但阻断年化波动、GetDelta 与期权', () => {
    const row = buildFormulaPath(makeRows(40), {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 8,
      optionTenorSessions: 20,
      strikePrice: 100,
      iv: 0.3,
      deltaSlope: 0.3,
    }).at(-1)

    expect(row.iv).toBe(0.3)
    expect(row.deltaUpper).toBeNull()
    expect(row.optionDelta).toBeNull()
    expect(row.fieldStates.deltaUpper.status).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('trading-days-per-year')
    expect(row.fieldStates.optionDelta.missingInputs).toContain('trading-days-per-year')
  })

  it('动态方向、周期起点与边界目标共同推导 q/H 和当前 GetDelta', () => {
    const row = buildFormulaPath(makeRows(100), { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)
    const context = row.fieldStates.formulaHorizonSessions.context
    const q = (context.targetPrice - context.cycleStartPrice) / (context.anchorPrice - context.cycleStartPrice)
    const expectedRaw = context.halfLifeSessions * (Math.log(1 / (1 - q)) / Math.log(2))

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('research-only')
    expect(context.status).toBe('eligible')
    expect(context.side).toMatch(/long|short/)
    expect(context.recoveryFraction).toBeCloseTo(q, 12)
    expect(context.modelHorizonRaw).toBeCloseTo(expectedRaw, 12)
    expect(row.formulaHorizonSessions).toBe(Math.ceil(expectedRaw))
    expect(row.fieldStates.deltaUpper.status).toBe('implemented')
    expect(row.deltaLower).toBeTypeOf('number')
    expect(row.deltaUpper).toBeTypeOf('number')
  })

  it('AR 前缀门禁失败时 Delta 继承 model-gate-failed，同时保留真实输入缺口', () => {
    const row = buildFormulaPath(makeRows(4), { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('model-gate-failed')
    expect(row.fieldStates.formulaHorizonSessions.context.status).toBe('model-gate-failed')
    expect(row.fieldStates.formulaHorizonSessions.context.resultClaimClass).toBeNull()
    expect(row.fieldStates.deltaUpper.status).toBe('model-gate-failed')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('realized-volatility')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
  })

  it('真实零波动历史窗口明确标为模型退化，不冒充缺输入或绘制零宽 Delta/LP', () => {
    const fixtures = [
      ['000301', ['2021-05-11', '2021-05-12']],
      ['000425', ['2021-04-16', '2021-04-19', '2021-04-20']],
      ['600009', ['2021-06-24']],
      ['601988', ['2021-01-29']],
    ]

    for (const [symbol, dates] of fixtures) {
      const path = buildFormulaPath(loadCsv(`public/data/${symbol}-1d.csv`), {
        deltaSlope: 0.3,
        tradingDaysPerYear: 242,
      })
      for (const date of dates) {
        const row = path.find((point) => point.date === date)
        expect(row, `${symbol} ${date}`).toBeTruthy()
        expect(row.formulaHorizonSessions).toBeGreaterThan(0)
        expect(row.iv).toBeNull()
        expect([row.deltaLower, row.deltaUpper, row.lpLowerPrice, row.lpUpperPrice]).toEqual([null, null, null, null])
        for (const field of ['iv', 'deltaLower', 'deltaUpper', 'lpLowerPrice', 'lpUpperPrice']) {
          expect(row.fieldStates[field].status).toBe('model-gate-failed')
          expect(row.fieldStates[field].missingInputs).toEqual([])
          expect(row.fieldStates[field].blockedReasons).toContain('degenerate-volatility')
        }
        expect(row.modelContext.volatility).toEqual({
          value: null,
          source: 'rolling-log-return-volatility-degenerate-zero',
        })
      }
    }
  })

  it('周期结构输入确实无效时 Delta 才标 missing-input', () => {
    const rows = makeRows(100)
    rows[rows.length - 1] = { ...rows.at(-1), open: 0, high: 0, low: 0, close: 0 }
    const row = buildFormulaPath(rows, { deltaSlope: 0.3, tradingDaysPerYear: 242 }).at(-1)

    expect(row.fieldStates.formulaHorizonSessions.status).toBe('missing-input')
    expect(row.fieldStates.formulaHorizonSessions.context.status).toBe('missing-input')
    expect(row.fieldStates.formulaHorizonSessions.context.resultClaimClass).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.status).toBe('missing-input')
    expect(row.fieldStates.deltaUpper.missingInputs).toContain('formula-horizon-inputs')
    expect(row.fieldStates.deltaUpper.missingInputs).not.toContain('formula-derived-horizon')
  })

  it('carry 只复用公式周期，手填周期方向/目标/可知时点不能覆盖它', () => {
    const rows = makeRows(20)
    const base = {
      pathUsesScenarioInputs: true,
      formulaHorizonSessions: 3,
      formulaHorizonSide: 'long',
      horizonTargetPrice: 150,
      horizonTargetSource: 'test-explicit-target',
      horizonAvailableAt: 'session-0019:close',
      perpTwap: 101,
      spotTwap: 100,
      fundingPositionSide: 'short',
      fundingSessionDurationHours: 24,
      fundingSessionCalendarId: 'CRYPTO-UTC-24H',
      recoveryNotionalBasis: 'cycle-start-quote-notional',
      fundingNotionalBasis: 'cycle-start-quote-notional',
      tradingDaysPerYear: 242,
    }
    const row = buildFormulaPath(rows, base).at(-1)
    const missingKnownAt = buildFormulaPath(rows, { ...base, horizonAvailableAt: null }).at(-1)

    expect(row.cumulativeFundingProxy).toBeTypeOf('number')
    expect(row.netCarry).toBeTypeOf('number')
    expect(row).not.toHaveProperty('fundingProxy')
    expect(row.fieldStates).not.toHaveProperty('fundingProxy')
    expect(row.fieldStates.netCarry.context.availableAt).toBe('session-0019:close')
    expect(row.fieldStates.formulaHorizonSessions.context.targetPrice).not.toBe(150)
    expect(row.fieldStates.formulaHorizonSessions.context.targetSource).toMatch(/^adaptive-cost-/)
    expect(missingKnownAt.netCarry).toBe(row.netCarry)
    expect(missingKnownAt.fieldStates.netCarry.status).toBe('proxy-only')
  })
})
