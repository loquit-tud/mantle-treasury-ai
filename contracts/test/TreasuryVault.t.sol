// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../TreasuryVault.sol";
import "./mocks/MockERC20.sol";

contract TreasuryVaultTest is Test {
    TreasuryVault vault;
    MockERC20 usdt;

    address deployer = address(this);
    address agent = address(0xA1);
    address guardian = address(0xB1);
    address executor = address(0xC1);
    address user = address(0xD1);
    address protocol = address(0xE1);

    function setUp() public {
        usdt = new MockERC20();
        vault = new TreasuryVault(address(usdt), address(0));

        // Grant roles
        vault.grantRole(vault.AGENT_ROLE(), agent);
        vault.grantRole(vault.GUARDIAN_ROLE(), guardian);
        vault.grantRole(vault.EXECUTOR_ROLE(), executor);

        // Allow protocol
        vm.prank(guardian);
        vault.setProtocolAllowed(protocol, true);

        // Mint USDT to user and approve
        usdt.mint(user, 100_000e6);
        vm.prank(user);
        usdt.approve(address(vault), type(uint256).max);
    }

    // ── Deposit ────────────────────────────────────────────

    function test_deposit() public {
        vm.prank(user);
        vault.deposit(1000e6);
        assertEq(vault.getBalance(), 1000e6);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(user);
        vm.expectRevert("TreasuryVault: amount must be > 0");
        vault.deposit(0);
    }

    // ── Propose + Execute Withdrawal ──────────────────────

    function test_propose_and_execute_small_withdrawal() public {
        // Deposit first
        vm.prank(user);
        vault.deposit(5000e6);

        // Agent proposes (below MULTISIG_THRESHOLD = 1000e6)
        vm.prank(agent);
        bytes32 txHash = vault.proposeWithdrawal(user, 500e6);

        // Warp past timelock
        vm.warp(block.timestamp + 1 hours + 1);

        // Executor executes
        vm.prank(executor);
        vault.executeWithdrawal(txHash);

        // Verify balance decreased
        assertEq(vault.getBalance(), 4500e6);
    }

    function test_large_withdrawal_needs_multisig() public {
        vm.prank(user);
        vault.deposit(5000e6);

        // Agent proposes 1000e6 (at threshold)
        vm.prank(agent);
        bytes32 txHash = vault.proposeWithdrawal(user, 1000e6);

        // Warp past timelock
        vm.warp(block.timestamp + 1 hours + 1);

        // Executor tries without 2 sigs -> revert
        vm.prank(executor);
        vm.expectRevert("TreasuryVault: insufficient signatures");
        vault.executeWithdrawal(txHash);

        // Second agent signs — signTransaction auto-executes (2 sigs + timelock passed)
        vm.prank(deployer); // deployer also has AGENT_ROLE
        vault.signTransaction(txHash);

        // Already executed by signTransaction, verify balance
        assertEq(vault.getBalance(), 4000e6);
    }

    function test_timelock_enforced() public {
        vm.prank(user);
        vault.deposit(5000e6);

        vm.prank(agent);
        bytes32 txHash = vault.proposeWithdrawal(user, 500e6);

        // Try executing before timelock
        vm.prank(executor);
        vm.expectRevert("TreasuryVault: timelock not expired");
        vault.executeWithdrawal(txHash);
    }

    function test_exceeds_max_single_tx() public {
        vm.prank(user);
        vault.deposit(5000e6);

        vm.prank(agent);
        vm.expectRevert("TreasuryVault: exceeds max single tx");
        vault.proposeWithdrawal(user, 1001e6);
    }

    function test_exceeds_daily_volume() public {
        usdt.mint(user, 100_000e6);
        vm.prank(user);
        vault.deposit(50_000e6);

        // Volume is tracked at execution time; use amounts below MULTISIG_THRESHOLD (1000e6)
        bytes32[] memory hashes = new bytes32[](11);
        for (uint256 i = 0; i < 11; i++) {
            vm.prank(agent);
            hashes[i] = vault.proposeWithdrawal(user, 999e6);
        }

        // Warp past timelock
        vm.warp(block.timestamp + 1 hours + 1);

        // Execute 10 txns = 9990e6 (just under MAX_DAILY_VOLUME of 10000e6)
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(executor);
            vault.executeWithdrawal(hashes[i]);
        }

        // 11th execution pushes over 10000e6 daily limit
        vm.prank(executor);
        vm.expectRevert("TreasuryVault: exceeds daily volume");
        vault.executeWithdrawal(hashes[10]);
    }

    // ── Emergency Pause ───────────────────────────────────

    function test_emergency_pause() public {
        vm.prank(guardian);
        vault.emergencyPause();

        // Deposit should fail when paused
        vm.prank(user);
        vm.expectRevert();
        vault.deposit(1000e6);

        // Unpause
        vm.prank(guardian);
        vault.emergencyUnpause();

        // Deposit works again
        vm.prank(user);
        vault.deposit(1000e6);
        assertEq(vault.getBalance(), 1000e6);
    }

    // ── Yield Investment ──────────────────────────────────

    function test_invest_no_pool_reverts() public {
        vm.prank(user);
        vault.deposit(5000e6);

        vm.prank(agent);
        vm.expectRevert("TreasuryVault: Aave pool not set");
        vault.investInYield(protocol, 1000e6, 500);
    }

    function test_harvest_no_pool_reverts() public {
        vm.prank(agent);
        vm.expectRevert("TreasuryVault: Aave pool not set");
        vault.harvestYield(protocol, 1000e6);
    }

    // ── Access Control ────────────────────────────────────

    function test_non_agent_cannot_propose() public {
        vm.prank(user);
        vault.deposit(5000e6);

        vm.prank(user);
        vm.expectRevert();
        vault.proposeWithdrawal(user, 500e6);
    }

    function test_non_guardian_cannot_pause() public {
        vm.prank(user);
        vm.expectRevert();
        vault.emergencyPause();
    }

    // ── View functions ────────────────────────────────────

    function test_getCurrentDayVolume() public {
        vm.prank(user);
        vault.deposit(5000e6);

        assertEq(vault.getCurrentDayVolume(), 0);

        // Volume is tracked at execution time
        vm.prank(agent);
        bytes32 txHash = vault.proposeWithdrawal(user, 500e6);

        // Still 0 after proposal (volume tracked at execution)
        assertEq(vault.getCurrentDayVolume(), 0);

        // Warp past timelock and execute
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(executor);
        vault.executeWithdrawal(txHash);

        assertEq(vault.getCurrentDayVolume(), 500e6);
    }

    function test_getBalance() public {
        assertEq(vault.getBalance(), 0);

        vm.prank(user);
        vault.deposit(1000e6);

        assertEq(vault.getBalance(), 1000e6);
    }
}
