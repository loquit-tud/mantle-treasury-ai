#Requires -Version 5.1
<#
.SYNOPSIS
  Verify deployed TreasuryVault on Mantle (chain 5000) via Foundry + Etherscan API v2.

.DESCRIPTION
  Reads ETHERSCAN_API_KEY from backend/.env (first non-comment match) or from the
  existing process environment. Never prints the key.

  Usage (from repo root):
    pwsh ./scripts/verify-treasury-vault.ps1
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-DotEnvValue {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Key
    )
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $eq = $t.IndexOf('=')
        if ($eq -lt 1) { continue }
        $name = $t.Substring(0, $eq).Trim()
        if ($name -ne $Key) { continue }
        $val = $t.Substring($eq + 1).Trim()
        if (
            ($val.Length -ge 2) -and
            (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))
        ) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        return $val
    }
    return $null
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

$envPath = Join-Path $RepoRoot 'backend/.env'
$key = Read-DotEnvValue -Path $envPath -Key 'ETHERSCAN_API_KEY'
if ([string]::IsNullOrWhiteSpace($key)) {
    $key = $env:ETHERSCAN_API_KEY
}
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Error "ETHERSCAN_API_KEY missing. Add it to backend/.env or set the environment variable."
    exit 1
}

$vault = '0xb52718aEc4Bc8459Ac97A276CB2d0798B25b17F0'
$usdt = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736'
$pool = '0x458F293454fE0d67EC0655f3672301301DD51422'

Write-Host "Building contracts..." -ForegroundColor Cyan
& forge build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Encoding constructor args..." -ForegroundColor Cyan
$ctorArgs = & cast abi-encode 'constructor(address,address)' $usdt $pool
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$ctorArgs = $ctorArgs.Trim()

Write-Host "Submitting verification (Etherscan v2, chain 5000)..." -ForegroundColor Cyan
Write-Host "Contract: $vault  (TreasuryVault)" -ForegroundColor DarkGray

& forge verify-contract `
    --chain-id 5000 `
    --verifier etherscan `
    --verifier-url 'https://api.etherscan.io/v2/api?chainid=5000' `
    --etherscan-api-key $key `
    --constructor-args $ctorArgs `
    --num-of-optimizations 200 `
    $vault `
    'contracts/TreasuryVault.sol:TreasuryVault'

exit $LASTEXITCODE
