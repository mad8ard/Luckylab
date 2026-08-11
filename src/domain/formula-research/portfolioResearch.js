import { defineLegacyAliasContract } from '../formulas/legacyAliases.js'

const PNL_LEGACY_CONTRACT = defineLegacyAliasContract({
  fees: 'feeIncomeQuote',
  funding: 'fundingCashflowQuote',
})
const PORTFOLIO_INPUT_LEGACY_CONTRACT = defineLegacyAliasContract({
  feePnl: 'feeIncomeQuote',
  fundingPnl: 'fundingCashflowQuote',
})

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * A ledger-shaped research result.  Mark, entry cashflow and PnL are never
 * added across columns. `scenarioTotal` is exposed separately when some legs
 * still use model marks or an explicitly sourced scenario cashflow.
 */
export function buildPortfolioResearch({
  lpMark,
  lpEntryValue,
  lpPnl,
  optionPortfolio,
  hedgePnl,
  feeIncomeQuote,
  feePnl: legacyFeePnl,
  fundingCashflowQuote,
  fundingCashflowSource,
  fundingPnl: legacyFundingPnl,
  feeModelCalibrated = false,
  fundingSettlementKnown: legacyFundingSettlementKnown = false,
  lpPositionKnown = true,
} = {}) {
  const optionMissingInputs = Array.isArray(optionPortfolio?.missingInputs)
    ? optionPortfolio.missingInputs.filter((input) => typeof input === 'string' && input.length > 0)
    : []
  const optionMark = finiteOrNull(optionPortfolio?.value)
  const optionEntry = optionMissingInputs.includes('option-leg-premium')
    ? null
    : finiteOrNull(optionPortfolio?.entryCost)
  const optionPnl = finiteOrNull(optionPortfolio?.pnl)
  const resolvedFeeIncomeQuote = Number.isFinite(feeIncomeQuote) ? feeIncomeQuote : finiteOrNull(legacyFeePnl)
  const canonicalFundingSource = ['observed-settlement', 'explicit-scenario'].includes(fundingCashflowSource)
    ? fundingCashflowSource
    : null
  const canonicalFundingCashflow = canonicalFundingSource ? finiteOrNull(fundingCashflowQuote) : null
  const resolvedFundingCashflowQuote =
    canonicalFundingCashflow !== null ? canonicalFundingCashflow : finiteOrNull(legacyFundingPnl)
  const resolvedFundingSource = canonicalFundingSource
    ? canonicalFundingSource
    : resolvedFundingCashflowQuote !== null
      ? legacyFundingSettlementKnown
        ? 'observed-settlement'
        : 'legacy-source-unspecified'
      : null
  const pnlComponents = {
    lp: finiteOrNull(lpPnl),
    option: optionPnl,
    hedge: finiteOrNull(hedgePnl),
    feeIncomeQuote: resolvedFeeIncomeQuote,
    fundingCashflowQuote: resolvedFundingCashflowQuote,
  }
  const scenarioTotal = Object.values(pnlComponents).every(Number.isFinite)
    ? Object.values(pnlComponents).reduce((sum, value) => sum + value, 0)
    : null
  const missingInputs = [
    ...new Set(
      [
        ...optionMissingInputs,
        lpPositionKnown ? null : 'valid-lp-position-range',
        pnlComponents.lp === null ? 'lp-pnl' : null,
        optionEntry === null ? 'option-leg-premium' : null,
        pnlComponents.option === null ? 'option-pnl' : null,
        pnlComponents.hedge === null ? 'hedge-pnl' : null,
        pnlComponents.feeIncomeQuote === null ? 'fee-income-quote' : null,
        feeModelCalibrated ? null : 'path-fee-model',
        pnlComponents.fundingCashflowQuote === null ? 'funding-cashflow-quote' : null,
        resolvedFundingSource ? null : 'funding-cashflow-source',
        resolvedFundingSource === 'observed-settlement' ? null : 'observed-funding-settlement',
      ].filter(Boolean),
    ),
  ]
  const totalPnl = scenarioTotal !== null && !missingInputs.length ? scenarioTotal : null
  return {
    status: missingInputs.length ? 'calibration-required' : 'scenario-attribution',
    mark: {
      lp: finiteOrNull(lpMark),
      option: optionMark,
      hedge: null,
      total: null,
      missingInputs: ['hedge-mark-value', 'common-valuation-basis'],
    },
    entryCashflow: {
      lp: finiteOrNull(lpEntryValue),
      option: optionEntry,
      hedge: null,
      total: null,
      missingInputs: [optionEntry === null ? 'option-leg-premium' : null, 'hedge-entry-cashflow'].filter(Boolean),
    },
    pnl: {
      ...pnlComponents,
      fees: resolvedFeeIncomeQuote,
      funding: resolvedFundingCashflowQuote,
      scenarioTotal,
      total: totalPnl,
      missingInputs,
      ...PNL_LEGACY_CONTRACT,
    },
    missingInputs,
    feeInputSemantics: Number.isFinite(feeIncomeQuote)
      ? 'canonical-fee-income-quote'
      : Number.isFinite(legacyFeePnl)
        ? 'deprecated-feePnl-as-quote-currency'
        : 'missing-fee-income-quote',
    fundingCashflowSource: resolvedFundingSource,
    fundingInputSemantics:
      canonicalFundingCashflow !== null
        ? 'canonical-signed-funding-cashflow-quote'
        : Number.isFinite(legacyFundingPnl)
          ? 'deprecated-fundingPnl-as-signed-quote-cashflow'
          : 'missing-signed-funding-cashflow-quote',
    ...PORTFOLIO_INPUT_LEGACY_CONTRACT,
    accountingIdentity: 'mark-minus-entry-cashflow-plus-period-cashflows-equals-pnl',
  }
}
