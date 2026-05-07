// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

contract SwapVaultUSDT is Script {
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;
    address constant USDT = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AGNI_ROUTER = 0x319B69888D6F4e3f4BF42d89C6a3563Bab0BB8f8;
    uint24 constant POOL_FEE = 100; // 0.01%

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Swap USDT to USDT0 in Vault ===");
        console.log("Deployer:", deployer);
        console.log("New vault:", NEW_VAULT);

        TreasuryVault vault = TreasuryVault(NEW_VAULT);
        IERC20 usdtToken = IERC20(USDT);
        IERC20 usdt0Token = IERC20(USDT0);

        // Check current state
        uint256 vaultUSDT = usdtToken.balanceOf(NEW_VAULT);
        uint256 vaultUSDT0 = usdt0Token.balanceOf(NEW_VAULT);
        uint256 deployerUSDT = usdtToken.balanceOf(deployer);
        
        console.log("");
        console.log("--- BEFORE ---");
        console.log("Vault USDT:", vaultUSDT);
        console.log("Vault USDT0:", vaultUSDT0);
        console.log("Deployer USDT:", deployerUSDT);

        vm.startBroadcast(deployerKey);

        // Step 1: Emergency withdraw USDT from vault to deployer
        console.log("");
        console.log("Step 1: Emergency withdraw USDT from vault...");
        vault.emergencyWithdrawToken(USDT, deployer, vaultUSDT);
        console.log("Withdrawn USDT:", vaultUSDT);

        // Step 2: Approve Agni router for swap
        console.log("Step 2: Approving Agni router...");
        usdtToken.approve(AGNI_ROUTER, vaultUSDT);

        // Step 3: Swap USDT -> USDT0 on Agni Finance
        console.log("Step 3: Swapping USDT to USDT0 via Agni...");
        uint256 usdt0Out = ISwapRouter(AGNI_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: USDT,
                tokenOut: USDT0,
                fee: POOL_FEE,
                recipient: deployer,
                deadline: block.timestamp + 300,
                amountIn: vaultUSDT,
                amountOutMinimum: (vaultUSDT * 995) / 1000, // 0.5% slippage tolerance
                sqrtPriceLimitX96: 0
            })
        );
        console.log("Received USDT0:", usdt0Out);

        // Step 4: Deposit USDT0 into vault
        console.log("Step 4: Depositing USDT0 into vault...");
        usdt0Token.approve(address(vault), usdt0Out);
        vault.deposit(usdt0Out);
        console.log("Deposited USDT0:", usdt0Out);

        vm.stopBroadcast();

        console.log("");
        console.log("--- AFTER ---");
        console.log("Vault USDT:", usdtToken.balanceOf(NEW_VAULT));
        console.log("Vault USDT0:", usdt0Token.balanceOf(NEW_VAULT));
        console.log("Deployer USDT:", usdtToken.balanceOf(deployer));
        console.log("Deployer USDT0:", usdt0Token.balanceOf(deployer));
    }
}
