import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLAIM_CLASS_CONTRACT,
  SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
  buildSyntheticCkGeometryState,
  empiricalDeviationStats,
  isPositiveMonotonicMeanReversion,
  passesAshareShebaoFilter,
  scoreFreshnessEvidence,
} from '../../../.agents/skills/china-stock-selection/scripts/selection-helpers.mjs'

test('claim-class machine contract exposes the complete closed enum', () => {
  assert.deepEqual(CLAIM_CLASS_CONTRACT.allowedValues, [
    'exact-identity',
    'sample-estimate',
    'calibrated-estimate',
    'scenario-proxy',
    'missing-input',
  ])
})

test('empirical deviation reports rank and symmetric two-sided tail shares', () => {
  const low = empiricalDeviationStats([1, 2, 3, 4, 5], 1)
  const high = empiricalDeviationStats([1, 2, 3, 4, 5], 5)

  assert.deepEqual(
    {
      percentilePct: low.percentilePct,
      lowerTailPct: low.lowerTailPct,
      upperTailPct: low.upperTailPct,
      twoSidedTailPct: low.twoSidedTailPct,
      sampleSize: low.sampleSize,
    },
    {
      percentilePct: 20,
      lowerTailPct: 20,
      upperTailPct: 100,
      twoSidedTailPct: 40,
      sampleSize: 5,
    },
  )
  assert.equal(high.percentilePct, 100)
  assert.equal(high.lowerTailPct, 100)
  assert.equal(high.upperTailPct, 20)
  assert.equal(high.twoSidedTailPct, 40)
  assert.match(low.interpretation, /not a probability/)
})

test('empirical deviation handles ties and invalid samples explicitly', () => {
  const ties = empiricalDeviationStats([2, 2, 2], 2)

  assert.equal(ties.percentilePct, 100)
  assert.equal(ties.lowerTailPct, 100)
  assert.equal(ties.upperTailPct, 100)
  assert.equal(ties.twoSidedTailPct, 100)
  assert.equal(empiricalDeviationStats([], 2), null)
  assert.equal(empiricalDeviationStats([1, 2], Number.NaN), null)
})

test('social-security whitelist is an A-share-only gate', () => {
  const whitelist = new Set(['000001'])

  assert.equal(passesAshareShebaoFilter({ market: 'A股', symbol: '000001' }, whitelist, true), true)
  assert.equal(passesAshareShebaoFilter({ market: 'A股', symbol: '000002' }, whitelist, true), false)
  assert.equal(passesAshareShebaoFilter({ market: '港股', symbol: '00002_HK' }, whitelist, true), true)
  assert.equal(passesAshareShebaoFilter({ market: 'A股', symbol: '000002' }, whitelist, false), true)
})

test('dynamic holding accepts only positive monotonic mean reversion', () => {
  const valid = {
    isMeanReverting: true,
    decayMode: 'monotonic-decay',
    arCoefficient: 0.8,
    halfLifeSessions: 3.1,
  }

  assert.equal(isPositiveMonotonicMeanReversion(valid), true)
  assert.equal(
    isPositiveMonotonicMeanReversion({ ...valid, arCoefficient: -0.8, decayMode: 'oscillating-decay' }),
    false,
  )
  assert.equal(isPositiveMonotonicMeanReversion({ ...valid, arCoefficient: 1 }), false)
  assert.equal(isPositiveMonotonicMeanReversion({ ...valid, halfLifeSessions: null }), false)
  assert.equal(isPositiveMonotonicMeanReversion({ rho: 0.8, halfLifeDays: 3.1 }), false)
  assert.equal(isPositiveMonotonicMeanReversion(null), false)
})

test('synthetic CK disclosure forbids real-position and return interpretation', () => {
  assert.equal(SYNTHETIC_CK_GEOMETRY_DISCLOSURE.inputMode, 'synthetic')
  assert.equal(SYNTHETIC_CK_GEOMETRY_DISCLOSURE.liquidity, 1)
  assert.match(SYNTHETIC_CK_GEOMETRY_DISCLOSURE.limitation, /not a real LP position/)
  assert.match(SYNTHETIC_CK_GEOMETRY_DISCLOSURE.limitation, /investment return/)
})

test('synthetic CK geometry normalizes against the same range at the rolling anchor', () => {
  const atAnchor = buildSyntheticCkGeometryState({ costAnchor: 100, atrPercent: 0.1 }, { close: 100 })
  const belowAnchor = buildSyntheticCkGeometryState({ costAnchor: 100, atrPercent: 0.1 }, { close: 90 })

  assert.equal(atAnchor.normalizedValue, 1)
  assert.equal(atAnchor.region, 'range')
  assert.equal(belowAnchor.region, 'token0')
  assert.ok(Number.isFinite(belowAnchor.normalizedValue))
  assert.ok(Number.isFinite(belowAnchor.unitLiquidityValue))
  assert.ok(Number.isFinite(belowAnchor.anchorReferenceValue))
})

test('freshness evidence score has one effective stale threshold and observable components', () => {
  const current = scoreFreshnessEvidence({
    staleDays: 10,
    totalRows: 484,
    tradingDaysPerYear: 242,
    minimumRequiredRows: 121,
  })
  const stale = scoreFreshnessEvidence({
    staleDays: 11,
    totalRows: 484,
    tradingDaysPerYear: 242,
    minimumRequiredRows: 121,
  })
  const muchOlder = scoreFreshnessEvidence({
    staleDays: 31,
    totalRows: 484,
    tradingDaysPerYear: 242,
    minimumRequiredRows: 121,
  })

  assert.deepEqual(
    {
      score: current.score,
      freshness: current.freshnessScore,
      depth: current.evidenceDepthScore,
      annual: current.annualCoverageScore,
    },
    { score: 8, freshness: 5, depth: 2, annual: 1 },
  )
  assert.equal(stale.score, 3)
  assert.equal(muchOlder.score, stale.score)
  assert.equal(
    scoreFreshnessEvidence({ staleDays: -1, totalRows: 10, tradingDaysPerYear: 242, minimumRequiredRows: 10 }),
    null,
  )
})
