import { describe, expect, it, vi } from 'vitest'
import {
  applyHqOverlaySeriesStyle,
  bindHqSharedPriceScale,
  buildHqResearchChartConfig,
  hqResearchApiId,
  isHqResearchApiRequest,
  toHqColor,
  toHqResearchIndexResponse,
} from '../hqChartResearchAdapter.js'

const model = {
  dates: ['2026-08-06', '2026-08-07'],
  groups: [
    {
      id: 'price',
      label: '价格层',
      active: true,
      state: 'estimated',
      series: [
        {
          id: 'cost',
          label: '成本锚',
          color: '#0e7558',
          render: 'line',
          points: [
            { time: '2026-08-06', value: 10 },
            { time: '2026-08-07', value: 10.2 },
          ],
        },
      ],
    },
    {
      id: 'greeks',
      label: 'Greeks',
      active: true,
      state: 'estimated',
      series: [
        {
          id: 'delta',
          label: '期权 Delta',
          color: '#a93226',
          render: 'line',
          points: [{ time: '2026-08-07', value: 0.42 }],
        },
      ],
    },
    {
      id: 'lp',
      label: 'LP / 链上',
      active: false,
      state: 'estimated',
      series: [],
    },
    {
      id: 'equity',
      label: '回放权益',
      active: true,
      state: 'ready',
      series: [
        {
          id: 'latest',
          label: '最新权益',
          color: '#1f5fbf',
          render: 'point',
          points: [{ time: '2026-08-07', value: 100_200 }],
        },
      ],
    },
  ],
}

const multiScaleModel = {
  dates: model.dates,
  groups: [
    model.groups[0],
    {
      id: 'greeks',
      label: 'Greeks',
      active: true,
      state: 'estimated',
      series: [
        line('bsDelta', '期权 Delta', '#a93226', [0.4, 0.42]),
        line('bsGamma', '期权 Gamma', '#8b5a16', [0.03, 0.031], { lineWidth: 3 }),
        line('bsTheta', '期权 Theta/交易会话', '#274f9f', [-0.02, -0.021]),
      ],
    },
    {
      id: 'lp',
      label: 'LP / 链上',
      active: true,
      state: 'estimated',
      series: [
        line('lpDelta', 'LP 库存暴露', '#0e7558', [-0.1, 0.1]),
        line('lpRealDiv', '链上池价偏离', '#8b5a16', [0.01, 0.02]),
        line('lpValue', 'LP 库存价值', '#7a5cff', [980, 1_020]),
        line('lpCe', '资本效率', '#8b5a16', [2.1, 2.2]),
      ],
    },
  ],
}

describe('HQChart Market Lab research adapter', () => {
  it('把价格层接到主图共享坐标，把已启用分组接成副图窗口', () => {
    const config = buildHqResearchChartConfig(model)

    expect(config.overlayIndex).toHaveLength(1)
    expect(config.overlayIndex[0]).toMatchObject({
      Windows: 0,
      Identify: 'market-lab:price',
      IsShareY: true,
      API: { ID: 'market-lab:price' },
    })
    expect(config.windows.map((item) => item.API.ID)).toEqual(['market-lab:greeks', 'market-lab:equity'])
    expect(config.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Modify: false,
          Change: false,
          Close: false,
          MaxMin: true,
          TitleWindow: true,
          IsShowIndexName: true,
          TitleHeight: 22,
        }),
      ]),
    )
    expect(config.frames).toHaveLength(2)
  })

  it('生成 HQ API 指标格式并按日期对齐空值、颜色与点图形', () => {
    const greeks = toHqResearchIndexResponse(model, hqResearchApiId('greeks'), {
      symbol: '600519',
      market: 'A股',
      label: '贵州茅台',
    })
    const equity = toHqResearchIndexResponse(model, hqResearchApiId('equity'), {
      symbol: '600519',
      market: 'A股',
    })

    expect(greeks).toMatchObject({
      code: 0,
      stock: { symbol: '600519.sh', name: '贵州茅台' },
      outdata: {
        name: 'Lab · Greeks',
        date: [20260806, 20260807],
        outvar: [{ name: '期权 Delta', type: 0, data: [null, 0.42], color: 'rgb(169,50,38)' }],
      },
    })
    expect(equity.outdata.outvar[0]).toMatchObject({ type: 3, data: [null, 100_200] })
    expect(greeks.outdata.outvar[0].linewidth).toBe('LINETHICK1')
    expect(typeof greeks.outdata.outvar[0].linewidth).toBe('string')
    expect(equity.outdata.outvar[0].linewidth).toBe('LINETHICK2')
  })

  it('把 Greeks 和 LP 不同量纲拆成独立 API 轴并映射到对应 OverlayIndex Window', () => {
    const config = buildHqResearchChartConfig(multiScaleModel)

    expect(config.windows.map((item) => item.API.ID)).toEqual(['market-lab:greeks.delta', 'market-lab:lp.ratio'])
    expect(config.paneGroups.map((groups) => groups.map((group) => group.id))).toEqual([
      ['greeks.delta', 'greeks.gamma', 'greeks.theta'],
      ['lp.ratio', 'lp.value', 'lp.efficiency'],
    ])

    expect(
      config.overlayIndex.map((item) => ({
        Windows: item.Windows,
        Identify: item.Identify,
        IsShareY: item.IsShareY,
        IsCalculateYMaxMin: item.IsCalculateYMaxMin,
      })),
    ).toEqual([
      {
        Windows: 0,
        Identify: 'market-lab:price',
        IsShareY: true,
        IsCalculateYMaxMin: true,
      },
      {
        Windows: 4,
        Identify: 'market-lab:greeks.gamma',
        IsShareY: false,
        IsCalculateYMaxMin: true,
      },
      {
        Windows: 4,
        Identify: 'market-lab:greeks.theta',
        IsShareY: false,
        IsCalculateYMaxMin: true,
      },
      {
        Windows: 5,
        Identify: 'market-lab:lp.value',
        IsShareY: false,
        IsCalculateYMaxMin: true,
      },
      {
        Windows: 5,
        Identify: 'market-lab:lp.efficiency',
        IsShareY: false,
        IsCalculateYMaxMin: true,
      },
    ])
  })

  it('拆轴后的 API 响应只返回对应量纲，并保持 LINETHICK 字符串', () => {
    const gamma = toHqResearchIndexResponse(multiScaleModel, hqResearchApiId('greeks.gamma'), {})
    const lpValue = toHqResearchIndexResponse(multiScaleModel, hqResearchApiId('lp.value'), {})

    expect(gamma.outdata).toMatchObject({
      name: 'Lab · Greeks · Gamma',
      outvar: [
        {
          name: '期权 Gamma',
          data: [0.03, 0.031],
          linewidth: 'LINETHICK3',
        },
      ],
    })
    expect(lpValue.outdata).toMatchObject({
      name: 'Lab · LP / 链上 · 价值',
      outvar: [{ name: 'LP 库存价值', data: [980, 1_020], linewidth: 'LINETHICK1' }],
    })
    expect(typeof gamma.outdata.outvar[0].linewidth).toBe('string')
    expect(typeof lpValue.outdata.outvar[0].linewidth).toBe('string')
  })

  it('未知或关闭的指标组 fail closed，并识别本地 API 请求', () => {
    const missing = toHqResearchIndexResponse(model, hqResearchApiId('lp'), {})
    expect(missing.code).toBe(0)
    expect(missing.error.message).toContain('指标组不可用')
    expect(isHqResearchApiRequest({ Request: { Data: { indexname: hqResearchApiId('price') } } })).toBe(true)
    expect(isHqResearchApiRequest({ Request: { Data: { indexname: 'MACD' } } })).toBe(false)
  })

  it('在 HQ 边界把颜色转成可识别的 rgb，并补齐主图 Overlay 线型', () => {
    expect(toHqColor('#abc')).toBe('rgb(170,187,204)')
    expect(toHqColor('#0e7558')).toBe('rgb(14,117,88)')
    expect(toHqColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)')

    const chart = { Name: '成本锚', Color: '', LineWidth: 0, IsDotLine: false, LineDash: [] }
    const styledModel = {
      groups: [
        {
          series: [{ label: '成本锚', color: '#0e7558', lineWidth: 2, lineStyle: 'dashed' }],
        },
      ],
    }
    expect(applyHqOverlaySeriesStyle({ Chart: chart }, styledModel)).toBe(true)
    expect(chart).toMatchObject({ Color: 'rgb(14,117,88)', LineWidth: 2, IsDotLine: false, LineDash: [5, 4] })
  })

  it('价格 Overlay 委托主 K 线做同一套对数坐标换算', () => {
    let offset = 12
    const getYData = vi.fn((coordinate) => (coordinate - offset) * 1000)
    const mainFrame = {
      GetYFromData: (value) => value / 1000 + offset,
      GetYData: getYData,
      GetYLogarithmicData: (coordinate) => (coordinate - offset) * 1000,
    }
    const frame = {
      IsShareY: true,
      MainFrame: mainFrame,
      GetYFromData: (value) => value / 2000,
      GetYData: (coordinate) => coordinate * 2000,
      GetYLogarithmicData: (coordinate) => coordinate * 2000,
    }

    expect(bindHqSharedPriceScale(frame)).toBe(true)
    expect(frame.GetYFromData(64_923.19)).toBeCloseTo(76.92319)
    expect(frame.GetYData(76.92319, false)).toBeCloseTo(64_923.19)
    expect(getYData).toHaveBeenLastCalledWith(76.92319, false)
    expect(frame.GetYLogarithmicData(76.92319)).toBeCloseTo(64_923.19)

    offset = 20
    expect(frame.GetYFromData(64_923.19)).toBeCloseTo(84.92319)

    frame.MainFrame = {
      GetYFromData: (value) => value / 100 + 3,
      GetYData: (coordinate) => (coordinate - 3) * 100,
      GetYLogarithmicData: (coordinate) => (coordinate - 3) * 100,
    }
    expect(frame.GetYFromData(90.04)).toBeCloseTo(3.9004)
    expect(frame.GetYData(3.9004)).toBeCloseTo(90.04)
  })

  it('坐标修复不改写 BTC / BYD 原始价格值', () => {
    const rawPriceModel = {
      dates: ['2026-08-06', '2026-08-07'],
      groups: [
        {
          id: 'price',
          active: true,
          state: 'estimated',
          series: [
            {
              id: 'btcEntry',
              label: 'BTC 入场价',
              render: 'line',
              color: '#b3261e',
              points: [
                { time: '2026-08-06', value: 64_000 },
                { time: '2026-08-07', value: 64_923.19 },
              ],
            },
            {
              id: 'bydEntry',
              label: 'BYD 入场价',
              render: 'line',
              color: '#274f9f',
              points: [
                { time: '2026-08-06', value: 89.5 },
                { time: '2026-08-07', value: 90.04 },
              ],
            },
          ],
        },
      ],
    }
    const response = toHqResearchIndexResponse(rawPriceModel, hqResearchApiId('price'), {})
    expect(response.outdata.outvar.map((item) => item.data.at(-1))).toEqual([64_923.19, 90.04])
  })

  it('只在价格组的共享框架上经真实样式入口绑定主图坐标', () => {
    const mainFrame = { GetYFromData: (value) => value + 10, GetYData: (coordinate) => coordinate - 10 }
    const priceFrame = { IsShareY: true, MainFrame: mainFrame, GetYFromData: (value) => value }
    const priceChart = { Name: '成本锚', ChartFrame: priceFrame }
    expect(applyHqOverlaySeriesStyle({ Chart: priceChart }, model)).toBe(true)
    expect(priceFrame.GetYFromData(90.04)).toBeCloseTo(100.04)

    const greeksFrame = { IsShareY: true, MainFrame: mainFrame, GetYFromData: (value) => value }
    const greeksChart = { Name: '期权 Delta', ChartFrame: greeksFrame }
    expect(applyHqOverlaySeriesStyle({ Chart: greeksChart }, model)).toBe(true)
    expect(greeksFrame.GetYFromData(0.42)).toBe(0.42)
  })

  it('非共享副图不改写自己的数值坐标', () => {
    const ownMapping = (value) => value * 2
    const frame = { IsShareY: false, MainFrame: { GetYFromData: () => 1 }, GetYFromData: ownMapping }

    expect(bindHqSharedPriceScale(frame)).toBe(false)
    expect(frame.GetYFromData).toBe(ownMapping)
  })

  it('保留指标内部空值，并让稀疏研究线在空白公式日断开', () => {
    const sparseModel = {
      dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
      groups: [
        {
          id: 'greeks',
          label: 'Greeks',
          active: true,
          state: 'estimated',
          series: [
            {
              id: 'bsDelta',
              label: '期权 Delta',
              render: 'line',
              color: '#a93226',
              points: [
                { time: '2026-08-01', value: 0.4 },
                { time: '2026-08-03', value: 0.42 },
              ],
            },
          ],
        },
      ],
    }
    const response = toHqResearchIndexResponse(sparseModel, hqResearchApiId('greeks'), {})
    const chart = { Name: '期权 Delta', DrawType: 1 }

    expect(response.outdata.outvar[0].data).toEqual([0.4, null, 0.42])
    expect(applyHqOverlaySeriesStyle({ Chart: chart }, sparseModel)).toBe(true)
    expect(chart.DrawType).toBe(1)
    expect(response.outdata.outvar[0].data).toEqual([0.4, null, 0.42])
  })

  it('连续研究线也使用遇空值即断开的安全绘制模式', () => {
    const denseModel = {
      dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
      groups: [
        {
          id: 'price',
          series: [
            {
              id: 'cost',
              label: '成本锚',
              render: 'line',
              color: '#0e7558',
              points: [
                { time: '2026-08-01', value: 10 },
                { time: '2026-08-02', value: 10.1 },
                { time: '2026-08-03', value: 10.2 },
              ],
            },
          ],
        },
      ],
    }
    const chart = { Name: '成本锚', DrawType: 1 }

    expect(applyHqOverlaySeriesStyle({ Chart: chart }, denseModel)).toBe(true)
    expect(chart.DrawType).toBe(1)
  })

  it('研究日期先排序去重，再按日期对齐每条序列', () => {
    const unsorted = {
      dates: ['2026-08-07', '2026-08-06', '2026-08-07'],
      groups: model.groups,
    }
    const response = toHqResearchIndexResponse(unsorted, hqResearchApiId('price'), {})

    expect(response.outdata.date).toEqual([20260806, 20260807])
    expect(response.outdata.outvar[0].data).toEqual([10, 10.2])
  })
})

function line(id, label, color, values, options = {}) {
  return {
    id,
    label,
    color,
    render: 'line',
    lineWidth: options.lineWidth,
    points: model.dates.map((time, index) => ({ time, value: values[index] })),
  }
}
