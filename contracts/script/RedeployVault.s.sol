// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "../CreditLine.sol";

contract RedeployVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address agentAddress = vm.envAddress("AGENT_ADDRESS");
        address aavePool = vm.envAddress("AAVE_POOL_ADDRESS");
        address existingCreditLine = vm.envAddress("CREDIT_LINE_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new TreasuryVault with correct Aave V3 pool
        TreasuryVault vault = new TreasuryVault(usdt, aavePool);

        // Grant roles to agent wallet
        vault.grantRole(vault.AGENT_ROLE(), agentAddress);
        vault.grantRole(vault.EXECUTOR_ROLE(), agentAddress);

        // Allow Aave V3 pool as protocol
        vault.setProtocolAllowed(aavePool, true);

        // Update existing CreditLine to point to new vault
        CreditLine credit = CreditLine(existingCreditLine);
        credit.setTreasuryVault(address(vault));

        vm.stopBroadcast();

        console.log("=== NEW ADDRESSES ===");
        console.log("TreasuryVault:", address(vault));
        console.log("CreditLine (unchanged):", existingCreditLine);
        console.log("AavePool set:", aavePool);
    }
}
