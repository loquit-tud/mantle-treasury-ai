# CHANGELOG

## 2025-07-14
### Fix: TreasuryVault redeployed cu Aave V3 Pool corect pe Mantle Mainnet
**Fișiere**: `contracts/TreasuryVault.sol`, `contracts/script/RedeployVault.s.sol`, `backend/.env`
**Motiv**: Banii nu se mișcau — `investInYield()` revertea mereu din cauza `aavePool = address(0)` în contractul vechi + `AAVE_POOL_ADDRESS` lipsea din `.env`
**Fix**:
- Adăugat `setAavePool(address _pool)` setter în TreasuryVault.sol
- Creat `contracts/script/RedeployVault.s.sol` — script Foundry pentru redeploy fără a atinge CreditLine
- Deploiat noul TreasuryVault la `0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a` cu Aave V3 Pool `0x458F293454fE0d67EC0655f3672301301DD51422` (Mantle mainnet oficial)
- Actualizat `backend/.env`: `TREASURY_VAULT_ADDRESS` + adăugat `AAVE_POOL_ADDRESS`
- `setProtocolAllowed(aavePool, true)` apelat în deploy script — vault poate acum ruta fonduri
- Typecheck trecut fără erori (`npx tsc --noEmit`)
