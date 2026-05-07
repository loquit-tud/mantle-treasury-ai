# Locked / Deprecated Vaults

This file tracks vaults that MUST NOT be used. Sending tokens to these
addresses will result in permanent loss.

## Active Vault (USE THIS)

- **Address**: `0xb52718aEc4Bc8459Ac97A276CB2d0798B25b17F0`
- **Chain**: Mantle Mainnet (5000)
- **Token (usdt)**: USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`
- **Aave Pool**: `0x458F293454fE0d67EC0655f3672301301DD51422`
- **Deployed**: 2026-05-07 via `contracts/script/DeployVaultSafe.s.sol`
- **Status**: ✅ Active, configured correctly, has `emergencyWithdrawToken(address,address,uint256)` admin escape hatch

## ❌ LOCKED — DO NOT USE

### `0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A`

- **Chain**: Mantle Mainnet (5000)
- **Locked balance**: 50.000000 USDT (`0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE`, bridged USDT)
- **Why locked**: Constructor set `usdt = USDT0` but a raw `transfer()` of bridged USDT was sent to the vault. Every withdraw/invest function in deployed bytecode operates on the `usdt` storage var (USDT0) and reverts on balance check (USDT0 balance = 0). No `emergencyWithdrawToken` selector in deployed bytecode.
- **Recovery vectors exhausted**: direct extraction, reentrancy, malicious aavePool, L2 bridge, permit/EIP-2612, EIP-1271, selfdestruct, CREATE2 collision — all impossible.
- **Status**: PERMANENT LOSS. Do not send any tokens to this address.

### `0x4bEb9C28...` (original old vault)

- **Status**: Drained — 0 USDT remaining. Deprecated, do not reuse.

## Rules going forward

1. ALWAYS deploy via `DeployVaultSafe.s.sol` — pre-flight checks symbol + decimals + Aave pool code.
2. NEVER `transfer()` a token directly to a vault. Always use `deposit()` after verifying `vault.usdt()`.
3. `emergencyWithdrawToken(address token, address to, uint256 amount)` is the rescue hatch — admin-only, selector `0x277327a5`.
