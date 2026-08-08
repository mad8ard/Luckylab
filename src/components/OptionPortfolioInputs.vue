<script setup>
import { computed, onMounted, watch } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
})

const strategies = [
  { id: 'single', label: '单腿', hint: '单个 call / put' },
  { id: 'vertical', label: '价差', hint: '买一腿、卖一腿' },
  { id: 'straddle', label: '跨式', hint: '同 K 的 call + put' },
  { id: 'strangle', label: '宽跨', hint: '低 K put + 高 K call' },
  { id: 'collar', label: '领口', hint: '保护 put + 备兑 call' },
]

const optionTypes = [
  { id: 'put', label: 'Put' },
  { id: 'call', label: 'Call' },
]

const sides = [
  { id: 'long', label: '买入' },
  { id: 'short', label: '卖出' },
]

const strategy = computed(() => props.input.optionStrategy || 'single')
const needsType = computed(() => ['single', 'vertical'].includes(strategy.value))
const needsSide = computed(() => strategy.value !== 'collar')
const needsSecondStrike = computed(() => ['vertical', 'strangle', 'collar'].includes(strategy.value))
const secondStrikeLabel = computed(() => {
  if (strategy.value === 'vertical') return '远端行权价'
  if (strategy.value === 'collar') return '卖购行权价'
  return '高行权价'
})

const widthP = computed({
  get: () => toPercent(props.input.optionWidthPct),
  set: (v) => {
    props.input.optionWidthPct = fromPercent(v, 5)
    syncStrikesFromWidth()
  },
})

const rfrP = computed({
  get: () => toPercent(props.input.riskFreeRate),
  set: (v) => { props.input.riskFreeRate = fromPercent(v, 4) },
})

const premiumInput = computed({
  get: () => positive(props.input.optionPremium) ?? '',
  set: (v) => {
    const next = Number(v)
    props.input.optionPremium = Number.isFinite(next) && next > 0 ? next : 0
  },
})

const summary = computed(() => {
  const side = props.input.optionSide === 'short' ? '卖出' : '买入'
  const type = props.input.optionType === 'call' ? 'Call' : 'Put'
  const k1 = fmt(props.input.strikePrice)
  const k2 = fmt(props.input.strikePrice2)
  if (strategy.value === 'vertical') return `${side} ${type} 价差：${k1} / ${k2}`
  if (strategy.value === 'straddle') return `${side}跨式：Call + Put @ ${k1}`
  if (strategy.value === 'strangle') return `${side}宽跨：Put ${k1} + Call ${k2}`
  if (strategy.value === 'collar') return `领口：买 Put ${k1} + 卖 Call ${k2}`
  return `${side} ${type} @ ${k1}`
})

onMounted(() => ensureOptionDefaults())
watch(() => props.input.entryPrice, () => ensureOptionDefaults())

function setStrategy(id) {
  props.input.optionStrategy = id
  syncStrikesFromWidth(true)
}

function setOptionType(id) {
  props.input.optionType = id
  if (strategy.value === 'vertical') syncStrikesFromWidth(true)
}

function setSide(id) {
  props.input.optionSide = id
}

function useAtm() {
  const entry = positive(props.input.entryPrice)
  if (!entry) return
  props.input.strikePrice = round(entry)
  syncStrikesFromWidth(true)
}

function setWidth(value) {
  props.input.optionWidthPct = value
  syncStrikesFromWidth(true)
}

function ensureOptionDefaults() {
  if (!['single', 'vertical', 'straddle', 'strangle', 'collar'].includes(props.input.optionStrategy)) props.input.optionStrategy = 'single'
  if (!['put', 'call'].includes(props.input.optionType)) props.input.optionType = 'put'
  if (!['long', 'short'].includes(props.input.optionSide)) props.input.optionSide = 'long'
  if (!positive(props.input.optionQuantity)) props.input.optionQuantity = 1
  if (!positive(props.input.optionMultiplier)) props.input.optionMultiplier = 1
  if (!positive(props.input.optionWidthPct)) props.input.optionWidthPct = 0.05
  if (!nonNegative(props.input.riskFreeRate)) props.input.riskFreeRate = 0.04
  if (!positive(props.input.strikePrice) && positive(props.input.entryPrice)) props.input.strikePrice = round(props.input.entryPrice)
  if (needsSecondStrike.value && !positive(props.input.strikePrice2)) syncStrikesFromWidth(true)
}

function syncStrikesFromWidth(resetPrimary = false) {
  const entry = positive(props.input.entryPrice)
  if (!entry) return
  const width = positive(props.input.optionWidthPct) ?? 0.05
  if (strategy.value === 'strangle' || strategy.value === 'collar') {
    if (resetPrimary) props.input.strikePrice = round(entry * (1 - width))
    props.input.strikePrice2 = round(entry * (1 + width))
    return
  }
  if (strategy.value === 'vertical') {
    const k1 = positive(props.input.strikePrice) ?? entry
    const sign = props.input.optionType === 'call' ? 1 : -1
    props.input.strikePrice2 = round(k1 * (1 + sign * width))
  }
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function nonNegative(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
}

function round(value) {
  return Number(value.toFixed(2))
}

function toPercent(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : 0
}

function fromPercent(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n / 100 : fallback / 100
}

function fmt(value) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
    : '—'
}
</script>

<template>
  <div class="opi-card">
    <div class="opi-head">
      <div>
        <span>研究层</span>
        <strong>期权组合</strong>
      </div>
      <small>不写入模拟挂单</small>
    </div>

    <div class="opi-strategies" role="group" aria-label="期权组合">
      <button
        v-for="item in strategies"
        :key="item.id"
        type="button"
        :class="{ active: strategy === item.id }"
        :title="item.hint"
        @click="setStrategy(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="opi-summary">
      <b>{{ summary }}</b>
      <span>仅用于组合敏感度、到期损益和 LP payoff 对照。</span>
    </div>

    <div class="opi-controls">
      <div v-if="needsType" class="opi-segment">
        <button
          v-for="item in optionTypes"
          :key="item.id"
          type="button"
          :class="{ active: input.optionType === item.id }"
          @click="setOptionType(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="needsSide" class="opi-segment">
        <button
          v-for="item in sides"
          :key="item.id"
          type="button"
          :class="{ active: input.optionSide === item.id }"
          @click="setSide(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <button type="button" class="opi-ghost" @click="useAtm">ATM</button>
    </div>

    <div class="opi-grid">
      <label>
        <span>{{ strategy === 'strangle' || strategy === 'collar' ? '低行权价' : '行权价' }}</span>
        <input v-model.number="input.strikePrice" type="number" step="0.01" />
      </label>
      <label v-if="needsSecondStrike">
        <span>{{ secondStrikeLabel }}</span>
        <input v-model.number="input.strikePrice2" type="number" step="0.01" />
      </label>
      <label>
        <span>数量</span>
        <input v-model.number="input.optionQuantity" type="number" min="0.0001" step="1" />
      </label>
      <label>
        <span>乘数</span>
        <input v-model.number="input.optionMultiplier" type="number" min="0.0001" step="1" />
      </label>
    </div>

    <details class="opi-advanced">
      <summary>高级输入</summary>
      <div class="opi-grid">
        <label>
          <span>首腿权利金</span>
          <input v-model="premiumInput" type="number" min="0" step="0.01" placeholder="模型估算" />
        </label>
        <label>
          <span>无风险利率%</span>
          <input v-model.number="rfrP" type="number" step="0.1" />
        </label>
        <label>
          <span>区间宽度%</span>
          <input v-model.number="widthP" type="number" min="0.1" step="0.5" />
        </label>
        <label>
          <span>流动性宽度</span>
          <input v-model.number="input.rangeWidth" type="number" min="0.001" step="0.01" />
        </label>
      </div>
      <div class="opi-widths">
        <button type="button" @click="setWidth(0.03)">3%</button>
        <button type="button" @click="setWidth(0.05)">5%</button>
        <button type="button" @click="setWidth(0.1)">10%</button>
      </div>
    </details>
  </div>
</template>

<style>
.opi-card { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.opi-head { display: flex; justify-content: space-between; gap: 10px; align-items: end; }
.opi-head div { display: grid; gap: 1px; }
.opi-head span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.opi-head strong { font-size: 0.95rem; }
.opi-head small { color: var(--muted); font-size: 0.64rem; font-weight: 800; text-align: right; }
.opi-strategies,
.opi-controls,
.opi-segment,
.opi-widths { display: flex; gap: 5px; flex-wrap: wrap; }
.opi-strategies button,
.opi-controls button,
.opi-widths button { min-height: 28px; padding: 4px 8px; border-radius: 5px; font-size: 0.72rem; }
.opi-strategies button.active,
.opi-segment button.active { border-color: var(--green); background: var(--surface-active); color: var(--green); }
.opi-summary { display: grid; gap: 2px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
.opi-summary b { font-size: 0.78rem; }
.opi-summary span { color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
.opi-controls { align-items: center; }
.opi-segment { padding: 2px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
.opi-segment button { min-height: 24px; border: 0; background: transparent; padding: 3px 8px; font-size: 0.7rem; }
.opi-ghost { margin-left: auto; }
.opi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.opi-grid label { display: grid; gap: 2px; min-width: 0; }
.opi-grid span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.opi-grid input { min-width: 0; min-height: 28px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.opi-advanced { border-top: 1px solid var(--line); padding-top: 6px; }
.opi-advanced summary { color: var(--muted); cursor: pointer; font-size: 0.68rem; font-weight: 800; }
.opi-advanced[open] { display: grid; gap: 8px; }
.opi-widths button { min-height: 24px; padding: 2px 8px; font-size: 0.68rem; }
</style>
