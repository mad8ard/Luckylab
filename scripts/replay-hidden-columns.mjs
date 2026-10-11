// REPLAY 报告页要隐藏的成交行字段。
//
// 只影响网页显示：JSON 快照与 replay CLI 的输出完全不变（数据逻辑一律不动）。
// 以后想增减，改这一个文件即可，渲染器会自动同步表格列与底部注释。
//
// 分类依据（用当前 35 笔成交核对过）：
//   A. 全空        —— 没有声明滑点、订单规模、流动性门槛时恒为 null
//   B. 恒定        —— 35 笔取值完全相同，放成列只是噪音
//   C. 重复        —— 与相邻字段表达同一件事
//   D. 嵌套元数据  —— 整块对象塞进单元格，既读不了也占宽度

export const HIDDEN_TRADE_COLUMNS = new Set([
  // A. 全空：执行现实层未声明时恒为 null
  'entryParticipation',
  'entryVolumeCap',
  'entryVolumeCapExceeded',
  'exitVolumeCapExceeded',
  'entryLiquidityAvgVolume',
  'entryLiquidityAvgTurnover',
  'entryLiquidityWindowRows',
  'profileFixedTargetReturnPct',
  'baseAnchorSessions',
  'stretchSessions',

  // B. 恒定：35 笔完全一致
  'profile',
  'candidateStatus',
  'holdingGateVerdict',
  'holdingGateBlocked',
  'holdingGateBlockedReasons',
  'holdingGatePhase',
  'holdingGatePolicy',
  'holdingGateShortTradeAction',
  'ckGeometryModel',
  'ckGeometryInterpretation',
  'claimClasses',
  'dataState',
  'dataStateReasons',
  'deviationProbabilitySemantics',
  'dynamicStatus',
  'eligible',
  'empiricalDeviationInterpretation',
  'entryAtPriceLimitUp',
  'executionAuthority',
  'executionReasons',
  'executionStatus',
  'exitSessionLimitDown',
  'fundPlan',
  'shortPlan',
  'holdingWindowZeroVolumeSessions',
  'horizonMode',
  'intrabarPolicy',
  'meanReversionDecayMode',
  'modelHorizonStatus',
  'scoreStatus',
  'settlementLagSessions',
  'slippageModel',
  'slippageRate',
  'staleDays',
  'targetContextPolicy',
  'targetId',
  'targetMode',
  'targetRecomputedAtEntry',
  'targetTiming',
  'waitingReasons',

  // C. 重复：与相邻字段同义
  'status',
  'statusReasons',
  'nameSource',
  'market',
  'source',
  'fixedHorizonApplied',
  'profileMinimumGrossReturnPct',
  'profileStopPct',

  // D. 嵌套元数据：整块对象
  'provenance',
  'freshness',
  'adaptiveWindowSpec',
  'dynamicHolding',
  'intrabarBothHit',
])

// 顶部“顶层输出块”注释里同样不再显示这三个（它们只在 JSON 里保留）
export const HIDDEN_TOP_LEVEL_BLOCKS = new Set(['provenance', 'freshness', 'claimClasses', 'skipped'])