// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

contract ExecuteAndDeposit is Script {
    address constant OLD_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;
    address constant USDT = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AGNI_ROUTER = 0x319B69888D6F4e3f4BF42d89C6a3563Bab0BB8f8;
    uint24 constant POOL_FEE = 100;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bytes32 txHash = vm.envBytes32("TX_HASH");

        console.log("Deployer:", deployer);
        console.log("txHash:", vm.toString(txHash));

        TreasuryVault oldVault = TreasuryVault(OLD_VAULT);
        TreasuryVault newVault = TreasuryVault(NEW_VAULT);
        IERC20 usdtToken = IERC20(USDT);
        IERC20 usdt0Token = IERC20(USDT0);

        vm.startBroadcast(deployerKey);

        // Step 1: Execute withdrawal (timelock must be expired)
        console.log("Step 1: Execute withdrawal from old vault...");
        oldVault.executeWithdrawal(txHash);
        uint256 usdtBalance = usdtToken.balanceOf(deployer);
        console.log("Received USDT:", usdtBalance);

        // Step 2: Swap USDT → USDT0
        console.log("Step 2: Swap USDT -> USDT0...");
        usdtToken.approve(AGNI_ROUTER, usdtBalance);
        uint256 usdt0Out = ISwapRouter(AGNI_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: USDT,
                tokenOut: USDT0,
                fee: POOL_FEE,
                recipient: deployer,
                deadline: block.timestamp + 300,
                amountIn: usdtBalance,
                amountOutMinimum: (usdtBalance * 995) / 1000,
                sqrtPriceLimitX96: 0
            })
        );
        console.log("Swapped to USDT0:", usdt0Out);

        // Step 3: Deposit USDT0 into new vault
        console.log("Step 3: Deposit USDT0 into new vault...");
        usdt0Token.approve(address(newVault), usdt0Out);
        newVault.deposit(usdt0Out);
        console.log("Deposited OK!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== SUCCESS ===");
        console.log("New vault USDT0 balance:", usdt0Token.balanceOf(NEW_VAULT));
    }
}
