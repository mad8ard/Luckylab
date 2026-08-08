<script setup>
import { computed, onMounted, ref } from 'vue'
import { useBreakpoint } from '../composables/useBreakpoint.js'

const { isMobile } = useBreakpoint()
const mobileTab = ref('focus') // 'focus' | 'wait'

const pool = ref(null)
const loading = ref(true)
const error = ref('')

const focusItems = computed(() => pool.value?.focusItems ?? [])
const waitItems = computed(() => pool.value?.waitItems ?? [])
const dimensions = computed(() => (pool.value?.dimensions ?? []).filter((item) => item.enabled))

onMounted(async () => {
  try {
    const res = await fetch('/recommended-pool/data.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    pool.value = await res.json()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})

function fmt(v, digits = 2) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(digits) : '--'
}

function pct(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '--'
}

function dateText(v) {
  return v ? String(v).slice(0, 10) : '--'
}

function tierTitle(kind) {
  return kind === 'focus' ? '重点关注' : '等待观察'
}
</script>

<template>
  <main class="pool-page">
    <header class="pool-header">
      <div>
        <p class="pool-kicker">Market Lab</p>
        <h1>推荐股票池</h1>
      </div>
      <a class="pool-link" href="/">主工作台</a>
    </header>

    <section v-if="loading" class="pool-state">加载推荐池数据...</section>
    <section v-else-if="error" class="pool-state pool-error">
      推荐池数据读取失败：{{ error }}
    </section>

    <template v-else>
      <section class="pool-summary">
        <div>
          <span>生成日期</span>
          <strong>{{ dateText(pool.generatedAt) }}</strong>
        </div>
        <div>
          <span>候选数</span>
          <strong>{{ pool.totalCandidates }}</strong>
        </div>
        <div>
          <span>重点</span>
          <strong>{{ focusItems.length }}</strong>
        </div>
        <div>
          <span>等待</span>
          <strong>{{ waitItems.length }}</strong>
        </div>
      </section>

      <section class="pool-dims">
        <span v-for="dim in dimensions" :key="dim.id">{{ dim.label }} {{ dim.weight }}</span>
      </section>

      <div v-if="isMobile" class="pool-mobile-tabs">
        <button
          type="button"
          class="pool-mobile-tab"
          :class="{ 'is-active': mobileTab === 'focus' }"
          @click="mobileTab = 'focus'"
        >
          重点关注
        </button>
        <button
          type="button"
          class="pool-mobile-tab"
          :class="{ 'is-active': mobileTab === 'wait' }"
          @click="mobileTab = 'wait'"
        >
          等待观察
        </button>
      </div>

      <section class="pool-columns">
        <article
          v-for="group in [
            { kind: 'focus', items: focusItems },
            { kind: 'wait', items: waitItems },
          ]"
          v-show="!isMobile || mobileTab === group.kind"
          :key="group.kind"
          class="pool-group"
        >
          <h2>{{ tierTitle(group.kind) }}</h2>
          <div class="pool-table">
            <div class="pool-row pool-head">
              <span>标的</span>
              <span>得分</span>
              <span>价格</span>
              <span>LP</span>
              <span>Z</span>
              <span>周期</span>
            </div>
            <div v-for="item in group.items" :key="item.symbol" class="pool-row">
              <span>
                <b>{{ item.label }}</b>
                <small>{{ item.symbol }} · {{ item.market }}</small>
              </span>
              <span>{{ fmt(item.buyScore, 1) }}/{{ fmt(item.maxScore, 0) }}</span>
              <span>{{ fmt(item.metrics?.price, 2) }}</span>
              <span>{{ pct(item.metrics?.lpValuePercentile) }}</span>
              <span>{{ fmt(item.metrics?.zScore, 2) }}σ</span>
              <span>{{ fmt(item.metrics?.holdingDays, 0) }}天</span>
            </div>
          </div>
        </article>
      </section>

      <section class="pool-notes">
        <h2>策略说明</h2>
        <p>{{ pool.logic }}</p>
        <p>{{ pool.riskNote }}</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.pool-page {
  min-height: 100vh;
  background: #f7f4ec;
  color: #171714;
  padding: 24px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.pool-header,
.pool-summary,
.pool-group,
.pool-notes {
  border: 1px solid #d9d2c2;
  background: rgba(255, 253, 247, 0.88);
}

.pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
}

.pool-kicker {
  margin: 0 0 4px;
  color: #08785f;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 28px;
  line-height: 1.15;
}

h2 {
  font-size: 18px;
}

.pool-link {
  color: #08785f;
  font-weight: 700;
  text-decoration: none;
}

.pool-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 16px;
}

.pool-summary div {
  padding: 14px 16px;
  border-right: 1px solid #d9d2c2;
}

.pool-summary div:last-child {
  border-right: 0;
}

.pool-summary span {
  display: block;
  color: #08785f;
  font-size: 12px;
  font-weight: 800;
}

.pool-summary strong {
  display: block;
  margin-top: 4px;
  font-size: 24px;
}

.pool-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}

.pool-dims span {
  border: 1px solid #cfc5b1;
  background: #fffdf7;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 700;
}

.pool-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.pool-group {
  min-width: 0;
  padding: 16px;
}

.pool-table {
  margin-top: 12px;
  overflow-x: auto;
}

.pool-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.4fr) repeat(5, minmax(72px, 0.8fr));
  gap: 10px;
  align-items: center;
  min-width: 660px;
  padding: 10px 0;
  border-top: 1px solid #e2dccf;
  font-size: 14px;
}

.pool-head {
  color: #08785f;
  font-size: 12px;
  font-weight: 800;
}

.pool-row b,
.pool-row small {
  display: block;
}

.pool-row small {
  margin-top: 2px;
  color: #6d695f;
  font-size: 12px;
}

.pool-notes {
  margin-top: 16px;
  padding: 16px;
}

.pool-notes p {
  margin-top: 8px;
  color: #4b473f;
  line-height: 1.55;
}

.pool-state {
  margin-top: 16px;
  border: 1px solid #d9d2c2;
  background: #fffdf7;
  padding: 18px;
  font-weight: 700;
}

.pool-error {
  border-color: #b92d2d;
  color: #9a1f1f;
}

@media (max-width: 768px) {
  .pool-page {
    padding: 12px;
  }

  .pool-header,
  .pool-columns {
    display: block;
  }

  .pool-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pool-summary div:nth-child(2) {
    border-right: 0;
  }

  .pool-group + .pool-group {
    margin-top: 12px;
  }

  .pool-mobile-tabs {
    display: flex;
    gap: 8px;
    margin: 12px 0;
  }

  .pool-mobile-tab {
    flex: 1;
    min-height: 36px;
    border: 1px solid #d9d2c2;
    border-radius: 6px;
    background: #fffdf7;
    color: #171714;
    font-size: 0.84rem;
    font-weight: 700;
    cursor: pointer;
  }

  .pool-mobile-tab.is-active {
    border-color: #08785f;
    color: #08785f;
  }
}
</style>
