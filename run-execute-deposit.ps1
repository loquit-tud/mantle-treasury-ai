# run-execute-deposit.ps1
# Pasul 2: Executa retragere (dupa 1h timelock) + swap USDT->USDT0 + depune in new vault

Set-Location $PSScriptRoot

# Load .env
$envFile = Join-Path $PSScriptRoot "backend\.env"
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#][^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim())
    }
}

$privateKey = $env:DEPLOYER_PRIVATE_KEY
[System.Environment]::SetEnvironmentVariable("PRIVATE_KEY", $privateKey)

# Load txHash
$txHashFile = Join-Path $PSScriptRoot "transfer-txhash.txt"
if (-not (Test-Path $txHashFile)) {
    Write-Error "transfer-txhash.txt not found! Run run-propose-transfer.ps1 first."
    exit 1
}
$txHash = (Get-Content $txHashFile).Trim()
Write-Host "[OK] txHash loaded: $txHash" -ForegroundColor Green

# Check if 1 hour has passed
$timestampFile = Join-Path $PSScriptRoot "transfer-timestamp.txt"
if (Test-Path $timestampFile) {
    $proposeTime = [datetime]::Parse((Get-Content $timestampFile).Trim())
    $elapsed = (Get-Date) - $proposeTime
    if ($elapsed.TotalMinutes -lt 59) {
        $remaining = 60 - $elapsed.TotalMinutes
        Write-Warning "Timelock not expired yet! Remaining: ~$([math]::Ceiling($remaining)) minute(s)"
        Write-Warning "Proceeding anyway — if execute fails, wait longer."
    } else {
        Write-Host "[OK] Timelock expired ($([math]::Floor($elapsed.TotalMinutes)) min ago)" -ForegroundColor Green
    }
}

[System.Environment]::SetEnvironmentVariable("TX_HASH", $txHash)

$forge = "$env:USERPROFILE\.foundry\bin\forge.exe"

Write-Host ""
Write-Host "=== Execute Withdrawal + Swap + Deposit ===" -ForegroundColor Cyan

$output = &$forge script contracts/script/ExecuteAndDeposit.s.sol `
    --rpc-url https://rpc.mantle.xyz `
    --private-key "$privateKey" `
    --broadcast 2>&1

Write-Host ($output | Out-String)

if ($LASTEXITCODE -ne 0) {
    Write-Error "Execute failed! Check output above."
    exit 1
}

Write-Host ""
Write-Host "=== SUCCESS! New vault should now have USDT0 ===" -ForegroundColor Green
Write-Host "Check Railway backend: https://mantle-treasury-ai-production.up.railway.app/api/state"
