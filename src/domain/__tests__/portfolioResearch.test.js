import { describe, expect, it } from 'vitest'
import { buildPortfolioResearch } from '../formula-research/portfolioResearch.js'

describe('portfolio research ledger', () => {
  it('mark、入场现金流和 PnL 分列，缺校准输入时不输出正式 total', () => {
    const result = buildPortfolioResearch({
      lpMark: 120,
      lpEntryValue: 100,
      lpPnl: 20,
      optionPortfolio: {
        value: 8,
        entryCost: 5,
        pnl: 3,
        missingInputs: [],
      },
      hedgePnl: -4,
      feeIncomeQuote: 2,
      fundingCashflowQuote: -1,
      fundingCashflowSource: 'explicit-scenario',
      feeModelCalibrated: false,
    })
    expect(result.mark.option).toBe(8)
    expect(result.entryCashflow.option).toBe(5)
    expect(result.pnl.option).toBe(3)
    expect(result.pnl.feeIncomeQuote).toBe(2)
    expect(result.pnl.fundingCashflowQuote).toBe(-1)
    expect(result.pnl.legacyAliases.fees).toBe('feeIncomeQuote')
    expect(result.pnl.legacyAliasMetadata.fees).toEqual({ deprecated: true, legacyAliasOf: 'feeIncomeQuote' })
    expect(result.legacyAliasMetadata.feePnl).toEqual({ deprecated: true, legacyAliasOf: 'feeIncomeQuote' })
    expect(result.feeInputSemantics).toBe('canonical-fee-income-quote')
    expect(result.pnl.legacyAliases.funding).toBe('fundingCashflowQuote')
    expect(result.pnl.legacyAliasMetadata.funding).toEqual({
      deprecated: true,
      legacyAliasOf: 'fundingCashflowQuote',
    })
    expect(result.pnl.scenarioTotal).toBe(20)
    expect(result.pnl.total).toBeNull()
    expect(result.missingInputs).toEqual(['path-fee-model', 'observed-funding-settlement'])
  })

  it('缺失权利金保持缺失，不能被当作零成本', () => {
    const result = buildPortfolioResearch({
      lpMark: 100,
      lpEntryValue: 100,
      lpPnl: 0,
      optionPortfolio: {
        value: 4,
        entryCost: 4,
        pnl: 0,
        missingInputs: ['option-leg-premium'],
      },
      hedgePnl: 0,
      feeIncomeQuote: 0,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'explicit-scenario',
    })
    expect(result.entryCashflow.option).toBeNull()
    expect(result.missingInputs).toContain('option-leg-premium')
  })

  it('完整上卷期权组合的缺失输入，而不是只识别权利金', () => {
    const result = buildPortfolioResearch({
      lpMark: 100,
      lpEntryValue: 100,
      lpPnl: 0,
      optionPortfolio: {
        value: 4,
        entryCost: 1,
        pnl: 3,
        missingInputs: ['verified-market-iv-source'],
      },
      hedgePnl: 0,
      feeIncomeQuote: 0,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'observed-settlement',
      feeModelCalibrated: true,
    })
    expect(result.missingInputs).toContain('verified-market-iv-source')
    expect(result.pnl.missingInputs).toEqual(result.missingInputs)
    expect(result.pnl.total).toBeNull()
    expect(result.status).toBe('calibration-required')
  })

  it('旧 feePnl 只作为明确的 quote-currency 兼容输入', () => {
    const result = buildPortfolioResearch({
      lpPnl: 0,
      optionPortfolio: { value: 0, entryCost: 0, pnl: 0, missingInputs: [] },
      hedgePnl: 0,
      feePnl: 3,
      fundingPnl: -2,
    })
    expect(result.pnl.feeIncomeQuote).toBe(3)
    expect(result.pnl.fundingCashflowQuote).toBe(-2)
    expect(result.feeInputSemantics).toBe('deprecated-feePnl-as-quote-currency')
    expect(result.fundingInputSemantics).toBe('deprecated-fundingPnl-as-signed-quote-cashflow')
    expect(result.legacyAliasMetadata.fundingPnl).toEqual({
      deprecated: true,
      legacyAliasOf: 'fundingCashflowQuote',
    })
  })

  it('即使费用模型标为已校准，缺少 fee 金额也不能输出空 missingInputs', () => {
    const result = buildPortfolioResearch({
      lpPnl: 1,
      optionPortfolio: { value: 1, entryCost: 1, pnl: 0, missingInputs: [] },
      hedgePnl: 0,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'observed-settlement',
      feeModelCalibrated: true,
    })
    expect(result.pnl.feeIncomeQuote).toBeNull()
    expect(result.missingInputs).toContain('fee-income-quote')
    expect(result.pnl.total).toBeNull()
    expect(result.status).toBe('calibration-required')
  })
})
