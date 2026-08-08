<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  precision: { type: Number, default: 2 },
})

const pools = computed(() => props.model.realProfile?.pools ?? [])
const coverage = computed(() => normalizeCoverage(props.model.realProfile?.coverage ?? {}, pools.value))
const visibleRoutes = computed(() => (props.model.realProfile?.routes ?? []).slice(0, 8))
const hiddenRouteCount = computed(() => Math.max(0, (props.model.realProfile?.routes?.length ?? 0) - visibleRoutes.value.length))

function normalizeCoverage(raw, poolRows) {
  const reserveUsd = finiteOrNull(raw.reserveUsd) ?? sumBy(poolRows, 'reserveUsd')
  const volumeUsd24h = finiteOrNull(raw.volumeUsd24h) ?? sumBy(poolRows, 'volumeUsd24h')
  const topPoolReserveShare = finiteOrNull(raw.topPoolReserveShare) ?? computeTopReserveShare(poolRows, reserveUsd)
  return {
    ...raw,
    poolCount: raw.poolCount ?? poolRows.length,
    pairCount: raw.pairCount ?? countPairs(poolRows),
    protocolCount: raw.protocolCount ?? countProtocols(poolRows),
    reserveUsd,
    volumeUsd24h,
    topPoolReserveShare,
  }
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0)
}

function countPairs(poolRows) {
  return new Set(poolRows.map((pool) => {
    const symbols = [pool?.token0Symbol, pool?.token1Symbol].filter(Boolean).sort()
    return symbols.join('/')
  }).filter(Boolean)).size
}

function countProtocols(poolRows) {
  return new Set(poolRows.map((pool) => pool?.protocol).filter(Boolean)).size
}

function computeTopReserveShare(poolRows, reserveUsd) {
  if (!reserveUsd) return null
  const topReserve = Math.max(...poolRows.map((pool) => Number(pool?.reserveUsd) || 0), 0)
  return topReserve / reserveUsd
}

function fmt(value, digits = props.precision) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '-'
}

function usd(value) {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '-'
}
</script>

<template>
  <div v-if="model.realProfile?.routes?.length" class="lf-routes">
    <div class="lf-route-source">
      <span>聚合池路径</span>
      <b>{{ coverage.poolCount ?? model.realProfile.pools?.length ?? 0 }} 池 / {{ model.realProfile.routes.length }} 路径</b>
      <small>{{ coverage.quoteSymbols?.join('+') || 'USDT/USDC' }} · {{ coverage.protocolCount || coverage.protocols?.length || 0 }} 协议 · {{ coverage.pairCount || 0 }} pair</small>
      <small v-if="coverage.reserveUsd">蓄水 {{ usd(coverage.reserveUsd) }} USD · 24h {{ usd(coverage.volumeUsd24h) }} · top {{ pct(coverage.topPoolReserveShare) }}</small>
    </div>
    <div v-for="route in visibleRoutes" :key="route.id ?? `${route.quoteSymbol}-${route.label}`" class="lf-route-item">
      <span>{{ route.quoteSymbol }} · {{ route.routeType === 'via-weth' ? 'WETH 中转' : '直连' }}</span>
      <b>{{ fmt(route.quotePrice) }}</b>
      <small>{{ route.label }}</small>
      <small v-if="route.reserveUsd">蓄水 {{ usd(route.reserveUsd) }} · 24h {{ usd(route.volumeUsd24h) }}</small>
    </div>
    <div v-if="hiddenRouteCount" class="lf-route-more">
      <span>更多</span>
      <b>+{{ hiddenRouteCount }} 条路径</b>
      <small>已进入密度权重聚合</small>
    </div>
  </div>
</template>

<style scoped>
.lf-routes {
  display: grid;
  grid-template-columns: minmax(160px, 0.8fr) repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
}

.lf-route-source,
.lf-route-item,
.lf-route-more {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 7px 10px;
  background: var(--panel);
}

.lf-route-source span,
.lf-route-item span,
.lf-route-more span {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.lf-route-source b,
.lf-route-item b,
.lf-route-more b {
  font-size: 0.76rem;
  line-height: 1.1;
}

.lf-route-source small,
.lf-route-item small,
.lf-route-more small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.64rem;
  line-height: 1.2;
}
</style>
