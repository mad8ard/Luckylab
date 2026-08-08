import { describe, expect, it } from 'vitest'
import { formulaEvidenceCatalog } from '../formulas/evidence.js'
import { formulaStages } from '../formulas/registry.js'
import { formulaSourceAudit } from '../formulas/sourceAudit.js'
import { FORMULA_PATH_CURVES } from '../market-data/formulaPath.js'

describe('formula source audit', () => {
  it('keeps blog/desmos research formulas out of the executable chain by default', () => {
    expect(formulaSourceAudit.length).toBeGreaterThanOrEqual(8)
    const executable = formulaSourceAudit.filter((entry) => entry.executable)
    expect(executable.map((entry) => entry.id)).toEqual(['path', 'cost', 'volatility', 'delta-band', 'order-plan', 'deviation-score'])
    expect(formulaSourceAudit.filter((entry) => entry.executionDecision).map((entry) => entry.id)).toEqual(['order-plan'])
    expect(formulaSourceAudit.filter((entry) => entry.executionInput).map((entry) => entry.id)).toEqual(['path', 'cost', 'volatility', 'delta-band', 'deviation-score'])

    const research = formulaSourceAudit.filter((entry) => !entry.executable)
    expect(research.every((entry) => ['research-only', 'protocol-unverified', 'implemented', 'proxy-only'].includes(entry.status))).toBe(true)
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
    expect(formulaStages.every((stage) => evidenceIds.has(stage.id))).toBe(true)
    for (const entry of formulaEvidenceCatalog) {
      expect(entry.inputs.length).toBeGreaterThan(0)
      expect(entry.outputs.length).toBeGreaterThan(0)
      expect(['implemented', 'research-only', 'protocol-unverified', 'proxy-only'].includes(entry.status)).toBe(true)
    }
  })

  it('keeps chart curve metadata wired to evidence sources', () => {
    const evidenceIds = new Set(formulaEvidenceCatalog.map((entry) => entry.id))
    expect(Object.keys(FORMULA_PATH_CURVES).length).toBeGreaterThanOrEqual(15)
    for (const [field, meta] of Object.entries(FORMULA_PATH_CURVES)) {
      expect(field.length).toBeGreaterThan(2)
      expect(evidenceIds.has(meta.source)).toBe(true)
      expect(['price', 'delta', 'gamma', 'theta/day', 'ratio', 'quote', 'multiple', 'return'].includes(meta.unit)).toBe(true)
      expect(['priceBands', 'greeksPane', 'lpPane', 'carryPane'].includes(meta.pane)).toBe(true)
      expect(['implemented', 'research-only', 'proxy-only'].includes(meta.status)).toBe(true)
    }
  })
})
