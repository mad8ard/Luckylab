import { describe, expect, it } from 'vitest'
import { inferTdpy } from '../market-data/tdpy.js'

describe('inferTdpy', () => {
  it('detects Hong Kong equities', () => {
    expect(inferTdpy({ symbol: '0700.HK', market: '港股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '9988.HK' }).basis).toBe('hk')
  })

  it('detects China A shares', () => {
    expect(inferTdpy({ symbol: '600519', market: 'A股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '300750' }).basis).toBe('cn')
  })

  it('falls back safely for unknown input', () => {
    expect(inferTdpy(null)).toEqual({ value: 365, basis: 'fallback', label: '默认 365' })
    expect(inferTdpy({}).basis).toBe('fallback')
    expect(inferTdpy({ symbol: '???' }).basis).toBe('fallback')
  })
})
