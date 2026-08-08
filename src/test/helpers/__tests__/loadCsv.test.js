import { describe, expect, it } from 'vitest'
import { loadCsv } from '../loadCsv.js'

describe('loadCsv', () => {
  it('能加载 600519-1d.csv 并返回标准化 OHLCV 行', () => {
    const rows = loadCsv('public/data/600519-1d.csv')
    expect(rows.length).toBeGreaterThan(500)
    const last = rows.at(-1)
    expect(last).toMatchObject({
      date: expect.any(String),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      close: expect.any(Number),
      volume: expect.any(Number),
    })
    expect(last.high).toBeGreaterThanOrEqual(last.low)
  })
})
