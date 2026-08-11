import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLabStore } from '../labStore.js'

describe('useLabStore（v3 重写后契约）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('对外 API 字段齐全', () => {
    const lab = useLabStore()
    // 数据层
    expect(lab.rows).toBeDefined()
    expect(lab.cursor).toBeDefined()
    expect(typeof lab.loadSample).toBe('function')
    expect(typeof lab.importText).toBe('function')
    // 市场态
    expect(lab.market).toBeDefined()
    expect(lab.costPath).toBeDefined()
    expect(lab.formulaPath).toBeDefined()
    // 决策
    expect(lab.input).toBeDefined()
    expect(lab.graph).toBeDefined()
    expect(lab.effectiveInput).toBeDefined()
    // 回放
    expect(lab.replay).toBeDefined()
    expect(lab.profileReplays).toBeDefined()
    expect(lab.recommendedProfile).toBeDefined()
    // 三栏面板态 + 主图叠加（v3.1）
    expect(lab.leftPanelOpen).toBe(true)
    expect(lab.rightPanelOpen).toBe(true)
    expect(lab.activeLeftTab).toBe('decision')
    expect(typeof lab.toggleLeftPanel).toBe('function')
    expect(typeof lab.toggleRightPanel).toBe('function')
    // 面板宽度（v3.2）
    expect(lab.leftPanelW).toBe(280)
    expect(lab.rightPanelW).toBe(240)
    expect(typeof lab.setLeftPanelW).toBe('function')
    expect(typeof lab.setRightPanelW).toBe('function')
    expect(typeof lab.resetLeftPanelW).toBe('function')
    expect(typeof lab.resetRightPanelW).toBe('function')
    expect(lab.chartOverlays).toBeDefined()
    expect(lab.chartOverlays.costBand).toBe(true)
  })

  it('初始 input 默认值正确', () => {
    const lab = useLabStore()
    expect(lab.input.holdingDays).toBeUndefined()
    expect(lab.input.deltaSlope).toBe(0.3)
    expect(lab.input.exitTargetReturn).toBe(0)
    expect(lab.input.replayFeeRate).toBeNull()
    expect(lab.input.targetReturn).toBeUndefined()
    expect(lab.input.feeIncomeQuote).toBeNull()
    expect(lab.featureFlags.replayAccount).toBe(false)
    expect(lab.featureFlags.replayAutoProfile).toBe(false)
    expect(lab.input.tradingDaysPerYear).toBeUndefined()
    expect(lab.effectiveTdpy).toBeNull()
    expect(lab.tdpyMeta).toEqual({ value: null, basis: 'missing-input', label: '待识别' })
    expect(lab.input.pathUsesScenarioInputs).toBe(false)
    expect(typeof lab.setPathUsesScenarioInputs).toBe('function')
  })

  it('只通过显式命令启用历史路径期权情景，并严格归一化布尔值', () => {
    const lab = useLabStore()
    lab.setPathUsesScenarioInputs(true)
    expect(lab.input.pathUsesScenarioInputs).toBe(true)
    lab.setPathUsesScenarioInputs('true')
    expect(lab.input.pathUsesScenarioInputs).toBe(false)
  })

  it('importText 解析 CSV 并触发输入回填', async () => {
    const lab = useLabStore()
    const csv = [
      'date,open,high,low,close,volume',
      ...Array.from({ length: 60 }, (_, i) => {
        const close = 100 + i * 0.5
        return `2024-01-${String(i + 1).padStart(2, '0')},${close},${close + 1},${close - 1},${close},1000`
      }),
    ].join('\n')
    lab.importText(csv, '测试集')
    await new Promise((r) => setTimeout(r, 50))
    expect(lab.rows.length).toBeGreaterThan(0)
    expect(lab.market).toBeNull()
    expect(lab.tdpyMeta.basis).toBe('missing-input')
    lab.setTdpyOverride('测试集', 252)
    await new Promise((r) => setTimeout(r, 0))
    expect(lab.tdpyMeta.basis).toBe('explicit-override')
    expect(lab.tdpyMeta.inferredBasis).toBe('missing-input')
    lab.setCursorIndex(lab.cursor)
    expect(lab.input.entryPrice).toBeGreaterThan(0)
    expect(lab.input.iv).toBeGreaterThanOrEqual(0)
  })

  it('观察日期限制市场态和回放只使用当日前数据', async () => {
    const lab = useLabStore()
    const csv = [
      'date,open,high,low,close,volume',
      ...Array.from({ length: 90 }, (_, i) => {
        const close = 100 + i
        const date = new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10)
        return `${date},${close},${close + 1},${close - 1},${close},1000`
      }),
    ].join('\n')
    lab.importText(csv, '观察日期测试')
    await new Promise((r) => setTimeout(r, 50))
    lab.setTdpyOverride('观察日期测试', 252)
    lab.setObservationDate('2024-01-30')
    expect(lab.cursor).toBe(29)
    expect(lab.activeRows).toHaveLength(30)
    expect(lab.market.markPrice).toBe(129)
    expect(lab.observationDate).toBe('2024-01-30')
    expect(lab.observationDates['观察日期测试']).toBe('2024-01-30')
    lab.useLatestObservation()
    expect(lab.cursor).toBe(89)
    expect(lab.activeRows).toHaveLength(90)
  })

  it('hover 公式行按 K 线日期关联，路径错序或缺日时不回退最新值', async () => {
    const lab = useLabStore()
    lab.importText(
      [
        'date,open,high,low,close,volume',
        '2024-01-01,10,11,9,10,100',
        '2024-01-02,11,12,10,11,100',
        '2024-01-03,12,13,11,12,100',
      ].join('\n'),
      'hover-date-join',
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    lab.formulaPath.reverse()
    lab.setHoverIndex(0)
    expect(lab.hoverFormulaRow?.date).toBe('2024-01-01')

    const first = lab.formulaPath.findIndex((row) => row.date === '2024-01-02')
    lab.formulaPath.splice(first, 1)
    lab.setHoverIndex(1)
    expect(lab.hoverFormulaRow).toBeNull()
  })

  it('观察日期按数据源隔离，避免不同用户样本串时间', async () => {
    const lab = useLabStore()
    const csvA = [
      'date,open,high,low,close,volume',
      '2024-01-01,10,11,9,10,100',
      '2024-01-02,11,12,10,11,100',
      '2024-01-03,12,13,11,12,100',
    ].join('\n')
    const csvB = [
      'date,open,high,low,close,volume',
      '2025-02-01,20,21,19,20,100',
      '2025-02-02,21,22,20,21,100',
      '2025-02-03,22,23,21,22,100',
    ].join('\n')
    lab.importText(csvA, '用户A样本')
    await new Promise((r) => setTimeout(r, 20))
    lab.setObservationDate('2024-01-02')
    expect(lab.observationDate).toBe('2024-01-02')
    lab.importText(csvB, '用户B样本')
    await new Promise((r) => setTimeout(r, 20))
    expect(lab.observationDate).toBe('2025-02-03')
    lab.setObservationDate('2025-02-02')
    lab.importText(csvA, '用户A样本')
    await new Promise((r) => setTimeout(r, 20))
    expect(lab.observationDate).toBe('2024-01-02')
  })

  it('A3 回归：tdpy 切换不污染缓存', () => {
    const lab = useLabStore()
    const csv = [
      'date,open,high,low,close,volume',
      ...Array.from({ length: 80 }, (_, i) => {
        const close = 100 + Math.sin(i / 5) * 3
        return `2024-01-${String((i % 28) + 1).padStart(2, '0')},${close},${close + 0.5},${close - 0.5},${close},1000`
      }),
    ].join('\n')
    lab.importText(csv, '测试集')
    // '600519' 走 A股 242，覆盖为 365 触发不同结果
    lab.source = { ...lab.source, symbol: '600519' }
    const v1 = lab.market.annualVol
    lab.setTdpyOverride('600519', 365)
    const v2 = lab.market.annualVol
    expect(v1).not.toBeCloseTo(v2, 4)
  })

  it('effectiveTdpy 默认按 source 自动判断', () => {
    const lab = useLabStore()
    lab.source = { id: 'x', symbol: '0700.HK', market: '港股', label: '腾讯', url: '' }
    expect(lab.tdpyMeta.basis).toBe('hk')
    expect(lab.effectiveTdpy).toBe(242)

    lab.source = { id: 'y', symbol: '600519', market: 'A股', label: '贵州茅台', url: '' }
    expect(lab.tdpyMeta.basis).toBe('cn')
    expect(lab.effectiveTdpy).toBe(242)
  })

  it('用户覆盖优先于自动判断，且 per-symbol 隔离', () => {
    const lab = useLabStore()
    lab.source = { id: 'a', symbol: '600519', market: 'A股', label: '贵州茅台', url: '' }
    lab.setTdpyOverride('600519', 365)
    expect(lab.effectiveTdpy).toBe(365)
    expect(lab.tdpyMeta.basis).toBe('explicit-override')
    expect(lab.tdpyMeta.inferredBasis).toBe('cn')

    lab.source = { id: 'b', symbol: '0700.HK', market: '港股', label: '腾讯', url: '' }
    expect(lab.effectiveTdpy).toBe(242)
    lab.setTdpyOverride('0700.HK', 252)
    expect(lab.effectiveTdpy).toBe(252)

    lab.source = { id: 'a', symbol: '600519', market: 'A股', label: '贵州茅台', url: '' }
    expect(lab.effectiveTdpy).toBe(365)

    lab.clearTdpyOverride('600519')
    expect(lab.effectiveTdpy).toBe(242)
  })

  it('toggleLeftPanel / toggleRightPanel 切换面板态并持久化', () => {
    const lab = useLabStore()
    expect(lab.leftPanelOpen).toBe(true)
    lab.toggleLeftPanel()
    expect(lab.leftPanelOpen).toBe(false)
    lab.toggleLeftPanel()
    expect(lab.leftPanelOpen).toBe(true)

    expect(lab.rightPanelOpen).toBe(true)
    lab.toggleRightPanel()
    expect(lab.rightPanelOpen).toBe(false)
  })

  it('activeLeftTab 默认 decision，可切到 compute / settings', () => {
    const lab = useLabStore()
    expect(lab.activeLeftTab).toBe('decision')
    lab.activeLeftTab = 'compute'
    expect(lab.activeLeftTab).toBe('compute')
    lab.activeLeftTab = 'settings'
    expect(lab.activeLeftTab).toBe('settings')
  })

  it('chartOverlays 单字段切换生效', () => {
    const lab = useLabStore()
    expect(lab.chartOverlays.greeksPane).toBe(false)
    lab.setChartOverlay('greeksPane', true)
    expect(lab.chartOverlays.greeksPane).toBe(true)
    lab.setChartOverlay('unknown-layer', true)
    expect(lab.chartOverlays['unknown-layer']).toBeUndefined()
  })

  it('setLeftPanelW / setRightPanelW 在合法范围内生效', () => {
    const lab = useLabStore()
    lab.setLeftPanelW(320)
    expect(lab.leftPanelW).toBe(320)
    lab.setRightPanelW(280)
    expect(lab.rightPanelW).toBe(280)
  })

  it('面板宽度 clamp 上下限', () => {
    const lab = useLabStore()
    lab.setLeftPanelW(50) // 下限 200
    expect(lab.leftPanelW).toBe(200)
    lab.setLeftPanelW(999) // 上限 360，给主图保留阅读面积
    expect(lab.leftPanelW).toBe(360)
    lab.setRightPanelW(50) // 下限 200
    expect(lab.rightPanelW).toBe(200)
    lab.setRightPanelW(999) // 上限 300
    expect(lab.rightPanelW).toBe(300)
    lab.resetLeftPanelW()
    expect(lab.leftPanelW).toBe(280)
    lab.resetRightPanelW()
    expect(lab.rightPanelW).toBe(240)
  })
})
