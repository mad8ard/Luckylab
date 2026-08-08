import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsvText } from '../../domain/market-data/ohlcv.js'

// 路径相对于项目根（process.cwd()），测试必须从根目录运行
export function loadCsv(relativePath) {
  const absPath = resolve(process.cwd(), relativePath)
  const text = readFileSync(absPath, 'utf8')
  return parseCsvText(text)
}
