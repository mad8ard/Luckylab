#!/usr/bin/env node
// 校验 src/data/stock-index.json 与 public/data/ 下 CSV 的一致性
//   1. 每个 index entry 的 url 都能在 public/data 找到
//   2. 每个 public/data 下的 CSV 都被某个 index entry 引用（或在 marketSamples 白名单中）
//   3. id 唯一、symbol 唯一
//
// 用法：
//   node scripts/check-data-index.mjs
//   构建前可加入流程：pnpm run check:data && pnpm run build

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')

const errors = []
const warnings = []

const indexRaw = await readFile(INDEX_PATH, 'utf8')
const index = JSON.parse(indexRaw)

if (!Array.isArray(index)) {
  errors.push('stock-index.json 不是数组')
} else {
  // 唯一性
  const idSet = new Map()
  const symbolSet = new Map()
  for (const entry of index) {
    if (idSet.has(entry.id)) errors.push(`id 重复: ${entry.id}`)
    else idSet.set(entry.id, entry)
    if (symbolSet.has(entry.symbol)) warnings.push(`symbol 重复: ${entry.symbol} (id ${entry.id} 与 ${symbolSet.get(entry.symbol).id})`)
    else symbolSet.set(entry.symbol, entry)
  }
}

// 收集 url → 实际文件名
const indexFiles = new Set(
  index.map((entry) => dataFileName(entry.url)).filter(Boolean),
)

// 列出 public/data 实际文件
let csvFiles = []
try {
  csvFiles = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.csv'))
} catch (e) {
  errors.push(`无法读取 ${DATA_DIR}: ${e.message}`)
}

const csvSet = new Set(csvFiles)

// 检查 index 中每个 url 都有对应文件
for (const entry of index) {
  const file = dataFileName(entry.url)
  if (!file) {
    errors.push(`entry ${entry.id} 缺 url`)
    continue
  }
  if (!csvSet.has(file)) errors.push(`index 引用的 CSV 不存在: ${entry.url} (id=${entry.id})`)
}

// 检查孤立 CSV（marketSamples 白名单：在 ohlcv.js 里维护，这里通过路径推断）
for (const file of csvFiles) {
  if (!indexFiles.has(file)) warnings.push(`孤立 CSV（不在 index 中）: ${file}`)
}

// 输出
console.log(`stock-index.json: ${index.length} entries`)
console.log(`public/data/*.csv: ${csvFiles.length} files`)

if (warnings.length) {
  console.warn(`\n⚠️  ${warnings.length} 警告:`)
  for (const w of warnings) console.warn(`  - ${w}`)
}

if (errors.length) {
  console.error(`\n❌ ${errors.length} 错误:`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log('\n✅ 数据索引一致性 OK')

function dataFileName(url) {
  return String(url ?? '').replace(/^\/(?:data|datasets)\//, '').replace(/\.txt$/i, '')
}
