<script setup>
defineProps({
  enabled: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])
</script>

<template>
  <div class="psc-control" :class="{ active: enabled }">
    <label class="psc-toggle">
      <input
        type="checkbox"
        role="switch"
        :checked="enabled"
        aria-label="将期权情景投影到历史主图"
        @change="emit('change', $event.target.checked)"
      />
      <span>
        <strong>投影到历史主图</strong>
        <small>将本次期限、行权价和情景 σ 用于 Light / HQ 历史路径</small>
      </span>
      <em>{{ enabled ? '已启用' : '默认关闭' }}</em>
    </label>
    <p>仅用于显式研究情景，不代表真实历史期权合约；输入不完整时保持空值，不补 0、不插值。</p>
  </div>
</template>

<style>
.psc-control {
  display: grid;
  gap: 5px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
}
.psc-control.active {
  border-color: var(--green);
  background: var(--surface-active);
}
.psc-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}
.psc-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--green);
}
.psc-toggle span {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.psc-toggle strong {
  color: var(--ink);
  font-size: 0.72rem;
}
.psc-toggle small,
.psc-control p {
  color: var(--muted);
  font-size: 0.62rem;
  line-height: 1.4;
}
.psc-toggle em {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 800;
  white-space: nowrap;
}
.psc-control.active .psc-toggle em {
  border-color: var(--green);
  color: var(--green);
}
.psc-control p {
  margin: 0;
  padding-top: 5px;
  border-top: 1px dashed var(--line);
}
</style>
