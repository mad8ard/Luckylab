import { describe, expect, it } from 'vitest'
import { summarizeReason, summarizeRegime } from '../decision/narrative.js'

describe('neutral market narrative', () => {
  const banned = ['适合', '吸纳', '开始买', '不追高', '主策略', '推荐']

  it('summary text stays descriptive instead of advisory', () => {
    const texts = [
      summarizeRegime({ costDistance: -0.08, costWindow: 60 }),
      summarizeRegime({ costDistance: -0.02, costWindow: 60 }),
      summarizeRegime({ costDistance: 0.08, costWindow: 60 }),
      summarizeReason({ costDistance: -0.08, side: 'buy' }),
      summarizeReason({ costDistance: 0.08, side: 'sell' }),
    ]
    for (const text of texts) {
      for (const word of banned) expect(text).not.toContain(word)
    }
  })
})
