export function buildResearchStatusLabel(statuses = [], fieldStates = []) {
  const stateList = Array.isArray(fieldStates) ? fieldStates : Object.values(fieldStates ?? {})
  const statusSet = new Set(Array.isArray(statuses) ? statuses : [])
  const parts = []

  if (statusSet.has('research-only')) parts.push('研究')

  const lpStates = stateList.filter((state) => isLpState(state))
  const hasPosition = lpStates.some((state) => state.inputMode === 'real')
  const hasPool = lpStates.some((state) => state.inputMode === 'pool-real') || statusSet.has('pool-real-input')
  const missingInputs = stateList.flatMap((state) => Array.isArray(state?.missingInputs) ? state.missingInputs : [])
  const needsPool = missingInputs.includes('real-lp-pool')
  const hasMissing = statusSet.has('missing-input') || missingInputs.length > 0

  if (hasPosition) parts.push('Position')
  else if (hasPool) parts.push('聚合池')
  else if (needsPool) parts.push('待接池')

  if (hasPool && hasMissing) parts.push('待补')
  else if (hasMissing) parts.push('缺输入')

  if (statusSet.has('proxy-only') && parts.length < 3) parts.push('代理')
  if (statusSet.has('protocol-unverified') && parts.length < 3) parts.push('未验')
  if (!parts.length && stateList.length) parts.push('状态')

  return parts.slice(0, 3).join(' · ')
}

function isLpState(state) {
  return state?.source === 'lp-inventory' || state?.source === 'lp-pool-coverage'
}
