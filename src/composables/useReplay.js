import { computed } from 'vue'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'

/**
 * 回放层：跑当前 profile 的回放，再并行跑三档 profile 用于评分选档
 *
 * @param {Ref<Array>} rows
 * @param {object} input              reactive；目前只用于 chooseProfile 的 capital/baseNotional 评分
 * @param {ComputedRef<object>} effectiveInput  buildDailyReplay 的真正信源（labStore 当前传入的是 baseInput）
 * @param {ComputedRef<Array>} marketStateFull  来自 useMarketState，避免重算
 * @param {object} featureFlags                 显式开关；默认不跑回放
 *
 * Dedupe 优化：原版 profileReplays 与 replay 各自调 buildDailyReplay，
 * 同一个 input 变化要算 4 次。新版 replay 从 profileReplays 中按
 * effectiveInput.strategyProfile 取那一条，总调用从 4 次降到 3 次
 * （= strategyProfileList.length）。
 *
 * 单一信源：profileReplays 与 fallback 路径都基于 effectiveInput.value 派生，
 * 仅 strategyProfile 一个字段不同。如果调用方未来把更多字段（如 lpOnchainSnapshot）
 * 写进 effectiveInput 且 buildDailyReplay 开始消费它，dedupe 仍然保持等价；
 * 不会出现 shape 漂移。
 */
export function useReplay(rows, input, effectiveInput, marketStateFull, featureFlags = {}) {
  const profileReplays = computed(() => strategyProfileList.map((profile) => ({
    profile,
    replay: featureFlags.replayAccount
      ? buildDailyReplay(rows.value, { ...effectiveInput.value, strategyProfile: profile.id }, marketStateFull.value)
      : emptyReplay(),
  })))

  const recommendedProfile = computed(() => chooseProfile(
    profileReplays.value,
    Number(input.capital) + Number(input.baseNotional || 0),
  ))

  // dedupe: replay 直接复用 profileReplays 中匹配 effectiveInput.strategyProfile 的那条；
  // 如果 strategyProfileList 中没有对应 id（极端 fallback），临时算一次保证可用。
  const replay = computed(() => {
    if (!featureFlags.replayAccount) return emptyReplay()
    const targetId = effectiveInput.value.strategyProfile
    const hit = profileReplays.value.find((item) => item.profile.id === targetId)
    if (hit) return hit.replay
    return buildDailyReplay(rows.value, effectiveInput.value, marketStateFull.value)
  })

  return { profileReplays, recommendedProfile, replay }
}

function emptyReplay() {
  return {
    profileId: '',
    profileLabel: '',
    range: '',
    startDate: '',
    endDate: '',
    trades: [],
    equityCurve: [],
    tradeCount: 0,
    winRate: 0,
    totalPnl: 0,
    realizedPnl: 0,
    totalNotional: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    drawdownCurve: [],
    cash: 0,
    base: 0,
    openValue: 0,
    openCost: 0,
    status: 'disabled',
  }
}

function chooseProfile(items, capital) {
  if (!items.length) return strategyProfileList[1]
  if (items.every((item) => item.replay?.status)) return strategyProfileList[1]
  const accountSize = Math.max(capital || 0, 1)
  const scored = items.map((item) => {
    const replay = item.replay
    const drawdownPenalty = Math.abs(replay.maxDrawdown || 0) / accountSize
    const turnoverPenalty = Math.max(replay.tradeCount - 36, 0) * 0.0008
    const emptyPenalty = replay.tradeCount ? 0 : 0.01
    return {
      profile: item.profile,
      score: (replay.returnOnUsedNotional || 0) - drawdownPenalty * 0.85 - turnoverPenalty - emptyPenalty,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.profile ?? strategyProfileList[1]
}
