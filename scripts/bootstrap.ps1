[CmdletBinding()]
param(
    [switch]$RegisterMarketplace,
    [switch]$Configure
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pluginRoot = Join-Path $repoRoot 'plugins\moodle-codex'

if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot 'package-lock.json'))) {
    throw 'Plugin package-lock.json was not found.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
    throw 'Node.js and npm are required.'
}

$nodeVersion = [Version]((& node --version).Trim().TrimStart('v'))
if ($nodeVersion -lt [Version]'22.13.0') {
    throw "Node.js 22.13.0 or later is required; found $nodeVersion."
}

Push-Location $pluginRoot
try {
    $npmCache = Join-Path $pluginRoot '.npm-cache'
    & npm ci --cache $npmCache
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'npm test failed.' }
    & (Join-Path $pluginRoot 'scripts\configure-mobile.ps1') -SelfTest
    if ($LASTEXITCODE -ne 0) { throw 'Moodle setup GUI self-test failed.' }
}
finally {
    Pop-Location
}

if ($RegisterMarketplace) {
    if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        throw 'Codex CLI was not found; dependencies and tests passed, but the marketplace was not registered.'
    }
    & codex plugin marketplace add $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed.' }
}

if ($Configure) {
    & (Join-Path $pluginRoot 'scripts\configure-mobile.ps1')
}

Write-Host 'PASS: clean dependency install and offline test suite.'
if (-not $RegisterMarketplace) {
    Write-Host "Next: codex plugin marketplace add `"$repoRoot`""
}
if (-not $Configure) {
    Write-Host 'Next: double-click plugins\moodle-codex\Setup-Moodle.cmd, or rerun this script with -Configure.'
}
