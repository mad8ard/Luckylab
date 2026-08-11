export const HQ_PERIODS = Object.freeze([
  { id: 0, label: '日' },
  { id: 1, label: '周' },
  { id: 21, label: '双周' },
  { id: 2, label: '月' },
  { id: 9, label: '季' },
  { id: 22, label: '半年' },
  { id: 3, label: '年' },
])

export const HQ_MAIN_INDICATORS = Object.freeze([
  { id: 'EMPTY', label: '无（默认，仅显示 Lab）' },
  { id: 'MA', label: 'MA 均线' },
  { id: 'EMA', label: 'EMA 均线' },
  { id: 'SAR', label: 'SAR' },
  { id: 'BBI', label: 'BBI' },
  { id: 'EXPMA', label: 'EXPMA' },
])

export const HQ_SUB_INDICATORS = Object.freeze([
  { id: 'EMPTY', label: '无（默认，不占副图）' },
  { id: 'MACD', label: 'MACD' },
  { id: 'KDJ', label: 'KDJ' },
  { id: 'RSI', label: 'RSI' },
  { id: 'CCI', label: 'CCI' },
  { id: 'WR', label: 'WR' },
  { id: 'ATR', label: 'ATR' },
  { id: 'OBV', label: 'OBV' },
  { id: 'DMI', label: 'DMI' },
  { id: 'VR', label: 'VR' },
  { id: 'BIAS', label: 'BIAS' },
  { id: 'ROC', label: 'ROC' },
  { id: 'TRIX', label: 'TRIX' },
  { id: 'PSY', label: 'PSY' },
  { id: 'MFI', label: 'MFI' },
])

export const HQ_KLINE_STYLES = Object.freeze([
  { id: 0, label: '实心 K' },
  { id: 3, label: '空心阳 K' },
  { id: 1, label: '收盘线' },
  { id: 2, label: '美国线' },
  { id: 4, label: '面积图' },
])

export const HQ_QUICK_DRAWINGS = Object.freeze([
  { id: '趋势线', label: '趋势线' },
  { id: '水平线', label: '水平线' },
  { id: 'TVLongPosition', label: '多仓尺' },
  { id: 'TVShortPosition', label: '空仓尺' },
])

export function normalizeHqPreference(value, options, fallback) {
  return options.some((option) => option.id === value) ? value : fallback
}
