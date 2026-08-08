param(
  [string]$Path = ".\bl-esw-pinbar-market-lab-cdx.pine"
)

$ErrorActionPreference = "Stop"

$content = Get-Content -LiteralPath $Path -Raw
$lines = Get-Content -LiteralPath $Path
$errors = New-Object System.Collections.Generic.List[string]

if ($lines.Count -eq 0 -or $lines[0] -notmatch '^//@version=(5|6)$') {
  $errors.Add("First line must be Pine version declaration")
}

if ($content -notmatch 'shorttitle="([^"]{1,10})"') {
  $errors.Add("shorttitle must exist and be 10 chars or less")
}

foreach ($signal in @("Try", "LowBuy", "PullBuy", "Reclaim", "Wait", "Deep", "Trim", "NoChase")) {
  if ($content -notmatch [regex]::Escape($signal)) {
    $errors.Add("Missing chart signal: $signal")
  }
}

if ($content -notmatch 'cost_fast_anchor' -or $content -notmatch 'cost_slow_anchor') {
  $errors.Add("Missing adaptive three-layer cost anchor")
}

if ($content -notmatch 'lab_pull_buy' -or $content -notmatch 'lab_reclaim_buy') {
  $errors.Add("Missing trend pullback/reclaim buy logic")
}

$assignments = [regex]::Matches($content, '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=')
$names = @{}
foreach ($match in $assignments) {
  $name = $match.Groups[1].Value
  if (-not $names.ContainsKey($name)) {
    $names[$name] = 0
  }
  $names[$name] += 1
}

$dupes = $names.GetEnumerator() | Where-Object { $_.Value -gt 1 } | Select-Object -ExpandProperty Key
if ($dupes) {
  $errors.Add("Duplicate variable definitions: $($dupes -join ', ')")
}

if ($content -match '(?m)^\s*p_high\s*=') {
  $errors.Add("Do not use p_high because it can collide with plot handles")
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "Pine static checks passed"
