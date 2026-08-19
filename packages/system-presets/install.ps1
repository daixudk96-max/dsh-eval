# Install the two system presets into the DSH user agent-preset root.
#   $DSH_HOME/.agent-presets/system-evaluator/agent.cordis.yml
#   $DSH_HOME/.agent-presets/system-evolver/agent.cordis.yml
# Standing mounts: only NEW sessions see them; running sessions keep their generation.
param(
  [string]$DshHome = $env:DSH_HOME
)
if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE ".dsh" }
$dest = Join-Path $DshHome ".agent-presets"
$src = Split-Path -Parent $PSScriptRoot
foreach ($p in @("system-evaluator", "system-evolver")) {
  $target = Join-Path $dest $p
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -Force (Join-Path $src "presets\$p\agent.cordis.yml") (Join-Path $target "agent.cordis.yml")
  Write-Host "installed: $target"
}
Write-Host "Done. Verify with: node E:\github\dsh\apps\cli\lib\bin.js --profile web --dump-config | grep -i system-"
