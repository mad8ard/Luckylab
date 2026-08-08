#!/usr/bin/env node
// Verify that csv2js generated loadable JS data for the required market samples.

import { loadMarketCsv, marketCsvFiles } from '../src/data/generated/market-csv-index.js'

const errors = []

if (!marketCsvFiles.length) {
  errors.push('generated index is empty')
} else {
  const first = marketCsvFiles[0]
  const text = await loadMarketCsv(`/data/${first}`)
  if (!text) {
    errors.push(`generated loader returned no data for ${first}`)
  } else {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
    if (firstLine.split(',').length < 6) {
      errors.push(`${first} generated content does not look like OHLCV CSV`)
    }
  }
}

console.log(`generated market CSV modules: ${marketCsvFiles.length}`)

if (errors.length) {
  console.error(`\n${errors.length} generated data error(s):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('\ngenerated data integrity OK')
