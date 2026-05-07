# ExecuteMigration — rulează după 17:21 UTC (2026-05-06)
# Timelock expiră: 2026-05-06T17:21:38 UTC
# Apoi schimbă TREASURY_VAULT_ADDRESS în backend/.env la:
#   0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a
# și repornește backend-ul.

$env:DEPLOYER_PRIVATE_KEY="0xe810e0221acb1b96dc7bcef4753324905316ebbf3783e516dacc92468c3fa39d"
$env:TX_HASH="0x46adaa40f00afa2d4446a99725498af78ae21ad7aad429923ebc3667217409d6"

& "$env:USERPROFILE\.foundry\bin\forge.exe" script contracts/script/ExecuteMigration.s.sol --rpc-url https://rpc.mantle.xyz --broadcast
