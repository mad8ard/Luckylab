#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DEFAULTS } from './verify-pine-equivalence.mjs'

const file = process.argv[2] || 'bl-esw-pinbar-market-lab.pine'
const content = readFileSync(file, 'utf8')
const lines = content.split(/\r?\n/)
const errors = []

const deprecatedCompatibilityStubs = [
  'bl-esw-pinbar-market-lab-cdx.pine',
  'bl-esw-pinbar-market-lab-pro-cc.pine',
  'bl-esw-pinbar-market-lab-pro-osc-cc.pine',
]

for (const stubPath of deprecatedCompatibilityStubs) {
  const stub = readFileSync(stubPath, 'utf8')
  if (!stub.includes('DEPRECATED COMPATIBILITY STUB') || !stub.includes('plot(na')) {
    errors.push(`${stubPath} must remain an inert compatibility stub`)
  }
  if (/\b(?:input\.|alertcondition\s*\(|strategy\.)/.test(stub)) {
    errors.push(`${stubPath} must not expose inputs, alerts, or strategy execution`)
  }
  if (!stub.includes(`research/archive/pine/${stubPath}`)) {
    errors.push(`${stubPath} must point to its frozen archive source`)
  }
}

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

// 同步 JS 后核心信号变量
if (
  !content.includes('lab_buy') ||
  !content.includes('lab_sell') ||
  !content.includes('lab_wait_stop') ||
  !content.includes('lab_deep_discount') ||
  !content.includes('lab_overheat')
) {
  errors.push(
    'Missing core market lab signal variables (lab_buy / lab_sell / lab_wait_stop / lab_deep_discount / lab_overheat)',
  )
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
if (!/relax_mode\s*=\s*input\.bool\(false,/.test(content)) {
  errors.push('relax_mode must default to false to align with JS')
}

// Canonical 窗口和持有期必须是 prefix-causal 公式，不得恢复 30/60 日默认值。
for (const [label, pattern] of [
  ['prefix_n=bar_index+1', /prefix_n\s*=\s*bar_index\s*\+\s*1/],
  [
    'cost=max(5,floor(sqrt(prefix_n)))',
    /cost_window\s*=\s*math\.max\(5,\s*int\(math\.floor\(math\.sqrt\(prefix_n\)\)\)\)/,
  ],
  [
    'recent=max(3,floor(sqrt(cost)))',
    /recent_window\s*=\s*math\.max\(3,\s*int\(math\.floor\(math\.sqrt\(cost_window\)\)\)\)/,
  ],
  ['vol=cost', /vol_window\s*=\s*cost_window/],
  ['ATR=recent', /atr_observed\s*=\s*math\.max\(1,\s*math\.min\(bar_index,\s*recent_window\)\)/],
]) {
  if (!pattern.test(content)) errors.push(`Missing dynamic window identity: ${label}`)
}

for (const forbidden of [
  /holding_days\s*=\s*input\./,
  /formula_horizon_sessions\s*=\s*input\./,
  /formula_horizon_days\s*=\s*input\./,
  /cost_len\s*=\s*input\./,
  /recent_len\s*=\s*input\./,
  /vol_len\s*=\s*input\./,
  /target_return(?:_pct)?\s*=/,
  /\bhalf_life_days\b/,
  /\bformula_horizon_days\b/,
  /\bformula_horizon_raw\b/,
  /\btrading_days\b/,
  /formula_horizon_sessions\s*=\s*30\b/,
]) {
  if (forbidden.test(content)) errors.push(`Forbidden fixed-cycle or polluted input: ${forbidden}`)
}

for (const required of [
  'delta_slope',
  'trading_sessions_per_year',
  'ar_sum_xy',
  'ar_sum_x2',
  'rho_valid',
  'half_life_sessions',
  'cycle_side_short',
  'target_price',
  'target_source',
  'window_low_extreme',
  'window_high_extreme',
  'window_cycle_start',
  'window_structure_valid',
  'lower_cross_prices',
  'upper_cross_prices',
  'fallback_cycle_start',
  'scan_structure_valid',
  'cycle_start_price',
  'cycle_start_source',
  'cycle_direction',
  'anchor_gap',
  'target_gap',
  'recovery_fraction',
  'recovery_valid',
  'formula_horizon_raw_sessions',
  'formula_horizon_sessions',
  'dynamic_horizon_valid',
  'formula_ready',
]) {
  if (!content.includes(required)) errors.push(`Missing causal horizon variable: ${required}`)
}

for (const [label, pattern] of [
  ['side=close relative to cost anchor', /cycle_side_short\s*=\s*close\s*>\s*cost_anchor/],
  ['target=dynamic lower or upper', /target_price\s*=\s*cycle_side_short\s*\?\s*cost_high\s*:\s*cost_low/],
  ['long window low extreme', /window_low_extreme\s*=\s*ta\.lowest\(low,\s*cost_observed\)/],
  ['short window high extreme', /window_high_extreme\s*=\s*ta\.highest\(high,\s*cost_observed\)/],
  [
    'window extreme strictly brackets current target and anchor',
    /window_structure_valid\s*=\s*cycle_side_short\s*\?\s*window_cycle_start\s*>\s*target_price\s*and\s*target_price\s*>\s*cost_anchor\s*:\s*window_cycle_start\s*<\s*target_price\s*and\s*target_price\s*<\s*cost_anchor/,
  ],
  ['long dynamic lower crossing', /lower_crossed\s*=.*low\s*<\s*cost_low/],
  ['short dynamic upper crossing', /upper_crossed\s*=.*high\s*>\s*cost_high/],
  ['latest crossing fallback scan', /while\s+scan_index\s*>=\s*0\s+and\s+na\(fallback_cycle_start\)/],
  [
    'fallback crossing strictly brackets current target and anchor',
    /scan_structure_valid\s*=\s*cycle_side_short\s*\?\s*scan_price\s*>\s*target_price\s*and\s*target_price\s*>\s*cost_anchor\s*:\s*scan_price\s*<\s*target_price\s*and\s*target_price\s*<\s*cost_anchor/,
  ],
  ['side-normalized anchor gap', /anchor_gap\s*=\s*\(cost_anchor\s*-\s*cycle_start_price\)\s*\*\s*cycle_direction/],
  ['side-normalized target gap', /target_gap\s*=\s*\(target_price\s*-\s*cycle_start_price\)\s*\*\s*cycle_direction/],
  ['q target-over-anchor identity', /recovery_fraction\s*=.*target_gap\s*\/\s*anchor_gap/],
]) {
  if (!pattern.test(content)) errors.push(`Missing dynamic recovery identity: ${label}`)
}
if (!/rho_valid\s*=.*rho\s*>\s*0\s*and\s*rho\s*<\s*1/.test(content)) {
  errors.push('rho gate must require 0 < rho < 1')
}
if (
  !/recovery_valid\s*=.*anchor_gap\s*>\s*0.*target_gap\s*>\s*0.*recovery_fraction\s*>\s*0.*recovery_fraction\s*<\s*1/.test(
    content,
  )
) {
  errors.push('recovery gate must require directional gaps > 0 and 0 < q < 1')
}
if (!/formula_ready\s*=\s*delta_ok/.test(content)) {
  errors.push('signals must be gated by the dynamic GetDelta/horizon validity state')
}

// stdev 必须用 sample 模式（biased=false）
const stdevCalls = [...content.matchAll(/ta\.stdev\(([^)]*)\)/g)]
for (const call of stdevCalls) {
  const args = call[1].split(',').map((s) => s.trim())
  if (args.length < 3 || args[2] !== 'false') {
    errors.push(`ta.stdev must pass biased=false third arg: ta.stdev(${call[1]})`)
  }
}

// 禁止 ta.atr( 直接调用（必须用 recent 窗口 simple-mean ATR）
if (/ta\.atr\(/.test(content)) {
  errors.push('Do not call ta.atr directly; use recent-window simple-mean ATR to align with JS')
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
