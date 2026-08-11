<script setup>
import { computed } from 'vue'
import { summarizeReason } from '../domain/decision/narrative.js'
import { formatFormulaBlockReason } from '../domain/formula-research/formulaInputLabels.js'
import { buildOrderPlanReviewPresentation } from '../domain/formula-research/formulaPresentation.js'
import { buildTraderChecklist } from '../domain/workbench/traderChecklist.js'
import { persistedRef } from '../composables/usePersisted.js'
import DisclosureSection from './DisclosureSection.vue'
import OrderTable from './OrderTable.vue'
import ReplayPanel from './ReplayPanel.vue'
import TraderChecklist from './TraderChecklist.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  sourceLabel: { type: String, default: '未载入' },
  rows: { type: Array, default: () => [] },
  observationDate: { type: String, default: '' },
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
  autoProfile: { type: Boolean, default: false },
  replayEnabled: { type: Boolean, default: false },
  portfolioEnabled: { type: Boolean, default: false },
  profileList: { type: Array, required: true },
  input: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['set-profile', 'set-auto-profile'])

const DEFAULT_SECTION_ORDER = [
  'sample',
  'account',
  'facts',
  'triggers',
  'orders',
  'replay',
  'profile',
  'checklist',
  'reason',
  'portfolio',
]
const sectionOrder = persistedRef('lab.decisionSectionOrder.v2', DEFAULT_SECTION_ORDER)

const reasonText = computed(() => {
  const decision = props.graph?.decision
  const market = props.market
  if (!decision || !market) return decision?.path || '载入 K 线后生成事实状态'
  return summarizeReason({
    state: decision.state,
    costDistance: market.costDistance,
    atrPercent: market.atrPercent,
    side: decision.timing?.side,
  })
})

const ordersTitle = computed(() => (props.graph?.decision?.timing?.side === 'sell' ? '模拟卖出单' : '模拟买入单'))

const checklist = computed(() => buildTraderChecklist({ graph: props.graph, market: props.market }))
const primaryOrders = computed(() => props.graph?.plan?.primaryOrders ?? [])
const orderReview = computed(() => buildOrderPlanReviewPresentation(props.graph))
const extremenessText = computed(() => `偏离极端度 ${Math.round((props.graph?.decision?.signalStrength ?? 0) * 100)}%`)
const factMeta = computed(() => {
  const decision = props.graph?.decision
  if (!decision) return '等待数据'
  const execution = decision.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行'
  return `${decision.state} · 候选${decision.candidateStatus ?? '等待'} · ${execution}`
})
const hasPositionFacts = computed(() =>
  [
    props.graph?.position?.firstNotional,
    primaryOrders.value[0]?.price,
    props.graph?.position?.stopPrice,
    props.graph?.position?.targetPrice,
    props.graph?.position?.riskBudget,
    props.graph?.position?.stopDistance,
  ].some(Number.isFinite),
)
const triggerMeta = computed(() => {
  const triggered = props.graph?.decision?.triggeredConditions?.length ?? 0
  const blocked = props.graph?.decision?.blockedReasons?.length ?? 0
  if (triggered) return `${triggered} 已触发`
  if (blocked) return `${blocked} 未触发`
  return '等待'
})
const replayMeta = computed(() => {
  if (!props.replayEnabled) return '未启用'
  if (['missing-account-input', 'missing-replay-fee-input'].includes(props.replay?.status)) return '缺输入'
  return `${props.replay?.tradeCount ?? 0} 次`
})
const hasRunnableProfileReplay = computed(
  () => props.replayEnabled && props.profileReplays.some((item) => !item.replay?.status),
)
const accountMeta = computed(() => {
  const capital = Math.max(Number(props.input?.capital) || 0, 0)
  const base = Math.max(Number(props.input?.baseNotional) || 0, 0)
  if (capital > 0 && base > 0) return '资金+底仓'
  if (capital > 0) return '仅现金'
  if (base > 0) return '仅底仓'
  return '缺输入'
})
const activeProfileLabel = computed(
  () => props.profileList.find((p) => p.id === props.activeProfileId)?.label ?? props.activeProfileId,
)
const sampleMeta = computed(() => {
  const count = props.rows.length
  const asOf = props.observationDate || props.rows.at(-1)?.date || '—'
  return `${count} K · ${asOf}`
})
const normalizedSectionOrder = computed(() => {
  const stored = Array.isArray(sectionOrder.value) ? sectionOrder.value : []
  const known = new Set(DEFAULT_SECTION_ORDER)
  const ordered = stored.filter((id) => known.has(id))
  return [...ordered, ...DEFAULT_SECTION_ORDER.filter((id) => !ordered.includes(id))]
})
const visibleSectionOrder = computed(() =>
  normalizedSectionOrder.value.filter((id) => {
    if (id === 'portfolio') return props.portfolioEnabled
    if (id === 'replay') return props.replayEnabled
    return true
  }),
)

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'
}
function sectionPosition(id) {
  return visibleSectionOrder.value.indexOf(id)
}
function sectionStyle(id) {
  return { order: sectionPosition(id) }
}
function canMoveSection(id, delta) {
  const index = sectionPosition(id)
  return index >= 0 && index + delta >= 0 && index + delta < visibleSectionOrder.value.length
}
function moveSection(id, delta) {
  const visible = visibleSectionOrder.value
  const index = visible.indexOf(id)
  const targetId = visible[index + delta]
  if (!targetId) return
  const order = normalizedSectionOrder.value.slice()
  const from = order.indexOf(id)
  const to = order.indexOf(targetId)
  if (from < 0 || to < 0) return
  const [item] = order.splice(from, 1)
  order.splice(to, 0, item)
  sectionOrder.value = order
}
</script>

<template>
  <div class="dd-drawer">
    <DisclosureSection
      title="样本"
      :meta="sampleMeta"
      movable
      :can-move-up="canMoveSection('sample', -1)"
      :can-move-down="canMoveSection('sample', 1)"
      :style="sectionStyle('sample')"
      @move-up="moveSection('sample', -1)"
      @move-down="moveSection('sample', 1)"
    >
      <article class="dd-context-card">
        <header>
          <strong>{{ sourceLabel }}</strong>
          <em>{{ observationDate || rows.at(-1)?.date || '—' }}</em>
        </header>
        <div class="dd-context-grid">
          <div>
            <span>K 线</span><strong>{{ rows.length }}</strong>
          </div>
          <div>
            <span>现价</span><strong>{{ money(market?.markPrice) }}</strong>
          </div>
          <div>
            <span>成本锚</span><strong>{{ money(market?.costAnchor) }}</strong>
          </div>
        </div>
      </article>
    </DisclosureSection>

    <DisclosureSection
      title="账户边界"
      :meta="accountMeta"
      movable
      :can-move-up="canMoveSection('account', -1)"
      :can-move-down="canMoveSection('account', 1)"
      :style="sectionStyle('account')"
      @move-up="moveSection('account', -1)"
      @move-down="moveSection('account', 1)"
    >
      <div class="dd-account-inputs">
        <label>
          <span>账户资金</span>
          <input v-model.number="input.capital" type="number" min="0" step="100" />
        </label>
        <label>
          <span>底仓名义</span>
          <input v-model.number="input.baseNotional" type="number" min="0" step="100" />
        </label>
      </div>
    </DisclosureSection>

    <DisclosureSection
      title="行情状态"
      :meta="`${factMeta} · ${extremenessText}`"
      movable
      :can-move-up="canMoveSection('facts', -1)"
      :can-move-down="canMoveSection('facts', 1)"
      :style="sectionStyle('facts')"
      @move-up="moveSection('facts', -1)"
      @move-down="moveSection('facts', 1)"
    >
      <article class="dd-action-card">
        <header>
          <strong>市场结构 · {{ graph?.decision?.state || '等待数据' }}</strong>
          <em title="正态参考下的偏离极端度，不是胜率">{{ extremenessText }}</em>
        </header>
        <div v-if="hasPositionFacts" class="dd-action-grid">
          <div>
            <span>模拟首笔</span><strong>{{ money(graph?.position?.firstNotional) }}</strong>
          </div>
          <div>
            <span>挂单价</span><strong>{{ money(primaryOrders[0]?.price) }}</strong>
          </div>
          <div>
            <span>失效</span><strong>{{ money(graph?.position?.stopPrice) }}</strong>
          </div>
          <div>
            <span>目标</span><strong>{{ money(graph?.position?.targetPrice) }}</strong>
          </div>
          <div>
            <span>模拟风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong>
          </div>
          <div>
            <span>失效距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong>
          </div>
        </div>
        <p v-if="hasPositionFacts" class="dd-empty-note">
          名义金额按正态参考极端度缩放，仅用于情景模拟，不是胜率或实盘仓位建议。
        </p>
        <p v-else class="dd-empty-note">未生成模拟挂单。当前只展示价格位置和触发状态，不显示名义、风险预算或目标价。</p>
      </article>
    </DisclosureSection>

    <DisclosureSection
      title="信号条件"
      :meta="triggerMeta"
      movable
      :can-move-up="canMoveSection('triggers', -1)"
      :can-move-down="canMoveSection('triggers', 1)"
      :style="sectionStyle('triggers')"
      @move-up="moveSection('triggers', -1)"
      @move-down="moveSection('triggers', 1)"
    >
      <div v-for="item in orderReview.conditions" :key="`${orderReview.mode}-${item}`" class="dd-risk-row">
        <span>{{ orderReview.label }}</span>
        <strong>{{ item }}</strong>
      </div>
      <div v-for="item in graph?.decision?.triggeredConditions ?? []" :key="item" class="dd-risk-row">
        <span>已触发</span>
        <strong>{{ formatFormulaBlockReason(item) }}</strong>
      </div>
      <div v-for="item in graph?.decision?.blockedReasons ?? []" :key="item" class="dd-risk-row">
        <span>未触发</span>
        <strong>{{ formatFormulaBlockReason(item) }}</strong>
      </div>
    </DisclosureSection>

    <DisclosureSection
      title="模拟挂单"
      :meta="`${primaryOrders.length} 档`"
      :default-open="primaryOrders.length > 0"
      movable
      :can-move-up="canMoveSection('orders', -1)"
      :can-move-down="canMoveSection('orders', 1)"
      :style="sectionStyle('orders')"
      @move-up="moveSection('orders', -1)"
      @move-down="moveSection('orders', 1)"
    >
      <OrderTable :title="ordersTitle" :orders="primaryOrders" />
    </DisclosureSection>

    <DisclosureSection
      title="检查项"
      :meta="checklist.items?.length ? `${checklist.items.length} 项` : '等待'"
      movable
      :can-move-up="canMoveSection('checklist', -1)"
      :can-move-down="canMoveSection('checklist', 1)"
      :style="sectionStyle('checklist')"
      @move-up="moveSection('checklist', -1)"
      @move-down="moveSection('checklist', 1)"
    >
      <TraderChecklist :checklist="checklist" :show-header="false" :open-groups="['entry']" />
    </DisclosureSection>

    <DisclosureSection
      v-if="portfolioEnabled"
      title="组合研究"
      :default-open="false"
      storage-key="decision.portfolio"
      tone="research"
      movable
      :can-move-up="canMoveSection('portfolio', -1)"
      :can-move-down="canMoveSection('portfolio', 1)"
      :style="sectionStyle('portfolio')"
      @move-up="moveSection('portfolio', -1)"
      @move-down="moveSection('portfolio', 1)"
    >
      <div v-if="portfolioEnabled" class="dd-risk-row">
        <span>组合研究</span>
        <strong :class="(graph?.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(graph?.portfolio) }}</strong>
      </div>
    </DisclosureSection>

    <DisclosureSection
      title="策略档位"
      :meta="autoProfile ? '回放选档' : activeProfileLabel"
      :default-open="false"
      storage-key="decision.profile"
      tone="muted"
      movable
      :can-move-up="canMoveSection('profile', -1)"
      :can-move-down="canMoveSection('profile', 1)"
      :style="sectionStyle('profile')"
      @move-up="moveSection('profile', -1)"
      @move-down="moveSection('profile', 1)"
    >
      <div class="dd-profile-tabs">
        <button :class="{ active: autoProfile }" :disabled="!replayEnabled" @click="emit('set-auto-profile', true)">
          回放选档
        </button>
        <button
          v-for="p in profileList"
          :key="p.id"
          :class="{ active: !autoProfile && activeProfileId === p.id }"
          @click="emit('set-profile', p.id)"
        >
          {{ p.label }}
        </button>
      </div>
      <p v-if="!replayEnabled" class="replay-empty">
        现货路径回放未启用。策略档位只使用手动选择，不由回放结果反向改写信号条件。
      </p>
      <p v-else-if="!hasRunnableProfileReplay" class="replay-empty">
        缺少账户资金或底仓名义，暂不显示策略档位路径评分。
      </p>
      <ul v-else class="dd-profile-grid">
        <li
          v-for="item in profileReplays"
          :key="item.profile.id"
          :class="{ active: item.profile.id === activeProfileId }"
        >
          <span>{{ item.profile.label }}</span>
          <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
          <em>回撤 {{ money(item.replay.maxDrawdown) }} · {{ item.replay.tradeCount }} 次</em>
        </li>
      </ul>
    </DisclosureSection>

    <DisclosureSection
      v-if="replayEnabled"
      title="现货回放"
      :meta="replayMeta"
      :default-open="false"
      storage-key="decision.replay"
      tone="muted"
      movable
      :can-move-up="canMoveSection('replay', -1)"
      :can-move-down="canMoveSection('replay', 1)"
      :style="sectionStyle('replay')"
      @move-up="moveSection('replay', -1)"
      @move-down="moveSection('replay', 1)"
    >
      <ReplayPanel
        :replay="replay"
        :profile-replays="profileReplays"
        :active-profile-id="activeProfileId"
        :input="input"
      />
    </DisclosureSection>

    <DisclosureSection
      title="状态摘要"
      :default-open="false"
      storage-key="decision.reason"
      tone="muted"
      movable
      :can-move-up="canMoveSection('reason', -1)"
      :can-move-down="canMoveSection('reason', 1)"
      :style="sectionStyle('reason')"
      @move-up="moveSection('reason', -1)"
      @move-down="moveSection('reason', 1)"
    >
      <p class="dd-reason-text">{{ reasonText }}</p>
    </DisclosureSection>
  </div>
</template>

<style src="../styles/decision-drawer.css"></style>
