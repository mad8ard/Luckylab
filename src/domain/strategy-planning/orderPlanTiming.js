import { deviationScore } from '../formulas/core.js'
import { ensureExecutableProfile } from './orderPlanProfile.js'
import { clamp, erfApprox, formatPrice, pctFmt, positive } from './orderPlanUtils.js'
import { strategyProfiles } from './strategyProfile.js'

export function buildEntryTiming(market, bands, profile = strategyProfiles.balanced, inputs = {}) {
  const executableProfile = ensureExecutableProfile(profile, market)
  const atr = market.atrPercent || 0
  const formulaHorizonSessions = positive(inputs.formulaHorizonSessions)
  const explicitScenario = inputs.horizonMode === 'explicit-scenario'
  const hasFormulaBinding =
    explicitScenario ||
    (['long', 'short'].includes(inputs.formulaHorizonSide) &&
      positive(inputs.horizonAnchorPrice) &&
      positive(inputs.horizonTargetPrice) &&
      positive(inputs.horizonHalfLifeSessions))
  const belowCost = market.markPrice < market.costLow
  const aboveCost = market.markPrice > market.costHigh
  const regimeLabel = belowCost ? '折价区' : aboveCost ? '溢价区' : '成本带内'

  if (!belowCost && !aboveCost) {
    return waitTiming({
      state: '成本带内',
      reason: `现价 ${formatPrice(market.markPrice)} 位于成本带 ${formatPrice(market.costLow)}–${formatPrice(market.costHigh)} 内，当前没有方向明确的修复或减仓结构。`,
      facts: {
        regime: regimeLabel,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'no-active-direction-not-confidence-or-win-probability',
        triggeredConditions: ['价格位于成本带内'],
        blockedReasons: ['当前没有方向明确的结构信号'],
        missingInputs: [],
      },
    })
  }

  if (aboveCost && !explicitScenario && inputs.formulaHorizonSide !== 'short') {
    return waitTiming({
      state: '执行上沿周期待推导',
      reason: '价格已高于成本上沿；长侧成本下沿修复周期不适用于减仓，尚缺独立的 short-side 执行结构目标与周期。',
      facts: {
        regime: regimeLabel,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'missing-short-side-structure-not-confidence-or-win-probability',
        triggeredConditions: ['价格高于成本带'],
        blockedReasons: ['尚未定义与上沿减仓执行方向绑定的结构目标和周期'],
        missingInputs: ['short-side-target-horizon-binding'],
      },
    })
  }

  const missingFormulaInputs = [
    formulaHorizonSessions ? null : 'formula-derived-horizon',
    hasFormulaBinding ? null : 'side-target-horizon-binding',
    positive(inputs.iv) ? null : 'volatility',
    positive(inputs.tradingDaysPerYear) ? null : 'trading-days-per-year',
    bands ? null : 'delta-band',
  ].filter(Boolean)
  if (missingFormulaInputs.length) {
    return waitTiming({
      state: formulaGateState({ formulaHorizonSessions, hasFormulaBinding, inputs, bands }),
      reason: formulaGateReason({ formulaHorizonSessions, hasFormulaBinding, inputs, bands }),
      facts: {
        regime: null,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'missing-formula-input-not-confidence-or-win-probability',
        triggeredConditions: [],
        blockedReasons: [formulaGateReason({ formulaHorizonSessions, hasFormulaBinding, inputs, bands })],
        missingInputs: missingFormulaInputs,
      },
    })
  }
  const deviation = deviationScore({
    costDistance: market.costDistance,
    annualVol: market.annualVol,
    formulaHorizonSessions,
    tradingDaysPerYear: inputs.tradingDaysPerYear,
  })
  const periodVol = deviation?.periodVol
  const zScore = deviation?.z ?? null
  if (!Number.isFinite(periodVol) || !Number.isFinite(zScore)) {
    return waitTiming({
      state: '波动待估计',
      reason: '周期波动或偏离值不可计算，默认挂单保持关闭。',
      facts: {
        regime: null,
        zScore: null,
        zStrength: null,
        costDistance: market.costDistance,
        signalStrength: 0,
        signalSemantics: 'missing-formula-input-not-confidence-or-win-probability',
        triggeredConditions: [],
        blockedReasons: ['周期波动不可计算'],
        missingInputs: ['period-volatility'],
      },
    })
  }
  const zAbs = Math.abs(zScore)

  const signalStrength = clamp(zAbs < 8 ? 1 - 2 * (1 - (0.5 + 0.5 * erfApprox(zAbs / Math.sqrt(2)))) : 1, 0, 1)

  // Dynamic edge: actual distance from cost, normalized by ATR
  const minEdge = Math.max(atr * executableProfile.edgeAtr, executableProfile.minEdge)
  const buyEdge = market.costAnchor > market.markPrice ? (market.costAnchor - market.markPrice) / market.markPrice : 0
  const sellEdge = market.markPrice > market.costAnchor ? (market.markPrice - market.costAnchor) / market.markPrice : 0

  const insideLongBand = !bands || market.markPrice >= bands.long.low
  const insideShortBand = !bands || market.markPrice <= bands.short.high
  const costStillFalling =
    market.costSlopeRecent < -Math.max(atr * executableProfile.costSlopeAtr, executableProfile.costSlopeMin)
  const momentumRising = market.momentumFast > executableProfile.momentumMin

  const zLabel = zAbs < 0.5 ? '弱' : zAbs < 1.5 ? '中' : '强'
  const momThresh = Math.max(atr * 0.5, 0.005)
  const momentumLabel = market.momentumFast > momThresh ? '↑' : market.momentumFast < -momThresh ? '↓' : '→'
  const slopeThresh = Math.max(atr * 0.2, 0.002)
  const costTrendLabel =
    market.costSlopeRecent < -slopeThresh ? '↓降' : market.costSlopeRecent > slopeThresh ? '↑升' : '→平'

  const confHigh = Math.max(0.6, 1 - atr * 12)
  const confMid = Math.max(0.3, 1 - atr * 24)
  const baseFacts = {
    regime: regimeLabel,
    zScore,
    zStrength: zLabel,
    costDistance: market.costDistance,
    signalStrength,
    signalSemantics: 'normal-reference-extremeness-not-confidence-or-win-probability',
    triggeredConditions: [],
    blockedReasons: [],
    missingInputs: [],
  }

  function buildReason() {
    const parts = [
      `${regimeLabel} · Z=${zScore.toFixed(2)}σ · ${zLabel}`,
      `动量 ${momentumLabel}`,
      `成本 ${costTrendLabel}`,
    ]
    if (belowCost && momentumRising && !costStillFalling) parts.push('动量止跌条件满足')
    if (belowCost && (costStillFalling || !momentumRising)) parts.push('止跌条件未满足')
    if (aboveCost) parts.push('处于成本带上方')
    return parts.join(' · ')
  }

  if (belowCost && !insideLongBand) {
    return waitTiming({
      state: '低于波动带',
      reason: `价格 ${formatPrice(market.markPrice)} 低于波动带下沿 ${formatPrice(bands?.long?.low)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带', '价格低于入场价情景 GetDelta 下沿'],
        blockedReasons: ['超出当前默认入场带，需要额外风控输入'],
      }),
    })
  }
  if (belowCost && (costStillFalling || !momentumRising)) {
    return waitTiming({
      state: '低于成本带',
      reason: `价格低于成本带 ${pctFmt(Math.abs(market.costDistance))}，但止跌条件未同时满足。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带'],
        blockedReasons: [
          costStillFalling ? '成本锚仍在下降' : null,
          !momentumRising ? '自适应快动量未越过策略档位阈值' : null,
        ].filter(Boolean),
      }),
    })
  }
  if (belowCost && buyEdge >= minEdge) {
    return activeTiming({
      state: '低于成本带',
      side: 'buy',
      action: signalStrength > confHigh ? '条件满足' : signalStrength > confMid ? '条件部分满足' : '条件观察',
      reason: buildReason(),
      signalStrength,
      edge: buyEdge,
      stop: Math.min(market.costLow, bands?.long.low ?? market.costLow),
      target: positive(inputs.horizonTargetPrice) ?? market.costLow,
      ...withFacts(baseFacts, {
        triggeredConditions: [
          '价格低于成本带',
          '成本未继续下行',
          '自适应快动量满足策略档位阈值',
          '折价幅度达到策略档位阈值',
        ],
      }),
    })
  }
  if (aboveCost && !insideShortBand) {
    return waitTiming({
      state: '高于波动带',
      reason: `价格 ${formatPrice(market.markPrice)} 高于波动带上沿 ${formatPrice(bands?.short?.high)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '价格高于入场价情景 GetDelta 上沿'],
        blockedReasons: ['模拟挂单不把研究层或高位状态翻译成追价动作'],
      }),
    })
  }
  if (aboveCost && sellEdge >= minEdge) {
    return activeTiming({
      state: '高于成本带',
      side: 'sell',
      action: signalStrength > confHigh ? '条件满足' : '条件部分满足',
      reason: buildReason(),
      signalStrength,
      edge: sellEdge,
      stop: Math.max(market.costHigh, bands?.short.high ?? market.costHigh),
      target: positive(inputs.horizonTargetPrice) ?? market.costHigh,
      ...withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '溢价幅度达到策略档位阈值'],
      }),
    })
  }
  if (zAbs < 0.5) {
    return waitTiming({
      state: '成本带内',
      reason: `偏离 ${zScore.toFixed(2)}σ，未达到信号条件。`,
      facts: withFacts(baseFacts, { blockedReasons: ['偏离幅度低于 0.5σ'] }),
    })
  }
  return waitTiming({
    state: regimeLabel,
    reason: `${regimeLabel} · 偏离 ${pctFmt(market.costDistance)} · 未达到信号条件`,
    facts: withFacts(baseFacts, { blockedReasons: ['价格位置或动量条件未同时满足'] }),
  })
}

function activeTiming(timing) {
  return { ...timing, path: timing.side === 'buy' ? '低于成本带条件链' : '高于成本带条件链' }
}

function waitTiming({ state, reason, facts }) {
  return {
    state,
    side: null,
    action: '未触发',
    path: '信号条件未触发',
    edge: 0,
    stop: null,
    target: null,
    reason,
    ...facts,
  }
}

function withFacts(baseFacts, patch = {}) {
  return {
    ...baseFacts,
    ...patch,
    triggeredConditions: patch.triggeredConditions ?? baseFacts.triggeredConditions,
    blockedReasons: patch.blockedReasons ?? baseFacts.blockedReasons,
    missingInputs: patch.missingInputs ?? baseFacts.missingInputs,
  }
}

function formulaGateState({ formulaHorizonSessions, hasFormulaBinding, inputs, bands }) {
  if (!formulaHorizonSessions) return '周期门禁未通过'
  if (!hasFormulaBinding) return '方向与目标未绑定'
  if (!positive(inputs.iv)) return '波动待估计'
  if (!positive(inputs.tradingDaysPerYear)) return '交易会话口径缺失'
  if (!bands) return '价格带待生成'
  return '公式门禁未通过'
}

function formulaGateReason({ formulaHorizonSessions, hasFormulaBinding, inputs, bands }) {
  if (!formulaHorizonSessions) return horizonReasonText(inputs.horizonReason)
  if (!hasFormulaBinding) return '方向、结构目标、成本锚和半衰期尚未形成同一周期绑定，默认挂单保持关闭。'
  if (!positive(inputs.iv)) return '缺少有效波动率口径，无法生成同周期 GetDelta 价格带。'
  if (!positive(inputs.tradingDaysPerYear)) return '缺少市场年交易会话基准，无法把年化波动换算到公式周期。'
  if (!bands) return '当前公式参数无法生成有限 GetDelta 价格带，默认挂单保持关闭。'
  return '公式门禁尚未满足，默认挂单保持关闭。'
}

function horizonReasonText(reason) {
  const labels = {
    'cycle-start-at-or-beyond-anchor': '当前观察价已到或越过成本锚，长侧成本下沿修复结构不适用。',
    'target-already-crossed-at-cycle-start': '当前观察价已越过成本下沿，该下沿不再是前向修复目标。',
    'target-not-strictly-between-cycle-start-and-anchor':
      '结构目标没有严格位于观察价与冻结成本锚之间，无法推导有限周期。',
    'non-monotonic-or-insufficient-ar-prefix': '当前样本尚未形成 0<AR 系数<1 的单调衰减证据，无法推导有限修复周期。',
    'invalid-recovery-input': '结构目标、成本锚、观察价或半衰期不完整，无法推导修复周期。',
    'non-finite-recovery-horizon': '当前结构对应的周期不是有限正数，默认挂单保持关闭。',
  }
  return labels[reason] ?? '当前结构尚未形成可用的公式周期，默认挂单保持关闭。'
}
