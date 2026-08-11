<script setup>
import { computed } from 'vue'
import { formatFormulaBlockReason, formatFormulaInputList } from '../domain/formula-research/formulaAvailability.js'

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
    {
      id: 'il',
      label: '同期限 IL',
      value: d.returns?.lpIlFraction,
      display: props.pctFmt(d.returns?.lpIlFraction),
    },
    { id: 'fee', label: '路径手续费', value: d.returns?.feeReturn, display: props.pctFmt(d.returns?.feeReturn) },
    {
      id: 'net',
      label: '同口径净收益',
      value: d.returns?.netReturn,
      display: props.pctFmt(d.returns?.netReturn),
      strong: true,
    },
  ].filter((item) => Number.isFinite(item.value))
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
const candidateThresholdText = computed(() => {
  const thresholds = props.dynamicHoldingData?.candidateThresholds
  const shortTrade = thresholds?.shortTradeMinimumGrossReturn
  const fundCycle = thresholds?.fundCycleMinimumGrossReturn
  if (![shortTrade, fundCycle].every(Number.isFinite)) return ''
  if (shortTrade === fundCycle) return `短线 / 基金周期情景毛收益 ≥ ${props.pctFmt(shortTrade)}`
  return `短线 ≥ ${props.pctFmt(shortTrade)} · 基金周期 ≥ ${props.pctFmt(fundCycle)}`
})

function barWidth(value) {
  return `${Math.max(2, Math.min(100, (Math.abs(value || 0) / lpScale.value) * 100)).toFixed(1)}%`
}
function fixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}
function session(value) {
  return Number.isFinite(value) ? `${Math.ceil(value)}个交易会话` : '—'
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
  if (!id) return '—'
  return { firstRepair: '成本下沿', baseAnchor: '成本锚', stretch: 'LP 上沿' }[id] ?? '未标注目标'
}
function actionName(action) {
  return (
    {
      execute: '形成模拟候选',
      review: '复核',
      'wait-window': '等窗口',
      'wait-target': '等目标',
      'wait-repair-start': '等修复',
      'wait-drawdown-stabilize': '等止跌',
      'review-extension': '锚后复核',
      'refresh-data': '刷新数据',
    }[action] ?? (action ? '未标注动作' : '—')
  )
}
function reasonText(reasons = []) {
  return reasons.length ? reasons.map(formatFormulaBlockReason).join('/') : '通过'
}
function researchStatus(status) {
  return (
    {
      implemented: '可查看',
      'research-only': '仅研究',
      'proxy-only': '代理模型',
      'protocol-unverified': '协议未验证',
      'missing-input': '待输入',
      'calibration-required': '待路径校准',
    }[status] ?? '研究状态'
  )
}
function inputModeLabel(mode, isSynthetic = false) {
  if (isSynthetic) return '回退样本'
  return (
    {
      real: '真实输入',
      'pool-real': '聚合池快照',
      scenario: '情景输入',
      inferred: '推导输入',
      fallback: '回退输入',
    }[mode] ?? '输入未标注'
  )
}
</script>

<template>
  <div v-if="formulaId === 'net-lp-efficiency'" class="ff-card">
    <template v-if="netLpData">
      <header class="ff-head">
        <span class="fc-ttl">LP 研究拆解</span>
        <strong :class="netLpData.returns?.netReturn >= 0 ? 'green' : 'red'">{{
          Number.isFinite(netLpData.returns?.netReturn) ? `净 ${pctFmt(netLpData.returns.netReturn)}` : '待路径校准'
        }}</strong>
        <em>{{ researchStatus(netLpData.status) }}</em>
      </header>
      <div class="ff-metrics">
        <div>
          <b>CE 几何</b><span>{{ fixed(netLpData.geometry?.capitalEfficiency, 2) }}×</span>
        </div>
        <div><b>可与收益相加</b><span>否</span></div>
        <div>
          <b>同期限 IL</b
          ><span :class="netLpData.returns?.lpIlFraction < 0 ? 'red' : 'green'">{{
            pctFmt(netLpData.returns?.lpIlFraction)
          }}</span>
        </div>
        <div>
          <b>路径手续费</b><span>{{ pctFmt(netLpData.returns?.feeReturn) }}</span>
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
      <div class="ff-note">
        CE 与收益分列。待补：{{ formatFormulaInputList(netLpData.missingInputs) }}；fee≈theta
        仅为统一币种/期限/名义后的类比。
      </div>
    </template>
    <div v-else class="ff-empty">等待 CE / IL 数据</div>
  </div>

  <div v-else-if="formulaId === 'lp-pool-coverage'" class="ff-card">
    <template v-if="lpPoolData">
      <header class="ff-head">
        <span class="fc-ttl">LP 池覆盖</span>
        <strong>{{ inputModeLabel(lpPoolData.inputMode, lpPoolData.isSynthetic) }}</strong>
        <em>{{ lpPoolData.isSynthetic ? '回退数据' : '真实快照' }}</em>
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
      <div class="ff-note">待补：{{ formatFormulaInputList(lpPoolData.missingInputs) }}</div>
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
          <b>HL</b><span>{{ session(dynamicHoldingData.state?.halfLifeSessions) }}</span>
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
            >条件 {{ session(item.plan.expectedSessions) }} ·
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
          <span>目标</span><span>价格</span><span>条件周期</span><span>条件收益</span><span>状态</span>
        </div>
        <div v-for="milestone in dynamicHoldingData.milestones" :key="milestone.id" class="ff-row">
          <span>{{ targetName(milestone.id) }}</span>
          <span>{{ fmt(milestone.effectiveTargetPrice) }}</span>
          <span>{{ session(milestone.expectedSessions) }}</span>
          <span>{{ Number.isFinite(milestone.grossReturn) ? pctFmt(milestone.grossReturn) : '—' }}</span>
          <span>{{ reasonText(milestone.blockedReasons) }}</span>
        </div>
      </div>
      <div class="ff-note">周期和收益按信号日结构、AR 零冲击衰减投影，仅是情景坐标，不是预测或预期实现值。</div>
      <div v-if="candidateThresholdText" class="ff-note">
        候选硬门槛（{{ dynamicHoldingData.gateVersion }}）：{{
          candidateThresholdText
        }}；未通过时只保留研究诊断，不生成模拟挂单。
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
