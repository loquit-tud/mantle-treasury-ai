// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITreasuryVault {
    function proposeWithdrawal(address to, uint256 amount) external returns (bytes32);
    function balanceOf(address) external view returns (uint256);
}

contract ProposeMigration is Script {
    address constant OLD_VAULT    = 0x51A80e33E227029bB201C4891B62Eb8530F223c3;
    address constant NEW_VAULT    = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant USDT         = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        IERC20 usdt = IERC20(USDT);
        uint256 balance = usdt.balanceOf(OLD_VAULT);
        require(balance > 0, "Old vault: no USDT to migrate");

        console.log("Old vault USDT balance:", balance);
        console.log("Proposing withdrawal of", balance, "to new vault...");

        ITreasuryVault vault = ITreasuryVault(OLD_VAULT);
        bytes32 txHash = vault.proposeWithdrawal(NEW_VAULT, balance);

        console.log("=== SAVE THIS TX HASH ===");
        console.logBytes32(txHash);
        console.log("========================");
        console.log("Run ExecuteMigration.s.sol with TX_HASH=<above> after 1 hour");

        vm.stopBroadcast();
    }
}
