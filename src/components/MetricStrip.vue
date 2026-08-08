<script setup>
defineProps({
  items: { type: Array, required: true },
})
</script>

<template>
  <section class="metric-strip">
    <article v-for="item in items" :key="item.label">
      <span>{{ item.label }}</span>
      <strong>{{ item.value }}</strong>
      <small>{{ item.unit }}</small>
    </article>
  </section>
</template>
