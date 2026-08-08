#!/usr/bin/env node
// Fetch public pool aggregates for the static liquidity fingerprint research layer.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const DEFAULT_OUTPUT = join(ROOT, 'src', 'data', 'lp-onchain-snapshots.json')
const API_BASE = 'https://api.geckoterminal.com/api/v2'
const NETWORK = 'eth'
const OUTPUT = optionValue('--output', DEFAULT_OUTPUT)
const PAGES = Number(optionValue('--pages', '1'))

const TOKENS = {
  DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
}

const TOKEN_QUERIES = optionValue('--tokens', 'WETH')
  .split(',')
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean)
const ALLOWED_PAIRS = new Set([
  pairKey('WETH', 'USDC'),
  pairKey('WETH', 'USDT'),
  pairKey('WETH', 'DAI'),
  pairKey('USDC', 'USDT'),
  pairKey('DAI', 'USDC'),
  pairKey('DAI', 'USDT'),
])

const pools = new Map()
for (const symbol of TOKEN_QUERIES) {
  for (let page = 1; page <= PAGES; page += 1) {
    const json = await fetchTokenPools(TOKENS[symbol], page)
    const included = indexIncluded(json.included)
    for (const item of json.data ?? []) {
      const pool = toPool(item, included)
      if (!pool || !ALLOWED_PAIRS.has(pairKey(pool.token0Symbol, pool.token1Symbol))) continue
      pools.set(pool.address.toLowerCase(), pool)
    }
    await sleep(1200)
  }
}

const snapshot = {
  schemaVersion: 2,
  source: 'geckoterminal-pool-aggregate',
  apiBase: API_BASE,
  network: NETWORK,
  fetchedAt: new Date().toISOString(),
  blockNumber: null,
  pools: [...pools.values()].sort((left, right) => Number(right.reserveUsd ?? 0) - Number(left.reserveUsd ?? 0)),
  positions: [],
}

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
console.log(`wrote ${OUTPUT}`)
console.log(`pools: ${snapshot.pools.length}, source: ${snapshot.source}`)

async function fetchTokenPools(address, page) {
  const url = `${API_BASE}/networks/${NETWORK}/tokens/${address}/pools?page=${page}&include=base_token,quote_token,dex`
  return fetchJsonWithRetry(url)
}

async function fetchJsonWithRetry(url, attempts = 4) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`GeckoTerminal ${response.status}: ${await response.text()}`)
      return response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(700 * attempt)
    }
  }
  throw lastError
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function indexIncluded(items = []) {
  return new Map(items.map((item) => [item.id, item]))
}

function toPool(item, included) {
  const attributes = item?.attributes ?? {}
  const base = tokenFromRelationship(item, included, 'base_token')
  const quote = tokenFromRelationship(item, included, 'quote_token')
  const dex = included.get(item?.relationships?.dex?.data?.id)
  if (!base?.symbol || !quote?.symbol || !attributes.address) return null
  const price1Per0 = Number(attributes.base_token_price_quote_token)
  if (!Number.isFinite(price1Per0) || price1Per0 <= 0) return null
  const fee = feeFromName(attributes.name)
  return {
    id: `${item.relationships?.dex?.data?.id ?? 'dex'}-${attributes.address.toLowerCase()}`,
    label: `${base.symbol} / ${quote.symbol}${fee ? ` ${fee / 10000}%` : ''} · ${dex?.attributes?.name ?? 'DEX'}`,
    chainId: 1,
    protocol: item.relationships?.dex?.data?.id ?? 'dex',
    source: 'geckoterminal',
    address: attributes.address,
    token0: base.address,
    token1: quote.address,
    token0Symbol: base.symbol,
    token1Symbol: quote.symbol,
    fee,
    tickSpacing: tickSpacingFromFee(fee),
    status: 'ok',
    price1Per0,
    reserveUsd: numberOrNull(attributes.reserve_in_usd),
    volumeUsd24h: numberOrNull(attributes.volume_usd?.h24),
    transactions24h: transactionCount(attributes.transactions?.h24),
    poolCreatedAt: attributes.pool_created_at,
  }
}

function tokenFromRelationship(item, included, key) {
  const id = item?.relationships?.[key]?.data?.id
  const token = included.get(id)
  return token ? {
    address: token.attributes?.address,
    symbol: token.attributes?.symbol,
    decimals: token.attributes?.decimals,
  } : null
}

function pairKey(left, right) {
  return [left, right].sort().join('/')
}

function feeFromName(name = '') {
  const matched = String(name).match(/(\d+(?:\.\d+)?)%/)
  return matched ? Math.round(Number(matched[1]) * 10000) : null
}

function tickSpacingFromFee(fee) {
  return ({ 100: 1, 500: 10, 3000: 60, 10000: 200 })[fee] ?? null
}

function transactionCount(window) {
  return Number(window?.buys ?? 0) + Number(window?.sells ?? 0)
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
