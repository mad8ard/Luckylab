import { buildResearchStatusLabel } from './researchStatusLabel.js'

const MAX_REPLAY_MARKER_TRADES = 120
const MAX_REPLAY_TEXT_LABELS = 6

/**
 * 构建主图 markers（replay trades + 当前决策 + 研究层状态）
 *
 * @param {object} params
 * @param {Array} params.rows
 * @param {object} params.replay
 * @param {object} params.decision
 * @param {object} params.overlays   chartOverlays（含 executionMarkers/replayMarkers/currentDecision/replayMarkerLabels/researchMarkers）
 * @param {Array} params.formulaPath
 * @returns {Array} 排序后的 markers，可直接 setMarkers
 */
export function buildChartMarkers({ rows, replay, decision, overlays, formulaPath }) {
  const out = []
  if (overlayOn(overlays, 'executionMarkers') && overlays.replayMarkers) {
    out.push(...buildReplayMarkers(replay?.trades ?? [], overlays))
  }
  if (overlayOn(overlays, 'executionMarkers') && overlays.currentDecision && rows.length && decision) {
    const last = rows.at(-1)
    const side = decision.timing?.side
    out.push({
      time: last.date,
      position: side === 'sell' ? 'aboveBar' : 'belowBar',
      shape: side === 'buy' ? 'arrowUp' : side === 'sell' ? 'arrowDown' : 'circle',
      color: side === 'buy' ? '#0e7558' : side === 'sell' ? '#a93226' : '#888',
      text: decision.state || '',
      id: 'current-decision',
    })
  }
  if (overlayOn(overlays, 'researchMarkers')) out.push(...buildResearchMarkers(formulaPath))
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
}

function overlayOn(overlays, key) {
  return overlays[key] !== false
}

function buildResearchMarkers(formulaPath) {
  const last = formulaPath?.at?.(-1)
  if (!last?.date || !Array.isArray(last.status) || !last.status.length) return []
  const flagged = Object.values(last.fieldStates ?? {})
    .filter((state) => state?.status !== 'implemented' || state?.missingInputs?.length || state?.isSynthetic)
  const label = buildResearchStatusLabel(last.status, flagged)
  return [{
    time: last.date,
    position: 'aboveBar',
    shape: 'circle',
    color: '#7a5cff',
    text: label,
    id: 'research-status',
  }]
}

function buildReplayMarkers(trades, overlays) {
  const start = Math.max(0, trades.length - MAX_REPLAY_MARKER_TRADES)
  const visibleTrades = trades.slice(start)
  const showTextFrom = overlays.replayMarkerLabels
    ? Math.max(0, visibleTrades.length - MAX_REPLAY_TEXT_LABELS)
    : Infinity
  return visibleTrades.flatMap((trade, localIndex) => {
    const i = start + localIndex
    const isBuy = trade.side === 'buy'
    const showText = localIndex >= showTextFrom
    const markers = []
    if (trade.signalDate && trade.signalDate !== trade.fillDate) {
      markers.push(withMarkerText({
        time: trade.signalDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `signal-${i}`,
      }, showText, `${isBuy ? '买入' : '卖出'}信号`))
    }
    if (trade.fillDate && trade.fillDate === trade.exitDate) {
      markers.push(withMarkerText({
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `fill-${i}`,
      }, showText, `${trade.reason} ${isBuy ? '成交 @' + money(trade.fillPrice) : signedMoney(trade.pnl)}`))
      return markers
    }
    if (trade.fillDate) {
      markers.push(withMarkerText({
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `fill-${i}`,
      }, showText, `${isBuy ? '买入' : '卖出'}成交 ${money(trade.fillPrice)}`))
    }
    if (trade.exitDate) {
      markers.push(withMarkerText({
        time: trade.exitDate,
        position: trade.pnl >= 0 ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: trade.pnl >= 0 ? '#0e7558' : '#a93226',
        id: `exit-${i}`,
      }, showText, `${trade.reason} ${signedMoney(trade.pnl)}`))
    }
    return markers
  })
}

function withMarkerText(marker, show, text) {
  return show ? { ...marker, text } : marker
}

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '无'
}

function signedMoney(v) {
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${money(v)}` : '无'
}
