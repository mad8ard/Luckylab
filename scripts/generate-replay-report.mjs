#!/usr/bin/env node
// 运行 T+1 replay 并把 JSON 快照落盘，供 render-replay-page.mjs 渲染。
//
// 用法（参数会原样透传给 replay CLI）：
//   pnpm run generate:replay-report
//   pnpm run generate:replay-report -- --profile combo --fee 0.0011 --validate walk-forward
//
// 落盘位置（与推荐池一致，均被 .gitignore 忽略）：
//   src/data/replay-reports/replay-<date>.json
//   src/data/replay-latest.json

import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CLI = join(ROOT, '.agents', 'skills', 'china-stock-selection', 'scripts', 'replay-short-hold.mjs')
const OUT_DIR = join(ROOT, 'src', 'data', 'replay-reports')
const LATEST_PATH = join(ROOT, 'src', 'data', 'replay-latest.json')

const DEFAULT_ARGS = [
  ['--mode', 'replay'],
  ['--profile', 'strict'],
  ['--fee', '0.0011'],
]

const userArgs = process.argv.slice(2)
const args = [
  ...DEFAULT_ARGS.filter(([flag]) => !userArgs.includes(flag)).flat(),
  ...userArgs,
  '--format',
  'json',
]

const started = Date.now()
const result = spawnSync(process.execPath, [CLI, ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}

let payload = null
try {
  payload = JSON.parse(result.stdout)
} catch (error) {
  console.error(`replay 输出不是合法 JSON: ${error.message}`)
  process.exit(1)
}

payload.reportCommand = `node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs ${args.join(' ')}`
payload.reportGeneratedAt = new Date().toISOString()
payload.reportElapsedMs = Date.now() - started

await mkdir(OUT_DIR, { recursive: true })
const date = String(payload.generatedAt ?? new Date().toISOString()).slice(0, 10)
const datedPath = join(OUT_DIR, `replay-${date}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')

const tradeCount = Array.isArray(payload.trades) ? payload.trades.length : 0
console.log(
  `replay 快照写入完成：trades=${tradeCount} / skipped=${payload.skipped?.length ?? 0} / ${(payload.reportElapsedMs / 1000).toFixed(1)}s`,
)
console.log(`  ${datedPath}`)
console.log(`  ${LATEST_PATH}`)