import { describe, expect, it } from 'vitest'
import { formulaEvidenceCatalog } from '../formulas/evidence.js'
import { formulaStages, getFormulaStage } from '../formulas/registry.js'
import { formulaSourceAudit } from '../formulas/sourceAudit.js'
import { FORMULA_PATH_CURVES, FORMULA_PATH_FIELDS } from '../market-data/formulaPath.js'

describe('formula source audit', () => {
  it('keeps blog/desmos research formulas out of the executable chain by default', () => {
    expect(formulaSourceAudit.length).toBeGreaterThanOrEqual(8)
    const executable = formulaSourceAudit.filter((entry) => entry.executable)
    expect(executable.map((entry) => entry.id)).toEqual([
      'path',
      'cost',
      'volatility',
      'delta-band',
      'order-plan',
      'deviation-score',
    ])
    expect(formulaSourceAudit.filter((entry) => entry.executionDecision).map((entry) => entry.id)).toEqual([
      'order-plan',
    ])
    expect(formulaSourceAudit.filter((entry) => entry.executionInput).map((entry) => entry.id)).toEqual([
      'path',
      'cost',
      'volatility',
      'delta-band',
      'deviation-score',
    ])

    const research = formulaSourceAudit.filter((entry) => !entry.executable)
    expect(
      research.every((entry) =>
        ['research-only', 'protocol-unverified', 'implemented', 'proxy-only'].includes(entry.status),
      ),
    ).toBe(true)
    expect(research.find((entry) => entry.id === 'portfolio')?.status).toBe('research-only')
    expect(research.find((entry) => entry.id === 'amm-geometry')?.status).toBe('protocol-unverified')
  })

  it('records source ids, IO, and boundaries for every migrated formula group', () => {
    for (const entry of formulaSourceAudit) {
      expect(entry.sources.length).toBeGreaterThan(0)
      expect(entry.inputs.length).toBeGreaterThan(0)
      expect(entry.outputs.length).toBeGreaterThan(0)
      expect(entry.boundary.length).toBeGreaterThan(10)
    }
  })

  it('keeps formula stages backed by the evidence catalog', () => {
    const evidenceIds = new Set(formulaEvidenceCatalog.map((entry) => entry.id))
    const stageIds = new Set(formulaStages.map((stage) => stage.id))
    expect(formulaStages.every((stage) => evidenceIds.has(stage.id))).toBe(true)
    expect(stageIds).toEqual(evidenceIds)
    for (const entry of formulaEvidenceCatalog) {
      expect(entry.inputs.length).toBeGreaterThan(0)
      expect(entry.outputs.length).toBeGreaterThan(0)
      expect(['implemented', 'research-only', 'protocol-unverified', 'proxy-only'].includes(entry.status)).toBe(true)
    }
  })

  it('keeps the formula-derived LP display range research-only and without valuation or execution authority', () => {
    const stage = getFormulaStage('lp-research-range')
    const evidence = formulaEvidenceCatalog.find((entry) => entry.id === 'lp-research-range')
    const audit = formulaSourceAudit.find((entry) => entry.id === 'lp-research-range')

    expect(stage.status).toBe('research-only')
    expect(stage.formulas.join(' ')).toContain('scenario-proxy only')
    expect(stage.formulas.join(' ')).toContain('executionAuthority=none')
    expect(stage.formulas.join(' ')).toContain('valuationAuthority=none')
    expect(evidence).toMatchObject({
      status: 'research-only',
      executable: false,
      executionInput: false,
      executionDecision: false,
      queryOnly: true,
    })
    expect(audit).toMatchObject({
      status: 'research-only',
      executable: false,
      executionInput: false,
      executionDecision: false,
    })
    expect(audit.boundary).toContain('no execution or valuation authority')
  })

  it('keeps drawer registry semantics causal, session-based, and unit-explicit', () => {
    const path = getFormulaStage('path')
    const cost = getFormulaStage('cost')
    const volatility = getFormulaStage('volatility')
    const deltaBand = getFormulaStage('delta-band')
    const optionGreeks = getFormulaStage('option-greeks')
    const asianOption = getFormulaStage('asian-option')
    const riskSurface = getFormulaStage('risk-surface')
    const meanReversion = getFormulaStage('mean-reversion')
    const dynamicHolding = getFormulaStage('dynamic-holding-state')
    const registryText = JSON.stringify(formulaStages)

    expect(path.formulas.join(' ')).toContain('OHLCV_{0:t}')
    expect(path.formulas.join(' ')).toContain('禁止读取 t 之后的样本')
    expect(path.formulas.join(' ')).not.toMatch(/质数\s*179|e\s*\/\s*π/)

    expect(cost.formulas.join(' ')).toContain('typical_i = (high_i + low_i + close_i) / 3')
    expect(cost.formulas.join(' ')).toContain('sum(typical_i * volume_i) / sum(volume_i)')
    expect(cost.formulas.join(' ')).toContain('equal-weight typical mean')
    expect(cost.formulas.join(' ')).not.toContain('sum(close * volume)')

    expect(volatility.formulas.join(' ')).toContain('sqrt(tradingDaysPerYear)')
    expect(volatility.formulas.join(' ')).not.toContain('sqrt(365)')
    expect(deltaBand.inputs.join(' ')).toContain('formulaHorizonSessions')
    expect(deltaBand.formulas.join(' ')).toContain('tradingDaysPerYear')
    expect(deltaBand.formulas.join(' ')).not.toMatch(/365|持仓 T|到期时间/)

    expect(meanReversion.outputs.join(' ')).toContain('arCoefficient')
    expect(meanReversion.outputs.join(' ')).toContain('arDecayRatePerStep')
    expect(meanReversion.outputs.join(' ')).toContain('halfLifeSessions')
    expect(meanReversion.formulas.join(' ')).not.toMatch(/[ρθ]|半衰期天数/)

    expect(dynamicHolding.formulas.join(' ')).toContain('expanding-prefix')
    expect(dynamicHolding.formulas.join(' ')).toContain('仅显式情景')
    expect(dynamicHolding.formulas.join(' ')).not.toContain('high120')

    expect(optionGreeks.outputs).toContain('portfolio.optionDelta（标的单位；含数量与 contractMultiplier）')
    expect(optionGreeks.outputs).toContain(
      'portfolio.optionGamma（标的单位/标的价格单位；含数量与 contractMultiplier）',
    )
    expect(optionGreeks.outputs).toContain(
      'portfolio.optionThetaPerSession（报价币/交易会话；含数量与 contractMultiplier）',
    )
    expect(optionGreeks.outputs).toContain('portfolio.optionThetaAnnual（报价币/年；含数量与 contractMultiplier）')
    expect(optionGreeks.outputs).toContain('portfolio.optionVegaPerPct（报价币/IV 上升 1 个百分点）')
    expect(optionGreeks.outputs).toContain('portfolio.optionRhoPerPct（报价币/年化利率上升 1 个百分点）')
    expect(optionGreeks.outputs.join(' ')).not.toMatch(/portfolio\.(?:delta|gamma|thetaDaily|vega|rho)\b/)
    expect(asianOption.outputs.join(' ')).toContain('optionNormalVegaPerUnit')
    expect(asianOption.outputs.join(' ')).not.toMatch(/Asian delta|Asian gamma|Bachelier price\/delta\/gamma/)
    expect(riskSurface.outputs.join(' ')).toContain('optionThetaPerSession')
    expect(riskSurface.outputs.join(' ')).not.toContain('thetaDaily')

    expect(registryText).not.toContain('半衰期天数')
  })

  it('keeps chart curve metadata wired to evidence sources', () => {
    const evidenceIds = new Set(formulaEvidenceCatalog.map((entry) => entry.id))
    expect(Object.keys(FORMULA_PATH_CURVES).length).toBeGreaterThanOrEqual(15)
    for (const [field, meta] of Object.entries(FORMULA_PATH_CURVES)) {
      expect(field.length).toBeGreaterThan(2)
      expect(evidenceIds.has(meta.source)).toBe(true)
      expect(
        ['price', 'delta', 'gamma', 'theta/trading-session', 'ratio', 'quote', 'multiple', 'return'].includes(
          meta.unit,
        ),
      ).toBe(true)
      expect(['priceBands', 'greeksPane', 'lpPane', 'carryPane'].includes(meta.pane)).toBe(true)
      expect(['implemented', 'research-only', 'proxy-only'].includes(meta.status)).toBe(true)
    }
  })

  it('keeps deprecated aliases out of the canonical formula path registry', () => {
    for (const alias of [
      'formulaHorizonDays',
      'optionThetaDaily',
      'lpInventoryDelta',
      'impermanentLoss',
      'fundingProxy',
    ]) {
      expect(FORMULA_PATH_FIELDS).not.toHaveProperty(alias)
      expect(FORMULA_PATH_CURVES).not.toHaveProperty(alias)
    }
  })
})
