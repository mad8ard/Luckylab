import { resolveArithmeticRangeSpec } from '../formulas/core.js'

/**
 * Resolves the one and only valuation basis for an LP position.
 *
 * Aggregate pool quotes, a generic range-width default, or a cursor-derived
 * start price are insufficient to value a position.  Until a complete
 * timestamped real position adapter exists, valuation is intentionally limited
 * to a fully declared research scenario.
 */
export function resolveLpValuationSpec({ input = {} } = {}) {
  const scenarioEnabled = input?.lpScenarioEnabled === true
  const startPrice = positive(input?.lpScenarioStartPrice)
  const rangeWidth = boundedRangeWidth(input?.lpScenarioRangeWidth)
  const skew = nonNegative(input?.lpScenarioSkew)
  const liquidity = positive(input?.lpScenarioLiquidity)
  const rangeSpec =
    scenarioEnabled && startPrice && rangeWidth !== null && skew !== null
      ? resolveArithmeticRangeSpec({
          referencePrice: startPrice,
          rangeWidth,
          skew,
        })
      : null

  if (rangeSpec && liquidity) {
    return {
      available: true,
      mode: 'explicit-scenario',
      isSynthetic: true,
      startPrice,
      liquidity,
      rangeWidth: rangeSpec.rangeWidth,
      skew: rangeSpec.skew,
      lowerPrice: rangeSpec.lowerPrice,
      upperPrice: rangeSpec.upperPrice,
      rangeSpec,
      missingInputs: [],
      availableAt: null,
      valuationBasis: 'declared-lp-scenario',
    }
  }

  return {
    available: false,
    mode: 'missing-input',
    isSynthetic: false,
    startPrice: null,
    liquidity: null,
    rangeWidth: null,
    skew: null,
    lowerPrice: null,
    upperPrice: null,
    rangeSpec: null,
    missingInputs: missingInputs({
      scenarioEnabled,
      startPrice,
      rangeWidth,
      skew,
      liquidity,
    }),
    availableAt: null,
    valuationBasis: null,
  }
}

function missingInputs({ scenarioEnabled, startPrice, rangeWidth, skew, liquidity }) {
  if (!scenarioEnabled) {
    return ['declared-lp-scenario-or-complete-position']
  }
  return [
    startPrice ? null : 'lp-scenario-start-price',
    rangeWidth !== null ? null : 'lp-scenario-range-width',
    skew !== null ? null : 'lp-scenario-skew',
    liquidity ? null : 'lp-scenario-liquidity',
  ].filter(Boolean)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function boundedRangeWidth(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 && next < 1 ? next : null
}

function nonNegative(value) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}
