/** @deprecated 动态持仓状态只能消费 OrderPlan 已生成的同一门禁结果。 */
export function resolveDynamicHoldingData({ graph } = {}) {
  return graph?.dynamicHolding ?? null
}
