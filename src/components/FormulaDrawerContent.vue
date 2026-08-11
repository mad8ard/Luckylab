<script setup>
import { computed } from 'vue'
import {
  buildOrderPlanReviewPresentation,
  getFormulaAvailability,
  getFormulaStageRelations,
} from '../domain/formula-research/formulaAvailability.js'
import { formulaStages } from '../domain/formulas/registry.js'

const props = defineProps({
  formulaId: { type: String, default: '' },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  formulaPath: { type: Array, default: () => [] },
})

const stage = computed(() => formulaStages.find((s) => s.id === props.formulaId))
const availability = computed(() =>
  getFormulaAvailability(props.formulaId, {
    graph: props.graph,
    market: props.market,
    rows: props.rows,
    costPath: props.costPath,
    formulaPath: props.formulaPath,
  }),
)
const orderReview = computed(() => buildOrderPlanReviewPresentation(props.graph))
const relations = computed(() => getFormulaStageRelations(props.formulaId))
const feedsFromHere = computed(() => relations.value.downstream)
const fedFromUpstream = computed(() => relations.value.upstream)

const currentValues = computed(() => {
  const id = props.formulaId
  const g = props.graph
  const m = props.market
  if (!id) return []
  const v = []
  switch (id) {
    case 'path':
      v.push(['行数', m?.rows ?? '—'])
      v.push(['日期范围', m?.range ?? '—'])
      break
    case 'cost':
      v.push(['成本锚', fmt(m?.costAnchor)])
      v.push(['偏离', pct(m?.costDistance)])
      v.push(['上沿 / 下沿', `${fmt(m?.costHigh)} / ${fmt(m?.costLow)}`])
      v.push(['自适应近期斜率', pct(m?.costSlopeRecent)])
      break
    case 'volatility':
      v.push(['历史年化波动', pct(m?.annualVol)])
      v.push(['ATR%', pct(m?.atrPercent)])
      v.push(['自适应快动量', pct(m?.momentumFast)])
      break
    case 'delta-band':
      v.push(['多头低', fmt(g.deltaBands?.long?.low)])
      v.push(['多头成本', fmt(g.deltaBands?.long?.cost)])
      v.push(['多头高', fmt(g.deltaBands?.long?.high)])
      v.push(['e_T', f4(g.deltaBands?.wave)])
      break
    case 'option-greeks':
      if (g.optionPortfolio) {
        v.push(['组合价值', fmt(g.optionPortfolio.value)])
        v.push(['组合 Delta', f4(g.optionPortfolio.optionDelta)])
        v.push(['组合 Gamma', f4(g.optionPortfolio.optionGamma)])
        v.push(['Theta/交易会话', f4(g.optionPortfolio.optionThetaPerSession)])
        v.push(['Vega/1% 波动', f4(g.optionPortfolio.optionVegaPerPct)])
        v.push(['Legs', g.optionPortfolio.legs?.length ?? 0])
      } else {
        v.push(['价格', fmt(g.option?.price)])
        v.push(['Delta', f4(g.option?.optionDelta)])
        v.push(['Gamma', f4(g.option?.optionGamma)])
        v.push(['Theta/交易会话', f4(g.option?.optionThetaPerSession)])
        v.push(['Vega/1% 波动', f4(g.option?.optionVegaPerPct)])
      }
      break
    case 'lp-inventory':
      v.push(['LP 价值', fmt(g.lpV3?.value)])
      v.push(['库存 Delta (token0)', f4(g.lpV3?.inventoryDeltaToken0)])
      v.push(['V3 区间 IL', pct(g.rangeV3Il?.rangeV3Il)])
      v.push(['V2 全区间 IL 代理', pct(g.fullRangeV2Il?.fullRangeV2IlProxy)])
      break
    case 'capital-efficiency':
      v.push([
        '效率倍数',
        Number.isFinite(g.efficiency?.efficiency) ? `${g.efficiency.efficiency.toFixed(2)}×` : '未生成',
      ])
      v.push(['区间下沿', f4(g.efficiency?.lower)])
      v.push(['区间上沿', f4(g.efficiency?.upper)])
      break
    case 'funding':
      v.push(['基差比例代理', pct(g.funding?.basisFraction)])
      v.push(['累计资金成本代理', f4(g.funding?.cumulativeFundingProxy)])
      break
    case 'portfolio':
      v.push(['组合研究', fmt(g.portfolio)])
      break
    case 'order-plan':
      v.push(['模拟挂单档数', g.plan?.primaryOrders?.length ?? 0])
      if (orderReview.value.mode === 'invalidation') {
        v.push(['失效下沿', fmt(orderReview.value.lower)])
        v.push(['失效上沿', fmt(orderReview.value.upper)])
      } else {
        v.push(['复核条件', orderReview.value.conditions.join('；') || '当前没有可展示的复核条件'])
      }
      v.push(['市场结构', g.decision?.state ?? '—'])
      v.push(['候选状态', g.decision?.candidateStatus ?? '等待'])
      v.push(['执行状态', g.decision?.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行'])
      break
    default:
      v.push(['当前输出', '当前无数值输出，按上方可用性补输入'])
  }
  return v
})

const decisionImpact = computed(() => {
  const id = props.formulaId
  const map = {
    path: '所有下游计算的输入口径',
    cost: '决定模拟挂单的成本锚、上下沿、结构目标',
    volatility: '决定模拟挂单间距与失效阈值',
    'delta-band': '生成同周期价格带；市场与账户门禁同时满足后才进入模拟梯队',
    'option-greeks': '研究层风险拆解；模拟挂单不消费期权组合',
    'lp-inventory': 'LP 库存暴露 → 组合 Delta 一部分',
    'lp-pool-coverage': '标注聚合池覆盖质量，不推断历史 tick 流动性',
    'capital-efficiency': '比较区间几何与资金放大倍数；不代表净收益或可执行性',
    funding: '永续持仓的累计成本，影响 net carry',
    portfolio: '统一检查 LP/期权/对冲/费用是否相加正',
    'order-plan': '有方向时输出模拟买卖/失效/目标；无方向时只给复核条件',
    'deviation-score': '描述样本中的偏离极端度；不是回归概率、胜率或单独交易信号',
    'risk-surface': '研究价格情景下的局部曲率；默认模拟挂单不消费该输出',
    'net-lp-efficiency': '拆解几何倍数、同期限 IL 与路径手续费；缺真实费用时不能判断是否可行',
    'net-carry': '同口径归因资金成本；缺真实结算数据时保持研究态',
    'mean-reversion': 'AR(1) 样本路径诊断；仅作节奏坐标，不是未来时点预测',
    'dynamic-holding-state': '把回撤、z、半衰期和结构目标合成观察/等待/剔除',
    'gamma-pnl': '单位与名义口径下的凸性情景值；不是已实现人民币收益',
    'vol-confidence': '历史已实现波动样本区间；不是市场 IV 的置信区间或未来保证',
  }
  return map[id] ?? '该公式参与研究层，不直接进入挂单结论'
})

function fmt(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function f4(v) {
  return Number.isFinite(v) ? v.toFixed(4) : '—'
}
function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—'
}
</script>

<template>
  <div v-if="stage" class="fdc">
    <header class="fdc-head">
      <span>{{ stage.layer }} · {{ stage.label }}</span>
      <strong>{{ stage.role }}</strong>
    </header>

    <section class="fdc-block fdc-availability" :class="`state-${availability.tone}`">
      <h4>当前可用性</h4>
      <strong>{{ availability.label }}</strong>
      <p v-if="availability.missingInputs.length"><b>缺少输入</b>{{ availability.missingText }}</p>
      <p v-if="availability.blockedReasons.length"><b>当前原因</b>{{ availability.reasonText }}</p>
      <p><b>下一步</b>{{ availability.nextStep }}</p>
      <small>{{ availability.boundary }}</small>
    </section>

    <section class="fdc-block">
      <h4>当前值</h4>
      <dl>
        <template v-for="[k, v] in currentValues" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
    </section>

    <section class="fdc-block">
      <h4>使用位置</h4>
      <p>{{ decisionImpact }}</p>
    </section>

    <section class="fdc-block">
      <h4>输入 / 输出</h4>
      <dl>
        <dt>输入</dt>
        <dd>{{ stage.inputs.join(' · ') }}</dd>
        <dt>输出</dt>
        <dd>{{ stage.outputs.join(' · ') }}</dd>
      </dl>
    </section>

    <section v-if="stage.formulas.length" class="fdc-block">
      <h4>公式</h4>
      <pre v-for="f in stage.formulas" :key="f">{{ f }}</pre>
    </section>

    <section v-if="feedsFromHere.length || fedFromUpstream.length" class="fdc-block">
      <h4>依赖关系</h4>
      <p v-if="fedFromUpstream.length"><b>上游</b>{{ fedFromUpstream.map((item) => item.label).join(' / ') }}</p>
      <p v-if="feedsFromHere.length"><b>下游</b>{{ feedsFromHere.map((item) => item.label).join(' / ') }}</p>
    </section>
  </div>
  <div v-else class="fdc-empty">未选中公式</div>
</template>

<style>
.fdc {
  display: grid;
  gap: 14px;
  align-content: start;
}
.fdc-head {
  display: grid;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.fdc-head span {
  color: var(--green);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.fdc-head strong {
  font-size: 0.95rem;
  line-height: 1.35;
  color: var(--ink);
}
.fdc-block {
  display: grid;
  gap: 6px;
}
.fdc-block h4 {
  margin: 0;
  color: var(--green);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.fdc-block p {
  margin: 0;
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.5;
}
.fdc-block p b {
  color: var(--muted);
  margin-right: 6px;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
}
.fdc-block dl {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 4px 10px;
  margin: 0;
}
.fdc-block dt {
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 700;
}
.fdc-block dd {
  margin: 0;
  color: var(--ink);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.fdc-block pre {
  margin: 0;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--blue);
  font-size: 0.72rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.fdc-availability {
  border: 1px solid currentColor;
  border-radius: 7px;
  padding: 9px;
  background: var(--surface-alt);
}
.fdc-availability > strong {
  font-size: 0.86rem;
}
.fdc-availability small {
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.4;
}
.fdc-availability.state-viewable {
  color: var(--green);
}
.fdc-availability.state-missing,
.fdc-availability.state-gate-failed {
  color: var(--red);
}
.fdc-availability.state-research {
  color: var(--blue);
}
.fdc-availability.state-proxy {
  color: #8b5a16;
}
.fdc-availability.state-unverified,
.fdc-availability.state-not-applicable {
  color: var(--muted);
}
.fdc-availability p {
  color: var(--ink);
}
.fdc-empty {
  color: var(--muted);
  font-size: 0.78rem;
  padding: 8px;
  text-align: center;
}
</style>
