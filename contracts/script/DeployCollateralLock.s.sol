// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../CollateralLock.sol";

contract DeployCollateralLock is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address treasuryVault = vm.envAddress("TREASURY_VAULT_ADDRESS");
        address agentAddress = vm.envAddress("AGENT_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        CollateralLock collateral = new CollateralLock(usdt, treasuryVault);

        // Grant AGENT_ROLE to the agent wallet
        collateral.grantRole(collateral.AGENT_ROLE(), agentAddress);

        vm.stopBroadcast();

        console.log("CollateralLock:", address(collateral));
        console.log("USDt:         ", usdt);
        console.log("TreasuryVault:", treasuryVault);
        console.log("Agent:        ", agentAddress);
    }
}
