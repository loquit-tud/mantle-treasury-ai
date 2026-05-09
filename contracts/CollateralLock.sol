// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CollateralLock
 * @dev Holds borrower collateral for CreditLine loans.
 *      100% USDt collateral required before loan approval.
 *      Released on repayment, seized on default.
 */
contract CollateralLock is ReentrancyGuard, AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    IERC20 public usdt;
    address public treasuryVault;

    struct Collateral {
        uint256 amount;
        uint256 loanId;
        bool locked;
    }

    mapping(address => Collateral) public collaterals;

    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralReleased(address indexed borrower, uint256 amount);
    event CollateralSeized(address indexed borrower, uint256 amount, address indexed treasury);

    constructor(address _usdt, address _treasuryVault) {
        require(_usdt != address(0), "CollateralLock: invalid USDT");
        require(_treasuryVault != address(0), "CollateralLock: invalid treasury");
        usdt = IERC20(_usdt);
        treasuryVault = _treasuryVault;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
    }

    /**
     * @dev Borrower deposits collateral before taking a loan.
     */
    function depositCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "CollateralLock: amount must be > 0");
        require(!collaterals[msg.sender].locked, "CollateralLock: already has active collateral");

        bool success = usdt.transferFrom(msg.sender, address(this), amount);
        require(success, "CollateralLock: transfer failed");

        collaterals[msg.sender] = Collateral({
            amount: amount,
            loanId: 0,
            locked: true
        });

        emit CollateralDeposited(msg.sender, amount);
    }

    /**
     * @dev Agent links collateral to a loan ID after approval.
     */
    function linkToLoan(address borrower, uint256 loanId) external onlyRole(AGENT_ROLE) {
        require(collaterals[borrower].locked, "CollateralLock: no collateral");
        require(loanId > 0, "CollateralLock: invalid loanId");
        require(collaterals[borrower].loanId == 0, "CollateralLock: already linked");
        collaterals[borrower].loanId = loanId;
    }

    /**
     * @dev Release collateral back to borrower after full repayment.
     */
    function releaseCollateral(address borrower) external onlyRole(AGENT_ROLE) nonReentrant {
        Collateral storage col = collaterals[borrower];
        require(col.locked, "CollateralLock: no active collateral");

        uint256 amount = col.amount;
        col.amount = 0;
        col.locked = false;
        col.loanId = 0;

        bool success = usdt.transfer(borrower, amount);
        require(success, "CollateralLock: release failed");

        emit CollateralReleased(borrower, amount);
    }

    /**
     * @dev Seize collateral on default — sends to treasury vault.
     */
    function seizeCollateral(address borrower) external onlyRole(AGENT_ROLE) nonReentrant {
        Collateral storage col = collaterals[borrower];
        require(col.locked, "CollateralLock: no active collateral");

        uint256 amount = col.amount;
        col.amount = 0;
        col.locked = false;
        col.loanId = 0;

        bool success = usdt.transfer(treasuryVault, amount);
        require(success, "CollateralLock: seize failed");

        emit CollateralSeized(borrower, amount, treasuryVault);
    }

    /**
     * @dev Check if borrower has sufficient collateral for a loan amount.
     */
    function hasCollateral(address borrower, uint256 requiredAmount) external view returns (bool) {
        Collateral storage col = collaterals[borrower];
        return col.locked && col.amount >= requiredAmount;
    }

    /**
     * @dev Get collateral details.
     */
    function getCollateral(address borrower) external view returns (uint256 amount, uint256 loanId, bool locked) {
        Collateral storage col = collaterals[borrower];
        return (col.amount, col.loanId, col.locked);
    }
}
