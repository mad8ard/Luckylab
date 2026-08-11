const WALK_FORWARD_SCRIPT = 'research/latent-liquidity-lab/scripts/run-walk-forward.mjs'

export function renderWalkForwardCommand(market) {
  const value = String(market ?? '').trim()
  if (!value) throw new TypeError('market is required to render the walk-forward command')
  return `node ${WALK_FORWARD_SCRIPT} --market=${value} --write`
}
