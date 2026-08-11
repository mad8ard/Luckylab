import { formulaStages } from '../formulas/registry.js'
import { formatFormulaInputToken } from './formulaInputLabels.js'

export function getFormulaStageRelations(formulaId) {
  const stage = formulaStages.find((item) => item.id === formulaId)
  if (!stage) return { upstream: [], downstream: [] }
  return {
    upstream: formulaStages
      .filter((item) => item.feeds?.includes(formulaId))
      .map((item) => ({ id: item.id, label: item.label })),
    downstream: (stage.feeds ?? []).map((id) => {
      const target = formulaStages.find((item) => item.id === id)
      return { id, label: target?.label ?? formatFormulaInputToken(id) }
    }),
  }
}
