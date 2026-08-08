import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDataLoader } from '../useDataLoader.js'

describe('useDataLoader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads bundled market CSV data before falling back to fetch', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('fetch should not be used for bundled samples')
    })
    vi.stubGlobal('fetch', fetchMock)

    const loader = useDataLoader({})
    await loader.loadSample({
      id: 'cn-600519',
      label: '贵州茅台 日线',
      symbol: '600519',
      url: '/data/600519-1d.csv',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(loader.error.value).toBe(null)
    expect(loader.rows.value.length).toBeGreaterThan(1000)
    expect(loader.rows.value[0].date).toBe('2021-01-04')
  })
})
