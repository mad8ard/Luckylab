param()

$ErrorActionPreference = "Stop"

Write-Error "The CDX Pine verifier is retired because its target used fixed-window and fixed-horizon semantics. Run 'pnpm run verify:pine' against bl-esw-pinbar-market-lab.pine. The frozen source is under research/archive/pine/."
exit 1
