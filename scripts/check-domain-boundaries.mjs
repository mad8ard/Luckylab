#!/usr/bin/env node
/**
 * 守门员：src/domain/ 必须保持纯净，不依赖 Vue、Pinia、图表库等 UI/框架代码。
 * 与 AGENTS.md 第 23 行（DDD 边界）一致。
 *
 * 一旦发现违规即退出 1，build 链路阻断。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/domain'
const EXTENSIONS = new Set(['.js', '.mjs', '.vue'])

// 禁止 import 的目标。匹配 ESM 与 dynamic import 两种写法。
const FORBIDDEN = [
  { pattern: /from\s+['"]vue['"]/, label: 'vue' },
  { pattern: /from\s+['"]vue\//, label: 'vue/*' },
  { pattern: /from\s+['"]@vue\//, label: '@vue/*' },
  { pattern: /from\s+['"]pinia['"]/, label: 'pinia' },
  { pattern: /from\s+['"]lightweight-charts['"]/, label: 'lightweight-charts' },
  { pattern: /import\(\s*['"]vue['"]\s*\)/, label: 'dynamic vue' },
  { pattern: /import\(\s*['"]pinia['"]\s*\)/, label: 'dynamic pinia' },
]

const offenders = []
scan(ROOT)

if (offenders.length) {
  console.error(`src/domain/ must not depend on Vue / Pinia / chart libs (see AGENTS.md):`)
  for (const o of offenders) {
    console.error(`- ${o.path}:${o.line}  [forbidden: ${o.label}]  ${o.text}`)
  }
  process.exit(1)
}

console.log(`domain boundary check passed (${ROOT})`)

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      scan(path)
      continue
    }
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.slice(dot) : ''
    if (!EXTENSIONS.has(ext)) continue

    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) {
          offenders.push({ path, line: i + 1, label: rule.label, text: line.trim() })
        }
      }
    })
  }
}
