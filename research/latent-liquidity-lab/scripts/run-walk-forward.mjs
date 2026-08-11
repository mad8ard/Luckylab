import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { assessOhlcvQuality, parseCsvText } from '../../../src/domain/market-data/ohlcv.js'
import { inferTdpy } from '../../../src/domain/market-data/tdpy.js'
import { renderWalkForwardCommand } from '../src/reporting.js'
import { evaluateLatentLiquidityUniverse } from '../src/validation.js'

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const RESULT_SCHEMA_VERSION = 'latent-liquidity-sessions-v4'
const args = parseArgs(process.argv.slice(2))
const market = args.market ?? 'A股'
const tdpyMeta = inferMarketTdpy(market)
const outputDir = args.write ? resolveOutputDir(args.output, tdpyMeta.basis) : null
const index = JSON.parse(await readFile(resolve(ROOT, 'src/data/stock-index.json'), 'utf8'))
const requested = index
  .filter((item) => item.market === market && !item.isPartial && !item.isStale)
  .slice(0, positiveInteger(args.maxSymbols, Number.POSITIVE_INFINITY))
const instruments = await Promise.all(requested.map(loadInstrument))
const evaluation = evaluateLatentLiquidityUniverse(instruments.filter(Boolean), {
  cycle: {
    tradingDaysPerYear: tdpyMeta.value,
    tradingDaysPerYearBasis: tdpyMeta.basis,
    tradingDaysPerYearLabel: tdpyMeta.label,
    tradingDaysPerYearSource: `src/domain/market-data/tdpy.js#inferTdpy:${tdpyMeta.basis}`,
  },
})
const summary = compactSummary({ market, requested, instruments, evaluation })
const markdownConfig = (await resolveConfig(resolve(ROOT, 'research/latent-liquidity-lab/latest-report.md'))) ?? {}
const jsonConfig = (await resolveConfig(resolve(ROOT, 'research/latent-liquidity-lab/latest-summary.json'))) ?? {}
const report = await format(renderReport(summary), { ...markdownConfig, parser: 'markdown' })
const summaryJson = await format(JSON.stringify(summary), { ...jsonConfig, parser: 'json' })

process.stdout.write(report)

if (args.write) {
  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(outputDir, 'latest-summary.json'), summaryJson),
    writeFile(resolve(outputDir, 'latest-report.md'), report),
  ])
  process.stdout.write(`\n已写入 ${outputDir}\n`)
}

async function loadInstrument(entry) {
  try {
    const path = resolve(ROOT, 'public', String(entry.url).replace(/^\//, ''))
    const rows = parseCsvText(await readFile(path, 'utf8'))
    const quality = assessOhlcvQuality(rows)
    if (quality.suspectedSyntheticOpen || rows.length < 2) return null
    return {
      symbol: entry.symbol,
      label: entry.label,
      market: entry.market,
      rows,
      quality,
      dataThrough: entry.dataThrough,
    }
  } catch (error) {
    process.stderr.write(`跳过 ${entry.symbol}: ${error.message}\n`)
    return null
  }
}

function compactSummary({ market, requested, instruments, evaluation }) {
  const used = instruments.filter(Boolean)
  const dataThrough = used
    .map((item) => item.dataThrough)
    .filter(Boolean)
    .sort()
  const dynamic = evaluation.dynamic ?? {}
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    market,
    dataSnapshot: {
      requestedSymbols: requested.length,
      usableSymbols: used.length,
      firstDataThrough: dataThrough[0] ?? null,
      lastDataThrough: dataThrough.at(-1) ?? null,
      source: '本地 public/data/*.csv 与 src/data/stock-index.json 快照',
      selectionWarning: '静态股票池，可能存在覆盖、幸存者与复权点时性偏差。',
    },
    evaluation: {
      status: evaluation.status,
      claimClass: evaluation.claimClass,
      executionStatus: evaluation.executionStatus,
      protocol: evaluation.protocol,
      coverage: evaluation.coverage,
      dynamic: {
        horizonMode: dynamic.horizonMode,
        fixedHorizonApplied: dynamic.fixedHorizonApplied,
        coverage: dynamic.coverage,
        horizonDistribution: dynamic.horizonDistribution,
        byFormulaHorizonQuantile: dynamic.byFormulaHorizonQuantile,
        groups: dynamic.groups,
        yearly: dynamic.yearly,
        comparisons: dynamic.comparisons,
        promotion: dynamic.promotion,
      },
    },
    decisionBoundary: {
      status: dynamic.promotion?.status ?? 'not-promoted',
      meaning:
        '本轮只验证日线 OHLCV 的状态增量与公式周期；未识别真实参与者、盘口成交、库存、路径费用、涨跌停排队或账户约束，不可直接变成交易指令。',
      nextGate: '只有逐事件动态周期在未见数据中稳定、超过预注册基线，并完成前向纸面记录后，才可考虑升级。',
    },
  }
}

function renderReport(summary) {
  const dynamic = summary.evaluation.dynamic ?? {}
  const groups = dynamic.groups ?? {}
  const support = groups['latent:absorption-below-band']
  const reprice = groups['latent:reprice-down']
  const costBand = groups['baseline:cost-band-below']
  const positiveResponse = groups['evidence:discount-positive-response']
  const negativeResponse = groups['evidence:discount-negative-response']
  const comparisons = dynamic.comparisons ?? []
  const responseCost = comparisons.find((item) => item.id === 'positive-response-vs-cost-band')
  const distribution = dynamic.horizonDistribution ?? {}
  const lines = [
    '# Latent Liquidity Cost Band — 动态周期无未来数据验证',
    '',
    `- 市场：${summary.market}；可用标的：${summary.dataSnapshot.usableSymbols}/${summary.dataSnapshot.requestedSymbols}`,
    `- 本地快照截止：${summary.dataSnapshot.firstDataThrough ?? '未知'} ~ ${summary.dataSnapshot.lastDataThrough ?? '未知'}`,
    `- 年化交易会话基数：${summary.evaluation.protocol?.cycle?.tradingDaysPerYear ?? '缺失'}；来源：${summary.evaluation.protocol?.cycle?.tradingDaysPerYearSource ?? '缺失'}。`,
    '- 每个事件独立计算 recoveryFraction_t、HL_t 与 H_t；不存在固定主期、持有期下限、上限或日历周期回退。',
    `- 公式周期样本：${distribution.samples ?? 0}；H_t 分布：${number(distribution.minimum)} / ${number(distribution.p10)} / ${number(distribution.median)} / ${number(distribution.p90)} / ${number(distribution.maximum)}（min / p10 / median / p90 / max，交易会话）。`,
    `- q_t p10 / median / p90：${pct(distribution.recoveryFraction?.p10)} / ${pct(distribution.recoveryFraction?.median)} / ${pct(distribution.recoveryFraction?.p90)}；leave-then-return recurrence 中位数：${number(distribution.recurrencePeriodSessions?.median)} 个交易会话（与目标周期不是同一量）。`,
    `- CK alpha_t p10 / median / p90：${number(distribution.ckSkewAlpha?.p10)} / ${number(distribution.ckSkewAlpha?.median)} / ${number(distribution.ckSkewAlpha?.p90)}；x*(alpha_t) 中位数：${pct(distribution.ckRangeWidth?.median)}；较小侧 ESS 中位数 ${number(distribution.ckAlphaMinimumEffectiveSamples?.median)}、log-alpha SE 中位数 ${number(distribution.ckAlphaLogStandardError?.median)}，仍属弱识别情景。`,
    `- 状态：${summary.decisionBoundary.status}。${summary.decisionBoundary.meaning}`,
    `- 提升门槛：${dynamic.promotion?.status ?? 'not-promoted'}${dynamic.promotion?.failures?.length ? `；未满足：${dynamic.promotion.failures.join('；')}` : ''}`,
    '',
    '## 动态周期汇总',
    '',
    '| 组别 | 信号 | 目标命中率 | 方向调整平均收益 | 原始平均收益 | 平均 MAE | 平均 H_t |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    tableRow('support-candidate（下沿吸收）', support),
    tableRow('reprice-risk（下行重定价）', reprice),
    tableRow('折价 + 正向收盘反应', positiveResponse),
    tableRow('折价 + 负向收盘反应', negativeResponse),
    tableRow('成本带下方基线', costBand),
    '',
    responseCost
      ? `折价 + 正向收盘反应相对成本带基线：周期分层方向收益差 ${pct(responseCost.durationAdjusted?.returnDifference)}；周期分层目标命中率差 ${pct(responseCost.durationAdjusted?.successRateDifference)}。`
      : '样本不足，未形成“正向收盘反应 vs 成本带”比较。',
    '',
    '## 预注册比较',
    '',
    '| 比较 | 周期分层收益差 | 周期分层命中率差 | 交易会话区块长度 | 区块收益差 95% | 区块命中率差 95% |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...comparisons.map(
      (item) =>
        `| ${item.id} | ${pct(item.durationAdjusted?.returnDifference)} | ${pct(item.durationAdjusted?.successRateDifference)} | ${number(item.bootstrap?.blockSessions)} | ${intervalPct(item.bootstrap?.returnDifference95)} | ${intervalPct(item.bootstrap?.successRateDifference95)} |`,
    ),
    '',
    '## 年度稳定性',
    '',
    '| 年份 | 折价+正向收盘：信号 | 命中率 | 方向调整平均收益 | 折价+负向收盘：信号 | 命中率 | 方向调整平均收益 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...yearlyRows(dynamic.yearly, 'evidence:discount-positive-response', 'evidence:discount-negative-response'),
    '',
    '## 公式边界',
    '',
    '- recoveryFraction_t 是“周期起点到冻结结构目标”占“周期起点到成本锚”的比例；它不是 CK 的 endpointFourthRoot。',
    '- CK x*(alpha_t) 是资本效率边际几何诊断，不是概率覆盖、收益目标或自动退出价。',
    '- recurrence 半径/周期是 CK Part 1 启发的项目扩展，不冒充 CK 已发表恒等式。',
    '- “吸收 / 重定价”仍是日线价量状态代理，不是做市商、主力或任何账户的身份、成本、库存或意图。',
    '- 信号日冻结锚、结构目标与 AR 系数；q_t/H_t 到 T+1 开盘才可计算。未来 K 线只用于评分。',
    '',
    '## 命令',
    '',
    '```bash',
    renderWalkForwardCommand(summary.market),
    'node --test research/latent-liquidity-lab/test/latentLiquidity.test.mjs',
    '```',
  ]
  return lines.join('\n')
}

function tableRow(name, group) {
  if (!group) return `| ${name} | — | — | — | — | — | — |`
  return `| ${name} | ${group.signals} | ${pct(group.successRate)} | ${pct(group.meanDirectionalReturn)} | ${pct(group.meanTerminalReturn)} | ${pct(group.meanMaxAdverseReturn)} | ${number(group.meanModelHorizonSessions)} |`
}

function inferMarketTdpy(market) {
  const inferred = inferTdpy({ market })
  if (inferred.basis === 'fallback') {
    throw new TypeError(`无法为市场 ${market} 推导 tradingDaysPerYear；请先在项目 TDPY 映射中声明该市场`)
  }
  return inferred
}

function resolveOutputDir(requestedOutput, tdpyBasis) {
  const legacyDirs = new Set(
    [
      'research/latent-liquidity-lab/results',
      'research/latent-liquidity-lab/results/hk',
      'research/latent-liquidity-lab/results/us',
    ].map((path) => resolve(ROOT, path)),
  )
  const outputDir = resolve(
    ROOT,
    requestedOutput ?? `research/latent-liquidity-lab/results/${RESULT_SCHEMA_VERSION}/${tdpyBasis}`,
  )
  if (legacyDirs.has(outputDir)) {
    throw new Error(`拒绝覆盖旧协议证据目录：${outputDir}`)
  }
  return outputDir
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'
}

function number(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '—'
}

function intervalPct(interval) {
  return Number.isFinite(interval?.lower) && Number.isFinite(interval?.upper)
    ? `[${pct(interval.lower)}, ${pct(interval.upper)}]`
    : '—'
}

function yearlyRows(yearly, positiveModel, negativeModel) {
  const positive = yearly?.[positiveModel] ?? {}
  const negative = yearly?.[negativeModel] ?? {}
  const years = [...new Set([...Object.keys(positive), ...Object.keys(negative)])].sort()
  return years.length
    ? years.map((year) => {
        const up = positive[year]
        const down = negative[year]
        return `| ${year} | ${up?.signals ?? '—'} | ${pct(up?.successRate)} | ${pct(up?.meanDirectionalReturn)} | ${down?.signals ?? '—'} | ${pct(down?.successRate)} | ${pct(down?.meanDirectionalReturn)} |`
      })
    : ['| — | — | — | — | — | — | — |']
}

function parseArgs(values) {
  return Object.fromEntries(
    values.map((value) => {
      const matched = /^--([^=]+)(?:=(.*))?$/.exec(value)
      return matched ? [matched[1], matched[2] ?? true] : [value, true]
    }),
  )
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
