<script setup>
defineProps({
  title: { type: String, required: true },
  orders: { type: Array, required: true },
})

function num(value, digits = 2) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value)
}

function signed(value) {
  return `${value > 0 ? '+' : ''}${num(value)}`
}
</script>

<template>
  <section class="order-table">
    <header>{{ title }}</header>
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>价格</th>
          <th>目标</th>
          <th>名义</th>
          <th>数量</th>
          <th>预期</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="order in orders" :key="`${order.side}-${order.price}`">
          <td>{{ order.role }}</td>
          <td>{{ num(order.price) }}</td>
          <td>{{ num(order.targetPrice) }}</td>
          <td>{{ num(order.notional) }}</td>
          <td>{{ num(order.amount, 6) }}</td>
          <td>{{ signed(order.expectedProfit) }}</td>
        </tr>
        <tr v-if="!orders.length">
          <td colspan="6">未触发候选条件</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
