// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

contract ProposeTransfer is Script {
    address constant OLD_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Old vault:", OLD_VAULT);

        TreasuryVault vault = TreasuryVault(OLD_VAULT);

        vm.startBroadcast(deployerKey);

        // Grant AGENT_ROLE to deployer (deployer is DEFAULT_ADMIN so can grant)
        bytes32 AGENT_ROLE = keccak256("AGENT_ROLE");
        vault.grantRole(AGENT_ROLE, deployer);
        console.log("AGENT_ROLE granted to deployer");

        // Propose withdrawal of all 50 USDT to deployer
        bytes32 txHash = vault.proposeWithdrawal(deployer, 50_000_000);
        console.log("Withdrawal proposed!");
        console.log("txHash:", vm.toString(txHash));
        console.log("executeAfter: in 1 hour from now");

        vm.stopBroadcast();

        console.log("");
        console.log("=== SAVE THIS txHash ===");
        console.log(vm.toString(txHash));
        console.log("Run execute script in 1 hour!");
    }
}
