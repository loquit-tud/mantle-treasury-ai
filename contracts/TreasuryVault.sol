// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/**
 * @title TreasuryVault
 * @dev Multi-sig treasury vault for DAOs with timelock and daily limits
 * Integrates with Aave V3 for yield generation
 */
contract TreasuryVault is ReentrancyGuard, AccessControl, Pausable {
    
    // Roles
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    
    // Constraints
    uint256 public constant MAX_DAILY_VOLUME = 10000 * 10**6; // 10k USDt
    uint256 public constant MAX_SINGLE_TX = 1000 * 10**6;     // 1k USDt
    uint256 public constant MULTISIG_THRESHOLD = 1000 * 10**6; // >1k needs 2 sigs
    uint256 public constant TIMELOCK_DELAY = 1 hours;
    
    // State
    IERC20 public usdt;
    IPool public aavePool;
    uint256 public totalInvested;
    
    struct Transaction {
        address to;
        uint256 amount;
        bytes32 txHash;
        uint256 proposedAt;
        uint256 executedAt;
        bool executed;
        uint256 signatures;
        mapping(address => bool) hasSigned;
    }
    
    struct DailyVolume {
        uint256 volume;
        uint256 day;
    }
    
    // Storage
    mapping(bytes32 => Transaction) public transactions;
    mapping(uint256 => DailyVolume) public dailyVolumes;
    mapping(address => bool) public allowedProtocols;
    
    bytes32[] public pendingTransactions;
    uint256 public transactionCount;
    
    // Events
    event Deposit(address indexed from, uint256 amount, uint256 newBalance);
    event WithdrawProposed(bytes32 indexed txHash, address indexed to, uint256 amount, uint256 executeAfter);
    event WithdrawExecuted(bytes32 indexed txHash, address indexed to, uint256 amount);
    event TransactionSigned(bytes32 indexed txHash, address indexed signer);
    event YieldInvested(address indexed protocol, uint256 amount, uint256 apy);
    event YieldHarvested(address indexed protocol, uint256 amount);
    event EmergencyPaused(address indexed guardian);
    event EmergencyUnpaused(address indexed guardian);
    event ProtocolAllowed(address indexed protocol, bool allowed);
    
    modifier onlyAgent() {
        require(hasRole(AGENT_ROLE, msg.sender), "TreasuryVault: not agent");
        _;
    }
    
    modifier onlyGuardian() {
        require(hasRole(GUARDIAN_ROLE, msg.sender), "TreasuryVault: not guardian");
        _;
    }
    
    modifier onlyExecutor() {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "TreasuryVault: not executor");
        _;
    }
    
    constructor(address _usdt, address _aavePool) {
        require(_usdt != address(0), "TreasuryVault: invalid USDT address");
        usdt = IERC20(_usdt);
        if (_aavePool != address(0)) {
            aavePool = IPool(_aavePool);
        }
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
    }
    
    /**
     * @dev Deposit USDt into treasury
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "TreasuryVault: amount must be > 0");
        
        bool success = usdt.transferFrom(msg.sender, address(this), amount);
        require(success, "TreasuryVault: transfer failed");
        
        emit Deposit(msg.sender, amount, usdt.balanceOf(address(this)));
    }
    
    /**
     * @dev Propose a withdrawal (timelock + multi-sig for large amounts)
     */
    function proposeWithdrawal(
        address to,
        uint256 amount
    ) external onlyAgent nonReentrant whenNotPaused returns (bytes32) {
        require(to != address(0), "TreasuryVault: invalid recipient");
        require(amount > 0, "TreasuryVault: amount must be > 0");
        require(amount <= MAX_SINGLE_TX, "TreasuryVault: exceeds max single tx");
        require(
            usdt.balanceOf(address(this)) >= amount,
            "TreasuryVault: insufficient balance"
        );
        
        // Create transaction
        bytes32 txHash = keccak256(
            abi.encodePacked(to, amount, block.timestamp, transactionCount++)
        );
        
        Transaction storage txn = transactions[txHash];
        txn.to = to;
        txn.amount = amount;
        txn.txHash = txHash;
        txn.proposedAt = block.timestamp;
        txn.signatures = 1;
        txn.hasSigned[msg.sender] = true;
        
        pendingTransactions.push(txHash);
        // NOTE: volume is tracked at execution time to avoid phantom deductions
        
        uint256 executeAfter = block.timestamp + TIMELOCK_DELAY;
        
        emit WithdrawProposed(txHash, to, amount, executeAfter);
        emit TransactionSigned(txHash, msg.sender);
        
        return txHash;
    }
    
    /**
     * @dev Sign a pending transaction (for multi-sig)
     */
    function signTransaction(bytes32 txHash) external onlyAgent nonReentrant {
        Transaction storage txn = transactions[txHash];
        require(txn.txHash != bytes32(0), "TreasuryVault: transaction not found");
        require(!txn.executed, "TreasuryVault: already executed");
        require(!txn.hasSigned[msg.sender], "TreasuryVault: already signed");
        
        txn.hasSigned[msg.sender] = true;
        txn.signatures++;
        
        emit TransactionSigned(txHash, msg.sender);
        
        // Execute if threshold reached and timelock passed
        uint256 executeAfter = txn.proposedAt + TIMELOCK_DELAY;
        if (
            txn.signatures >= 2 &&
            block.timestamp >= executeAfter
        ) {
            _executeWithdrawal(txHash);
        }
    }
    
    /**
     * @dev Execute a withdrawal after timelock
     */
    function executeWithdrawal(bytes32 txHash) external onlyExecutor nonReentrant {
        Transaction storage txn = transactions[txHash];
        require(txn.txHash != bytes32(0), "TreasuryVault: transaction not found");
        require(!txn.executed, "TreasuryVault: already executed");
        
        uint256 executeAfter = txn.proposedAt + TIMELOCK_DELAY;
        require(
            block.timestamp >= executeAfter,
            "TreasuryVault: timelock not expired"
        );
        
        // Multi-sig check for large amounts
        if (txn.amount >= MULTISIG_THRESHOLD) {
            require(txn.signatures >= 2, "TreasuryVault: insufficient signatures");
        }
        
        _executeWithdrawal(txHash);
    }
    
    function _executeWithdrawal(bytes32 txHash) internal {
        Transaction storage txn = transactions[txHash];
        
        // Track daily volume at execution time (not at proposal time)
        uint256 currentDay = block.timestamp / 1 days;
        DailyVolume storage dv = dailyVolumes[currentDay];
        if (dv.day != currentDay) {
            dv.volume = 0;
            dv.day = currentDay;
        }
        require(
            dv.volume + txn.amount <= MAX_DAILY_VOLUME,
            "TreasuryVault: exceeds daily volume"
        );
        dv.volume += txn.amount;
        
        txn.executed = true;
        txn.executedAt = block.timestamp;
        
        // Remove from pendingTransactions (swap-and-pop)
        _removePending(txHash);
        
        bool success = usdt.transfer(txn.to, txn.amount);
        require(success, "TreasuryVault: transfer failed");
        
        emit WithdrawExecuted(txHash, txn.to, txn.amount);
    }

    /**
     * @dev Remove a txHash from pendingTransactions (swap-and-pop)
     */
    function _removePending(bytes32 txHash) internal {
        uint256 len = pendingTransactions.length;
        for (uint256 i = 0; i < len; i++) {
            if (pendingTransactions[i] == txHash) {
                pendingTransactions[i] = pendingTransactions[len - 1];
                pendingTransactions.pop();
                break;
            }
        }
    }
    
    /**
     * @dev Invest USDt into Aave V3 (supply)
     */
    function investInYield(
        address protocol,
        uint256 amount,
        uint256 apy
    ) external onlyAgent nonReentrant whenNotPaused {
        require(address(aavePool) != address(0), "TreasuryVault: Aave pool not set");
        require(allowedProtocols[protocol], "TreasuryVault: protocol not allowed");
        require(amount > 0, "TreasuryVault: amount must be > 0");
        require(
            usdt.balanceOf(address(this)) >= amount,
            "TreasuryVault: insufficient balance"
        );
        
        // Reset then set allowance — required for USDT (non-standard approve)
        usdt.approve(address(aavePool), 0);
        usdt.approve(address(aavePool), amount);
        // Supply to Aave V3
        aavePool.supply(address(usdt), amount, address(this), 0);
        totalInvested += amount;
        
        emit YieldInvested(protocol, amount, apy);
    }
    
    /**
     * @dev Withdraw USDt from Aave V3
     */
    function harvestYield(
        address protocol,
        uint256 expectedAmount
    ) external onlyAgent nonReentrant whenNotPaused {
        require(address(aavePool) != address(0), "TreasuryVault: Aave pool not set");
        
        uint256 before = usdt.balanceOf(address(this));
        aavePool.withdraw(address(usdt), expectedAmount, address(this));
        uint256 received = usdt.balanceOf(address(this)) - before;
        if (totalInvested > received) {
            totalInvested -= received;
        } else {
            totalInvested = 0;
        }
        
        emit YieldHarvested(protocol, received);
    }
    
    /**
     * @dev Emergency pause
     */
    function emergencyPause() external onlyGuardian {
        _pause();
        emit EmergencyPaused(msg.sender);
    }
    
    /**
     * @dev Unpause
     */
    function emergencyUnpause() external onlyGuardian {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }
    
    /**
     * @dev Allow/disallow a protocol
     */
    function setProtocolAllowed(address protocol, bool allowed) external onlyGuardian {
        allowedProtocols[protocol] = allowed;
        emit ProtocolAllowed(protocol, allowed);
    }
    
    /**
     * @dev Get treasury balance
     */
    function getBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
    
    /**
     * @dev Get daily volume for current day
     */
    function getCurrentDayVolume() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        DailyVolume storage dv = dailyVolumes[currentDay];
        if (dv.day != currentDay) {
            return 0;
        }
        return dv.volume;
    }
    
    /**
     * @dev Get pending transactions
     */
    function getPendingTransactions() external view returns (bytes32[] memory) {
        return pendingTransactions;
    }
    
    /**
     * @dev Get transaction details
     */
    function getTransaction(bytes32 txHash) external view returns (
        address to,
        uint256 amount,
        uint256 proposedAt,
        uint256 executedAt,
        bool executed,
        uint256 signatures
    ) {
        Transaction storage txn = transactions[txHash];
        return (
            txn.to,
            txn.amount,
            txn.proposedAt,
            txn.executedAt,
            txn.executed,
            txn.signatures
        );
    }
}
