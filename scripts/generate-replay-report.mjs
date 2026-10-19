#!/usr/bin/env node
// 运行 T+1 replay 并把 JSON 快照落盘，供 render-replay-page.mjs 渲染。
//
// 默认口径（2026-10 收紧）：min-z 2.13 / 目标 3.2% / 费用 11bps / walk-forward。
// 同时再跑一遍 10bps 滑点变体，网页会把基准、样本外折和滑点变体放在一起展示。
//
// 用法：
//   pnpm run generate:replay-report
//   pnpm run generate:replay-report -- --profile combo --fee 0.0011
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
  ['--min-z', '2.13'],
  ['--target', '0.032'],
  ['--validate', 'walk-forward'],
]

const userArgs = process.argv.slice(2)
const requestedMode = argValue(userArgs, '--mode') ?? 'replay'
const baseArgs = [
  ...DEFAULT_ARGS.filter(([flag]) => {
    if (userArgs.includes(flag)) return false
    // walk-forward 只对 replay 模式有效；显式传 --mode latest 时不要带默认校验。
    if (flag === '--validate' && requestedMode !== 'replay') return false
    return true
  }).flat(),
  ...userArgs,
]

const started = Date.now()
const payload = runReplay(baseArgs, '基准回放')
const elapsedMs = Date.now() - started

const hasSlippage = userArgs.some((arg) => arg === '--slippage-bps' || arg === '--slippage-atr-fraction')
let slippageVariant = null
if (!hasSlippage) {
  const slipStarted = Date.now()
  const variant = runReplay([...baseArgs, '--slippage-bps', '10'], '10bps 滑点')
  slippageVariant = {
    label: '10bps 滑点',
    generatedAt: variant.generatedAt,
    reportElapsedMs: Date.now() - slipStarted,
    summary: variant.summary,
    statistics: variant.statistics,
    riskMetrics: variant.riskMetrics,
    executionAudit: variant.executionAudit,
    config: {
      feeRate: variant.config?.feeRate,
      profiles: variant.config?.profiles,
      execution: variant.config?.execution,
    },
    trades: Array.isArray(variant.trades) ? variant.trades : [],
    warnings: variant.audit?.warnings ?? [],
  }
}

payload.reportCommand = `node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs ${[...baseArgs, '--format', 'json'].join(' ')}`
payload.reportGeneratedAt = new Date().toISOString()
payload.reportElapsedMs = elapsedMs
if (slippageVariant) payload.slippageVariant = slippageVariant

await mkdir(OUT_DIR, { recursive: true })
const date = String(payload.generatedAt ?? new Date().toISOString()).slice(0, 10)
const datedPath = join(OUT_DIR, `replay-${date}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')

const tradeCount = Array.isArray(payload.trades) ? payload.trades.length : 0
const folds = payload.walkForward?.aggregate?.folds ?? 0
console.log(
  `replay 快照写入完成：trades=${tradeCount} / skipped=${payload.skipped?.length ?? 0} / walk-forward ${folds} 折 / ${(elapsedMs / 1000).toFixed(1)}s`,
)
if (slippageVariant) {
  console.log(
    `10bps 滑点：trades=${slippageVariant.trades.length} / avgNet=${slippageVariant.summary?.avgNetPct ?? '—'}% / ${(slippageVariant.reportElapsedMs / 1000).toFixed(1)}s`,
  )
}
console.log(`  ${datedPath}`)
console.log(`  ${LATEST_PATH}`)

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? null : null
}

function runReplay(base, label) {
  const args = [...base, '--format', 'json']
  const startedAt = Date.now()
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) {
    console.error(`步骤「${label}」失败（退出码 ${result.status}）`)
    console.error(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  try {
    const parsed = JSON.parse(result.stdout)
    parsed.reportElapsedMs = Date.now() - startedAt
    return parsed
  } catch (error) {
    console.error(`步骤「${label}」输出不是合法 JSON: ${error.message}`)
    process.exit(1)
  }
}
