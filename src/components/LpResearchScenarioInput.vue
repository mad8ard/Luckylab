<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
})
const emit = defineEmits(['change'])

const scenarioEnabled = fieldModel('lpScenarioEnabled')
const scenarioStartPrice = fieldModel('lpScenarioStartPrice')
const scenarioRangeWidth = fieldModel('lpScenarioRangeWidth')
const scenarioSkew = fieldModel('lpScenarioSkew')
const scenarioLiquidity = fieldModel('lpScenarioLiquidity')

const rangeValid = computed(() => {
  const value = Number(props.input.lpScenarioRangeWidth)
  return Number.isFinite(value) && value > 0 && value < 1
})

const ready = computed(
  () =>
    props.input.lpScenarioEnabled === true &&
    positive(props.input.lpScenarioStartPrice) &&
    rangeValid.value &&
    nonNegative(props.input.lpScenarioSkew) &&
    positive(props.input.lpScenarioLiquidity),
)

function positive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

function nonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0
}

function fieldModel(field) {
  return computed({
    get: () => props.input[field],
    set: (value) => emit('change', field, value),
  })
}
</script>

<template>
  <div class="lpsi-card" :class="{ active: input.lpScenarioEnabled === true }">
    <label class="lpsi-toggle">
      <input v-model="scenarioEnabled" type="checkbox" role="switch" />
      <span>
        <strong>声明 LP 研究情景</strong>
        <small>默认不估值；聚合池报价不会替代你的仓位区间或流动性 L。</small>
      </span>
      <em>{{ ready ? '输入完整' : input.lpScenarioEnabled ? '待补输入' : '默认关闭' }}</em>
    </label>
    <p>仅在开关开启且四项输入完整时，才计算 LP 库存、IL 和资本效率；结果是研究情景，不是链上真实仓位。</p>
    <div v-if="input.lpScenarioEnabled === true" class="lpsi-grid">
      <label>
        <span>LP 情景入场价</span>
        <input v-model.number="scenarioStartPrice" type="number" min="0.00000001" step="0.01" placeholder="必填" />
      </label>
      <label>
        <span>LP 情景区间宽度</span>
        <input
          v-model.number="scenarioRangeWidth"
          type="number"
          min="0.001"
          max="0.999"
          step="0.01"
          placeholder="例如 0.10"
        />
        <small v-if="!rangeValid" class="lpsi-error">必须大于 0 且小于 1</small>
      </label>
      <label>
        <span>LP 情景区间偏斜</span>
        <input v-model.number="scenarioSkew" type="number" min="0" step="0.01" placeholder="必填；对称填 1" />
      </label>
      <label>
        <span>LP 情景流动性 L</span>
        <input v-model.number="scenarioLiquidity" type="number" min="0.00000001" step="any" placeholder="必填" />
      </label>
    </div>
  </div>
</template>

<style>
.lpsi-card {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
}
.lpsi-card.active {
  border-color: var(--green);
  background: var(--surface-active);
}
.lpsi-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}
.lpsi-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--green);
}
.lpsi-toggle span {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.lpsi-toggle strong {
  color: var(--ink);
  font-size: 0.72rem;
}
.lpsi-toggle small,
.lpsi-card p {
  color: var(--muted);
  font-size: 0.62rem;
  line-height: 1.4;
}
.lpsi-toggle em {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 800;
  white-space: nowrap;
}
.lpsi-card.active .lpsi-toggle em {
  border-color: var(--green);
  color: var(--green);
}
.lpsi-card p {
  margin: 0;
  padding-top: 5px;
  border-top: 1px dashed var(--line);
}
.lpsi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.lpsi-grid label {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.lpsi-grid span {
  color: var(--muted);
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
}
.lpsi-grid input {
  min-width: 0;
  min-height: 28px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  color: var(--ink);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.lpsi-error {
  color: var(--red);
  font-size: 0.62rem;
  font-weight: 800;
}
</style>
