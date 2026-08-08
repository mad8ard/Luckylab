import { formulaEdges, formulaStages } from '../../domain/formulas/registry.js'

const LAYER_ORDER = ['数据', '波动', '期权', 'LP', 'AMM', '组合', '执行', '融合', '二阶']
const NODE_W = 168
const NODE_H = 52
const LAYER_GAP = 200
const NODE_GAP = 12

export function useGraphLayout() {
  const layers = new Map()
  for (const stage of formulaStages) {
    const group = layers.get(stage.layer) ?? []
    group.push(stage)
    layers.set(stage.layer, group)
  }

  const sortedLayers = LAYER_ORDER.filter((l) => layers.has(l))
  const nodes = []
  const nodeById = new Map()

  for (const [li, layer] of sortedLayers.entries()) {
    const stages = layers.get(layer)
    const totalH = stages.length * NODE_H + (stages.length - 1) * NODE_GAP
    const startY = -(totalH / 2)

    for (const [si, stage] of stages.entries()) {
      const node = {
        id: stage.id,
        x: li * LAYER_GAP + 40,
        y: startY + si * (NODE_H + NODE_GAP) + 100,
        w: NODE_W,
        h: NODE_H,
        stage,
      }
      nodes.push(node)
      nodeById.set(stage.id, node)
    }
  }

  const edges = formulaEdges
    .map((e) => {
      const src = nodeById.get(e.source)
      const tgt = nodeById.get(e.target)
      if (!src || !tgt) return null
      return {
        id: `${e.source}→${e.target}`,
        x1: src.x + NODE_W,
        y1: src.y + NODE_H / 2,
        x2: tgt.x,
        y2: tgt.y + NODE_H / 2,
        source: e.source,
        target: e.target,
      }
    })
    .filter(Boolean)

  const bounds = nodes.reduce(
    (b, n) => ({
      w: Math.max(b.w, n.x + NODE_W + 40),
      h: Math.max(b.h, n.y + NODE_H + 20),
    }),
    { w: 0, h: 0 },
  )

  return { nodes, edges, bounds }
}
