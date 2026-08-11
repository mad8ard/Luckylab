<script setup>
import { Maximize2, Minus, MousePointer2, Redo2, Scan, Square, Trash2, TrendingUp, Undo2 } from 'lucide-vue-next'

defineProps({
  tool: { type: String, default: 'cursor' },
  count: { type: Number, default: 0 },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  helpText: { type: String, default: '' },
})

const emit = defineEmits(['set-tool', 'undo', 'redo', 'delete', 'clear', 'fit'])

const tools = [
  { id: 'cursor', label: '查看', title: '拖动、缩放和十字线', icon: MousePointer2 },
  { id: 'select', label: '选择', title: '选择或调整已有标注', icon: Scan },
  { id: 'horizontal', label: '水平', title: '添加水平价格线', icon: Minus },
  { id: 'trend', label: '趋势', title: '添加两点趋势线', icon: TrendingUp },
  { id: 'range', label: '区域', title: '框选观察区间', icon: Square },
]
</script>

<template>
  <section class="drawing-toolbar" aria-label="图表画线工具">
    <div class="dt-tools" role="toolbar" aria-label="画线工具">
      <span class="dt-kicker"
        >画图 <b>{{ count }}</b></span
      >
      <button
        v-for="item in tools"
        :key="item.id"
        type="button"
        class="dt-tool"
        :class="{ active: tool === item.id }"
        :aria-pressed="tool === item.id"
        :title="item.title"
        @click="emit('set-tool', item.id)"
      >
        <component :is="item.icon" :size="15" />
        <span>{{ item.label }}</span>
      </button>
      <span class="dt-divider" />
      <button
        type="button"
        class="dt-action"
        aria-label="撤销画线"
        title="撤销（⌘/Ctrl+Z）"
        :disabled="!canUndo"
        @click="emit('undo')"
      >
        <Undo2 :size="15" />
      </button>
      <button
        type="button"
        class="dt-action"
        aria-label="重做画线"
        title="重做（⌘/Ctrl+Shift+Z）"
        :disabled="!canRedo"
        @click="emit('redo')"
      >
        <Redo2 :size="15" />
      </button>
      <button
        type="button"
        class="dt-action"
        aria-label="删除选中画线"
        title="删除选中标注"
        :disabled="!canDelete"
        @click="emit('delete')"
      >
        <Trash2 :size="15" />
      </button>
      <button type="button" class="dt-action" aria-label="适配全部K线" title="复位图表视野" @click="emit('fit')">
        <Maximize2 :size="15" />
      </button>
      <button
        type="button"
        class="dt-clear"
        :disabled="count === 0"
        title="清空当前标的全部画线；可撤销"
        @click="emit('clear')"
      >
        清空
      </button>
    </div>
    <p>{{ helpText }} <span>手绘不参与公式</span></p>
  </section>
</template>

<style scoped>
.drawing-toolbar {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.dt-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.dt-kicker {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  margin-right: 2px;
  color: var(--green);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}
.dt-kicker b {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--green-dim);
  text-align: center;
}
.dt-tool,
.dt-action,
.dt-clear {
  min-height: 32px;
  border-radius: 5px;
  padding: 4px 8px;
  background: var(--bg);
  font-size: 0.72rem;
}
.dt-tool {
  gap: 5px;
}
.dt-tool.active {
  border-color: var(--green);
  background: var(--surface-active);
  color: var(--green);
}
.dt-action {
  width: 32px;
  padding: 4px;
}
.dt-clear {
  color: var(--muted);
}
.dt-divider {
  width: 1px;
  height: 22px;
  margin: 0 2px;
  background: var(--line);
}
.drawing-toolbar p {
  margin: 0;
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.35;
}
.drawing-toolbar p span {
  margin-left: 4px;
  color: var(--blue);
  font-weight: 800;
}
@media (max-width: 640px) {
  .dt-tools {
    gap: 3px;
  }
  .dt-kicker {
    width: 100%;
  }
  .dt-tool {
    min-height: 40px;
    padding: 5px 7px;
  }
  .dt-action {
    width: 40px;
    min-height: 40px;
  }
  .dt-tool span {
    font-size: 0.68rem;
  }
}
</style>
