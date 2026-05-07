// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

contract GrantDeployerRole is Script {
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bytes32 AGENT_ROLE = keccak256("AGENT_ROLE");

        console.log("Granting AGENT_ROLE to deployer on new vault...");
        console.log("Vault:", NEW_VAULT);
        console.log("Deployer:", deployer);

        TreasuryVault vault = TreasuryVault(NEW_VAULT);

        vm.startBroadcast(deployerKey);
        vault.grantRole(AGENT_ROLE, deployer);
        console.log("OK!");
        vm.stopBroadcast();
    }
}
