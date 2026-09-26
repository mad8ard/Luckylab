#!/usr/bin/env node
// 一条命令跑完：抓取消息面快照 + 渲染报告页。
//
// 为什么要有这层包装：`pnpm run x -- args` 会把参数追加到整条命令的末尾，
// 如果写成 `python ... && node ...`，参数就会跑到渲染器那边去。
//
// 用法：
//   pnpm run fetch:stock-news -- 600519 000425
//   pnpm run fetch:stock-news -- 600519 --recent-rows 60 --sleep 1

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FETCHER = join(ROOT, 'scripts', 'fetch-stock-news.py')
const RENDERER = join(ROOT, 'scripts', 'render-stock-news-page.mjs')
const VENV_PYTHON = join(ROOT, '.venv', 'Scripts', 'python.exe')
const VENV_PYTHON_UNIX = join(ROOT, '.venv', 'bin', 'python')
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : existsSync(VENV_PYTHON_UNIX) ? VENV_PYTHON_UNIX : 'python3'
const args = process.argv.slice(2)

if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('用法：pnpm run fetch:stock-news -- <6位A股代码> [更多代码...] [--recent-rows N] [--sleep S]')
  console.log('示例：pnpm run fetch:stock-news -- 600519 000425')
  console.log('说明：只做 A 股；只抓你点名的这几只；结果不参与量价评分。')
  process.exit(args.length ? 0 : 2)
}

const fetchResult = spawnSync(PYTHON, [FETCHER, ...args], { cwd: ROOT, stdio: 'inherit' })
if (fetchResult.status !== 0) process.exit(fetchResult.status ?? 1)

const renderResult = spawnSync(process.execPath, [RENDERER], { cwd: ROOT, stdio: 'inherit' })
process.exit(renderResult.status ?? 0)