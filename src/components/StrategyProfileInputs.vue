<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
  profileList: { type: Array, required: true },
  graph: { type: Object, default: null },
})

const FIELD_GROUPS = [
  {
    title: '入场过滤',
    fields: [
      { key: 'strategyEdgeSigma', label: '入场偏离σ', min: 0.1, max: 3, step: 0.05, hint: '成本偏离 / ATR' },
      { key: 'strategyMomentumSigma', label: '动量阈值σ', min: -2, max: 2, step: 0.05, hint: '5日动量 / 日波动' },
      { key: 'strategyCostSlopeSigma', label: '成本止跌σ', min: 0, max: 3, step: 0.05, hint: '成本斜率 / ATR' },
    ],
  },
  {
    title: '仓位生成',
    fields: [
      { key: 'strategyRiskPct', label: '风险预算%', min: 0.1, max: 8, step: 0.1, pct: true, hint: '权益 × 风险预算' },
      { key: 'strategyExposurePct', label: '仓位上限%', min: 1, max: 100, step: 1, pct: true, hint: '权益 × 仓位上限' },
      { key: 'strategyFirstWeight', label: '首笔比例%', min: 5, max: 100, step: 1, pct: true, hint: '最大名义 × 首笔' },
    ],
  },
  {
    title: '节奏 / 风控',
    fields: [
      { key: 'strategyCooldownFactor', label: '冷却系数', min: 0.25, max: 8, step: 0.25, hint: '买/卖冷却天数' },
      { key: 'strategyCutLossSigma', label: '风控动量σ', min: 0.1, max: 5, step: 0.1, hint: '动量破坏阈值' },
    ],
  },
]

const executionLinks = computed(() => {
  const graph = props.graph
  const p = graph?.profile ?? {}
  const pos = graph?.position ?? {}
  const formulaRows = graph?.formulaStrategy?.executionParams ?? []
  return [
    ...formulaRows,
    ['入场阈值', `max(ATR × ${f2(p.edgeAtr)}, 0.5%) = ${pct(p.minEdge)}`],
    ['动量确认', `5日动量 > ${pct(p.momentumMin)}`],
    ['成本止跌', `成本斜率 ≥ -${pct(p.costSlopeMin)}`],
    ['风险预算', `权益 × ${pct(p.riskMax)} = ${fmt(pos.riskBudget)}`],
    ['仓位上限', `权益 × ${pct(p.exposureMax)} → 最大名义 ${fmt(pos.maxNotional)}`],
    ['首笔挂单', `最大名义 × ${pct(p.firstWeight)} = ${fmt(pos.firstNotional)}`],
    ['退出计划', `退出 ${pct(Number(props.input.exitTargetReturn) || 0)}；d=${pct(Number(props.input.deltaSlope ?? props.input.targetReturn) || 0)}；T=${holdingDays(props.input)} 天；失效 ${fmt(pos.stopPrice)}`],
    ['风控确认', `动量破坏 < -${pct(p.cutMomentumMin)}`],
    ['冷却', `买 ${p.buyCooldown ?? '—'} 天；卖 ${p.sellCooldown ?? '—'} 天`],
  ]
})

const lifecycleSteps = computed(() => {
  const graph = props.graph
  const steps = graph?.formulaStrategy?.steps
  if (Array.isArray(steps) && steps.length) return steps.map((step, index) => ({
    index: String(index + 1),
    title: step.label,
    status: step.status,
    summary: step.role,
    rows: [
      ['公式', step.formula],
      ['输出', step.value],
    ],
  }))
  return []
})

const moduleLinks = computed(() => props.graph?.formulaStrategy?.researchOnly ?? [])
const formulaBasis = computed(() => props.graph?.formulaStrategy?.formulaBasis ?? null)

function valueOf(input, field) {
  const value = Number(input[field.key])
  if (!Number.isFinite(value)) return ''
  return field.pct ? Number((value * 100).toFixed(2)) : value
}

function setValue(input, field, raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const normalized = field.pct ? value / 100 : value
  input[field.key] = Math.min(field.max / (field.pct ? 100 : 1), Math.max(field.min / (field.pct ? 100 : 1), normalized))
}

function fmt(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function pct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function f2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : '—'
}

function holdingDays(input) {
  return Math.max(Math.round(Number(input?.holdingDays) || 1), 1)
}
</script>

<template>
  <section class="strategy-profile-inputs">
    <div class="spi-head">
      <strong>自有公式策略组合</strong>
      <select v-model="input.strategyProfile">
        <option v-for="profile in profileList" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
      </select>
    </div>

    <div class="spi-lifecycle">
      <article v-for="step in lifecycleSteps" :key="step.title" class="spi-step">
        <header>
          <span>{{ step.index }}</span>
          <strong>{{ step.title }}</strong>
          <b>{{ step.status }}</b>
        </header>
        <p>{{ step.summary }}</p>
        <dl>
          <template v-for="row in step.rows" :key="row[0]">
            <dt>{{ row[0] }}</dt>
            <dd>{{ row[1] }}</dd>
          </template>
        </dl>
      </article>
    </div>

    <div v-if="formulaBasis" class="spi-calibration">
      <span>公式口径</span>
      <strong>{{ formulaBasis.sourceId }} · {{ formulaBasis.status }}</strong>
      <small>{{ formulaBasis.note }}</small>
      <dl>
        <template v-for="row in formulaBasis.variables" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }} · {{ row[2] }}</dd>
        </template>
        <template v-for="row in formulaBasis.terms" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[2] }}</dd>
        </template>
      </dl>
    </div>

    <details class="spi-param-details" :open="input.strategyProfile === 'custom'">
      <summary>
        <span>参数调节</span>
        <strong>{{ input.strategyProfile === 'custom' ? '执行档位可编辑' : '执行档位只读' }}</strong>
      </summary>
      <div v-if="input.strategyProfile === 'custom'" class="spi-groups">
        <section v-for="group in FIELD_GROUPS" :key="group.title">
          <h4>{{ group.title }}</h4>
          <div class="spi-grid">
            <label v-for="field in group.fields" :key="field.key">
              <span>{{ field.label }}</span>
              <input
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :value="valueOf(input, field)"
                @input="setValue(input, field, $event.target.value)"
              />
              <small>{{ field.hint }}</small>
            </label>
          </div>
        </section>
      </div>
      <p v-else>这些档位参数只负责过滤、仓位和冷却；自有公式链路在上方。</p>
    </details>

    <div class="spi-links">
      <header>
        <span>执行档位明细</span>
        <strong>辅助公式链路，不是公式来源</strong>
      </header>
      <dl>
        <template v-for="row in executionLinks" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }}</dd>
        </template>
      </dl>
    </div>

    <details class="spi-boundary">
      <summary>公式边界 / 研究层</summary>
      <div class="spi-modules">
        <article v-for="row in moduleLinks" :key="row[0]" :class="{ research: row[1] === '研究层' }">
          <strong>{{ row[0] }}</strong>
          <span>{{ row[1] }}</span>
          <small>{{ row[2] }}</small>
        </article>
      </div>
    </details>
  </section>
</template>

<style>
.strategy-profile-inputs { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.spi-head { display: grid; grid-template-columns: 1fr minmax(100px, 0.7fr); gap: 8px; align-items: center; }
.spi-head strong { color: var(--green); font-size: 0.78rem; }
.spi-head select,
.spi-grid input { min-width: 0; min-height: 30px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); padding: 3px 7px; font-variant-numeric: tabular-nums; }
.spi-lifecycle { display: grid; gap: 7px; counter-reset: step; }
.spi-step { display: grid; gap: 6px; padding: 8px; border: 1px solid var(--line); border-left: 4px solid var(--green); border-radius: 6px; background: var(--bg); min-width: 0; }
.spi-step header { display: grid; grid-template-columns: 22px 1fr auto; gap: 7px; align-items: center; min-width: 0; }
.spi-step header span { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; background: var(--green); color: #fff; font-size: 0.68rem; font-weight: 900; }
.spi-step header strong { min-width: 0; color: var(--ink); font-size: 0.82rem; }
.spi-step header b { color: var(--green); font-size: 0.74rem; font-variant-numeric: tabular-nums; text-align: right; }
.spi-step p { margin: 0; color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
.spi-step dl { display: grid; grid-template-columns: minmax(62px, 0.42fr) 1fr; gap: 3px 7px; margin: 0; font-size: 0.66rem; }
.spi-step dt { color: var(--muted); font-weight: 800; }
.spi-step dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.spi-calibration { display: grid; grid-template-columns: minmax(68px, auto) 1fr; gap: 3px 8px; align-items: baseline; padding: 7px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-active); min-width: 0; }
.spi-calibration span { color: var(--green); font-size: 0.64rem; font-weight: 900; }
.spi-calibration strong { color: var(--ink); font-size: 0.72rem; font-variant-numeric: tabular-nums; }
.spi-calibration small { grid-column: 1 / -1; color: var(--muted); font-size: 0.62rem; line-height: 1.35; overflow-wrap: anywhere; }
.spi-calibration dl { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(30px, auto) 1fr; gap: 2px 7px; margin: 2px 0 0; font-size: 0.62rem; }
.spi-calibration dt { color: var(--green); font-weight: 900; }
.spi-calibration dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.spi-param-details,
.spi-boundary { display: grid; gap: 7px; border-top: 1px solid var(--line); padding-top: 8px; }
.spi-param-details summary,
.spi-boundary summary { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; cursor: pointer; color: var(--green); font-size: 0.68rem; font-weight: 900; }
.spi-param-details summary strong { color: var(--muted); font-size: 0.62rem; }
.spi-groups { display: grid; gap: 8px; }
.spi-groups section { display: grid; gap: 6px; }
.spi-groups h4 { margin: 0; color: var(--muted); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.spi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.spi-grid label { display: grid; gap: 3px; min-width: 0; }
.spi-grid span { color: var(--muted); font-size: 0.64rem; font-weight: 800; }
.spi-grid small { color: var(--muted); font-size: 0.58rem; line-height: 1.25; overflow-wrap: anywhere; }
.strategy-profile-inputs p { margin: 0; color: var(--muted); font-size: 0.68rem; line-height: 1.45; }
.spi-links { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line); }
.spi-links header { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; }
.spi-links header span { color: var(--green); font-size: 0.62rem; font-weight: 900; }
.spi-links header strong { color: var(--muted); font-size: 0.62rem; text-align: right; }
.spi-links dl { display: grid; grid-template-columns: minmax(74px, 0.55fr) 1fr; gap: 4px 8px; margin: 0; font-size: 0.66rem; }
.spi-links dt { color: var(--muted); font-weight: 800; }
.spi-links dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.spi-modules { display: grid; gap: 5px; }
.spi-modules article { display: grid; grid-template-columns: minmax(58px, 0.55fr) minmax(42px, auto) 1fr; gap: 6px; align-items: baseline; padding: 5px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); font-size: 0.64rem; min-width: 0; }
.spi-modules article.research { opacity: 0.82; }
.spi-modules strong { color: var(--ink); }
.spi-modules span { color: var(--green); font-weight: 900; }
.spi-modules article.research span { color: var(--muted); }
.spi-modules small { color: var(--muted); overflow-wrap: anywhere; }
</style>
