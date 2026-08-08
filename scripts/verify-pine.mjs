#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DEFAULTS } from './verify-pine-equivalence.mjs'

const file = process.argv[2] || 'bl-esw-pinbar-market-lab.pine'
const content = readFileSync(file, 'utf8')
const lines = content.split(/\r?\n/)
const errors = []

if (!/^\/\/@version=(5|6)$/.test(lines[0] || '')) {
  errors.push('First line must be Pine version declaration')
}

if (!/shorttitle="([^"]{1,10})"/.test(content)) {
  errors.push('shorttitle must exist and be 10 chars or less')
}

// 信号体系按 JS buildEntryTiming 同步：5 类核心信号
for (const signal of ['Low Buy', 'Wait Stop', 'Deep Discount', 'Trim', 'No Chase']) {
  if (!content.includes(signal)) errors.push(`Missing chart signal: ${signal}`)
}

// 成本锚保留三档候选，adaptive_cost 决定是否混合
if (!content.includes('cost_fast_anchor') || !content.includes('cost_slow_anchor')) {
  errors.push('Missing adaptive three-layer cost anchor')
}

// 同步 JS 后核心信号变量
if (!content.includes('lab_buy') || !content.includes('lab_sell') || !content.includes('lab_wait_stop') || !content.includes('lab_deep_discount') || !content.includes('lab_overheat')) {
  errors.push('Missing core market lab signal variables (lab_buy / lab_sell / lab_wait_stop / lab_deep_discount / lab_overheat)')
}

const names = new Map()
for (const match of content.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
  names.set(match[1], (names.get(match[1]) || 0) + 1)
}
const duplicates = [...names].filter(([, count]) => count > 1).map(([name]) => name)
if (duplicates.length) errors.push(`Duplicate variable definitions: ${duplicates.join(', ')}`)

if (/^\s*p_high\s*=/m.test(content)) {
  errors.push('Do not use p_high because it can collide with plot handles')
}

// 默认对齐网站：扩展开关默认 false
if (!/auto_adapt\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('auto_adapt must default to false to align with JS')
}
if (!/adaptive_cost\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('adaptive_cost must default to false to align with JS')
}
if (!/relax_mode\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('relax_mode must default to false to align with JS')
}

// stdev 必须用 sample 模式（biased=false）
const stdevCalls = [...content.matchAll(/ta\.stdev\(([^)]*)\)/g)]
for (const call of stdevCalls) {
  const args = call[1].split(',').map((s) => s.trim())
  if (args.length < 3 || args[2] !== 'false') {
    errors.push(`ta.stdev must pass biased=false third arg: ta.stdev(${call[1]})`)
  }
}

// 禁止 ta.atr( 直接调用（必须用自实现 simple-mean ATR）
if (/ta\.atr\(/.test(content)) {
  errors.push('Do not call ta.atr directly; use simple-mean ATR via ta.sma(true_range, 14) to align with JS')
}

// 必须存在的对齐变量
for (const v of ['lp_lower', 'lp_upper', 'position_label', 'match_pct']) {
  if (!new RegExp(`(^|\\s)${v}\\s*=`, 'm').test(content)) {
    errors.push(`Missing alignment variable: ${v}`)
  }
}

// JS 双胞胎 DEFAULTS 里的每个字段，在 pine 文件里必须有同名 input.* 声明。
// 防御类似 iv_override 的"使用但未声明"漂移：双胞胎给字段定了默认值，
// 但 pine 漏写 input 声明，等价测试用默认值仍然全绿，bug 被掩盖。
for (const name of Object.keys(DEFAULTS)) {
  if (!new RegExp(`(^|\\s)${name}\\s*=\\s*input\\.`, 'm').test(content)) {
    errors.push(`Missing input declaration for alignment field: ${name}`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}

console.log('Pine static checks passed')
