// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CreditLine
 * @dev On-chain credit scoring and lending system for DAOs
 * Integrated with TreasuryVault for loan disbursement
 */
contract CreditLine is ReentrancyGuard, AccessControl {
    
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    // Credit tiers
    uint256 public constant TIER_EXCELLENT = 800; // 5k limit, 5% APR
    uint256 public constant TIER_GOOD = 600;      // 2k limit, 10% APR
    uint256 public constant TIER_POOR = 0;        // 500 limit, 15% APR
    
    // Interest rates (basis points)
    uint256 public constant RATE_EXCELLENT = 500;  // 5%
    uint256 public constant RATE_GOOD = 1000;      // 10%
    uint256 public constant RATE_POOR = 1500;      // 15%
    
    // Credit limits
    uint256 public constant LIMIT_EXCELLENT = 5000 * 10**6;  // 5k USDt
    uint256 public constant LIMIT_GOOD = 2000 * 10**6;       // 2k USDt
    uint256 public constant LIMIT_POOR = 500 * 10**6;        // 500 USDt
    
    // State
    IERC20 public usdt;
    address public treasuryVault;
    
    struct CreditProfile {
        uint256 score;
        uint256 limit;
        uint256 rate;        // APR in basis points
        uint256 borrowed;
        uint256 repaid;
        uint256 defaults;
        uint256 lastUpdated;
        uint256 transactionCount;
        uint256 volumeUSD;
        uint256 accountAge;
        uint256 repaidLoans;
        bool exists;
    }
    
    struct Loan {
        address borrower;
        uint256 principal;
        uint256 interestRate;
        uint256 borrowedAt;
        uint256 dueDate;
        uint256 repaid;
        bool active;
    }
    
    // Storage
    mapping(address => CreditProfile) public profiles;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    
    uint256 public loanCount;
    uint256 public totalLent;
    uint256 public totalRepaid;
    uint256 public totalDefaults;
    
    // Events
    event ProfileUpdated(
        address indexed user,
        uint256 score,
        uint256 limit,
        uint256 rate
    );
    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 interestRate,
        uint256 dueDate
    );
    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 amount,
        uint256 interest
    );
    event LoanDefaulted(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 amount
    );
    event TreasuryUpdated(address indexed newTreasury);
    
    modifier onlyAgent() {
        require(hasRole(AGENT_ROLE, msg.sender), "CreditLine: not agent");
        _;
    }
    
    modifier onlyOracle() {
        require(hasRole(ORACLE_ROLE, msg.sender), "CreditLine: not oracle");
        _;
    }
    
    constructor(address _usdt, address _treasuryVault) {
        require(_usdt != address(0), "CreditLine: invalid USDT address");
        require(_treasuryVault != address(0), "CreditLine: invalid treasury");
        
        usdt = IERC20(_usdt);
        treasuryVault = _treasuryVault;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }
    
    /**
     * @dev Update credit profile (called by agent after scoring)
     */
    function updateProfile(
        address user,
        uint256 transactionCount,
        uint256 volumeUSD,
        uint256 accountAge,
        uint256 repaidLoans,
        uint256 defaults
    ) external onlyAgent nonReentrant {
        require(user != address(0), "CreditLine: invalid user");
        
        // Calculate score
        uint256 score = _calculateScore(
            transactionCount,
            volumeUSD,
            accountAge,
            repaidLoans,
            defaults
        );
        
        // Determine tier and set limit/rate
        (uint256 limit, uint256 rate) = _getTierParams(score);
        
        CreditProfile storage profile = profiles[user];
        
        // Keep existing borrowed amount
        uint256 existingBorrowed = profile.borrowed;
        
        profile.score = score;
        profile.limit = limit;
        profile.rate = rate;
        profile.borrowed = existingBorrowed;
        profile.repaid = profile.repaid;
        profile.defaults = defaults;
        profile.lastUpdated = block.timestamp;
        profile.transactionCount = transactionCount;
        profile.volumeUSD = volumeUSD;
        profile.accountAge = accountAge;
        profile.repaidLoans = repaidLoans;
        profile.exists = true;
        
        emit ProfileUpdated(user, score, limit, rate);
    }
    
    /**
     * @dev Calculate credit score
     * Formula:
     * - Base: 500
     * - + min(txCount * 2, 200)
     * - + min(volumeUSD / 100, 150)
     * - + repaidLoans * 100
     * - + min(accountAge / 10, 50)
     * - - defaults * 200
     */
    function _calculateScore(
        uint256 transactionCount,
        uint256 volumeUSD,
        uint256 accountAge,
        uint256 repaidLoans,
        uint256 defaults
    ) internal pure returns (uint256) {
        uint256 score = 500; // Base
        
        // Positive factors
        score += _min(transactionCount * 2, 200);
        score += _min(volumeUSD / 100, 150);
        score += repaidLoans * 100;
        score += _min(accountAge / 10, 50);
        
        // Negative factors (saturating subtract to prevent uint underflow)
        uint256 penalty = defaults * 200;
        score = penalty >= score ? 0 : score - penalty;
        
        // Clamp to 1000 max
        if (score > 1000) score = 1000;
        
        return score;
    }
    
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    /**
     * @dev Get tier parameters based on score
     */
    function _getTierParams(uint256 score) internal pure returns (uint256 limit, uint256 rate) {
        if (score >= TIER_EXCELLENT) {
            return (LIMIT_EXCELLENT, RATE_EXCELLENT);
        } else if (score >= TIER_GOOD) {
            return (LIMIT_GOOD, RATE_GOOD);
        } else {
            return (LIMIT_POOR, RATE_POOR);
        }
    }
    
    /**
     * @dev Borrow USDt — restricted to AGENT_ROLE only.
     * Fund disbursement must be coordinated off-chain via TreasuryVault.proposeWithdrawal.
     * Direct borrower calls are disabled to prevent phantom loans (credit consumed, funds never received).
     * Users should request loans through the backend API which calls borrowFor().
     */
    function borrow(uint256 amount) external onlyAgent nonReentrant {
        _borrowFor(msg.sender, amount, 0, 0);
    }

    /**
     * @dev Borrow on behalf of a user (agent/relayer pattern)
     * Only callable by AGENT_ROLE — the backend acts as operator.
     * Uses profile defaults for rate and 30-day duration.
     */
    function borrowFor(address borrower, uint256 amount) external onlyAgent nonReentrant {
        _borrowFor(borrower, amount, 0, 0);
    }

    /**
     * @dev Borrow with custom terms negotiated by the LLM agent.
     * @param customRateBps Custom interest rate in basis points (0 = use profile default)
     * @param customDurationSec Custom loan duration in seconds (0 = 30 days default)
     * Rate is clamped: min(profileRate, customRate) — agent can only
     * offer BETTER terms than the tier default, never worse.
     * Duration: 7 days minimum, 90 days maximum.
     */
    function borrowForCustom(
        address borrower,
        uint256 amount,
        uint256 customRateBps,
        uint256 customDurationSec
    ) external onlyAgent nonReentrant {
        _borrowFor(borrower, amount, customRateBps, customDurationSec);
    }

    function _borrowFor(
        address borrower,
        uint256 amount,
        uint256 customRateBps,
        uint256 customDurationSec
    ) internal {
        require(borrower != address(0), "CreditLine: invalid borrower");
        CreditProfile storage profile = profiles[borrower];
        require(profile.exists, "CreditLine: no credit profile");
        require(amount > 0, "CreditLine: amount must be > 0");

        uint256 availableCredit = profile.limit - profile.borrowed;
        require(amount <= availableCredit, "CreditLine: exceeds credit limit");

        // Rate: use custom if provided and <= profile rate (agent can't charge MORE than tier)
        uint256 interestRate = profile.rate;
        if (customRateBps > 0 && customRateBps <= profile.rate) {
            interestRate = customRateBps;
        }

        // Duration: 7d min, 90d max, default 30d
        uint256 duration = 30 days;
        if (customDurationSec > 0) {
            if (customDurationSec < 7 days) customDurationSec = 7 days;
            if (customDurationSec > 90 days) customDurationSec = 90 days;
            duration = customDurationSec;
        }
        uint256 dueDate = block.timestamp + duration;

        uint256 loanId = loanCount++;
        loans[loanId] = Loan({
            borrower: borrower,
            principal: amount,
            interestRate: interestRate,
            borrowedAt: block.timestamp,
            dueDate: dueDate,
            repaid: 0,
            active: true
        });

        borrowerLoans[borrower].push(loanId);
        profile.borrowed += amount;
        totalLent += amount;

        emit LoanCreated(loanId, borrower, amount, interestRate, dueDate);
    }
    
    /**
     * @dev Repay a loan
     */
    function repay(uint256 loanId, uint256 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "CreditLine: loan not active");
        require(loan.borrower == msg.sender, "CreditLine: not borrower");
        require(amount > 0, "CreditLine: amount must be > 0");
        
        uint256 interest = calculateInterest(loanId);
        uint256 totalDue = loan.principal + interest - loan.repaid;
        
        require(amount <= totalDue, "CreditLine: overpayment");
        
        // Transfer USDT from borrower
        bool success = usdt.transferFrom(msg.sender, treasuryVault, amount);
        require(success, "CreditLine: transfer failed");
        
        loan.repaid += amount;
        
        CreditProfile storage profile = profiles[msg.sender];
        profile.repaid += amount;
        
        // Update totals
        totalRepaid += amount;
        
        emit LoanRepaid(loanId, msg.sender, amount, interest);
        
        // Close loan if fully repaid
        if (loan.repaid >= loan.principal + interest) {
            loan.active = false;
            profile.repaidLoans++;
            profile.borrowed -= loan.principal;
        }
    }

    /**
     * @dev Repay on behalf of a user (agent/relayer pattern)
     * Agent transfers USDt from its own balance back to treasury.
     */
    function repayFor(address borrower, uint256 loanId, uint256 amount) external onlyAgent nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "CreditLine: loan not active");
        require(loan.borrower == borrower, "CreditLine: borrower mismatch");
        require(amount > 0, "CreditLine: amount must be > 0");

        uint256 interest = calculateInterest(loanId);
        uint256 totalDue = loan.principal + interest - loan.repaid;
        require(amount <= totalDue, "CreditLine: overpayment");

        // Agent pays from its own balance on behalf of borrower
        bool success = usdt.transferFrom(msg.sender, treasuryVault, amount);
        require(success, "CreditLine: transfer failed");

        loan.repaid += amount;

        CreditProfile storage profile = profiles[borrower];
        profile.repaid += amount;
        totalRepaid += amount;

        emit LoanRepaid(loanId, borrower, amount, interest);

        if (loan.repaid >= loan.principal + interest) {
            loan.active = false;
            profile.repaidLoans++;
            profile.borrowed -= loan.principal;
        }
    }
    
    /**
     * @dev Mark loan as defaulted (called by agent after due date)
     */
    function markDefaulted(uint256 loanId) external onlyAgent nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "CreditLine: loan not active");
        require(block.timestamp > loan.dueDate, "CreditLine: not yet due");
        
        loan.active = false;
        
        CreditProfile storage profile = profiles[loan.borrower];
        profile.defaults++;
        profile.borrowed -= loan.principal;
        
        totalDefaults += loan.principal - loan.repaid;
        
        emit LoanDefaulted(loanId, loan.borrower, loan.principal - loan.repaid);
    }
    
    /**
     * @dev Calculate interest for a loan
     * Formula: (principal * rate * time) / (365 days * 10000)
     */
    function calculateInterest(uint256 loanId) public view returns (uint256) {
        Loan storage loan = loans[loanId];
        if (!loan.active) return 0;
        
        uint256 timeElapsed = block.timestamp - loan.borrowedAt;
        uint256 interest = (loan.principal * loan.interestRate * timeElapsed) / (365 days * 10000);
        
        return interest;
    }
    
    /**
     * @dev Get total amount due for a loan
     */
    function getAmountDue(uint256 loanId) external view returns (uint256) {
        Loan storage loan = loans[loanId];
        if (!loan.active) return 0;
        
        uint256 interest = calculateInterest(loanId);
        return loan.principal + interest - loan.repaid;
    }
    
    /**
     * @dev Get user's active loans
     */
    function getActiveLoans(address user) external view returns (uint256[] memory) {
        uint256[] memory userLoans = borrowerLoans[user];
        uint256[] memory activeLoans = new uint256[](userLoans.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < userLoans.length; i++) {
            if (loans[userLoans[i]].active) {
                activeLoans[count++] = userLoans[i];
            }
        }
        
        // Resize array
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = activeLoans[i];
        }
        
        return result;
    }
    
    /**
     * @dev Get credit profile
     */
    function getProfile(address user) external view returns (
        uint256 score,
        uint256 limit,
        uint256 rate,
        uint256 borrowed,
        uint256 available,
        uint256 lastUpdated
    ) {
        CreditProfile storage profile = profiles[user];
        
        uint256 available = profile.borrowed <= profile.limit
            ? profile.limit - profile.borrowed
            : 0;
        return (
            profile.score,
            profile.limit,
            profile.rate,
            profile.borrowed,
            available,
            profile.lastUpdated
        );
    }
    
    /**
     * @dev Check if user has credit profile
     */
    function hasProfile(address user) external view returns (bool) {
        return profiles[user].exists;
    }
    
    /**
     * @dev Admin-only: cancel a loan regardless of due date (e.g. erroneous phantom loans).
     * No funds are moved — just closes the on-chain record and frees credit.
     */
    function adminCancelLoan(uint256 loanId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "CreditLine: loan not active");

        loan.active = false;

        CreditProfile storage profile = profiles[loan.borrower];
        profile.borrowed -= loan.principal;

        emit LoanDefaulted(loanId, loan.borrower, 0);
    }

    /**
     * @dev Update treasury vault address
     */
    function setTreasuryVault(address _treasuryVault) external onlyAgent {
        require(_treasuryVault != address(0), "CreditLine: invalid treasury");
        treasuryVault = _treasuryVault;
        emit TreasuryUpdated(_treasuryVault);
    }
    
    /**
     * @dev Get protocol stats
     */
    function getStats() external view returns (
        uint256 _totalLent,
        uint256 _totalRepaid,
        uint256 _totalDefaults,
        uint256 _activeLoans,
        uint256 _loanCount
    ) {
        return (totalLent, totalRepaid, totalDefaults, loanCount, loanCount);
    }
}
