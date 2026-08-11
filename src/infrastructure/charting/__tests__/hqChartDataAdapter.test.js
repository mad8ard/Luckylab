import { describe, expect, it, vi } from 'vitest'
import { createHqNetworkFilter, dateNumber, toHqHistoryResponse, toHqSymbol } from '../hqChartDataAdapter.js'

const rows = [
  { date: '2026-08-06', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
  { date: '2026-08-07', open: 10.6, high: 12, low: 10.4, close: 11.8, volume: 120 },
]

describe('HQChart local data adapter', () => {
  it('为 A/港/美/加密市场生成稳定的 HQChart symbol', () => {
    expect(toHqSymbol({ symbol: '600519', market: 'A股' })).toBe('600519.sh')
    expect(toHqSymbol({ symbol: '000001', id: 'auto-000001-1d' })).toBe('000001.sz')
    expect(toHqSymbol({ symbol: '0700', market: '港股' })).toBe('0700.hk')
    expect(toHqSymbol({ symbol: 'AAPL', id: 'us-aapl-1d' })).toBe('aapl.us')
    expect(toHqSymbol({ symbol: 'BTCUSDT', market: '加密' })).toBe('btcusdt.bit')
  })

  it('按官方日线数组顺序生成 yclose/OHLCV/amount', () => {
    const response = toHqHistoryResponse(rows, { symbol: '600519', market: 'A股', label: '贵州茅台' })
    expect(response.symbol).toBe('600519.sh')
    expect(response.name).toBe('贵州茅台')
    expect(response.data[0]).toEqual([20260806, 10, 10, 11, 9, 10.5, 100, 1050])
    expect(response.data[1]).toEqual([20260807, 10.5, 10.6, 12, 10.4, 11.8, 120, 1416])
  })

  it('NetworkFilter 同步关闭默认网络并异步回传本地历史', async () => {
    const callback = vi.fn()
    const request = {
      Name: 'KLineChartContainer::RequestHistoryData',
      Request: { Data: { count: 1 } },
      PreventDefault: false,
    }
    const filter = createHqNetworkFilter({
      getRows: () => rows,
      getSource: () => ({ symbol: '600519', market: 'A股' }),
    })
    filter(request, callback)
    expect(request.PreventDefault).toBe(true)
    expect(callback).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ symbol: '600519.sh' }))
    expect(callback.mock.calls[0][0].data).toHaveLength(1)
  })

  it('未知请求 fail closed，分钟请求返回明确空集而不伪造数据', async () => {
    const unsupported = vi.fn()
    const callback = vi.fn()
    const filter = createHqNetworkFilter({ getRows: () => rows, onUnsupported: unsupported })
    const minute = { Name: 'KLineChartContainer::ReqeustHistoryMinuteData' }
    filter(minute, callback)
    expect(minute.PreventDefault).toBe(true)
    expect(callback).not.toHaveBeenCalled()
    expect(unsupported).toHaveBeenCalledWith(expect.objectContaining({ reason: 'minute-data-unavailable' }))
    await Promise.resolve()
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ data: [] }))
  })

  it('API 指标请求只消费本地研究序列并始终关闭默认网络', async () => {
    const callback = vi.fn()
    const response = { code: 0, outdata: { name: 'Lab · Greeks', date: [], outvar: [] } }
    const getResearchResponse = vi.fn(() => response)
    const filter = createHqNetworkFilter({ getResearchResponse })
    const request = {
      Name: 'APIScriptIndex::ExecuteScript',
      Request: { Data: { indexname: 'market-lab:greeks' } },
      PreventDefault: false,
    }

    filter(request, callback)

    expect(request.PreventDefault).toBe(true)
    expect(getResearchResponse).toHaveBeenCalledWith('market-lab:greeks')
    await Promise.resolve()
    expect(callback).toHaveBeenCalledWith(response)
  })

  it('日期只接受 YYYY-MM-DD 可压缩格式', () => {
    expect(dateNumber('2026-08-07')).toBe(20260807)
    expect(dateNumber('bad')).toBe(0)
  })
})
