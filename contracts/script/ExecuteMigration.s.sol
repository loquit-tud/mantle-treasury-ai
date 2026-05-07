// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITreasuryVault {
    function executeWithdrawal(bytes32 txHash) external;
}

contract ExecuteMigration is Script {
    address constant OLD_VAULT = 0x51A80e33E227029bB201C4891B62Eb8530F223c3;
    address constant NEW_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant USDT      = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        bytes32 txHash = vm.envBytes32("TX_HASH");

        vm.startBroadcast(deployerKey);

        ITreasuryVault vault = ITreasuryVault(OLD_VAULT);
        vault.executeWithdrawal(txHash);

        IERC20 usdt = IERC20(USDT);
        uint256 newBal = usdt.balanceOf(NEW_VAULT);
        console.log("Migration complete! New vault USDT balance:", newBal);

        vm.stopBroadcast();
    }
}
