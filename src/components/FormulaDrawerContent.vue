<script setup>
import { computed } from 'vue'
import { formulaStages } from '../domain/formulas/registry.js'

const props = defineProps({
  formulaId: { type: String, default: '' },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
})

const stage = computed(() => formulaStages.find((s) => s.id === props.formulaId))
const feedsFromHere = computed(() => stage.value?.feeds ?? [])
const fedFromUpstream = computed(() => formulaStages.filter((s) => s.feeds?.includes(props.formulaId)).map((s) => s.id))

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
      v.push(['5日斜率', pct(m?.costSlope5)])
      break
    case 'volatility':
      v.push(['年化波动', pct(m?.annualVol)])
      v.push(['ATR%', pct(m?.atrPercent)])
      v.push(['5日动量', pct(m?.momentum5)])
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
        v.push(['组合 Delta', f4(g.optionPortfolio.delta)])
        v.push(['组合 Gamma', f4(g.optionPortfolio.gamma)])
        v.push(['Theta/日', f4(g.optionPortfolio.thetaDaily)])
        v.push(['Vega', f4(g.optionPortfolio.vega)])
        v.push(['Legs', g.optionPortfolio.legs?.length ?? 0])
      } else {
        v.push(['价格', fmt(g.option?.price)])
        v.push(['Delta', f4(g.option?.delta)])
        v.push(['Gamma', f4(g.option?.gamma)])
        v.push(['Theta', f4(g.option?.theta)])
        v.push(['Vega', f4(g.option?.vega)])
      }
      break
    case 'lp-inventory':
      v.push(['LP 价值', fmt(g.lpV3?.value)])
      v.push(['库存 Delta', f4(g.lpV3?.inventoryDelta)])
      v.push(['IL', pct(g.impermanentLoss?.impermanentLoss)])
      break
    case 'capital-efficiency':
      v.push(['效率倍数', `${(g.efficiency?.efficiency ?? 0).toFixed(2)}×`])
      v.push(['区间下沿', f4(g.efficiency?.lower)])
      v.push(['区间上沿', f4(g.efficiency?.upper)])
      break
    case 'funding':
      v.push(['资金费率', pct(g.funding?.ratio)])
      v.push(['累计资金成本', f4(g.funding?.funding)])
      break
    case 'portfolio':
      v.push(['组合研究', fmt(g.portfolio)])
      break
    case 'order-plan':
      v.push(['挂单档数', g.plan?.primaryOrders?.length ?? 0])
      v.push(['失效下沿', fmt(g.plan?.invalidation?.lower)])
      v.push(['失效上沿', fmt(g.plan?.invalidation?.upper)])
      v.push(['信号状态', g.decision?.state ?? '—'])
      break
    default:
      v.push(['详见公式图', '点击中央公式面板查看可视化'])
  }
  return v
})

const decisionImpact = computed(() => {
  const id = props.formulaId
  const map = {
    path: '所有下游计算的输入口径',
    cost: '决定挂单的成本锚、上下沿、回归目标',
    volatility: '决定挂单间距与失效阈值',
    'delta-band': '直接生成挂单价格梯队（试仓/加仓/极值）',
    'option-greeks': '研究层风险拆解；模拟挂单不消费期权组合',
    'lp-inventory': 'LP 库存暴露 → 组合 Delta 一部分',
    'lp-pool-coverage': '标注聚合池覆盖质量，不推断历史 tick 流动性',
    'capital-efficiency': '决定 LP 区间是否值得收窄',
    funding: '永续持仓的累计成本，影响 net carry',
    portfolio: '统一检查 LP/期权/对冲/费用是否相加正',
    'order-plan': '最终输出：挂买/挂卖/失效线/目标价',
    'deviation-score': '判断当前偏离是否够强，是否触发交易',
    'risk-surface': '展示不同价格上的 Greeks 曲线，挂单前看曲率',
    'net-lp-efficiency': 'IL × CE 净效率 → LP 是否可行',
    'net-carry': '判断回归收益能否覆盖资金费',
    'mean-reversion': '估计回归速度，决定持仓时长',
    'dynamic-holding-state': '把回撤、z、半衰期和结构目标合成观察/等待/剔除',
    'gamma-pnl': '凸性头寸的实际波动收益估计',
    'vol-confidence': '当前 IV 估计的置信区间',
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
      <p v-if="fedFromUpstream.length"><b>上游</b>{{ fedFromUpstream.join(' / ') }}</p>
      <p v-if="feedsFromHere.length"><b>下游</b>{{ feedsFromHere.join(' / ') }}</p>
    </section>

    <section class="fdc-block fdc-status">
      <span :class="stage.status === 'implemented' ? 'live' : 'mapped'">
        {{ stage.status === 'implemented' ? '已计算' : '研究层（不参与默认挂单）' }}
      </span>
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
.fdc-status {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.fdc-status span {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 800;
}
.fdc-status .live {
  background: var(--surface-active);
  color: var(--green);
  border: 1px solid var(--green);
}
.fdc-status .mapped {
  background: var(--surface-alt);
  color: var(--muted);
  border: 1px solid var(--line);
}
.fdc-empty {
  color: var(--muted);
  font-size: 0.78rem;
  padding: 8px;
  text-align: center;
}
</style>
