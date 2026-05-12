#Requires -Version 5.1
param(
    [Parameter(Mandatory)][string]$Guid
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-DotEnvValue {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Key)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $eq = $t.IndexOf('=')
        if ($eq -lt 1) { continue }
        $name = $t.Substring(0, $eq).Trim()
        if ($name -ne $Key) { continue }
        $val = $t.Substring($eq + 1).Trim()
        if (($val.Length -ge 2) -and (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'")))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        return $val
    }
    return $null
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $RepoRoot 'backend/.env'
$key = Read-DotEnvValue -Path $envPath -Key 'ETHERSCAN_API_KEY'
if ([string]::IsNullOrWhiteSpace($key)) { $key = $env:ETHERSCAN_API_KEY }
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Error "ETHERSCAN_API_KEY missing."
    exit 1
}

Set-Location -LiteralPath $RepoRoot
& forge verify-check $Guid `
    --chain-id 5000 `
    --verifier etherscan `
    --verifier-url 'https://api.etherscan.io/v2/api?chainid=5000' `
    --etherscan-api-key $key

exit $LASTEXITCODE
