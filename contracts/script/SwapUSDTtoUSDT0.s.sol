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

contract SwapUSDTtoUSDT0 is Script {
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;
    address constant USDT = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AGNI_ROUTER = 0x319B69888D6F4e3f4BF42d89C6a3563Bab0BB8f8;
    uint24 constant POOL_FEE = 100; // 0.01%

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("New vault:", NEW_VAULT);

        TreasuryVault newVault = TreasuryVault(NEW_VAULT);
        IERC20 usdtToken = IERC20(USDT);
        IERC20 usdt0Token = IERC20(USDT0);

        // Check current state
        uint256 newVaultUSDT = usdtToken.balanceOf(NEW_VAULT);
        uint256 newVaultUSDT0 = usdt0Token.balanceOf(NEW_VAULT);
        console.log("New vault USDT before:", newVaultUSDT);
        console.log("New vault USDT0 before:", newVaultUSDT0);

        vm.startBroadcast(deployerKey);

        // Step 1: Withdraw USDT from new vault to deployer
        // Note: This requires that deployer has AGENT role or vault has a withdraw function
        // For now, assume vault allows withdrawing USDT (it shouldn't have a guard against it)
        // We'll use a low-level approach: call withdrawToken if available, or just transfer
        
        console.log("Step 1: Checking if vault accepts USDT withdrawal...");
        
        // Try to withdraw - this may fail if vault doesn't support it
        // For now, assuming deployer can manually extract or vault has a mechanism
        // Alternative: just swap with deployer's own funds if we have them
        
        // Actually, let's do this differently:
        // 1. Deployer sweeps USDT from vault (via vault function or direct transfer if allowed)
        // 2. Deployer swaps it
        // 3. Deployer deposits USDT0 back into vault
        
        // Check if deployer has USDT (from previous withdrawal)
        uint256 deployerUSDT = usdtToken.balanceOf(deployer);
        console.log("Deployer USDT:", deployerUSDT);
        
        if (deployerUSDT == 0) {
            console.log("ERROR: Deployer has no USDT to swap!");
            // Try to pull from vault - this may fail
            console.log("Attempting to pull USDT from vault...");
            // Can't do this without a vault function
            revert("No USDT to swap");
        }

        // Step 2: Approve Agni router
        console.log("Step 2: Approving Agni router...");
        usdtToken.approve(AGNI_ROUTER, deployerUSDT);

        // Step 3: Swap USDT -> USDT0
        console.log("Step 3: Swapping USDT to USDT0...");
        uint256 usdt0Out = ISwapRouter(AGNI_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: USDT,
                tokenOut: USDT0,
                fee: POOL_FEE,
                recipient: deployer,
                deadline: block.timestamp + 300,
                amountIn: deployerUSDT,
                amountOutMinimum: (deployerUSDT * 995) / 1000, // 0.5% slippage
                sqrtPriceLimitX96: 0
            })
        );
        console.log("Swapped USDT to USDT0:", usdt0Out);

        // Step 4: Deposit USDT0 into new vault
        console.log("Step 4: Depositing USDT0 into new vault...");
        usdt0Token.approve(address(newVault), usdt0Out);
        newVault.deposit(usdt0Out);
        console.log("Deposited OK!");

        vm.stopBroadcast();

        console.log("");
        console.log("=== SUCCESS ===");
        console.log("New vault USDT after:", usdtToken.balanceOf(NEW_VAULT));
        console.log("New vault USDT0 after:", usdt0Token.balanceOf(NEW_VAULT));
    }
}
