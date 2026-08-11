<script setup>
import { computed } from 'vue'

const props = defineProps({
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
  input: { type: Object, default: null },
})

const isDisabled = computed(() => props.replay.status === 'disabled')
const isMissingAccount = computed(() => props.replay.status === 'missing-account-input')
const isMissingFee = computed(() => props.replay.status === 'missing-replay-fee-input')
const isMissingInput = computed(() => isMissingAccount.value || isMissingFee.value)
const isRunnable = computed(() => !isDisabled.value && !isMissingInput.value)
const replayFeePct = computed({
  get: () => (Number.isFinite(props.input?.replayFeeRate) ? props.input.replayFeeRate * 100 : null),
  set: (value) => {
    if (!props.input) return
    props.input.replayFeeRate =
      value === '' || value === null || value === undefined || !Number.isFinite(Number(value))
        ? null
        : Number(value) / 100
  },
})
const titleValue = computed(() => {
  if (isDisabled.value) return '未启用'
  if (isMissingInput.value) return '未运行'
  return money(props.replay.totalPnl)
})
const statusText = computed(() => {
  if (isDisabled.value) return '现货路径回放未启用'
  if (isMissingAccount.value) return '需要账户资金或底仓名义'
  if (isMissingFee.value) return '需要显式回放总费率；系统不注入隐藏默认值'
  return `${props.replay.range || '等待样本'} · 下一根 K 线验证`
})
const showProfileScan = computed(() => isRunnable.value && props.profileReplays.some((item) => !item.replay?.status))
const drawdownBasis = computed(
  () =>
    props.replay.drawdownBasis ?? {
      label: '现货路径回撤',
      source: '成本路径 → GetDelta → 偏离强度 → OrderPlan',
      note: '这里只是现货账户权益路径；期权、LP、资金费率和流动性重分配还没有进入组合回测引擎。',
    },
)
const engineScope = computed(
  () =>
    props.replay.engineScope ?? {
      label: '现货路径回放',
      status: 'partial',
      excludes: ['期权腿生命周期', 'LP 区间库存', '资金费率结算', '流动性重分配治理'],
    },
)
const emptyText = computed(() => {
  if (isDisabled.value) return '现货路径回放未启用。'
  if (isMissingAccount.value) return '填写账户资金或底仓名义后，才运行现货路径回放并显示成交记录。'
  if (isMissingFee.value) return '填写回放总费率后才运行；0% 也必须显式填写。'
  const audit = props.replay.candidateAudit
  const directional = (audit?.diagnosticBuyPrefixes ?? 0) + (audit?.diagnosticSellPrefixes ?? 0)
  if (directional && !audit?.acceptedCandidates) {
    return `${directional} 个诊断方向前缀均未通过候选门禁，因此没有生成模拟成交。`
  }
  if (directional) {
    return `${directional} 个诊断方向前缀中有 ${audit.acceptedCandidates} 个进入候选观察，但未形成下一根 K 线模拟成交。`
  }
  return '当前样本没有形成路径回放成交。'
})

function money(value) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function pct(value) {
  if (!Number.isFinite(value)) return '无'
  return `${(value * 100).toFixed(1)}%`
}
</script>

<template>
  <section class="replay-panel">
    <header>
      <span>{{ engineScope.label }}</span>
      <strong>{{ titleValue }}</strong>
      <small>{{ statusText }}</small>
    </header>
    <div v-if="isRunnable" class="replay-grid">
      <article>
        <span>历史成交</span>
        <strong>{{ replay.tradeCount }}</strong>
      </article>
      <article>
        <span>历史正收益率</span>
        <strong>{{ pct(replay.winRate) }}</strong>
      </article>
      <article>
        <span>历史情景回报</span>
        <strong>{{ pct(replay.returnOnUsedNotional) }}</strong>
      </article>
      <article>
        <span>最大回撤</span>
        <strong>{{ money(replay.maxDrawdown) }} · {{ pct(replay.maxDrawdownPct) }}</strong>
        <small v-if="replay.maxDrawdownStart && replay.maxDrawdownEnd">
          {{ replay.maxDrawdownStart }} → {{ replay.maxDrawdownEnd }}
        </small>
      </article>
      <article>
        <span>现金</span>
        <strong>{{ money(replay.cash) }}</strong>
      </article>
      <article>
        <span>持仓市值</span>
        <strong>{{ money(replay.openValue) }}</strong>
      </article>
    </div>
    <div v-if="isRunnable" class="replay-basis">
      <span>{{ drawdownBasis.label }}</span>
      <strong>{{ drawdownBasis.source }}</strong>
      <small>{{ drawdownBasis.note }}</small>
      <em>{{ engineScope.excludes.join('、') }} 未接入</em>
    </div>
    <div v-if="showProfileScan" class="profile-scan">
      <article
        v-for="item in profileReplays"
        :key="item.profile.id"
        :class="{ active: item.profile.id === activeProfileId }"
      >
        <span>{{ item.profile.label }}</span>
        <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
        <small
          >最大回撤 {{ money(item.replay.maxDrawdown) }} · {{ pct(item.replay.maxDrawdownPct) }} /
          {{ item.replay.tradeCount }} 次</small
        >
      </article>
    </div>
    <table v-if="isRunnable && replay.trades.length">
      <tbody>
        <tr v-for="trade in replay.trades.slice(-4).reverse()" :key="`${trade.signalDate}-${trade.fillDate}`">
          <td>{{ trade.side === 'buy' ? '买' : '卖' }}</td>
          <td>{{ trade.fillDate }}</td>
          <td>{{ trade.reason }}</td>
          <td :class="{ positive: trade.pnl > 0, negative: trade.pnl < 0 }">{{ money(trade.pnl) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="replay-empty">
      {{ emptyText }}
    </p>
    <div v-if="isMissingInput && input" class="replay-account-inputs">
      <label>
        <span>账户资金</span>
        <input v-model.number="input.capital" type="number" min="0" step="100" />
      </label>
      <label>
        <span>底仓名义</span>
        <input v-model.number="input.baseNotional" type="number" min="0" step="100" />
      </label>
      <label>
        <span>回放总费率 %</span>
        <input v-model.number="replayFeePct" type="number" min="0" step="0.01" placeholder="需显式填写" />
      </label>
    </div>
  </section>
</template>
