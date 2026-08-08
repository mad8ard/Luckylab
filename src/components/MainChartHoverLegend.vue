<script setup>
defineProps({
  // 父组件构造好的 legend 对象，shape 参考 MainChart 的 buildLegend
  // null 表示不显示
  legend: { type: Object, default: null },
})

function formatLegendValue(unit, value) {
  if (!Number.isFinite(value)) return '—'
  if (unit === 'pct')   return `${(value * 100).toFixed(2)}%`
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (unit === 'num')   return value.toFixed(2)
  // price
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function formatVolume(v) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(v)
}
</script>

<template>
  <div v-if="legend && legend.ohlcv" class="mc-legend" :class="`dir-${legend.ohlcv.direction ?? 'flat'}`">
    <div class="mc-legend-head">
      <span class="mc-legend-date">{{ legend.date }}</span>
      <span class="mc-legend-ohlc">
        <em>开</em>{{ formatLegendValue('price', legend.ohlcv.open) }}
        <em>高</em>{{ formatLegendValue('price', legend.ohlcv.high) }}
        <em>低</em>{{ formatLegendValue('price', legend.ohlcv.low) }}
        <em>收</em>{{ formatLegendValue('price', legend.ohlcv.close) }}
      </span>
      <span class="mc-legend-change">
        <template v-if="Number.isFinite(legend.ohlcv.change)">
          <span class="mc-legend-delta">{{ legend.ohlcv.change > 0 ? '+' : '' }}{{ formatLegendValue('price', legend.ohlcv.change) }}</span>
          <span class="mc-legend-pct">{{ legend.ohlcv.changePct > 0 ? '+' : '' }}{{ (legend.ohlcv.changePct * 100).toFixed(2) }}%</span>
        </template>
      </span>
      <span class="mc-legend-vol"><em>量</em>{{ formatVolume(legend.ohlcv.volume) }}</span>
    </div>
    <div v-for="g in legend.indicators" :key="g.group" class="mc-legend-group">
      <span v-for="ind in g.items" :key="ind.key" class="mc-legend-item">
        <i :style="{ background: ind.color }" />
        <span class="mc-legend-title">{{ ind.title }}</span>
        <strong>{{ formatLegendValue(ind.unit, ind.value) }}</strong>
      </span>
    </div>
  </div>
</template>

<style>
/* hover 图例：透明贴在主图内，避免遮挡 K 线和 TV 交互层 */
.mc-legend {
  position: absolute; top: 6px; left: 10px; right: 56px; z-index: 12;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px;
  max-height: 54px; overflow: hidden;
  color: var(--ink); font-size: 0.68rem; line-height: 1.22;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  text-shadow: 0 1px 0 var(--bg), 0 -1px 0 var(--bg), 1px 0 0 var(--bg), -1px 0 0 var(--bg);
}
.mc-legend-head {
  display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px;
  font-weight: 700;
}
.mc-legend-date { color: var(--green); font-weight: 800; letter-spacing: 0.02em; }
.mc-legend-ohlc em,
.mc-legend-vol em {
  color: var(--muted); font-style: normal; font-weight: 800;
  font-size: 0.62rem; margin-right: 2px; margin-left: 2px;
}
.mc-legend-ohlc em:first-child, .mc-legend-vol em:first-child { margin-left: 0; }
.mc-legend-change { display: inline-flex; gap: 4px; align-items: baseline; }
.mc-legend-delta, .mc-legend-pct { font-weight: 800; }
.dir-up .mc-legend-delta, .dir-up .mc-legend-pct { color: #0e7558; }
.dir-down .mc-legend-delta, .dir-down .mc-legend-pct { color: #a93226; }
.mc-legend-group {
  display: inline-flex; flex-wrap: wrap; gap: 2px 10px;
}
.mc-legend-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.mc-legend-item i {
  width: 10px; height: 2px; border-radius: 1px; display: inline-block; flex-shrink: 0;
}
.mc-legend-title {
  color: var(--muted); font-size: 0.64rem; font-weight: 700;
  white-space: nowrap;
}
.mc-legend-item strong { font-weight: 800; }
@media (max-width: 768px) {
  .mc-legend {
    max-height: 40px;
    font-size: 0.62rem;
    gap: 1px 9px;
    /* 移动端：脱离主图绝对定位，固定到视口底部作为信息条 */
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    max-width: 100vw;
    transform: none !important;
    border-radius: 0;
    border-top: 1px solid var(--line);
    background: var(--bg);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
    padding: 8px 12px;
    z-index: 30;
  }
  .mc-legend-head, .mc-legend-group { gap: 1px 7px; }
}
</style>
