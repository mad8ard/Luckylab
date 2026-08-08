#!/usr/bin/env node
// Fetch Uniswap v3 on-chain pool and optional position snapshots for static research data.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const DEFAULT_OUTPUT = join(ROOT, 'src', 'data', 'lp-onchain-snapshots.json')
const RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'
const RPC_TIMEOUT_MS = Number(process.env.ETH_RPC_TIMEOUT_MS) || 12000
const POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const Q96 = 2n ** 96n

const TOKENS = {
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
}

const POOL_PAIRS = [
  ['WETH', 'USDC'],
  ['WETH', 'USDT'],
  ['WETH', 'DAI'],
  ['USDC', 'USDT'],
  ['DAI', 'USDC'],
  ['DAI', 'USDT'],
]

const FEE_TIERS = [100, 500, 3000, 10000]

const SELECTORS = {
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  feeGrowthGlobal0X128: '0xf3058399',
  feeGrowthGlobal1X128: '0x46141319',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  fee: '0xddca3f43',
  getPool: '0x1698ee82',
  tickSpacing: '0xd0c93a7c',
  positions: '0x99fbab88',
}

const output = optionValue('--output', DEFAULT_OUTPUT)
const positionIds = optionValue('--position-ids', process.env.UNISWAP_V3_POSITION_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const blockNumber = await rpc('eth_blockNumber', [])
const poolDefinitions = await discoverUniswapV3Pools()
const pools = []
for (const pool of poolDefinitions) {
  try {
    pools.push(await fetchPool(pool))
  } catch (error) {
    pools.push({ ...pool, status: 'error', error: error.message })
  }
}

const positions = []
for (const tokenId of positionIds) {
  try {
    positions.push(await fetchPosition(tokenId))
  } catch (error) {
    positions.push({ tokenId, status: 'error', error: error.message })
  }
}

const snapshot = {
  schemaVersion: 1,
  source: 'ethereum-json-rpc',
  rpcUrl: redactedRpcUrl(RPC_URL),
  fetchedAt: new Date().toISOString(),
  blockNumber: Number(BigInt(blockNumber)),
  pools,
  positions,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
console.log(`wrote ${output}`)
console.log(`pools: ${pools.length}, positions: ${positions.length}, block: ${snapshot.blockNumber}`)

async function discoverUniswapV3Pools() {
  const definitions = []
  for (const [base, quote] of POOL_PAIRS) {
    for (const fee of FEE_TIERS) {
      const address = await getPoolAddress(TOKENS[base], TOKENS[quote], fee)
      if (isZeroAddress(address)) continue
      definitions.push({
        id: `uniswap-v3-${base.toLowerCase()}-${quote.toLowerCase()}-${fee}`,
        label: `${base} / ${quote} ${feeLabel(fee)}`,
        chainId: 1,
        protocol: 'uniswap-v3',
        address,
        token0Symbol: base,
        token1Symbol: quote,
      })
    }
  }
  return definitions
}

async function getPoolAddress(tokenA, tokenB, fee) {
  const data = `${SELECTORS.getPool}${addressArg(tokenA)}${addressArg(tokenB)}${uint256Hex(fee)}`
  return addressFromWord(await call(UNISWAP_V3_FACTORY, data))
}

async function fetchPool(pool) {
  const [slot0Raw, liquidityRaw, feeGrowth0Raw, feeGrowth1Raw, token0Raw, token1Raw, feeRaw, tickSpacingRaw] = await Promise.all([
    call(pool.address, SELECTORS.slot0),
    call(pool.address, SELECTORS.liquidity),
    call(pool.address, SELECTORS.feeGrowthGlobal0X128),
    call(pool.address, SELECTORS.feeGrowthGlobal1X128),
    call(pool.address, SELECTORS.token0),
    call(pool.address, SELECTORS.token1),
    call(pool.address, SELECTORS.fee),
    call(pool.address, SELECTORS.tickSpacing),
  ])
  const words = splitWords(slot0Raw)
  const sqrtPriceX96 = BigInt(`0x${words[0]}`)
  const tick = intN(words[1], 24)
  const token0 = addressFromWord(token0Raw)
  const token1 = addressFromWord(token1Raw)
  const token0Symbol = tokenSymbol(token0) ?? pool.token0Symbol
  const token1Symbol = tokenSymbol(token1) ?? pool.token1Symbol
  const fee = Number(BigInt(feeRaw))
  return {
    ...pool,
    status: 'ok',
    id: `uniswap-v3-${token0Symbol.toLowerCase()}-${token1Symbol.toLowerCase()}-${fee}`,
    label: `${token0Symbol} / ${token1Symbol} ${feeLabel(fee)}`,
    token0,
    token1,
    token0Symbol,
    token1Symbol,
    fee,
    tickSpacing: Number(intN(splitWords(tickSpacingRaw)[0], 24)),
    sqrtPriceX96: sqrtPriceX96.toString(),
    price1Per0: sqrtPriceToPrice(sqrtPriceX96),
    tick,
    liquidity: BigInt(liquidityRaw).toString(),
    feeGrowthGlobal0X128: BigInt(feeGrowth0Raw).toString(),
    feeGrowthGlobal1X128: BigInt(feeGrowth1Raw).toString(),
  }
}

async function fetchPosition(tokenId) {
  const data = `${SELECTORS.positions}${uint256Hex(tokenId)}`
  const raw = await call(POSITION_MANAGER, data)
  const words = splitWords(raw)
  return {
    tokenId: String(tokenId),
    status: 'ok',
    nonce: Number(BigInt(`0x${words[0]}`)),
    operator: addressFromWord(`0x${words[1]}`),
    token0: addressFromWord(`0x${words[2]}`),
    token1: addressFromWord(`0x${words[3]}`),
    fee: Number(BigInt(`0x${words[4]}`)),
    tickLower: intN(words[5], 24),
    tickUpper: intN(words[6], 24),
    liquidity: BigInt(`0x${words[7]}`).toString(),
    feeGrowthInside0LastX128: BigInt(`0x${words[8]}`).toString(),
    feeGrowthInside1LastX128: BigInt(`0x${words[9]}`).toString(),
    tokensOwed0: BigInt(`0x${words[10]}`).toString(),
    tokensOwed1: BigInt(`0x${words[11]}`).toString(),
  }
}

async function call(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest'])
}

async function rpc(method, params) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const json = await response.json()
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error))
    return json.result
  } finally {
    clearTimeout(timeout)
  }
}

function splitWords(hex) {
  const clean = hex.replace(/^0x/, '')
  return clean.match(/.{1,64}/g) || []
}

function addressFromWord(hex) {
  const clean = hex.replace(/^0x/, '').padStart(64, '0')
  return `0x${clean.slice(-40)}`
}

function intN(word, bits) {
  const value = BigInt(`0x${word}`)
  const size = 1n << BigInt(bits)
  const half = size >> 1n
  const masked = value & (size - 1n)
  return Number(masked >= half ? masked - size : masked)
}

function sqrtPriceToPrice(sqrtPriceX96) {
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 1000000000000n
  const scaled = numerator / (Q96 * Q96)
  return Number(scaled) / 1e12
}

function uint256Hex(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function addressArg(value) {
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function isZeroAddress(value) {
  return /^0x0{40}$/i.test(value)
}

function tokenSymbol(address) {
  const found = Object.entries(TOKENS).find(([, value]) => value.toLowerCase() === address.toLowerCase())
  return found?.[0] ?? null
}

function feeLabel(fee) {
  return `${fee / 10000}%`
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function redactedRpcUrl(url) {
  return url.replace(/([?&](?:api[_-]?key|apikey|token)=)[^&]+/i, '$1***')
}
