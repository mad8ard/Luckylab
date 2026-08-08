<script setup>
import { computed } from 'vue'
import { buildVolumePriceProfile } from '../domain/research-visualization/volumePriceProfile.js'

const props = defineProps({
  rows: { type: Array, required: true },
  viewport: { type: Object, default: null },
})

const profile = computed(() => buildVolumePriceProfile({
  rows: props.rows,
  activeIndex: Number.isInteger(props.viewport?.activeIndex) ? props.viewport.activeIndex : props.rows.length - 1,
  visibleWindow: Number.isFinite(props.viewport?.visibleWindow) ? props.viewport.visibleWindow : 180,
  binCount: 36,
}))
const W = 220
const PLOT_RIGHT = 216
const MAX_BAR = 170
const viewportHeight = computed(() => Math.max(180, Math.round(props.viewport?.height ?? 360)))
const priceRange = computed(() => {
  const lower = Number(props.viewport?.priceLower)
  const upper = Number(props.viewport?.priceUpper)
  if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) return { lower, upper }
  return profile.value.range
})

const bars = computed(() => {
  const model = profile.value
  const range = priceRange.value
  if (!range || range.upper <= range.lower) return []
  return model.bins.map((bin) => {
    if (bin.upper < range.lower || bin.lower > range.upper) return null
    const y1 = priceY(Math.min(bin.upper, range.upper), range)
    const y2 = priceY(Math.max(bin.lower, range.lower), range)
    const h = Math.max(2, y2 - y1 - 1)
    const width = Math.max(1, bin.intensity * MAX_BAR)
    return {
      ...bin,
      x: PLOT_RIGHT - width,
      y: y1,
      width,
      height: h,
      upWidth: width * bin.upShare,
      downWidth: width * bin.downShare,
    }
  }).filter(Boolean)
})
const pocY = computed(() => priceYInRange(profile.value.poc?.mid))
const currentY = computed(() => priceYInRange(profile.value.currentPrice))

function money(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : '—'
}

function volume(value) {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

function priceY(price, range) {
  return ((range.upper - price) / (range.upper - range.lower)) * viewportHeight.value
}

function priceYInRange(price) {
  const range = priceRange.value
  if (!Number.isFinite(price) || !range || price < range.lower || price > range.upper) return null
  return priceY(price, range)
}
</script>

<template>
  <aside v-if="profile.bins.length" class="scp" aria-label="个股筹码图">
    <svg :viewBox="`0 0 ${W} ${viewportHeight}`" class="scp-svg">
      <g class="scp-bars">
        <g
          v-for="bar in bars"
          :key="bar.index"
          :class="{ poc: bar.isPoc, current: bar.isCurrent, value: bar.inValueArea }"
        >
          <title>{{ money(bar.lower) }} - {{ money(bar.upper) }} · {{ volume(bar.volume) }}</title>
          <rect
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            rx="1.5"
            class="scp-total"
          />
          <rect
            :x="PLOT_RIGHT - bar.upWidth"
            :y="bar.y"
            :width="bar.upWidth"
            :height="bar.height"
            rx="1.5"
            class="scp-up"
          />
          <rect
            :x="PLOT_RIGHT - bar.upWidth - bar.downWidth"
            :y="bar.y"
            :width="bar.downWidth"
            :height="bar.height"
            rx="1.5"
            class="scp-down"
          />
        </g>
      </g>
      <line v-if="pocY !== null" x1="30" :x2="PLOT_RIGHT" :y1="pocY" :y2="pocY" class="scp-poc-line" />
      <text v-if="pocY !== null" x="34" :y="pocY - 4" class="scp-label">POC {{ money(profile.poc?.mid) }}</text>
      <line v-if="currentY !== null" x1="14" :x2="PLOT_RIGHT" :y1="currentY" :y2="currentY" class="scp-current-line" />
      <text v-if="currentY !== null" x="18" :y="currentY + 12" class="scp-label current">现价 {{ money(profile.currentPrice) }}</text>
      <text x="118" y="13" class="scp-watermark">筹码 · 成交量代理</text>
    </svg>
  </aside>
</template>

<style>
.scp {
  position: absolute; top: 0; right: 54px; z-index: 14;
  width: min(260px, 26%); height: v-bind('`${viewportHeight}px`');
  pointer-events: none; overflow: hidden;
}
.scp-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.scp-total { fill: rgba(120,120,120,0.11); }
.scp-up { fill: rgba(14,117,88,0.34); }
.scp-down { fill: rgba(169,50,38,0.24); }
.scp-bars .value .scp-total { fill: rgba(14,117,88,0.13); }
.scp-bars .poc .scp-total { fill: rgba(139,90,22,0.32); }
.scp-bars .current .scp-total { stroke: rgba(39,79,159,0.7); stroke-width: 1; }
.scp-poc-line { stroke: rgba(139,90,22,0.82); stroke-width: 1.2; stroke-dasharray: 3 2; }
.scp-current-line { stroke: rgba(39,79,159,0.82); stroke-width: 1.2; }
.scp-label, .scp-watermark {
  fill: var(--muted); font-size: 9px; font-weight: 800;
  paint-order: stroke; stroke: var(--bg); stroke-width: 3px; stroke-linejoin: round;
}
.scp-label.current { fill: var(--ink); }
.scp-watermark { fill: var(--green); opacity: 0.72; }
@media (max-width: 768px) {
  .scp { display: none; }
}
</style>
