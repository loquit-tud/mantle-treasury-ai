// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

interface IERC20Meta {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/**
 * @title DeployVaultSafe
 * @notice Deploys a fresh TreasuryVault with mandatory pre-flight checks.
 *
 * Pre-flight checks (revert if any fail):
 *  - USDT token address is a contract
 *  - USDT token symbol matches expected ("USDT0" for Aave V3 Mantle compatibility)
 *  - Aave pool address is a contract
 *
 * This guards against the previous mistake of deploying a vault with a token
 * address that doesn't match the actual intended token.
 *
 * Usage:
 *   $env:PRIVATE_KEY = "<deployer pk>"
 *   forge script contracts/script/DeployVaultSafe.s.sol \
 *     --rpc-url https://rpc.mantle.xyz \
 *     --private-key $env:PRIVATE_KEY \
 *     --broadcast
 */
contract DeployVaultSafe is Script {
    // Mantle Mainnet addresses
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736; // Aave V3 compatible
    address constant AAVE_POOL = 0x458F293454fE0d67EC0655f3672301301DD51422;

    // Expected symbol of the configured stablecoin
    string constant EXPECTED_SYMBOL = "USDT0";

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("=== Safe Vault Deploy ===");
        console.log("Deployer:", deployer);
        console.log("Configured token (USDT0):", USDT0);
        console.log("Aave pool:", AAVE_POOL);

        // Pre-flight check 1: USDT0 must be a contract
        require(_isContract(USDT0), "PRE-FLIGHT FAIL: USDT0 address has no code");

        // Pre-flight check 2: symbol must match
        string memory sym = IERC20Meta(USDT0).symbol();
        console.log("Token symbol on chain:", sym);
        require(
            keccak256(bytes(sym)) == keccak256(bytes(EXPECTED_SYMBOL)),
            "PRE-FLIGHT FAIL: token symbol does not match EXPECTED_SYMBOL"
        );

        // Pre-flight check 3: decimals sanity
        uint8 dec = IERC20Meta(USDT0).decimals();
        console.log("Token decimals:", dec);
        require(dec == 6, "PRE-FLIGHT FAIL: USDT0 decimals != 6");

        // Pre-flight check 4: Aave pool must be a contract
        require(_isContract(AAVE_POOL), "PRE-FLIGHT FAIL: Aave pool address has no code");

        console.log("All pre-flight checks passed. Deploying...");

        vm.startBroadcast(pk);

        TreasuryVault vault = new TreasuryVault(USDT0, AAVE_POOL);
        vault.setProtocolAllowed(AAVE_POOL, true);

        vm.stopBroadcast();

        // Post-deploy verification
        require(address(vault.usdt()) == USDT0, "POST: vault.usdt() != USDT0");

        console.log("");
        console.log("=== DEPLOY SUCCESS ===");
        console.log("New vault address:", address(vault));
        console.log("");
        console.log("Next steps:");
        console.log("1. Update Railway: TREASURY_VAULT_ADDRESS=", address(vault));
        console.log("2. Verify USDT_ADDRESS on Railway is", USDT0);
        console.log("3. Fund vault with USDT0 (deposit() or direct transfer)");
    }

    function _isContract(address a) internal view returns (bool) {
        uint256 size;
        assembly { size := extcodesize(a) }
        return size > 0;
    }
}
