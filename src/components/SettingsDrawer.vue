<script setup>
import SimulationInputs from './SimulationInputs.vue'
import OptionPortfolioInputs from './OptionPortfolioInputs.vue'
import ObservationDateControl from './ObservationDateControl.vue'
import AdvancedSettingsContent from './AdvancedSettingsContent.vue'
import ChartOverlayToggles from './ChartOverlayToggles.vue'
import StartupConfigPanel from './StartupConfigPanel.vue'
import StrategyProfileInputs from './StrategyProfileInputs.vue'

defineProps({
  input: { type: Object, required: true },
  rows: { type: Array, required: true },
  cursor: { type: Number, required: true },
  observationDate: { type: String, default: '' },
  featureFlags: { type: Object, required: true },
  profileList: { type: Array, required: true },
  graph: { type: Object, default: null },
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, required: true },
  symbol: { type: String, default: '' },
  overlays: { type: Object, required: true },
  theme: { type: String, default: 'light' },
})

// 四个 emit 事件：计算口径覆盖、计算口径重置、主题切换、全量重置
const emit = defineEmits(['override-tdpy', 'reset-tdpy', 'set-theme', 'reset-all', 'set-observation-date', 'latest-observation'])
</script>

<template>
  <div class="sd-drawer">
    <StartupConfigPanel
      :input="input"
      :feature-flags="featureFlags"
      :overlays="overlays"
      :rows="rows"
      :cursor="cursor"
    />

    <section class="sd-section">
      <h3 class="sd-h">样本时间</h3>
      <ObservationDateControl
        :rows="rows"
        :cursor="cursor"
        :observation-date="observationDate"
        @set-date="(date) => emit('set-observation-date', date)"
        @latest="emit('latest-observation')"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">模拟参数</h3>
      <SimulationInputs :input="input" :graph="graph" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">执行规则</h3>
      <StrategyProfileInputs :input="input" :profile-list="profileList" :graph="graph" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">期权组合研究</h3>
      <OptionPortfolioInputs :input="input" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">计算口径</h3>
      <AdvancedSettingsContent
        :tdpy-meta="tdpyMeta"
        :effective-tdpy="effectiveTdpy"
        :symbol="symbol"
        @override="(s, v) => emit('override-tdpy', s, v)"
        @reset="(s) => emit('reset-tdpy', s)"
      />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">主图叠加项</h3>
      <ChartOverlayToggles :overlays="overlays" />
    </section>

    <section class="sd-section">
      <h3 class="sd-h">主题</h3>
      <div class="sd-theme">
        <button :class="{ active: theme === 'light' }" @click="emit('set-theme', 'light')">浅色</button>
        <button :class="{ active: theme === 'dark' }" @click="emit('set-theme', 'dark')">深色</button>
      </div>
    </section>

    <section class="sd-section">
      <h3 class="sd-h">重置</h3>
      <button class="sd-reset" type="button" @click="emit('reset-all')">清空所有持久化参数 + 刷新</button>
    </section>
  </div>
</template>

<style>
.sd-drawer { display: grid; gap: 16px; min-width: 0; }
.sd-drawer > * { min-width: 0; }
.sd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); min-width: 0; }
.sd-section:last-child { border-bottom: none; }
.sd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.sd-theme { display: flex; gap: 6px; flex-wrap: wrap; }
.sd-theme button { min-height: 30px; padding: 4px 14px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-weight: 700; cursor: pointer; }
.sd-theme button.active { border-color: var(--green); background: var(--surface-active); }
.sd-reset { min-height: 32px; padding: 5px 14px; border: 1px solid #b8860b; border-radius: 5px; background: var(--bg); color: #b8860b; font-size: 0.8rem; font-weight: 700; cursor: pointer; overflow-wrap: anywhere; }
.sd-reset:hover { background: #b8860b; color: #fff; }
</style>
