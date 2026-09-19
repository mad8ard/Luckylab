const TDPY = {
  hk: { value: 242, basis: 'hk', label: '港股 242' },
  cn: { value: 242, basis: 'cn', label: 'A 股 242' },
  missing: { value: null, basis: 'missing-input', label: '待识别' },
}

export function inferTdpy(sample) {
  if (!sample || typeof sample !== 'object') return { ...TDPY.missing }

  const market = sample.market
  const symbol = String(sample.symbol || '').toUpperCase()

  if (market === '港股') return { ...TDPY.hk }
  if (/\.HK$/.test(symbol)) return { ...TDPY.hk }

  if (market === 'A股') return { ...TDPY.cn }
  if (/^\d{6}$/.test(symbol)) return { ...TDPY.cn }

  return { ...TDPY.missing }
}
