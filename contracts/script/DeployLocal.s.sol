// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "../CreditLine.sol";
import "../test/mocks/MockERC20.sol";

/**
 * @title DeployLocal
 * @notice Deploys the full stack on Anvil (local devnet) including a mock USDt.
 *         Usage:  forge script contracts/script/DeployLocal.s.sol:DeployLocal \
 *                   --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployLocal is Script {
    function run() external {
        // Anvil account #0 private key (deterministic, NOT secret)
        uint256 deployerKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerKey);

        // Use Anvil account #1 as the "agent" address
        address agentAddress = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

        vm.startBroadcast(deployerKey);

        // 1. Deploy mock USDt
        MockERC20 usdt = new MockERC20();
        // Mint 1M USDt to deployer & agent
        usdt.mint(deployer, 1_000_000e6);
        usdt.mint(agentAddress, 100_000e6);

        // 2. Deploy TreasuryVault (no Aave locally)
        TreasuryVault vault = new TreasuryVault(address(usdt), address(0));

        // 3. Deploy CreditLine (linked to vault)
        CreditLine credit = new CreditLine(address(usdt), address(vault));

        // 4. Grant roles to agent
        vault.grantRole(vault.AGENT_ROLE(), agentAddress);
        vault.grantRole(vault.EXECUTOR_ROLE(), agentAddress);
        credit.grantRole(credit.AGENT_ROLE(), agentAddress);

        // 5. Seed the vault with 50k USDt
        usdt.approve(address(vault), 50_000e6);
        vault.deposit(50_000e6);

        vm.stopBroadcast();

        // Log deployed addresses (parsed by demo script)
        console.log("USDT_ADDRESS=%s", address(usdt));
        console.log("TREASURY_VAULT_ADDRESS=%s", address(vault));
        console.log("CREDIT_LINE_ADDRESS=%s", address(credit));
        console.log("AGENT_ADDRESS=%s", agentAddress);
        console.log("---");
        console.log("Vault seeded with 50,000 USDt");
        console.log("Agent has 100,000 USDt");
    }
}
