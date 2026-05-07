// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

contract ProposeFromNewVault is Script {
    address constant VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Vault:", VAULT);
        console.log("Deployer:", deployer);

        TreasuryVault vault = TreasuryVault(VAULT);

        vm.startBroadcast(deployerKey);

        // Vault.usdt() returns USDT0 address (configured), but vault holds USDT
        // proposeWithdrawal uses the configured token (USDT0) - won't work for USDT!
        // 
        // Check vault's configured token
        address configuredToken = address(vault.usdt());
        console.log("Vault configured token:", configuredToken);

        // proposeWithdrawal will check usdt.balanceOf(this) which is USDT0 = 0
        // It will revert with "insufficient balance"
        // We can't use this path

        console.log("ERROR: proposeWithdrawal uses configured token (USDT0) but vault holds USDT");
        console.log("Need a different approach!");

        vm.stopBroadcast();
    }
}
