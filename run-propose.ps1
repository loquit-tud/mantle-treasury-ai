# run-propose.ps1
# Step 1: Propose withdrawal of 50 USDT from vault to deployer
# After this, run run-swap-deploy.ps1 in 1 hour

Set-Location $PSScriptRoot

# Load .env
$envFile = Join-Path $PSScriptRoot "backend\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim())
        }
    }
    Write-Host "[OK] Loaded .env" -ForegroundColor Green
} else {
    Write-Error ".env not found at $envFile"
    exit 1
}

Write-Host "=== Step 1: Propose Withdrawal 50 USDT -> Deployer ===" -ForegroundColor Cyan

# Extract PRIVATE_KEY from .env
$privateKey = $null
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^DEPLOYER_PRIVATE_KEY=(.*)$') {
        $privateKey = $Matches[1].Trim()
    }
}

if (-not $privateKey) {
    Write-Error "DEPLOYER_PRIVATE_KEY not found in .env"
    exit 1
}

# Set PRIVATE_KEY env var for forge scripts
[System.Environment]::SetEnvironmentVariable("PRIVATE_KEY", $privateKey)

Write-Host "Using deployer private key (last 8 chars): ...$(($privateKey | Select-Object -Last 8))" -ForegroundColor Dim

$forge = "$env:USERPROFILE\.foundry\bin\forge.exe"

& $forge script contracts/script/ProposeWithdrawalToDeployer.s.sol `
    --rpc-url https://rpc.mantle.xyz `
    --private-key "$privateKey" `
    --broadcast `
    -vvv

if ($LASTEXITCODE -ne 0) {
    Write-Error "Propose failed!"
    exit 1
}

# Save timestamp for timelock check
(Get-Date).ToString("o") | Set-Content "propose-timestamp.txt"

$txHashFile = Join-Path $PSScriptRoot "withdrawal-txhash.txt"
if (Test-Path $txHashFile) {
    $txHash = Get-Content $txHashFile
    Write-Host ""
    Write-Host "=== SUCCESS ===" -ForegroundColor Green
    Write-Host "txHash: $txHash" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ">>> WAIT 1 HOUR, then run:" -ForegroundColor Yellow
    Write-Host "    .\run-swap-deploy.ps1" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Timelock expires at: $((Get-Date).AddHours(1).ToString('HH:mm:ss'))" -ForegroundColor Yellow
} else {
    Write-Warning "txhash file not found — check script output for txHash manually"
}
