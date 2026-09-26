// 真实 tick / 池级对照层。
//
// 加密池快照管道已随加密标的整体移除，任何真实池与 tick 证据都不可能再进入
// 流动性指纹。该档位因此恒为空状态，rack 固定停在模型目标仓视图。

import { normalizeBinCount } from './utils.js'

export function buildRealPoolProfile({ binCount }) {
  const count = normalizeBinCount(binCount)
  return {
    hasSignal: false,
    hasCalibrationSignal: false,
    evidence: 'missing',
    pool: null,
    pools: [],
    routes: [],
    ticks: [],
    quotePrice: null,
    quoteSymbol: null,
    liquidity: null,
    blockNumber: null,
    coverage: null,
    weights: Array.from({ length: count }, () => 0),
    calibrationWeights: Array.from({ length: count }, () => 0),
  }
}