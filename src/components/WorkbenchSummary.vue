<script setup>
defineProps({
  model: { type: Object, default: null },
  defaultOpen: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <details v-if="model" class="workbench-summary" :class="{ compact }" :open="defaultOpen">
    <summary>
      <span class="ws-data" :class="`state-${model.data.state}`">{{ model.data.label }}</span>
      <strong>{{ model.gate.marketState }}</strong>
      <span class="ws-candidate">{{ model.gate.candidateLabel }}</span>
      <span class="ws-gate">{{ model.gate.executionLabel }}</span>
      <span class="ws-reason">{{ model.reason }}</span>
      <span class="ws-more">看懂当前图</span>
    </summary>
    <div class="ws-grid">
      <article>
        <span>1 · 数据能用吗</span>
        <strong>{{ model.data.label }}</strong>
        <small>{{ model.data.detail }} · {{ model.data.source }} · 模型：{{ model.data.modelLabel }}</small>
      </article>
      <article>
        <span>2 · 当前门禁</span>
        <strong>{{ model.gate.candidateLabel }} · 执行{{ model.gate.executionLabel }}</strong>
        <small>市场结构：{{ model.gate.marketState }}</small>
      </article>
      <article>
        <span>3 · 为什么</span>
        <strong>{{ model.reason }}</strong>
      </article>
      <article>
        <span>4 · {{ model.review?.label || '何时复核' }}</span>
        <strong>{{ model.review?.value || '下一交易会话复核结构' }}</strong>
      </article>
      <article>
        <span>5 · 下一步</span>
        <strong>{{ model.nextCheck }}</strong>
      </article>
    </div>
    <p>
      {{ model.disclosure }} <b>{{ model.data.claimLabel || '口径待核验' }}</b>
    </p>
  </details>
</template>

<style scoped>
.workbench-summary {
  min-width: 0;
  container-type: inline-size;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
}
.workbench-summary summary {
  min-height: 38px;
  display: grid;
  grid-template-columns: auto auto auto auto minmax(120px, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 6px 9px;
  cursor: pointer;
  list-style: none;
}
.workbench-summary summary::-webkit-details-marker {
  display: none;
}
.workbench-summary summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.ws-data,
.ws-candidate,
.ws-gate {
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.68rem;
  font-weight: 900;
  white-space: nowrap;
}
.ws-data {
  color: var(--green);
  background: var(--green-dim);
}
.ws-data.state-stale,
.ws-data.state-invalid {
  color: var(--red);
  background: var(--red-dim);
}
.ws-gate {
  color: var(--blue);
  background: var(--blue-dim);
}
.ws-candidate {
  border: 1px solid var(--line);
  color: var(--ink);
  background: var(--surface-active);
}
.workbench-summary summary > strong {
  font-size: 0.82rem;
}
.ws-reason {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-more {
  color: var(--green);
  font-size: 0.7rem;
  font-weight: 800;
  white-space: nowrap;
}
.ws-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  border-top: 1px solid var(--line);
  background: var(--line);
}
.ws-grid article {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 9px;
  background: var(--panel);
}
.ws-grid span {
  color: var(--green);
  font-size: 0.68rem;
  font-weight: 900;
}
.ws-grid strong {
  font-size: 0.76rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.ws-grid small {
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.35;
}
.workbench-summary > p {
  margin: 0;
  padding: 7px 9px;
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.4;
}
.workbench-summary > p b {
  margin-left: 5px;
  color: var(--blue);
}
@container (max-width: 900px) {
  .workbench-summary summary {
    grid-template-columns: auto auto auto minmax(90px, 1fr) auto;
  }
  .ws-gate {
    display: none;
  }
  .ws-grid {
    grid-template-columns: 1fr 1fr;
  }
  .ws-grid article:last-child {
    grid-column: 1 / -1;
  }
}
@container (max-width: 300px) {
  .workbench-summary summary {
    grid-template-columns: auto auto auto 1fr;
  }
  .ws-reason {
    grid-column: 1 / -1;
  }
  .ws-more {
    grid-column: 4;
    grid-row: 1;
    justify-self: end;
  }
  .ws-grid {
    grid-template-columns: 1fr;
  }
  .ws-grid article:last-child {
    grid-column: auto;
  }
}
</style>
