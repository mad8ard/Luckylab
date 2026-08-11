import assert from 'node:assert/strict'
import test from 'node:test'
import { renderWalkForwardCommand } from '../src/reporting.js'

test('the rendered reproduction command preserves the evaluated market', () => {
  assert.equal(
    renderWalkForwardCommand('港股'),
    'node research/latent-liquidity-lab/scripts/run-walk-forward.mjs --market=港股 --write',
  )
  assert.equal(
    renderWalkForwardCommand('美股'),
    'node research/latent-liquidity-lab/scripts/run-walk-forward.mjs --market=美股 --write',
  )
})
