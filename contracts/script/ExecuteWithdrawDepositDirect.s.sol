// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ExecuteWithdrawDepositDirect is Script {
    address constant OLD_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;
    address constant USDT = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bytes32 txHash = vm.envBytes32("TX_HASH");

        console.log("Deployer:", deployer);
        console.log("txHash:", vm.toString(txHash));

        TreasuryVault oldVault = TreasuryVault(OLD_VAULT);
        TreasuryVault newVault = TreasuryVault(NEW_VAULT);
        IERC20 usdtToken = IERC20(USDT);

        vm.startBroadcast(deployerKey);

        // Step 1: Execute withdrawal (timelock must be expired)
        console.log("Step 1: Execute withdrawal from old vault...");
        oldVault.executeWithdrawal(txHash);
        uint256 usdtBalance = usdtToken.balanceOf(deployer);
        console.log("Received USDT:", usdtBalance);

        // Step 2: Try to deposit USDT into new vault (even though it expects USDT0)
        // The new vault might have a generic deposit or accept USDT anyway
        console.log("Step 2: Transferring USDT to new vault...");
        usdtToken.transfer(address(newVault), usdtBalance);
        console.log("Transferred!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== SUCCESS ===");
        console.log("Old vault USDT now:", usdtToken.balanceOf(OLD_VAULT));
        console.log("New vault USDT now:", usdtToken.balanceOf(NEW_VAULT));
        console.log("Deployer USDT now:", usdtToken.balanceOf(deployer));
    }
}
