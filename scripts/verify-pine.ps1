param(
  [string]$Path = ".\bl-esw-pinbar-market-lab.pine"
)

$ErrorActionPreference = "Stop"

# Keep Windows/manual verification on the same contract as `pnpm run verify:pine`.
# The Node verifier owns the canonical prefix-window, bilateral cycle-start,
# q/H identity, disabled-extension defaults, and compatibility-stub checks.
& node ".\scripts\verify-pine.mjs" $Path
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
