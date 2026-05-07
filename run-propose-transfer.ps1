# run-propose-transfer.ps1
# Pasul 1: Propune retragere din old vault
# Pasul 2 (in 1 ora): run-execute-deposit.ps1

Set-Location $PSScriptRoot

# Load .env
$envFile = Join-Path $PSScriptRoot "backend\.env"
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#][^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim())
    }
}
Write-Host "[OK] .env loaded" -ForegroundColor Green

$privateKey = $env:DEPLOYER_PRIVATE_KEY
[System.Environment]::SetEnvironmentVariable("PRIVATE_KEY", $privateKey)

$forge = "$env:USERPROFILE\.foundry\bin\forge.exe"

Write-Host ""
Write-Host "=== Propose Transfer from Old Vault ===" -ForegroundColor Cyan

$output = &$forge script contracts/script/ProposeTransfer.s.sol `
    --rpc-url https://rpc.mantle.xyz `
    --private-key "$privateKey" `
    --broadcast 2>&1

Write-Host ($output | Out-String)

if ($LASTEXITCODE -ne 0) {
    Write-Error "Propose failed! Check output above."
    exit 1
}

# Extract txHash from output
$outputText = $output | Out-String
if ($outputText -match '0x[a-fA-F0-9]{64}' ) {
    # Find the one from "txHash:" line
    $lines = $output | Where-Object { $_ -match 'txHash:' }
    if ($lines -match '(0x[a-fA-F0-9]{64})') {
        $txHash = $matches[1]
        $txHash | Out-File -FilePath "transfer-txhash.txt" -Encoding utf8 -NoNewline
        $now = Get-Date
        $executeAfter = $now.AddHours(1)
        $now.ToString("o") | Out-File -FilePath "transfer-timestamp.txt" -Encoding utf8 -NoNewline
        Write-Host ""
        Write-Host "[OK] txHash saved: $txHash" -ForegroundColor Green
        Write-Host "[OK] Execute after: $executeAfter" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Come back in 1 hour and run: .\run-execute-deposit.ps1" -ForegroundColor Cyan
    }
}
