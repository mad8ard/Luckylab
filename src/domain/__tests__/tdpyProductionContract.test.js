import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRODUCTION_FILES = [
  'src/domain/formulas/core.js',
  'src/composables/usePlanning.js',
  'src/domain/replay/dailyReplay.js',
  'src/composables/useMarketState.js',
  'src/domain/formula-research/researchSnapshot.js',
  'src/domain/market-data/cost.js',
  'src/domain/market-data/formulaPath.js',
  'src/domain/market-data/tdpy.js',
  'src/domain/strategy-planning/orderPlanTiming.js',
  'src/domain/strategy-planning/orderPlanContext.js',
]

describe('production tradingDaysPerYear contract', () => {
  it.each(PRODUCTION_FILES)('%s has no hidden 365 fallback', async (file) => {
    const source = await readFile(resolve(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/tradingDaysPerYear\s*=\s*365/)
    expect(source).not.toMatch(/(?:tdpy|tradingDaysPerYear)[^\n]*(?:\|\||\?\?)\s*365/)
    expect(source).not.toMatch(/tradingDaysPerYear\s*:\s*365/)
    expect(source).not.toMatch(/fallback[^\n]*365|默认\s*365/)
  })
})
