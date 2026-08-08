// liquidityRackModel meta：拼装可视化层的来源/目的/缺口提示文案。

import { compactUsd, gapModeLabel } from './utils.js'

export function buildMeta({
  orders,
  fingerprint = null,
  lpOnchain = null,
  viewMode = 'compare',
  gapMode = 'shortfall',
  hasRealSignal = false,
}) {
  const lpMode = lpOnchain?.inputMode ?? 'fallback'
  const pool = lpOnchain?.pool ?? null
  const coverage = lpOnchain?.poolCoverage ?? {}
  const routeCount = coverage.routeCount ?? (Array.isArray(lpOnchain?.quoteRoutes) ? lpOnchain.quoteRoutes.length : 0)
  const poolCount = coverage.poolCount ?? (Array.isArray(lpOnchain?.pools) ? lpOnchain.pools.length : 0)
  const quoteLabel =
    Array.isArray(coverage.quoteSymbols) && coverage.quoteSymbols.length ? coverage.quoteSymbols.join('+') : '稳定币'
  const poolLabel = poolCount > 1 ? `${poolCount} 个池 / ${routeCount} 条 ${quoteLabel} 路径` : pool?.label
  const reserveLabel = coverage.reserveUsd ? `，蓄水 ${compactUsd(coverage.reserveUsd)}` : ''
  const volumeLabel = coverage.volumeUsd24h ? `，24h ${compactUsd(coverage.volumeUsd24h)}` : ''
  const nextInputs = [
    lpMode === 'fallback' ? '接入匹配的池级聚合快照' : null,
    '补充 tick 分布 / liquidityGross / liquidityNet 或区间深度',
    lpMode === 'real' ? null : '接入钱包 Position NFT 区间和本金',
    '补充 1inch/订单簿路径、成交队列、撤单行为',
  ].filter(Boolean)
  const realPending = !hasRealSignal && viewMode !== 'simulate'
  return {
    title: realPending
      ? '真实层待匹配'
      : viewMode === 'real'
        ? '链上池状态'
        : viewMode === 'simulate'
          ? '模拟目标仓'
          : viewMode === 'gap'
            ? `目标仓${gapModeLabel(gapMode)}`
            : '目标仓 × 池状态',
    sourceLabel:
      fingerprint?.inputMode === 'hybrid-model'
        ? 'OHLCV 成本锚 + 现价/成本/区间/挂单成分 + log-Laplace 底层分布'
        : 'OHLCV 成本锚 + log-Laplace 目标分布',
    compositionLabel: realPending
      ? '未匹配链上池，暂显示模型目标仓'
      : viewMode === 'real'
        ? '链上池级快照用于校准当前状态'
        : viewMode === 'simulate'
          ? '模拟目标仓表达策略意图'
          : viewMode === 'gap'
            ? `模型目标仓减真实池状态的${gapModeLabel(gapMode)}视图`
            : '模拟目标仓和真实池状态并排对照',
    dataLabel:
      lpMode === 'real'
        ? '真实 Position NFT 已接入，可直接对照策略目标'
        : lpMode === 'pool-real'
          ? `${poolLabel ?? '聚合池快照'} 已接入${reserveLabel}${volumeLabel}，可校准模型目标仓`
          : '未匹配链上池级快照，当前只显示模型目标仓参考',
    orderLabel: orders.length ? '挂单刻度来自模拟挂单' : '当前未生成模拟挂单',
    purpose: [
      '把目标风险密度离散成价格层级，观察挂单是否落在合理密度区。',
      '辅助订单流视角看成本、现价、Delta 带和计划挂单的相对位置。',
      '研究层可以切换真实、模拟、对照和缺口，不反向改写默认挂单结论。',
    ],
    layers: [
      { label: '密度', value: '模型目标 LP 分布', note: '由底层分布、成本锚、现价、区间和模拟挂单混合生成' },
      {
        label: '链上',
        value: lpMode === 'pool-real' ? '聚合池路由' : lpMode === 'real' ? 'Position 快照' : '待匹配',
        note: poolLabel ?? '可作为校准层，不替代策略目标',
      },
      { label: 'BID/ASK', value: '相对现价分侧', note: '低于现价归 BID，高于现价归 ASK' },
      { label: '挂单', value: '我们的模拟刻度', note: '来自模拟挂单，不是市场订单簿' },
    ],
    nextInputs,
    missing: nextInputs,
    lpMode,
    lpModeLabel: lpMode === 'real' ? 'Position' : lpMode === 'pool-real' ? '聚合池' : '待匹配',
    hasRealSignal,
  }
}
