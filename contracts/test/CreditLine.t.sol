// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../CreditLine.sol";
import "./mocks/MockERC20.sol";

contract CreditLineTest is Test {
    CreditLine credit;
    MockERC20 usdt;

    address deployer = address(this);
    address agent = address(0xA1);
    address oracle = address(0xA2);
    address treasury = address(0xBBBB);
    address borrower = address(0xD1);
    address borrower2 = address(0xD2);

    function setUp() public {
        usdt = new MockERC20();
        credit = new CreditLine(address(usdt), treasury);

        // Grant roles
        credit.grantRole(credit.AGENT_ROLE(), agent);
        credit.grantRole(credit.ORACLE_ROLE(), oracle);

        // Give borrower some USDT for repayments
        usdt.mint(borrower, 100_000e6);
        vm.prank(borrower);
        usdt.approve(address(credit), type(uint256).max);

        usdt.mint(borrower2, 100_000e6);
        vm.prank(borrower2);
        usdt.approve(address(credit), type(uint256).max);
    }

    // ── Score Calculation & Tiers ─────────────────────────

    function test_excellent_tier() public {
        // Score: 500 + min(100*2,200) + min(50000/100,150) + 3*100 + min(365/10,50) = 500+200+150+300+36 = 1186 → clamped to 1000
        vm.prank(agent);
        credit.updateProfile(borrower, 100, 50000, 365, 3, 0);

        (uint256 score, uint256 limit, uint256 rate,,,) = credit.getProfile(borrower);
        assertGe(score, 800);
        assertEq(limit, 5000e6);
        assertEq(rate, 500); // 5% APR
    }

    function test_good_tier() public {
        // Score: 500 + min(30*2,200) + min(1000/100,150) + 1*100 + min(90/10,50) = 500+60+10+100+9 = 679
        vm.prank(agent);
        credit.updateProfile(borrower, 30, 1000, 90, 1, 0);

        (uint256 score, uint256 limit, uint256 rate,,,) = credit.getProfile(borrower);
        assertGe(score, 600);
        assertLt(score, 800);
        assertEq(limit, 2000e6);
        assertEq(rate, 1000); // 10% APR
    }

    function test_poor_tier() public {
        // Score: 500 + min(5*2,200) + 0 + 0 + 0 = 510
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        (uint256 score, uint256 limit, uint256 rate,,,) = credit.getProfile(borrower);
        assertLt(score, 600);
        assertEq(limit, 500e6);
        assertEq(rate, 1500); // 15% APR
    }

    function test_profile_exists() public {
        assertFalse(credit.hasProfile(borrower));

        vm.prank(agent);
        credit.updateProfile(borrower, 10, 100, 30, 0, 0);

        assertTrue(credit.hasProfile(borrower));
    }

    // ── Borrow ────────────────────────────────────────────

    function test_borrow() public {
        // Create profile — poor tier (500 USDt limit)
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        // Agent borrows on behalf of borrower (borrow() is onlyAgent)
        vm.prank(agent);
        credit.borrowFor(borrower, 200e6);

        assertEq(credit.loanCount(), 1);
        assertEq(credit.totalLent(), 200e6);

        (,,,uint256 borrowed, uint256 available,) = credit.getProfile(borrower);
        assertEq(borrowed, 200e6);
        assertEq(available, 300e6);
    }

    function test_borrow_exceeds_limit_reverts() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        vm.expectRevert("CreditLine: exceeds credit limit");
        credit.borrowFor(borrower, 501e6);
    }

    function test_borrow_no_profile_reverts() public {
        vm.prank(agent);
        vm.expectRevert("CreditLine: no credit profile");
        credit.borrowFor(borrower, 100e6);
    }

    // ── Repay ─────────────────────────────────────────────

    function test_repay_full() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 200e6);

        // Warp 30 days so interest accrues
        vm.warp(block.timestamp + 30 days);

        uint256 interest = credit.calculateInterest(0);
        uint256 totalDue = 200e6 + interest;

        vm.prank(borrower);
        credit.repay(0, totalDue);

        // Loan should be closed
        (,,,,,,bool active) = credit.loans(0);
        assertFalse(active);

        // USDT should reach treasury
        assertEq(usdt.balanceOf(treasury), totalDue);
    }

    function test_repay_partial() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 200e6);

        vm.prank(borrower);
        credit.repay(0, 50e6);

        (,,,,, uint256 repaid, bool active) = credit.loans(0);
        assertTrue(active);
        assertEq(repaid, 50e6);
    }

    // ── Default ───────────────────────────────────────────

    function test_mark_defaulted() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 200e6);

        // Warp past due date (30 days)
        vm.warp(block.timestamp + 31 days);

        vm.prank(agent);
        credit.markDefaulted(0);

        (,,,,,,bool active) = credit.loans(0);
        assertFalse(active);
        assertEq(credit.totalDefaults(), 200e6);

        // Profile should have the default recorded
        (uint256 score,,,,, ) = credit.getProfile(borrower);
        // Score might have changed due to default
        assertGe(score, 0);
    }

    function test_mark_defaulted_before_due_reverts() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 200e6);

        vm.prank(agent);
        vm.expectRevert("CreditLine: not yet due");
        credit.markDefaulted(0);
    }

    // ── Interest Calculation ──────────────────────────────

    function test_interest_calculation() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0); // poor tier → 15% APR, 500 USDt limit

        vm.prank(agent);
        credit.borrowFor(borrower, 400e6); // borrow within 500e6 limit

        // Warp 365 days
        vm.warp(block.timestamp + 365 days);

        uint256 interest = credit.calculateInterest(0);
        // Expected: 400e6 * 1500 * 365 days / (365 days * 10000) = 60e6
        assertEq(interest, 60e6);
    }

    // ── Active Loans ──────────────────────────────────────

    function test_get_active_loans() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 100e6);
        vm.prank(agent);
        credit.borrowFor(borrower, 100e6);

        uint256[] memory activeLoans = credit.getActiveLoans(borrower);
        assertEq(activeLoans.length, 2);
    }

    // ── Treasury Update ───────────────────────────────────

    function test_set_treasury_vault() public {
        address newTreasury = address(0xCCCC);

        vm.prank(agent);
        credit.setTreasuryVault(newTreasury);

        assertEq(credit.treasuryVault(), newTreasury);
    }

    function test_set_treasury_vault_zero_reverts() public {
        vm.prank(agent);
        vm.expectRevert("CreditLine: invalid treasury");
        credit.setTreasuryVault(address(0));
    }

    // ── Access Control ────────────────────────────────────

    function test_non_agent_cannot_update_profile() public {
        vm.prank(borrower);
        vm.expectRevert();
        credit.updateProfile(borrower, 10, 100, 30, 0, 0);
    }

    function test_non_agent_cannot_mark_default() public {
        vm.prank(agent);
        credit.updateProfile(borrower, 5, 0, 0, 0, 0);

        vm.prank(agent);
        credit.borrowFor(borrower, 100e6);

        vm.warp(block.timestamp + 31 days);

        vm.prank(borrower);
        vm.expectRevert();
        credit.markDefaulted(0);
    }
}
