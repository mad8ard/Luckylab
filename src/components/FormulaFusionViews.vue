<script setup>
import { computed } from 'vue'

const props = defineProps({
  formulaId: { type: String, required: true },
  netLpData: { type: Object, default: null },
  lpPoolData: { type: Object, default: null },
  dynamicHoldingData: { type: Object, default: null },
  fmt: { type: Function, required: true },
  pctFmt: { type: Function, required: true },
})

const lpParts = computed(() => {
  const d = props.netLpData
  if (!d) return []
  return [
    { id: 'gross', label: 'CE 毛效率', value: d.grossGain, display: signedX(d.grossGain) },
    { id: 'il', label: 'IL', value: d.impermanentLoss, display: props.pctFmt(d.impermanentLoss) },
    { id: 'fee', label: '手续费估计', value: d.feeBoost, display: signedX(d.feeBoost, 2) },
    { id: 'net', label: '净效率', value: d.totalNet, display: signedX(d.totalNet, 2), strong: true },
  ]
})
const lpScale = computed(() => Math.max(...lpParts.value.map((item) => Math.abs(item.value || 0)), 0.01))
const dynamicPlans = computed(() => {
  const plan = props.dynamicHoldingData?.holdingPlan
  return plan
    ? [
        { id: 'shortTrade', label: '短线', plan: plan.shortTrade },
        { id: 'fundCycle', label: '基金周期', plan: plan.fundCycle },
      ]
    : []
})

function barWidth(value) {
  return `${Math.max(2, Math.min(100, (Math.abs(value || 0) / lpScale.value) * 100)).toFixed(1)}%`
}
function signedX(value, digits = 1) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}×`
}
function fixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}
function day(value) {
  return Number.isFinite(value) ? `${Math.round(value)}天` : '—'
}
function ratio(value) {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '—'
}
function progressWidth(value) {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '0%'
}
function statusClass(status) {
  if (status === '观察') return 'green'
  if (status === '剔除') return 'red'
  return ''
}
function targetName(id) {
  return { firstRepair: '成本下沿', baseAnchor: '成本锚', stretch: 'LP 上沿' }[id] ?? id ?? '—'
}
function actionName(action) {
  return (
    {
      execute: '执行',
      review: '复核',
      'wait-window': '等窗口',
      'wait-repair-start': '等修复',
      'wait-drawdown-stabilize': '等止跌',
      'review-extension': '锚后复核',
      'refresh-data': '刷新数据',
    }[action] ??
    action ??
    '—'
  )
}
function reasonText(reasons = []) {
  const map = {
    'drawdown-expanding': '回撤扩张',
    'gross-return': '收益不足',
    'holding-window': '周期外',
    'insufficient-history': '数据不足',
    'no-structural-target': '无目标',
    'post-anchor-extension': '锚后扩展',
    'target-behind-entry': '目标反向',
    'z-threshold': 'z不足',
  }
  return reasons.length ? reasons.map((reason) => map[reason] ?? reason).join('/') : '通过'
}
</script>

<template>
  <div v-if="formulaId === 'net-lp-efficiency'" class="ff-card">
    <template v-if="netLpData">
      <header class="ff-head">
        <span class="fc-ttl">LP 净效率</span>
        <strong :class="netLpData.totalNet >= 0 ? 'green' : 'red'">净 {{ signedX(netLpData.totalNet, 2) }}</strong>
        <em>{{ netLpData.status }}</em>
      </header>
      <div class="ff-metrics">
        <div>
          <b>CE</b><span>{{ fixed(netLpData.ce, 1) }}×</span>
        </div>
        <div>
          <b>毛效率</b><span>{{ signedX(netLpData.grossGain) }}</span>
        </div>
        <div>
          <b>IL</b
          ><span :class="netLpData.impermanentLoss < 0 ? 'red' : 'green'">{{ pctFmt(netLpData.impermanentLoss) }}</span>
        </div>
        <div>
          <b>手续费</b><span>{{ signedX(netLpData.feeBoost, 2) }}</span>
        </div>
      </div>
      <div class="ff-bars">
        <div v-for="part in lpParts" :key="part.id" class="ff-bar-row" :class="{ strong: part.strong }">
          <span>{{ part.label }}</span>
          <div class="ff-track">
            <i :class="part.value >= 0 ? 'pos' : 'neg'" :style="{ width: barWidth(part.value) }"></i>
          </div>
          <strong>{{ part.display }}</strong>
        </div>
      </div>
      <div class="ff-note">真实 LP 权重 / 手续费制度 / 再平衡规则：未接入</div>
    </template>
    <div v-else class="ff-empty">等待 CE / IL 数据</div>
  </div>

  <div v-else-if="formulaId === 'lp-pool-coverage'" class="ff-card">
    <template v-if="lpPoolData">
      <header class="ff-head">
        <span class="fc-ttl">LP 池覆盖</span>
        <strong>{{ lpPoolData.inputMode || '—' }}</strong>
        <em>{{ lpPoolData.isSynthetic ? 'fallback' : 'real-snapshot' }}</em>
      </header>
      <div class="ff-metrics">
        <div>
          <b>24h 换手</b><span>{{ pctFmt(lpPoolData.turnover24h) }}</span>
        </div>
        <div>
          <b>主池占比</b><span>{{ pctFmt(lpPoolData.topReserveShare) }}</span>
        </div>
        <div>
          <b>Reserve</b><span>{{ fmt(lpPoolData.poolCoverage?.reserveUsd) }}</span>
        </div>
        <div>
          <b>Volume 24h</b><span>{{ fmt(lpPoolData.poolCoverage?.volumeUsd24h) }}</span>
        </div>
      </div>
      <div class="ff-bars">
        <div class="ff-bar-row">
          <span>换手</span>
          <div class="ff-track"><i class="pos" :style="{ width: progressWidth(lpPoolData.turnover24h) }"></i></div>
          <strong>{{ pctFmt(lpPoolData.turnover24h) }}</strong>
        </div>
        <div class="ff-bar-row">
          <span>集中度</span>
          <div class="ff-track"><i class="pos" :style="{ width: progressWidth(lpPoolData.topReserveShare) }"></i></div>
          <strong>{{ pctFmt(lpPoolData.topReserveShare) }}</strong>
        </div>
      </div>
      <div class="ff-note">待补：{{ lpPoolData.missingInputs.join(' / ') || '无' }}</div>
    </template>
    <div v-else class="ff-empty">等待聚合池覆盖数据</div>
  </div>

  <div v-else-if="formulaId === 'dynamic-holding-state'" class="ff-card">
    <template v-if="dynamicHoldingData">
      <header class="ff-head">
        <span class="fc-ttl">动态持仓状态</span>
        <strong :class="statusClass(dynamicHoldingData.status)">{{ dynamicHoldingData.status }}</strong>
        <em>{{ dynamicHoldingData.phaseLabel }}</em>
      </header>
      <div class="ff-metrics">
        <div>
          <b>Z</b><span>{{ fixed(dynamicHoldingData.state?.zScore, 2) }}</span>
        </div>
        <div>
          <b>HL</b><span>{{ day(dynamicHoldingData.state?.halfLifeDays) }}</span>
        </div>
        <div>
          <b>回撤</b><span>{{ pctFmt(dynamicHoldingData.state?.drawdown?.drawdownDepth) }}</span>
        </div>
        <div>
          <b>修复</b><span>{{ ratio(dynamicHoldingData.state?.drawdown?.drawdownRepair) }}</span>
        </div>
      </div>
      <div class="ff-progress">
        <span :style="{ width: progressWidth(dynamicHoldingData.state?.drawdown?.drawdownRepair) }"></span>
      </div>
      <div class="ff-plans">
        <section v-for="item in dynamicPlans" :key="item.id">
          <b>{{ item.label }}</b>
          <strong :class="statusClass(item.plan.status)">{{ item.plan.status }}</strong>
          <span>{{ actionName(item.plan.action) }} · {{ targetName(item.plan.targetId) }}</span>
          <small
            >{{ day(item.plan.expectedDays) }} ·
            {{
              Number.isFinite(item.plan.expectedReturnPct)
                ? item.plan.expectedReturnPct + '%'
                : reasonText(item.plan.blockedReasons)
            }}</small
          >
        </section>
      </div>
      <div class="ff-table">
        <div class="ff-row head">
          <span>目标</span><span>价格</span><span>周期</span><span>收益</span><span>状态</span>
        </div>
        <div v-for="milestone in dynamicHoldingData.milestones" :key="milestone.id" class="ff-row">
          <span>{{ targetName(milestone.id) }}</span>
          <span>{{ fmt(milestone.effectiveTargetPrice) }}</span>
          <span>{{ day(milestone.expectedDays) }}</span>
          <span>{{ Number.isFinite(milestone.grossReturn) ? pctFmt(milestone.grossReturn) : '—' }}</span>
          <span>{{ reasonText(milestone.blockedReasons) }}</span>
        </div>
      </div>
    </template>
    <div v-else class="ff-empty">等待回撤 / z / 半衰期 / 结构目标</div>
  </div>
</template>

<style>
.ff-card {
  display: grid;
  gap: 9px;
  padding: 12px;
}
.ff-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ff-head strong {
  font-size: 0.95rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.ff-head em {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.64rem;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ff-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.ff-metrics div,
.ff-plans section {
  display: grid;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  min-width: 0;
}
.ff-metrics b,
.ff-plans b,
.ff-table .head {
  color: var(--muted);
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.ff-metrics span {
  font-size: 0.9rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}
.ff-bars {
  display: grid;
  gap: 5px;
}
.ff-bar-row {
  display: grid;
  grid-template-columns: 82px minmax(90px, 1fr) 64px;
  gap: 8px;
  align-items: center;
  font-size: 0.66rem;
  color: var(--muted);
}
.ff-bar-row strong {
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.ff-bar-row.strong strong {
  color: var(--green);
}
.ff-track {
  height: 8px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.ff-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
}
.ff-track .pos {
  background: var(--green);
}
.ff-track .neg {
  background: var(--red);
}
.ff-note,
.ff-empty {
  color: var(--muted);
  font-size: 0.7rem;
}
.ff-progress {
  height: 8px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.ff-progress span {
  display: block;
  height: 100%;
  max-width: 100%;
  border-radius: inherit;
  background: var(--green);
}
.ff-plans {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.ff-plans strong {
  font-size: 0.88rem;
  font-weight: 900;
}
.ff-plans span,
.ff-plans small {
  color: var(--muted);
  font-size: 0.66rem;
}
.ff-table {
  display: grid;
  border: 1px solid var(--line);
  border-radius: 5px;
  overflow: hidden;
}
.ff-row {
  display: grid;
  grid-template-columns: 1fr 1fr 0.8fr 0.8fr 1fr;
  gap: 6px;
  padding: 5px 7px;
  background: var(--bg);
  font-size: 0.64rem;
}
.ff-row + .ff-row {
  border-top: 1px solid var(--line);
}
.ff-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 768px) {
  .ff-metrics,
  .ff-plans {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ff-row {
    grid-template-columns: 1fr 1fr 0.8fr;
  }
  .ff-row span:nth-child(4),
  .ff-row span:nth-child(5) {
    display: none;
  }
}
</style>
