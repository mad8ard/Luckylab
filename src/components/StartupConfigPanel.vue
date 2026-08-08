<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
  featureFlags: { type: Object, required: true },
  overlays: { type: Object, required: true },
  rows: { type: Array, default: () => [] },
  cursor: { type: Number, default: 0 },
})

const warmupIndex = computed(() => Math.min(
  80,
  Math.max(20, Math.floor(props.rows.length * 0.03)),
  Math.max(props.rows.length - 1, 0),
))
const firstDate = computed(() => props.rows[warmupIndex.value]?.date ?? props.rows[0]?.date ?? '')
const lastDate = computed(() => props.rows[Math.min(Math.max(props.cursor, 0), Math.max(props.rows.length - 1, 0))]?.date ?? props.rows.at(-1)?.date ?? '')
</script>

<template>
  <section class="startup-config">
    <header>
      <span>回放设置</span>
      <strong>运行链路</strong>
    </header>

    <div class="sc-chain">
      <span>市场样本</span>
      <b>→</b>
      <span>信号引擎</span>
      <b>+</b>
      <span :class="{ off: !featureFlags.replayAccount }">现货回放</span>
      <b>+</b>
      <span :class="{ off: !featureFlags.portfolioResearch }">公式研究</span>
    </div>

    <div class="sc-grid">
      <label class="sc-toggle">
        <input v-model="featureFlags.replayAccount" type="checkbox" />
        <span>启用现货路径回放</span>
      </label>
      <label class="sc-toggle">
        <input v-model="featureFlags.replayAutoProfile" type="checkbox" :disabled="!featureFlags.replayAccount" />
        <span>回放选档</span>
      </label>
      <label class="sc-toggle">
        <input v-model="featureFlags.portfolioResearch" type="checkbox" />
        <span>显示组合研究</span>
      </label>
      <label class="sc-toggle">
        <input v-model="overlays.equityPane" type="checkbox" :disabled="!featureFlags.replayAccount" />
        <span>权益子图</span>
      </label>
    </div>

    <div class="sc-inputs">
      <label>
        <span>账户资金</span>
        <input v-model.number="input.capital" type="number" min="0" step="100" />
      </label>
      <label>
        <span>底仓名义</span>
        <input v-model.number="input.baseNotional" type="number" min="0" step="100" />
      </label>
      <label>
        <span>账户入场日</span>
        <input v-model="input.accountStartDate" type="date" :min="firstDate" :max="lastDate" />
      </label>
      <label>
        <span>自动起点</span>
        <button type="button" class="sc-mini-btn" @click="input.accountStartDate = ''">{{ firstDate || '样本 warmup' }}</button>
      </label>
    </div>

    <p>
      默认模拟只消费市场样本、GetDelta/成本带与显式账户输入。账户入场日决定现货回放起点；留空时从样本 warmup 后开始。
    </p>
  </section>
</template>

<style>
.startup-config { display: grid; gap: 9px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.startup-config header { display: grid; gap: 2px; }
.startup-config header span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.startup-config header strong { font-size: 0.95rem; }
.sc-chain { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; font-size: 0.68rem; color: var(--muted); }
.sc-chain span { border: 1px solid var(--line); border-radius: 999px; padding: 2px 6px; background: var(--panel); color: var(--green); font-weight: 800; }
.sc-chain span.off { color: var(--muted); opacity: 0.65; }
.sc-chain b { font-weight: 800; color: var(--muted); }
.sc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sc-toggle { display: flex; gap: 6px; align-items: center; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 5px 7px; background: var(--bg); cursor: pointer; }
.sc-toggle:has(input:checked) { border-color: var(--green); background: var(--surface-active); }
.sc-toggle input { margin: 0; }
.sc-toggle span { color: var(--ink); font-size: 0.72rem; font-weight: 700; overflow-wrap: anywhere; }
.sc-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.sc-inputs label { display: grid; gap: 2px; min-width: 0; }
.sc-inputs span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.sc-inputs input,
.sc-mini-btn { min-width: 0; min-height: 28px; border: 1px solid var(--line); border-radius: 5px; padding: 3px 7px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; }
.sc-mini-btn { cursor: pointer; font-size: 0.72rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-mini-btn:hover { border-color: var(--green); background: var(--surface-active); }
.startup-config p { margin: 0; color: var(--muted); font-size: 0.66rem; line-height: 1.45; }
</style>
