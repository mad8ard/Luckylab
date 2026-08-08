import { describe, expect, it } from 'vitest'
import { buildChartMarkers } from '../research-visualization/chartMarkers.js'

describe('buildChartMarkers', () => {
  function row(date, close = 100) {
    return { date, open: close, high: close + 1, low: close - 1, close, volume: 1000 }
  }

  it('overlays.executionMarkers === false 时不输出 replay 与 decision markers', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [{ side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01', pnl: 5, fillPrice: 100, reason: 'cost' }] },
      decision: { state: '低吸', timing: { side: 'buy' } },
      overlays: { executionMarkers: false, replayMarkers: true, currentDecision: true, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers).toEqual([])
  })

  it('replayMarkers + currentDecision 同时打开输出当前决策点', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [] },
      decision: { state: '低吸', timing: { side: 'buy' } },
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: true, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers.find((m) => m.id === 'current-decision')).toBeTruthy()
  })

  it('replayMarkers 同日 fill+exit 输出单条 markers', () => {
    const trade = { side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01', pnl: 5, fillPrice: 100, reason: 'cost' }
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [trade] },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers).toHaveLength(1)
    expect(markers[0].id).toBe('fill-0')
  })

  it('replayMarkers 跨日 fill/exit 输出两条 markers', () => {
    const trade = { side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-03', pnl: -3, fillPrice: 100, reason: 'stop' }
    const markers = buildChartMarkers({
      rows: [row('2024-01-01'), row('2024-01-02'), row('2024-01-03')],
      replay: { trades: [trade] },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    expect(markers).toHaveLength(2)
    expect(markers.map((m) => m.id).sort()).toEqual(['exit-0', 'fill-0'])
  })

  it('researchMarkers 打开且 formulaPath 末尾有 status 时输出 research-status', () => {
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [] },
      decision: null,
      overlays: { executionMarkers: false, researchMarkers: true, replayMarkers: false, currentDecision: false, replayMarkerLabels: false },
      formulaPath: [{ date: '2024-01-01', status: ['needs-input'], fieldStates: {} }],
    })
    expect(markers.find((m) => m.id === 'research-status')).toBeTruthy()
  })

  it('replayMarkerLabels=false 时仍输出 markers，但无 text 字段', () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({
      side: 'buy', signalDate: '2024-01-01', fillDate: '2024-01-01', exitDate: '2024-01-01',
      pnl: 1, fillPrice: 100, reason: 'cost',
    }))
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    for (const m of markers) {
      expect(m.text).toBeUndefined()
    }
  })

  it('signalDate !== fillDate 时输出独立的 signal marker', () => {
    const trade = {
      side: 'buy',
      signalDate: '2024-01-01',
      fillDate: '2024-01-02',
      exitDate: '2024-01-02',
      pnl: 2,
      fillPrice: 101,
      reason: 'cost',
    }
    const markers = buildChartMarkers({
      rows: [row('2024-01-01'), row('2024-01-02')],
      replay: { trades: [trade] },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: false, researchMarkers: false },
      formulaPath: [],
    })
    // signalDate ≠ fillDate → 输出 signal-0；fillDate === exitDate → 仅一条 fill-0
    expect(markers.map((m) => m.id).sort()).toEqual(['fill-0', 'signal-0'])
  })

  it('overlays 缺 key 时遵循"默认开"语义', () => {
    // 缺省 executionMarkers 与 researchMarkers 都视为 true
    const markers = buildChartMarkers({
      rows: [row('2024-01-01')],
      replay: { trades: [] },
      decision: { state: '低吸', timing: { side: 'buy' } },
      overlays: { replayMarkers: true, currentDecision: true },
      formulaPath: [],
    })
    expect(markers.find((m) => m.id === 'current-decision')).toBeTruthy()
  })

  it('replayMarkerLabels=true 时仅最后 6 条 fill marker 带 text', () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({
      side: 'buy',
      signalDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
      fillDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
      exitDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
      pnl: 1,
      fillPrice: 100,
      reason: 'cost',
    }))
    const rows10 = trades.map((t) => row(t.fillDate))
    const markers = buildChartMarkers({
      rows: rows10,
      replay: { trades },
      decision: null,
      overlays: { executionMarkers: true, replayMarkers: true, currentDecision: false, replayMarkerLabels: true, researchMarkers: false },
      formulaPath: [],
    })
    // 10 笔同日 fill+exit → 10 条 fill-X marker
    expect(markers).toHaveLength(10)
    // 前 4 条无 text，后 6 条有 text
    const noText = markers.filter((m) => m.text === undefined)
    const withText = markers.filter((m) => typeof m.text === 'string')
    expect(noText).toHaveLength(4)
    expect(withText).toHaveLength(6)
  })
})
