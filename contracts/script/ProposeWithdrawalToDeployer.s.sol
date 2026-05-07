// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface ITreasuryVault {
    function proposeWithdrawal(address to, uint256 amount) external returns (bytes32);
    function usdt() external view returns (address);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

contract ProposeWithdrawalToDeployer is Script {
    // Current vault (has 50 USDT)
    address constant VAULT      = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant USDT       = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
    uint256 constant AMOUNT     = 50_000_000; // 50 USDT (6 decimals)

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Propose Withdrawal to Deployer ===");
        console.log("Vault:", VAULT);
        console.log("Deployer:", deployer);
        
        uint256 vaultBal = IERC20(USDT).balanceOf(VAULT);
        console.log("Vault USDT balance:", vaultBal);
        require(vaultBal >= AMOUNT, "Insufficient vault balance");

        vm.startBroadcast(deployerKey);
        bytes32 txHash = ITreasuryVault(VAULT).proposeWithdrawal(deployer, AMOUNT);
        vm.stopBroadcast();

        console.log("=== SUCCESS ===");
        console.log("txHash:", vm.toString(txHash));
        console.log("Execute after: 1 hour from now");
        console.log("Save this txHash for the next step!");
        
        // Write txHash to file for automation
        string memory output = vm.toString(txHash);
        vm.writeFile("./withdrawal-txhash.txt", output);
        console.log("txHash saved to withdrawal-txhash.txt");
    }
}
