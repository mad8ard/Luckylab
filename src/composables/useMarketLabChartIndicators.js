import { computed } from 'vue'
import { queryMarketLabChartSeries } from '../domain/research-visualization/marketLabChartIndicators.js'

export function useMarketLabChartIndicators(props) {
  return computed(() =>
    queryMarketLabChartSeries({
      rows: props.rows,
      formulaPath: props.formulaPath,
      costPath: props.costPath,
      overlays: props.overlays,
      entryPrice: props.entryPrice,
      position: props.position,
      replay: props.replay,
    }),
  )
}
