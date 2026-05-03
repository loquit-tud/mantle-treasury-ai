// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "../CreditLine.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address agentAddress = vm.envAddress("AGENT_ADDRESS");
        address aavePool = vm.envAddress("AAVE_POOL_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy TreasuryVault with Aave V3 pool
        TreasuryVault vault = new TreasuryVault(usdt, aavePool);

        // 2. Deploy CreditLine (linked to vault)
        CreditLine credit = new CreditLine(usdt, address(vault));

        // 3. Grant AGENT_ROLE to the WDK-managed agent address
        vault.grantRole(vault.AGENT_ROLE(), agentAddress);
        vault.grantRole(vault.EXECUTOR_ROLE(), agentAddress);
        credit.grantRole(credit.AGENT_ROLE(), agentAddress);

        vm.stopBroadcast();

        // Log addresses
        console.log("TreasuryVault:", address(vault));
        console.log("CreditLine:   ", address(credit));
        console.log("Agent:        ", agentAddress);
        console.log("USDt:         ", usdt);
    }
}
