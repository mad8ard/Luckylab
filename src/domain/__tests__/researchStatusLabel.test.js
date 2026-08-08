import { describe, expect, it } from 'vitest'
import { buildResearchStatusLabel } from '../research-visualization/researchStatusLabel.js'

describe('buildResearchStatusLabel', () => {
  it('shows connected aggregate pool data before pending refinements', () => {
    const label = buildResearchStatusLabel(['research-only', 'proxy-only', 'missing-input', 'pool-real-input'], [
      { source: 'lp-inventory', inputMode: 'pool-real', missingInputs: ['position-nft'] },
      { source: 'lp-pool-coverage', inputMode: 'pool-real', missingInputs: ['tick-liquidity-history'] },
      { source: 'funding', inputMode: 'fallback', missingInputs: ['settlement-history'] },
    ])

    expect(label).toBe('研究 · 聚合池 · 待补')
  })

  it('keeps truly missing pool coverage explicit', () => {
    const label = buildResearchStatusLabel(['research-only', 'proxy-only', 'missing-input', 'fallback-input'], [
      { source: 'lp-inventory', inputMode: 'fallback', missingInputs: ['real-lp-pool'] },
      { source: 'funding', inputMode: 'fallback', missingInputs: ['settlement-history'] },
    ])

    expect(label).toBe('研究 · 待接池 · 缺输入')
  })
})
