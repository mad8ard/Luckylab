import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 双阈值：
// - WARN：早期预警，提醒按职责拆分（不阻断 build）
// - ERROR：硬上限，超过就阻断 build
const WARN_LINES = 450
const ERROR_LINES = 500

const ROOTS = ['src']
const EXTENSIONS = new Set(['.js', '.vue', '.css'])

const offenders = []
const warnings = []

for (const root of ROOTS) scan(root)

if (warnings.length) {
  console.warn(`⚠  ${warnings.length} file(s) approaching ${ERROR_LINES}-line limit (>= ${WARN_LINES} lines):`)
  for (const file of warnings) console.warn(`  - ${file.path}: ${file.lines}`)
  console.warn('  Plan a split by responsibility before they hit the hard limit.\n')
}

if (offenders.length) {
  console.error(`Files must stay at or below ${ERROR_LINES} lines:`)
  for (const file of offenders) console.error(`- ${file.path}: ${file.lines}`)
  process.exit(1)
}

console.log(`file size check passed (warn ${WARN_LINES} / error ${ERROR_LINES})`)

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      scan(path)
      continue
    }
    if (!EXTENSIONS.has(extensionOf(path))) continue
    const lines = readFileSync(path, 'utf8').split('\n').length
    if (lines > ERROR_LINES) {
      offenders.push({ path, lines })
    } else if (lines >= WARN_LINES) {
      warnings.push({ path, lines })
    }
  }
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot) : ''
}
