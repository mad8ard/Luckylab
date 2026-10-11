#!/usr/bin/env node
// 一条命令跑完：抓取大盘原始数据 → 计算趋势分层 → 渲染报告页。

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FETCHER = join(ROOT, 'scripts', 'fetch-market-regime.py')
const GENERATOR = join(ROOT, 'scripts', 'generate-market-regime.mjs')
const RENDERER = join(ROOT, 'scripts', 'render-market-regime-page.mjs')
const VENV_WIN = join(ROOT, '.venv', 'Scripts', 'python.exe')
const VENV_NIX = join(ROOT, '.venv', 'bin', 'python')
const PYTHON = existsSync(VENV_WIN) ? VENV_WIN : existsSync(VENV_NIX) ? VENV_NIX : 'python3'

const steps = [
  ['抓取原始数据', PYTHON, [FETCHER]],
  ['计算趋势分层', process.execPath, [GENERATOR]],
  ['渲染报告页', process.execPath, [RENDERER]],
]

for (const [label, command, args] of steps) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`步骤「${label}」失败，退出码 ${result.status}`)
    process.exit(result.status ?? 1)
  }
}