<script setup>
import FormulaFusionViews from './FormulaFusionViews.vue'
import LiquidityFingerprintRack from './LiquidityFingerprintRack.vue'
import { useFormulaChartModel } from '../composables/useFormulaChartModel.js'

const props = defineProps({
  formulaId: { type: String, required: true },
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  formulaPath: { type: Array, default: () => [] },
  cursor: { type: Number, default: null },
})

const {
  stage, availability, orderReview, activeIndex, fmt, f4, pctFmt, pathData, costData, volData, bandData,
  greeksData, lpData, syH, lpV3Curve, lpV3Marker, lpRealMarker, lpV3Bounds, ceData,
  ceCurve, ceDot, ceFrontierDot, fundData, portData, waterfallBars, portfolioCurves, asianData,
  bachelierData, ammData, fingerprintData, devScoreData, normalCurve, zMarker,
  riskSurfaceData, lpPoolData, netLpData, netCarryData, netCarryDisplay, guide, mrData, dynamicHoldingData,
  decayCurve, hlMarker, gpData, gammaCurve, gpMarker, vcData, orderData,
  W, H, PL, PR, pw, ph, sx, sy,
} = useFormulaChartModel(props)

function greekTone(value) {
  if (!Number.isFinite(value)) return ''
  return value > 0 ? 'green' : value < 0 ? 'red' : ''
}
</script>

<template>
  <div class="fc-shell">

    <div v-if="!availability.canRender" class="fc-availability" :class="`state-${availability.tone}`">
      <strong>{{ availability.label }}</strong>
      <span v-if="availability.missingInputs.length">缺少：{{ availability.missingText }}</span>
      <span v-if="availability.blockedReasons.length">原因：{{ availability.reasonText }}</span>
    </div>

    <!-- PATH -->
    <div v-if="formulaId === 'path' && pathData" class="fc-card">
      <span class="fc-ttl">价格路径</span>
      <div class="fc-kv">
        <div><b>数据点</b><span>{{ pathData.count }}</span></div>
        <div><b>区间</b><span>{{ pathData.firstDate }} → {{ pathData.lastDate }}</span></div>
        <div><b>首价</b><span>{{ fmt(pathData.firstClose) }}</span></div>
        <div><b>尾价</b><span>{{ fmt(pathData.lastClose) }}</span></div>
        <div><b>总收益</b><span :class="pathData.totalReturn >= 0 ? 'green' : 'red'">{{ pctFmt(pathData.totalReturn) }}</span></div>
        <div><b>对数收益</b><span>{{ f4(pathData.logReturn) }}</span></div>
      </div>
    </div>

    <!-- COST -->
    <div v-else-if="formulaId === 'cost' && costData" class="fc-card">
      <span class="fc-ttl">市场成本结构</span>
      <svg :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
        <rect :x="sx(0.02)" :y="sy(0.95)" :width="pw*0.35" :height="ph*0.05" rx="3" fill="var(--blue-dim)" />
        <text :x="sx(0.04)" :y="sy(0.93)" class="fc-tick">成本带 {{ fmt(costData.low) }} – {{ fmt(costData.high) }}</text>
        <!-- anchor line -->
        <line :x1="PL" :x2="W-PR" :y1="sy(0.5)" :y2="sy(0.5)" stroke="var(--green)" stroke-width="2" />
        <text :x="W-PR" :y="sy(0.5)-6" text-anchor="end" class="fc-tick green">锚 {{ fmt(costData.anchor) }}</text>
        <!-- price marker -->
        <circle :cx="sx(0.15)" :cy="sy(costData.price > costData.anchor ? 0.25 : 0.75)" r="5" fill="var(--ink)" />
        <text :x="sx(0.15)+10" :y="sy(costData.price > costData.anchor ? 0.25 : 0.75)+4" class="fc-tick">现价 {{ fmt(costData.price) }}</text>
        <!-- distance arrow -->
        <line :x1="sx(0.2)" :x2="sx(0.2)" :y1="sy(0.5)" :y2="sy(costData.price > costData.anchor ? 0.25 : 0.75)" stroke="var(--red)" stroke-width="1.5" marker-end="url(#arrow-red)" />
        <text :x="sx(0.22)" :y="sy(0.4)" class="fc-tick red">偏离 {{ pctFmt(costData.distance) }}</text>
      </svg>
      <div class="fc-kv">
        <div><b>成本锚</b><span>{{ fmt(costData.anchor) }}</span></div>
        <div><b>近端成本</b><span>{{ fmt(costData.recent) }}</span></div>
        <div><b>成本下沿</b><span>{{ fmt(costData.low) }}</span></div>
        <div><b>成本上沿</b><span>{{ fmt(costData.high) }}</span></div>
        <div><b>偏离度</b><span :class="costData.distance < 0 ? 'green' : 'red'">{{ pctFmt(costData.distance) }}</span></div>
        <div><b>近期斜率</b><span>{{ pctFmt(costData.slope) }}</span></div>
      </div>
    </div>

    <!-- VOLATILITY -->
    <div v-else-if="formulaId === 'volatility' && volData" class="fc-card">
      <span class="fc-ttl">波动口径</span>
      <div class="fc-vol">
        <div class="fc-vol-main">
          <span class="fc-big">{{ pctFmt(volData.annualVol) }}</span>
          <small>历史年化波动</small>
        </div>
        <div class="fc-vol-main">
          <span class="fc-big">{{ pctFmt(volData.atr) }}</span>
          <small>ATR%</small>
        </div>
      </div>
      <div class="fc-kv">
        <div><b>历史年化波动</b><span>{{ pctFmt(volData.annualVol) }}</span></div>
        <div><b>ATR%</b><span>{{ pctFmt(volData.atr) }}</span></div>
        <div><b>快动量</b><span :class="volData.momentumFast >= 0 ? 'green' : 'red'">{{ pctFmt(volData.momentumFast) }}</span></div>
        <div><b>慢动量</b><span :class="volData.momentumSlow >= 0 ? 'green' : 'red'">{{ pctFmt(volData.momentumSlow) }}</span></div>
        <div><b>情景 σ</b><span>{{ pctFmt(volData.iv) }}</span></div>
      </div>
      <div class="fc-meta">来源 {{ volData.ivSource }} · 非期权报价反推时不标记为市场 IV</div>
    </div>

    <!-- DELTA BANDS -->
    <svg
      v-else-if="formulaId === 'delta-band' && availability.canRender && bandData"
      :viewBox="`0 0 ${W} ${H}`"
      class="fc-svg"
    >
      <defs><marker id="arrow-red" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4"><path d="M0,6 L3,0 L6,6 Z" fill="var(--red)" /></marker></defs>
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">价格带 · 多空成本结构</text>
      <rect :x="sx(0.0)" :y="sy(bandData.longHigh)" :width="pw*0.42" :height="Math.max(2, ph*(bandData.longHigh - bandData.longLow))" fill="var(--blue-dim)" rx="4" />
      <text :x="sx(0.02)" :y="sy(bandData.longCost)+4" class="fc-tick">多头区</text>
      <rect :x="sx(0.55)" :y="sy(bandData.shortHigh)" :width="pw*0.42" :height="Math.max(2, ph*(bandData.shortHigh - bandData.shortLow))" fill="var(--red-dim)" rx="4" />
      <text :x="sx(0.57)" :y="sy(bandData.shortCost)+4" class="fc-tick">空头区</text>
      <!-- lines -->
      <line v-for="(label, key) in { longHigh: '长上', longCost: '长本', longLow: '长下', shortHigh: '空上', shortCost: '空本' }" :key="key" :x1="PL" :x2="W-PR" :y1="sy(bandData[key])" :y2="sy(bandData[key])" :stroke="key.includes('Cost') ? 'var(--green)' : 'var(--muted)'" :stroke-width="key.includes('Cost') ? 1.8 : 0.8" :stroke-dasharray="key.includes('Cost') ? 'none' : '4,3'" />
      <!-- price -->
      <line :x1="PL" :x2="W-PR" :y1="sy(bandData.price)" :y2="sy(bandData.price)" stroke="var(--ink)" stroke-width="2" />
      <circle :cx="sx(0.01)" :cy="sy(bandData.price)" r="4" fill="var(--ink)" />
      <text :x="sx(0.01)+8" :y="sy(bandData.price)+4" class="fc-tick">现价 {{ fmt(props.market?.markPrice) }}</text>
      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">波 {{ bandData.wave.toFixed(4) }} · 率 {{ bandData.ratio.toFixed(2) }}</text>
    </svg>

    <!-- OPTION GREEKS -->
    <div v-else-if="formulaId === 'option-greeks' && greeksData" class="fc-card">
      <span class="fc-ttl">{{ greeksData.isPortfolio ? '期权组合 Greeks' : '期权 Greeks' }}</span>
      <div class="fc-gr4">
        <div class="fc-gi"><b>{{ greeksData.isPortfolio ? '组合价值' : '价格' }}</b><span>{{ fmt(greeksData.price) }}</span></div>
        <div class="fc-gi"><b>Δ</b><span :class="greekTone(greeksData.optionDelta)">{{ f4(greeksData.optionDelta) }}</span></div>
        <div class="fc-gi"><b>Γ</b><span>{{ f4(greeksData.optionGamma) }}</span></div>
        <div class="fc-gi"><b>Θ/交易会话</b><span>{{ f4(greeksData.optionThetaPerSession) }}</span></div>
        <div class="fc-gi"><b>ν/1%波动</b><span>{{ f4(greeksData.optionVegaPerPct) }}</span></div>
        <div class="fc-gi"><b>ρ/1%利率</b><span>{{ f4(greeksData.optionRhoPerPct) }}</span></div>
      </div>
      <div v-if="greeksData.isPortfolio" class="fc-meta">
        {{ greeksData.legs }} legs · {{ greeksData.strategyClass }} · Θ/年 {{ f4(greeksData.optionThetaAnnual) }} · σ来源 {{ greeksData.volatilitySource }}
      </div>
      <div v-else class="fc-meta">d₁ = {{ greeksData.d1?.toFixed(4) }} · d₂ = {{ greeksData.d2?.toFixed(4) }} · Θ/年 {{ f4(greeksData.optionThetaAnnual) }}</div>
    </div>

    <!-- LP INVENTORY -->
    <svg v-else-if="formulaId === 'lp-inventory' && lpData" :viewBox="`0 0 ${W} ${220}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">LP 研究情景库存曲线 · V3 模型价值 vs 价格</text>
      <!-- V3 value curve points -->
      <polyline v-if="lpV3Curve" :points="lpV3Curve" fill="none" stroke="var(--green)" stroke-width="2" />
      <!-- HODL line -->
      <line v-if="lpV3Curve" :x1="PL" :y1="syH(0.5)" :x2="W-PR" :y2="syH(0.5)" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="syH(0.5)-4" text-anchor="end" class="fc-tick">HODL</text>
      <!-- Entry price marker -->
      <circle v-if="lpV3Curve" :cx="lpV3Marker?.cx" :cy="lpV3Marker?.cy" r="4" fill="var(--ink)" />
      <text v-if="lpV3Curve" :x="lpV3Marker?.cx + 8" :y="lpV3Marker?.cy - 6" class="fc-tick">入场</text>
      <!-- Real on-chain pool price marker -->
      <line v-if="lpRealMarker" :x1="lpRealMarker.x" :x2="lpRealMarker.x" :y1="syH(1)" :y2="syH(0.08)" stroke="#8b5a16" stroke-width="1.6" stroke-dasharray="2,2" />
      <text v-if="lpRealMarker" :x="lpRealMarker.x + 6" :y="syH(0.14)" class="fc-tick" fill="#8b5a16">链上 {{ fmt(lpRealMarker.price) }}</text>
      <text v-if="lpRealMarker" :x="lpRealMarker.x + 6" :y="syH(0.23)" class="fc-tick" fill="#8b5a16">偏离 {{ pctFmt(lpRealMarker.divergence) }}</text>
      <!-- Range bounds -->
      <line v-if="lpV3Curve" :x1="lpV3Bounds?.loX" :x2="lpV3Bounds?.loX" :y1="syH(1)" :y2="syH(0.1)" stroke="var(--blue)" stroke-width="0.8" stroke-dasharray="3,3" />
      <line v-if="lpV3Curve" :x1="lpV3Bounds?.hiX" :x2="lpV3Bounds?.hiX" :y1="syH(1)" :y2="syH(0.1)" stroke="var(--red)" stroke-width="0.8" stroke-dasharray="3,3" />
      <text :x="PL" :y="218" class="fc-tick">绿线=情景 LP 模型价值 · 棕线=当前链上池价 · 蓝/红=情景区间边界</text>
    </svg>

    <!-- LIQUIDITY FINGERPRINT -->
    <div v-else-if="formulaId === 'liquidity-fingerprint' && fingerprintData" class="fc-liquidity-rack">
      <LiquidityFingerprintRack
        :rows="rows"
        :cost-path="costPath"
        :formula-path="formulaPath"
        :graph="graph"
        :active-index="activeIndex"
      />
    </div>

    <!-- AMM GEOMETRY -->
    <svg v-else-if="formulaId === 'amm-geometry' && ammData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">AMM 储备曲线 · xy = k</text>

      <!-- Axes -->
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <line :x1="PL" :x2="PL" :y1="sy(1)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />

      <!-- Hyperbola xy = k -->
      <polyline
        :points="ammData.curve.points.map(p => {
          const rx = PL + (p.x / (ammData.curve.currentX * 3)) * pw
          const ry = sy(0) - (p.y / (ammData.curve.currentY * 3)) * ph
          return `${rx},${ry}`
        }).join(' ')"
        fill="none" stroke="var(--green)" stroke-width="2"
      />
      <polyline
        :points="ammData.curve.points.filter(p => Number.isFinite(p.lambertY)).map(p => {
          const rx = PL + (p.x / (ammData.curve.currentX * 3)) * pw
          const ry = sy(0) - (p.lambertY / (ammData.curve.currentY * 3)) * ph
          return `${rx},${ry}`
        }).join(' ')"
        fill="none" stroke="var(--blue)" stroke-width="1" stroke-dasharray="4,3"
      />

      <!-- Current reserve point -->
      <line :x1="PL" :x2="sx(ammData.curve.currentX / (ammData.curve.currentX * 3))" :y1="sy(0) - (ammData.curve.currentY / (ammData.curve.currentY * 3)) * ph" :y2="sy(0) - (ammData.curve.currentY / (ammData.curve.currentY * 3)) * ph" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
      <line :x1="sx(ammData.curve.currentX / (ammData.curve.currentX * 3))" :x2="sx(ammData.curve.currentX / (ammData.curve.currentX * 3))" :y1="sy(0)" :y2="sy(0) - (ammData.curve.currentY / (ammData.curve.currentY * 3)) * ph" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
      <circle :cx="sx(ammData.curve.currentX / (ammData.curve.currentX * 3))" :cy="sy(0) - (ammData.curve.currentY / (ammData.curve.currentY * 3)) * ph" r="5" fill="var(--ink)" />
      <text :x="sx(ammData.curve.currentX / (ammData.curve.currentX * 3)) + 8" :y="sy(0) - (ammData.curve.currentY / (ammData.curve.currentY * 3)) * ph - 6" class="fc-tick">储备 ({{ f4(ammData.curve.currentX) }}, {{ f4(ammData.curve.currentY) }})</text>

      <!-- Labels -->
      <text :x="W-PR" :y="sy(0.05)" text-anchor="end" class="fc-tick">x (Token0)</text>
      <text :x="PL+4" :y="sy(0.95)" class="fc-tick">y (Token1)</text>

      <text :x="W-PR" :y="H-18" text-anchor="end" class="fc-tick">绿 xy=k · 蓝 Lambert W 研究曲线 · Numoen {{ availability.label }}</text>
      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">L = {{ f4(ammData.curve.L) }} · k = {{ fmt(ammData.curve.invariant) }} · slip {{ f4(ammData.numoen.slippageY) }}</text>
    </svg>

    <!-- CAPITAL EFFICIENCY -->
    <svg v-else-if="formulaId === 'capital-efficiency' && ceData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">CK 端点比资本效率 · 几何中点评估</text>
      <polyline :points="ceCurve" fill="none" stroke="var(--green)" stroke-width="2" />
      <line v-if="ceFrontierDot" :x1="ceFrontierDot.cx" :x2="ceFrontierDot.cx" :y1="22" :y2="sy(0)" stroke="var(--blue)" stroke-width="1" stroke-dasharray="3,3" />
      <circle v-if="ceFrontierDot" :cx="ceFrontierDot.cx" :cy="ceFrontierDot.cy" r="4" fill="var(--blue)" />
      <text v-if="ceFrontierDot" :x="ceFrontierDot.cx - 6" :y="ceFrontierDot.cy + 15" text-anchor="end" class="fc-tick" fill="var(--blue)">{{ ceFrontierDot.label }} · CE {{ ceData.currentFrontier.efficiency.toFixed(4) }}×</text>
      <circle :cx="ceDot?.cx ?? PL" :cy="ceDot?.cy ?? sy(0)" r="5" fill="var(--ink)" />
      <text :x="(ceDot?.cx ?? PL) + 8" :y="(ceDot?.cy ?? sy(0)) - 6" class="fc-tick">端点比 CE {{ ceData.efficiency.toFixed(2) }}× · {{ (ceData.downMove * 100).toFixed(1) }}% / +{{ (ceData.upMove * 100).toFixed(1) }}%</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <text :x="PL" :y="sy(0)+16" class="fc-tick">0%</text>
      <text :x="W-PR" :y="sy(0)+16" text-anchor="end" class="fc-tick">100%</text>
      <text :x="W/2" :y="H-4" text-anchor="middle" class="fc-tick">CK ±84.13% 仅是几何中点/端点比目标下的精确拐点；不是标的交易最优区间</text>
    </svg>

    <!-- FUNDING -->
    <svg v-else-if="formulaId === 'funding' && fundData" :viewBox="`0 0 ${W} 120`" class="fc-svg">
      <text :x="W/2" :y="16" text-anchor="middle" class="fc-ttl">资金费率 · 永续溢价/折价</text>
      <line :x1="PL" :x2="W-PR" :y1="60" :y2="60" stroke="var(--line)" stroke-width="1" />
      <text :x="PL-4" :y="64" text-anchor="end" class="fc-tick">0</text>
      <!-- Bar showing ratio -->
      <rect :x="W/2 - 40" :y="fundData.basisFraction > 0 ? 60 - Math.abs(fundData.basisFraction) * 600 : 60" width="80" :height="Math.max(4, Math.abs(fundData.basisFraction) * 600)" :fill="fundData.basisFraction > 0 ? 'var(--red)' : 'var(--green)'" rx="3" opacity="0.7" />
      <text :x="W/2" :y="fundData.basisFraction > 0 ? 50 : 80" text-anchor="middle" class="fc-tick" :fill="fundData.basisFraction > 0 ? 'var(--red)' : 'var(--green)'">{{ pctFmt(fundData.basisFraction) }}</text>
      <text :x="W/2" :y="108" text-anchor="middle" class="fc-tick">{{ fundData.basisFraction > 0 ? '多头付费 (偏多)' : '空头付费 (偏空)' }} · 累计 {{ pctFmt(fundData.cumulativeFundingProxy) }}</text>
    </svg>

    <!-- PORTFOLIO -->
    <svg v-else-if="formulaId === 'portfolio' && portData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">组合情景 PnL {{ fmt(portData.scenarioTotal) }} · {{ portData.total === null ? '待校准' : '已归因' }}</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <g v-if="portfolioCurves">
        <polyline :points="portfolioCurves.lp" fill="none" stroke="var(--green)" stroke-width="1.4" />
        <polyline :points="portfolioCurves.option" fill="none" stroke="var(--blue)" stroke-width="1" stroke-dasharray="4,3" />
        <polyline :points="portfolioCurves.hedge" fill="none" stroke="var(--red)" stroke-width="1" stroke-dasharray="3,3" />
        <polyline :points="portfolioCurves.combined" fill="none" stroke="var(--ink)" stroke-width="2" />
        <text :x="PL" :y="H-4" class="fc-tick">同列 PnL: 黑 combined · 绿 LP · 蓝 option · 红 hedge</text>
      </g>
      <!-- Waterfall bars -->
      <template v-if="!portfolioCurves">
        <rect v-for="(bar, i) in waterfallBars" :key="i" :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h" :fill="bar.fill" rx="2" />
        <text v-for="(bar, i) in waterfallBars" :key="'t'+i" :x="bar.x + bar.w/2" :y="bar.y - 4" text-anchor="middle" class="fc-tick">{{ bar.label }} {{ fmt(bar.val) }}</text>
      </template>
    </svg>

    <!-- ORDER PLAN -->
    <div v-else-if="formulaId === 'order-plan'" class="fc-card">
      <span class="fc-ttl">模拟挂单</span>
      <template v-if="orderData">
        <div class="fc-orders">
          <div v-for="(o, i) in orderData" :key="i" class="fc-orow">
            <span class="fc-orole">{{ o.action }}</span>
            <span>{{ o.side === 'buy' ? '买' : '卖' }} @ {{ fmt(o.price) }}</span>
            <span class="fc-onotional">模拟名义 {{ fmt(o.notional) }}</span>
            <span v-if="o.expected" :class="o.expected > 0 ? 'green' : 'red'">情景 {{ fmt(o.expected) }}</span>
          </div>
        </div>
      </template>
      <div v-else class="fc-plan-wait">
        <span class="fc-big">等待</span>
        <div class="fc-meta">{{ props.graph.decision?.timing?.reason || '价格未触发入场条件' }}</div>
        <div class="fc-kv">
          <div><b>市场结构</b><span>{{ props.graph.decision?.state || '—' }}</span></div>
          <div><b>候选状态</b><span>{{ props.graph.decision?.candidateStatus || '等待' }}</span></div>
          <div>
            <b>执行状态</b
            ><span>{{ props.graph.decision?.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行' }}</span>
          </div>
          <template v-if="orderReview.mode === 'invalidation'">
            <div><b>失效下沿</b><span>{{ fmt(orderReview.lower) }}</span></div>
            <div><b>失效上沿</b><span>{{ fmt(orderReview.upper) }}</span></div>
          </template>
          <div v-else>
            <b>复核条件</b><span>{{ orderReview.conditions[0] || '当前没有可展示的复核条件' }}</span>
          </div>
          <div><b>缺失输入</b><span>{{ availability.missingText }}</span></div>
        </div>
        <div v-if="orderReview.conditions.length" class="fc-meta">
          <div v-for="(condition, idx) in orderReview.conditions" :key="idx">• {{ condition }}</div>
        </div>
      </div>
    </div>

    <!-- ASIAN OPTION -->
    <div v-else-if="formulaId === 'asian-option' && asianData" class="fc-card">
      <span class="fc-ttl">亚式近似 · 几何均价 Greeks</span>
      <div class="fc-asian">
        <div class="fc-asian-cmp">
          <div class="fc-gi"><b>常规 IV</b><span>{{ pctFmt(asianData.regularIv) }}</span></div>
          <span class="cf-arrow">→</span>
          <div class="fc-gi"><b>几何 IV</b><span class="green">{{ pctFmt(asianData.sigmaGeo) }}</span></div>
        </div>
        <div class="fc-meta">σ_geo = σ / √3 ≈ {{ (asianData.regularIv / 1.732).toFixed(4) }} → 降低 {{ ((1 - 1/1.732) * 100).toFixed(0) }}% 有效波动</div>
      </div>
      <div class="fc-gr4">
        <div class="fc-gi"><b>Asian 价格</b><span>{{ fmt(asianData.price) }}</span></div>
        <div class="fc-gi"><b>Δ</b><span :class="greekTone(asianData.optionDelta)">{{ f4(asianData.optionDelta) }}</span></div>
        <div class="fc-gi"><b>Γ</b><span>{{ f4(asianData.optionGamma) }}</span></div>
        <div class="fc-gi"><b>Bachelier</b><span>{{ fmt(bachelierData?.price) }}</span></div>
        <div class="fc-gi"><b>B-Δ</b><span :class="greekTone(bachelierData?.optionDelta)">{{ f4(bachelierData?.optionDelta) }}</span></div>
        <div class="fc-gi"><b>B-Γ</b><span>{{ f4(bachelierData?.optionGamma) }}</span></div>
      </div>
      <div class="fc-meta">Bachelier 使用 normal vol = S·σ；Asian/Bachelier 只用于 LP payoff fit 研究，不进入挂单。</div>
    </div>

    <!-- DEVIATION SCORE -->
    <svg v-else-if="formulaId === 'deviation-score' && devScoreData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">偏离强度 · Z={{ devScoreData.z.toFixed(2) }}σ · {{ devScoreData.regime }}{{ devScoreData.strength }}</text>
      <!-- Normal distribution curve -->
      <polyline :points="normalCurve" fill="var(--blue-dim)" stroke="var(--blue)" stroke-width="1.5" />
      <!-- Z-score marker -->
      <line :x1="zMarker?.x ?? PL" :x2="zMarker?.x ?? PL" :y1="sy(1)" :y2="sy(0.02)" stroke="var(--ink)" stroke-width="2" />
      <circle :cx="zMarker?.x ?? PL" :cy="zMarker?.y ?? sy(0)" r="5" fill="var(--red)" />
      <text :x="(zMarker?.x ?? PL) + 6" :y="(zMarker?.y ?? sy(0)) - 6" class="fc-tick" fill="var(--red)">Z={{ devScoreData.z.toFixed(2) }}</text>
      <!-- Zero line -->
      <line :x1="W/2" :x2="W/2" :y1="sy(1)" :y2="sy(0.02)" stroke="var(--line)" stroke-width="1" stroke-dasharray="3,3" />
      <text :x="W/2" :y="sy(0)+18" text-anchor="middle" class="fc-tick">0σ</text>
      <text :x="W-PR" :y="H-4" text-anchor="end" class="fc-tick">偏离百分位 {{ (devScoreData.deviationPercentile * 100).toFixed(1) }}% · 双尾 {{ (devScoreData.twoSidedTailProbability * 100).toFixed(1) }}%</text>
    </svg>

    <!-- RISK SURFACE -->
    <svg v-else-if="formulaId === 'risk-surface' && riskSurfaceData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">风险曲面 · Greeks × 价格带</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Delta curve -->
      <polyline :points="riskSurfaceData.points.map((p, i) => `${sx(i / riskSurfaceData.points.length)},${sy(p.optionDelta)}`).join(' ')" fill="none" stroke="var(--green)" stroke-width="1.5" />
      <text :x="W-PR" :y="sy(riskSurfaceData.points[riskSurfaceData.points.length-1].optionDelta)+4" text-anchor="end" class="fc-tick green">Δ</text>
      <!-- Gamma curve (scaled up 100x) -->
      <polyline :points="riskSurfaceData.points.map((p, i) => `${sx(i / riskSurfaceData.points.length)},${sy(Math.min(1, p.optionGamma * 100))}`).join(' ')" fill="none" stroke="var(--blue)" stroke-width="1" stroke-dasharray="3,2" />
      <text :x="W-PR" :y="sy(Math.min(1, riskSurfaceData.points[riskSurfaceData.points.length-1].optionGamma * 100))-6" text-anchor="end" class="fc-tick blue">Γ×100</text>
      <!-- Entry price line -->
      <line :x1="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :x2="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :y1="sy(0)" :y2="sy(1)" stroke="var(--ink)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="sx((riskSurfaceData.entryPrice - riskSurfaceData.bandLow) / (riskSurfaceData.bandHigh - riskSurfaceData.bandLow))" :y="sy(0.05)" text-anchor="middle" class="fc-tick">入场</text>
      <text :x="PL" :y="sy(0)+18" text-anchor="start" class="fc-tick">{{ fmt(riskSurfaceData.bandLow) }}</text>
      <text :x="W-PR" :y="sy(0)+18" text-anchor="end" class="fc-tick">{{ fmt(riskSurfaceData.bandHigh) }}</text>
    </svg>

    <!-- FUSION CARDS -->
    <FormulaFusionViews
      v-else-if="
        (formulaId === 'net-lp-efficiency' && netLpData) ||
        (formulaId === 'dynamic-holding-state' && dynamicHoldingData) ||
        (formulaId === 'lp-pool-coverage' && lpPoolData)
      "
      :formula-id="formulaId"
      :net-lp-data="netLpData"
      :lp-pool-data="lpPoolData"
      :dynamic-holding-data="dynamicHoldingData"
      :fmt="fmt"
      :pct-fmt="pctFmt"
    />

    <!-- NET CARRY -->
    <svg v-else-if="formulaId === 'net-carry' && netCarryDisplay" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">持仓归因情景 · 未接真实结算</text>
      <line :x1="PL" :x2="W-PR" :y1="netCarryDisplay.zeroY" :y2="netCarryDisplay.zeroY" stroke="var(--line)" stroke-width="1" />
      <g v-for="bar in netCarryDisplay.bars" :key="bar.label">
        <rect :x="bar.x" :y="bar.y" width="58" :height="bar.height" :fill="bar.tone" rx="2" opacity="0.62" />
        <text :x="bar.x + 29" :y="bar.value >= 0 ? bar.y - 4 : bar.y + bar.height + 11" text-anchor="middle" class="fc-tick" :fill="bar.tone">{{ pctFmt(bar.value) }}</text>
        <text :x="bar.x + 29" :y="H - 18" text-anchor="middle" class="fc-tick">{{ bar.label }}</text>
      </g>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">同名义净成本盈亏平衡 @ {{ pctFmt(netCarryData.breakEvenFundingNetCostReturn) }} · 未接真实资金费率</text>
    </svg>

    <!-- MEAN REVERSION -->
    <svg v-else-if="formulaId === 'mean-reversion' && mrData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">AR(1) 样本诊断 · 半衰期 {{ mrData.halfLifeSessions !== null ? Math.round(mrData.halfLifeSessions) + '会话' : '不可定义' }}</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <!-- Decay curve: e^(-θ×t) -->
      <polyline :points="decayCurve" fill="none" stroke="var(--green)" stroke-width="2" />
      <!-- Half-life marker -->
      <line v-if="mrData.halfLifeSessions !== null" :x1="hlMarker?.x ?? PL" :x2="hlMarker?.x ?? PL" :y1="sy(0)" :y2="sy(0.55)" stroke="var(--red)" stroke-width="1" stroke-dasharray="4,3" />
      <circle v-if="mrData.halfLifeSessions !== null" :cx="hlMarker?.x ?? PL" :cy="hlMarker?.y ?? sy(0)" r="4" fill="var(--red)" />
      <text v-if="mrData.halfLifeSessions !== null" :x="(hlMarker?.x ?? PL) + 6" :y="(hlMarker?.y ?? sy(0)) - 4" class="fc-tick" fill="var(--red)">t½={{ Math.round(mrData.halfLifeSessions) }}会话</text>
      <text :x="PL" :y="sy(0)+16" class="fc-tick">0</text>
      <text :x="W-PR" :y="sy(0)+16" text-anchor="end" class="fc-tick">{{ Number.isFinite(mrData.plotHorizonSessions) ? Math.round(mrData.plotHorizonSessions) + '会话（样本分辨率绘图区）' : '—' }}</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">AR={{ mrData.arCoefficient.toFixed(3) }} · decay={{ Number.isFinite(mrData.arDecayRatePerStep) ? mrData.arDecayRatePerStep.toFixed(4) : '—' }} · {{ mrData.speed }}</text>
    </svg>

    <!-- GAMMA PNL -->
    <svg v-else-if="formulaId === 'gamma-pnl' && gpData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">Gamma 情景值 · ½Γ(ΔP)²</text>
      <line :x1="PL" :x2="W-PR" :y1="sy(0)" :y2="sy(0)" stroke="var(--line)" stroke-width="1" />
      <line :x1="W/2" :x2="W/2" :y1="sy(1)" :y2="sy(0)" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3" />
      <!-- Parabola: ½Γx² -->
      <polyline :points="gammaCurve" fill="var(--green-dim)" stroke="var(--green)" stroke-width="2" />
      <!-- Current PnL marker -->
      <circle :cx="gpMarker?.cx ?? PL" :cy="gpMarker?.cy ?? sy(0)" r="4" fill="var(--ink)" />
      <text :x="(gpMarker?.cx ?? PL) + 6" :y="(gpMarker?.cy ?? sy(0)) - 4" class="fc-tick">{{ fmt(gpData.gammaPnl) }}</text>
      <text :x="W/2" :y="sy(0)+16" text-anchor="middle" class="fc-tick">ΔP=0</text>
      <text :x="W/2" :y="H-2" text-anchor="middle" class="fc-tick">{{ gpData.convexityNote }}</text>
    </svg>

    <!-- VOL CONFIDENCE -->
    <svg v-else-if="formulaId === 'vol-confidence' && vcData" :viewBox="`0 0 ${W} ${H}`" class="fc-svg">
      <text :x="W/2" :y="14" text-anchor="middle" class="fc-ttl">历史波动样本区间 · {{ vcData.quality }} · ±{{ pctFmt(vcData.relativeUncertainty) }}</text>
      <!-- Center line -->
      <line :x1="PL" :x2="W-PR" :y1="sy(0.5)" :y2="sy(0.5)" stroke="var(--green)" stroke-width="2" />
      <text :x="PL-4" :y="sy(0.5)+4" text-anchor="end" class="fc-tick">{{ pctFmt(vcData.annualVol) }}</text>
      <!-- Confidence band -->
      <rect :x="PL+10" :y="sy(vcData.upper / (vcData.annualVol * 1.5))" :width="pw-20" :height="Math.max(2, sy(vcData.lower / (vcData.annualVol * 1.5)) - sy(vcData.upper / (vcData.annualVol * 1.5)))" fill="var(--blue-dim)" rx="2" />
      <!-- Upper bound -->
      <line :x1="PL" :x2="W-PR" :y1="sy(vcData.upper / (vcData.annualVol * 1.5))" :y2="sy(vcData.upper / (vcData.annualVol * 1.5))" stroke="var(--red)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="sy(vcData.upper / (vcData.annualVol * 1.5))-3" text-anchor="end" class="fc-tick" fill="var(--red)">{{ pctFmt(vcData.upper) }}</text>
      <!-- Lower bound -->
      <line :x1="PL" :x2="W-PR" :y1="sy(vcData.lower / (vcData.annualVol * 1.5))" :y2="sy(vcData.lower / (vcData.annualVol * 1.5))" stroke="var(--blue)" stroke-width="1" stroke-dasharray="4,3" />
      <text :x="W-PR" :y="sy(vcData.lower / (vcData.annualVol * 1.5))-3" text-anchor="end" class="fc-tick" fill="var(--blue)">{{ pctFmt(vcData.lower) }}</text>
      <text :x="W/2" :y="H-4" text-anchor="middle" class="fc-tick">n={{ vcData.sampleSize }} · SE=σ/√(2n)={{ pctFmt(vcData.se) }}</text>
    </svg>

    <!-- FALLBACK -->
    <div v-else class="fc-card">
      <span class="fc-ttl">{{ stage?.label || formulaId }}</span>
      <strong class="fc-fallback-state" :class="`state-${availability.tone}`">{{ availability.label }}</strong>
      <div v-if="availability.missingInputs.length" class="fc-fallback-row">
        <b>缺少输入</b><span>{{ availability.missingText }}</span>
      </div>
      <div v-if="availability.blockedReasons.length" class="fc-fallback-row">
        <b>当前原因</b><span>{{ availability.reasonText }}</span>
      </div>
      <div class="fc-fallback-row"><b>下一步</b><span>{{ availability.nextStep }}</span></div>
      <div class="fc-meta">{{ availability.boundary }}</div>
    </div>

    <!-- 小白指南 -->
    <div v-if="guide" class="fc-guide">
      <span class="fc-guide-title">📖 {{ guide.title }}</span>
      <p class="fc-guide-body">{{ guide.body }}</p>
    </div>

  </div>
</template>

<style>
.fc-shell { min-height: 200px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: hidden; }
.fc-svg { display: block; width: 100%; height: auto; }
.fc-ttl { font-size: 0.7rem; font-weight: 900; fill: var(--green); letter-spacing: 0.04em; color: var(--green); }
.fc-tick { font-size: 9px; fill: var(--muted); }
.fc-card { display: grid; gap: 8px; padding: 12px; }
.fc-availability { display: flex; flex-wrap: wrap; gap: 5px 10px; align-items: baseline; padding: 7px 10px; border-bottom: 1px solid currentColor; background: var(--surface-alt); font-size: 0.68rem; }
.fc-availability strong { font-size: 0.72rem; }
.fc-availability.state-missing, .fc-availability.state-gate-failed { color: var(--red); }
.fc-availability.state-not-applicable { color: var(--muted); }
.fc-fallback-state { width: max-content; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: 0.72rem; }
.fc-fallback-state.state-missing, .fc-fallback-state.state-gate-failed { color: var(--red); }
.fc-fallback-state.state-not-applicable { color: var(--muted); }
.fc-fallback-state.state-research { color: var(--blue); }
.fc-fallback-state.state-proxy { color: #8b5a16; }
.fc-fallback-state.state-unverified { color: var(--muted); }
.fc-fallback-row { display: grid; grid-template-columns: 68px 1fr; gap: 8px; font-size: 0.74rem; line-height: 1.45; }
.fc-fallback-row b { color: var(--muted); }
.fc-kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.fc-kv div { display: grid; gap: 1px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); }
.fc-kv b { font-size: 0.6rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.fc-kv span { font-size: 0.82rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.fc-gr4, .fc-gr3 { display: grid; gap: 6px; }
.fc-gr4 { grid-template-columns: repeat(4, 1fr); }
.fc-gr3 { grid-template-columns: repeat(3, 1fr); }
.fc-gi { display: grid; gap: 2px; padding: 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); }
.fc-gi b { font-size: 0.6rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.fc-gi span { font-size: 0.88rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.fc-big { font-size: 1.8rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.fc-meta { font-size: 0.72rem; color: var(--muted); }
.fc-ce-row { display: flex; align-items: baseline; gap: 12px; }
.fc-vol { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fc-vol-main { display: grid; gap: 2px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); text-align: center; }
.fc-vol-main small { font-size: 0.66rem; color: var(--muted); }
.fc-formulas { display: grid; gap: 4px; }
.fc-formulas code { display: block; border: 1px solid var(--line); border-radius: 4px; padding: 5px 8px; background: var(--bg); color: var(--blue); font-size: 0.74rem; white-space: nowrap; overflow: auto; }
.fc-orders { display: grid; gap: 4px; }
.fc-orow { display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); font-size: 0.78rem; }
.fc-orole { font-weight: 800; color: var(--green); font-size: 0.7rem; min-width: 36px; }
.fc-onotional { color: var(--muted); margin-left: auto; }
.fc-asian { display: grid; gap: 8px; }
.fc-asian-cmp { display: flex; align-items: center; gap: 10px; }
.fc-plan-wait { display: grid; gap: 8px; }
.fc-guide { margin: 0 10px 10px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: var(--surface-alt); }
.fc-guide-title { display: block; font-size: 0.68rem; font-weight: 900; color: var(--green); margin-bottom: 4px; }
.fc-guide-body { margin: 0; font-size: 0.74rem; color: var(--ink); line-height: 1.45; }
.fc-liquidity-rack { height: min(680px, 72vh); min-height: 520px; background: var(--surface); }
.green { color: var(--green); }
.red { color: var(--red); }
@media (max-width: 768px) {
  .fc-liquidity-rack { height: 620px; min-height: 620px; }
}
</style>
