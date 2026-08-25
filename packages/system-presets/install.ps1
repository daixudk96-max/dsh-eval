# Install the two system presets into the DSH user agent-preset root.
#   $DSH_HOME/.agent-presets/system-evaluator/
#   $DSH_HOME/.agent-presets/system-evolver/
# Standing mounts: only NEW sessions see them; running sessions keep their generation.
param(
  [string]$DshHome = $env:DSH_HOME
)
if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE ".dsh" }
$dest = Join-Path $DshHome ".agent-presets"
$presetDir = Join-Path $PSScriptRoot "presets"

foreach ($p in @("system-evaluator", "system-evolver")) {
  $source = Join-Path $presetDir $p
  $target = Join-Path $dest $p
  if (Test-Path $target) {
    Remove-Item -Recurse -Force -Path $target | Out-Null
  }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -Path "$source\*" -Destination $target -Recurse -Force
  Write-Host "installed: $target"
}
Write-Host "Done. Verify with: node E:\github\dsh\apps\cli\lib\bin.js --profile web --dump-config"
