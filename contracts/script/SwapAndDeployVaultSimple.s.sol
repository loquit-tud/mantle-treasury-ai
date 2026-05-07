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

contract SwapAndDeployVaultSimple is Script {
    address constant USDT  = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant OLD_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
    address constant AAVE_POOL = 0x458F293454fE0d67EC0655f3672301301DD51422;
    address constant AGNI_ROUTER = 0x319B69888D6F4e3f4BF42d89C6a3563Bab0BB8f8;
    uint24 constant POOL_FEE = 100;
    address constant AGENT_WALLET = 0xf44f79827CAf6d7C5d3f3faabA147393a3e3310d;
    bytes32 constant TX_HASH = 0x59fd00904af9d9e00c30ec37fc216f67076290548ea0d3bd9d20ef5e043b6f95;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== SwapAndDeployVault (Simple) ===");
        console.log("Deployer:", deployer);
        console.log("Old vault:", OLD_VAULT);
        console.log("New vault: (will be deployed)");
        console.log("");

        vm.startBroadcast(deployerKey);

        // 1. Execute withdrawal from old vault
        console.log("Step 1: Execute withdrawal...");
        TreasuryVault(OLD_VAULT).executeWithdrawal(TX_HASH);
        console.log("Withdrawal executed OK");

        // 2. Swap USDT → USDT0
        console.log("Step 2: Swap USDT -> USDT0...");
        IERC20 usdtToken = IERC20(USDT);
        uint256 usdtBalance = usdtToken.balanceOf(deployer);
        console.log("USDT received:", usdtBalance);
        
        usdtToken.approve(AGNI_ROUTER, usdtBalance);
        uint256 minOut = (usdtBalance * 995) / 1000; // 0.5% slippage
        uint256 usdt0Out = ISwapRouter(AGNI_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: USDT,
                tokenOut: USDT0,
                fee: POOL_FEE,
                recipient: deployer,
                deadline: block.timestamp + 300,
                amountIn: usdtBalance,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        console.log("Swapped to USDT0:", usdt0Out);

        // 3. Deploy new vault
        console.log("Step 3: Deploy new vault with USDT0...");
        TreasuryVault newVault = new TreasuryVault(USDT0, AAVE_POOL);
        console.log("New vault deployed:", address(newVault));

        // 4. Configure roles & permissions
        bytes32 AGENT_ROLE = keccak256("AGENT_ROLE");
        bytes32 GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
        bytes32 EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
        newVault.setProtocolAllowed(AAVE_POOL, true);
        newVault.grantRole(AGENT_ROLE, AGENT_WALLET);
        newVault.grantRole(GUARDIAN_ROLE, AGENT_WALLET);
        newVault.grantRole(EXECUTOR_ROLE, AGENT_WALLET);
        console.log("Roles configured OK");

        // 5. Deposit USDT0
        console.log("Step 4: Deposit USDT0 to new vault...");
        IERC20 usdt0Token = IERC20(USDT0);
        usdt0Token.approve(address(newVault), usdt0Out);
        newVault.deposit(usdt0Out);
        console.log("Deposited:", usdt0Out);

        vm.stopBroadcast();

        console.log("");
        console.log("=== SUCCESS ===");
        console.log("New vault: ", address(newVault));
        console.log("USDT0 balance:", usdt0Out);
        console.log("");
        console.log(">>> Update Railway env vars:");
        console.log("TREASURY_VAULT_ADDRESS =", vm.toString(address(newVault)));
        console.log("USDT_ADDRESS = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736");
        console.log("AAVE_POOL_ADDRESS = 0x458F293454fE0d67EC0655f3672301301DD51422");
    }
}
