# run-swap-deploy.ps1
# Run AFTER 1 hour from proposeWithdrawal
# Usage: .\run-swap-deploy.ps1

param(
    [switch]$Force  # Skip time check
)

Set-Location $PSScriptRoot

# Load PRIVATE_KEY from .env
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

# Check txhash file exists
$txHashFile = Join-Path $PSScriptRoot "withdrawal-txhash.txt"
if (-not (Test-Path $txHashFile)) {
    Write-Error "withdrawal-txhash.txt not found! Run run-propose.ps1 first."
    exit 1
}
$txHash = Get-Content $txHashFile
Write-Host "[INFO] Using txHash: $txHash" -ForegroundColor Cyan

# Check if 1 hour has passed (unless --Force)
$proposeFile = Join-Path $PSScriptRoot "propose-timestamp.txt"
if ((Test-Path $proposeFile) -and -not $Force) {
    $proposeTime = [datetime](Get-Content $proposeFile)
    $elapsed = (Get-Date) - $proposeTime
    if ($elapsed.TotalMinutes -lt 60) {
        $remaining = 60 - $elapsed.TotalMinutes
        Write-Host "[WAIT] Timelock not expired yet. Wait $([math]::Round($remaining,1)) more minutes." -ForegroundColor Yellow
        Write-Host "       Use -Force to skip this check (will fail on-chain if too early)" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[OK] Timelock expired ($([math]::Round($elapsed.TotalMinutes,1)) min ago)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Executing: Withdrawal + Swap USDT->USDT0 + Deploy New Vault ===" -ForegroundColor Cyan

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

# Check txhash file exists
$txHashFile = Join-Path $PSScriptRoot "withdrawal-txhash.txt"
if (-not (Test-Path $txHashFile)) {
    Write-Error "withdrawal-txhash.txt not found! Run run-propose.ps1 first."
    exit 1
}

# Read txHash from file
$txHashValue = (Get-Content $txHashFile).Trim()
Write-Host "[OK] Loaded txHash from file: $txHashValue" -ForegroundColor Green

# Set PRIVATE_KEY and TX_HASH env vars for forge
[System.Environment]::SetEnvironmentVariable("PRIVATE_KEY", $privateKey)
[System.Environment]::SetEnvironmentVariable("TX_HASH", $txHashValue)

Write-Host "Using deployer private key (last 8 chars): ...$(($privateKey | Select-Object -Last 8))" -ForegroundColor Gray

$forge = "$env:USERPROFILE\.foundry\bin\forge.exe"

# Run with broadcast
Write-Host "[INFO] Executing broadcast on Mantle..." -ForegroundColor Yellow
$output = &$forge script contracts/script/SwapAndDeployVault.s.sol `
    --rpc-url https://rpc.mantle.xyz `
    --private-key "$privateKey" `
    --broadcast 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Error "Script failed! Check output above."
    exit 1
}

# Extract new vault address from output
$outputText = $output | Out-String
if ($outputText -match "New vault deployed: (0x[a-fA-F0-9]{40})") {
    $newVault = $matches[1]
    Write-Host "[OK] Extracted new vault address: $newVault" -ForegroundColor Green
} else {
    Write-Error "Could not extract new vault address from output"
    exit 1
}

Write-Host ""
Write-Host "=== Updating Railway Environment Variables ===" -ForegroundColor Cyan
Write-Host "New vault: $newVault" -ForegroundColor Green

railway variables --set "TREASURY_VAULT_ADDRESS=$newVault"
railway variables --set "USDT_ADDRESS=0x779Ded0c9e1022225f8E0630b35a9b54bE713736"
railway variables --set "AAVE_POOL_ADDRESS=0x458F293454fE0d67EC0655f3672301301DD51422"

Write-Host ""
Write-Host "=== Redeploying Railway Backend ===" -ForegroundColor Cyan
railway up --detach

Write-Host ""
Write-Host "=== DONE! ===" -ForegroundColor Green
Write-Host "New TreasuryVault: $newVault" -ForegroundColor Green
Write-Host "Token: USDT0 (0x779Ded0c9e1022225f8E0630b35a9b54bE713736)" -ForegroundColor Green
Write-Host "Aave V3 Pool: 0x458F293454fE0d67EC0655f3672301301DD51422" -ForegroundColor Green
Write-Host ""
Write-Host "Wait ~2 minutes for Railway to redeploy, then verify:" -ForegroundColor Yellow
Write-Host "  curl https://mantle-treasury-ai-production.up.railway.app/api/yield/opportunities" -ForegroundColor Yellow
