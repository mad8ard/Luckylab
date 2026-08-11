import { beforeEach, describe, expect, it } from 'vitest'
import { usePlanning } from '../usePlanning.js'

describe('usePlanning formula selection', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('把失效的持久化公式 id 规范化为合法默认项', () => {
    window.localStorage.setItem('lab.activeFormulaId.v1', JSON.stringify('removed-formula'))
    window.localStorage.setItem('lab.activeCapabilityId.v1', JSON.stringify('removed-capability'))

    const planning = usePlanning()

    expect(planning.activeFormulaId.value).toBe('delta-band')
    expect(planning.activeCapabilityId.value).toBe('move-derivative')
    expect(planning.activeFormula.value.id).toBe('delta-band')
  })

  it('选择公式时同步所属能力组，非法 id 不会留下无 active 项', () => {
    const planning = usePlanning()

    planning.selectFormula('funding')
    expect(planning.activeFormulaId.value).toBe('funding')
    expect(planning.activeCapabilityId.value).toBe('portfolio-execution')

    planning.selectFormula('unknown-formula')
    expect(planning.activeFormulaId.value).toBe('delta-band')
    expect(planning.activeCapabilityId.value).toBe('move-derivative')
  })
})
