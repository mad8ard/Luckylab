// liquidityRackModel meta：拼装可视化层的来源/目的/缺口提示文案。
//
// 池级快照与 tick 对比随加密标的移除后不再存在，因此这里只描述模型目标仓，
// 并如实声明真实池证据缺失。

import { gapModeLabel } from './utils.js'

export function buildMeta({
  orders,
  fingerprint = null,
  viewMode = 'compare',
  gapMode = 'shortfall',
  hasRealSignal = false,
  hasCalibrationSignal = false,
}) {
  const nextInputs = [
    '接入匹配的池级聚合快照',
    '补充 tick 分布 / liquidityGross / liquidityNet 或区间深度',
    '接入完整 Position NFT 区间和本金',
    '补充 1inch/订单簿路径、成交队列、撤单行为',
  ]
  const realPending = !hasRealSignal && viewMode !== 'simulate'
  return {
    title: realPending
      ? '真实 tick 深度待接入'
      : viewMode === 'real'
        ? '链上 tick 深度'
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
      ? hasCalibrationSignal
        ? '池报价只校准当前价；真实 tick 深度未接入，暂显示模型目标仓'
        : '未匹配链上池，暂显示模型目标仓'
      : viewMode === 'real'
        ? '链上池级快照用于校准当前状态'
        : viewMode === 'simulate'
          ? '模拟目标仓表达策略意图'
          : viewMode === 'gap'
            ? `模型目标仓减真实 tick 深度的${gapModeLabel(gapMode)}视图`
            : '模拟目标仓和真实 tick 深度并排对照',
    dataLabel: '未匹配链上池级快照，当前只显示模型目标仓参考',
    orderLabel: orders.length ? '挂单刻度来自模拟挂单' : '当前未生成模拟挂单',
    purpose: [
      '把目标分配权重离散成价格层级，观察挂单是否落在策略目标区。',
      '辅助订单流视角看成本、现价、Delta 带和计划挂单的相对位置。',
      '研究层可以切换模拟、对照和缺口视图，不反向改写默认挂单结论。',
    ],
    layers: [
      {
        label: '权重',
        value: '模型目标 LP 分配',
        note: '由底层核、成本锚、现价、区间和模拟挂单混合生成；不是价格概率',
      },
      {
        label: '链上',
        value: hasRealSignal ? '真实 tick 深度' : '待匹配',
        note: '聚合报价只校准现价，不替代 tick 深度',
      },
      { label: 'BID/ASK', value: '相对现价分侧', note: '低于现价归 BID，高于现价归 ASK' },
      { label: '挂单', value: '我们的模拟刻度', note: '来自模拟挂单，不是市场订单簿' },
    ],
    nextInputs,
    missing: nextInputs,
    lpMode: 'fallback',
    lpModeLabel: '待匹配',
    hasRealSignal,
    hasCalibrationSignal,
  }
}