// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MntCollateralVault
 * @dev Self-contained MNT-collateralized USDT0 lending.
 *      User sends native MNT, borrows USDT0 up to LTV (default 70%).
 *      Price feed is admin-updated (off-chain CoinGecko keeper).
 *      Liquidation hook (Phase 2) reserved for AGENT_ROLE.
 *
 *      Pricing convention:
 *        - MNT  : 18 decimals (native msg.value)
 *        - USDT0: 6 decimals
 *        - mntPriceUsd8 : MNT/USD with 8 decimals (e.g. $0.7234 = 72_340_000)
 */
contract MntCollateralVault is ReentrancyGuard, AccessControl {
    bytes32 public constant AGENT_ROLE  = keccak256("AGENT_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IERC20 public immutable usdt;

    /// @dev MNT/USD price with 8 decimals. Updated by ORACLE_ROLE.
    uint256 public mntPriceUsd8;
    /// @dev Last price update timestamp (sec).
    uint256 public mntPriceUpdatedAt;
    /// @dev Max age allowed for price (default 1h). If stale, borrow disabled.
    uint256 public maxPriceAgeSec = 3600;

    /// @dev Loan-to-value in basis points. 7000 = 70%.
    uint256 public ltvBps = 7000;
    /// @dev Liquidation threshold in basis points. 8000 = 80%.
    uint256 public liquidationLtvBps = 8000;

    struct Position {
        uint256 mntCollateral; // 18 decimals (wei)
        uint256 usdtDebt;      // 6 decimals
    }

    mapping(address => Position) public positions;

    /// @dev USDT0 reserves available to lend (admin pre-funds).
    uint256 public usdtReserves;

    event PriceUpdated(uint256 priceUsd8, uint256 timestamp);
    event ReservesFunded(address indexed funder, uint256 amount);
    event ReservesWithdrawn(address indexed to, uint256 amount);
    event Borrowed(address indexed user, uint256 mntLocked, uint256 usdtBorrowed, uint256 totalCollateral, uint256 totalDebt);
    event Repaid(address indexed user, uint256 amount, uint256 remainingDebt);
    event MntWithdrawn(address indexed user, uint256 amount, uint256 remainingCollateral);
    event Liquidated(address indexed user, uint256 mntSeized, uint256 debtCleared);
    event ParamsUpdated(uint256 ltvBps, uint256 liquidationLtvBps, uint256 maxPriceAgeSec);

    constructor(address _usdt, uint256 _initialPriceUsd8) {
        require(_usdt != address(0), "MCV: invalid USDT");
        require(_initialPriceUsd8 > 0, "MCV: invalid price");
        usdt = IERC20(_usdt);
        mntPriceUsd8 = _initialPriceUsd8;
        mntPriceUpdatedAt = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(AGENT_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }

    // ──────────────────────────────  Admin  ──────────────────────────────

    function setPrice(uint256 priceUsd8) external onlyRole(ORACLE_ROLE) {
        require(priceUsd8 > 0, "MCV: invalid price");
        mntPriceUsd8 = priceUsd8;
        mntPriceUpdatedAt = block.timestamp;
        emit PriceUpdated(priceUsd8, block.timestamp);
    }

    function setParams(uint256 _ltvBps, uint256 _liquidationLtvBps, uint256 _maxPriceAgeSec)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_ltvBps > 0 && _ltvBps < _liquidationLtvBps, "MCV: bad ltv");
        require(_liquidationLtvBps <= 9500, "MCV: liq too high");
        require(_maxPriceAgeSec >= 60, "MCV: maxAge too low");
        ltvBps = _ltvBps;
        liquidationLtvBps = _liquidationLtvBps;
        maxPriceAgeSec = _maxPriceAgeSec;
        emit ParamsUpdated(_ltvBps, _liquidationLtvBps, _maxPriceAgeSec);
    }

    /// @dev Admin pre-funds USDT0 reserves (must approve first).
    function fundReserves(uint256 amount) external nonReentrant {
        require(amount > 0, "MCV: zero");
        bool ok = usdt.transferFrom(msg.sender, address(this), amount);
        require(ok, "MCV: transfer failed");
        usdtReserves += amount;
        emit ReservesFunded(msg.sender, amount);
    }

    /// @dev Admin pulls USDT0 reserves out (only un-borrowed amount).
    function withdrawReserves(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount <= usdtReserves, "MCV: insufficient reserves");
        usdtReserves -= amount;
        bool ok = usdt.transfer(to, amount);
        require(ok, "MCV: transfer failed");
        emit ReservesWithdrawn(to, amount);
    }

    // ──────────────────────────────  User flow  ──────────────────────────

    /**
     * @dev Lock MNT and borrow USDT0 atomically.
     * @param usdtAmount Amount of USDT0 to borrow (6 decimals). Use 0 to lock without borrowing.
     */
    function borrow(uint256 usdtAmount) external payable nonReentrant {
        require(_priceFresh(), "MCV: price stale");
        require(msg.value > 0 || usdtAmount == 0, "MCV: must lock or skip borrow");

        Position storage p = positions[msg.sender];
        if (msg.value > 0) p.mntCollateral += msg.value;

        if (usdtAmount > 0) {
            require(usdtAmount <= usdtReserves, "MCV: insufficient reserves");
            uint256 newDebt = p.usdtDebt + usdtAmount;
            uint256 maxDebt = _maxBorrowable(p.mntCollateral);
            require(newDebt <= maxDebt, "MCV: exceeds LTV");

            p.usdtDebt = newDebt;
            usdtReserves -= usdtAmount;

            bool ok = usdt.transfer(msg.sender, usdtAmount);
            require(ok, "MCV: transfer failed");
        }

        emit Borrowed(msg.sender, msg.value, usdtAmount, p.mntCollateral, p.usdtDebt);
    }

    /**
     * @dev Repay outstanding USDT0 debt (full or partial).
     */
    function repay(uint256 amount) external nonReentrant {
        Position storage p = positions[msg.sender];
        require(p.usdtDebt > 0, "MCV: no debt");
        require(amount > 0, "MCV: zero");

        uint256 pay = amount > p.usdtDebt ? p.usdtDebt : amount;

        bool ok = usdt.transferFrom(msg.sender, address(this), pay);
        require(ok, "MCV: transfer failed");

        p.usdtDebt -= pay;
        usdtReserves += pay;

        emit Repaid(msg.sender, pay, p.usdtDebt);
    }

    /**
     * @dev Withdraw MNT collateral. Only if remaining collateral still covers remaining debt at LTV.
     */
    function withdrawMnt(uint256 amount) external nonReentrant {
        Position storage p = positions[msg.sender];
        require(amount > 0 && amount <= p.mntCollateral, "MCV: bad amount");

        uint256 remaining = p.mntCollateral - amount;
        if (p.usdtDebt > 0) {
            require(_priceFresh(), "MCV: price stale");
            require(p.usdtDebt <= _maxBorrowable(remaining), "MCV: would breach LTV");
        }

        p.mntCollateral = remaining;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "MCV: send MNT failed");

        emit MntWithdrawn(msg.sender, amount, remaining);
    }

    // ──────────────────────────────  Liquidation (agent)  ────────────────

    /**
     * @dev Liquidate underwater position. Agent (or anyone with AGENT_ROLE) calls.
     *      Seizes ALL MNT to msg.sender (liquidator) and clears the debt.
     *      Liquidator must repay the USDT0 debt first (transferFrom).
     */
    function liquidate(address user) external onlyRole(AGENT_ROLE) nonReentrant {
        require(_priceFresh(), "MCV: price stale");
        Position storage p = positions[user];
        require(p.usdtDebt > 0, "MCV: no debt");

        uint256 currentLtv = _currentLtvBps(p.mntCollateral, p.usdtDebt);
        require(currentLtv >= liquidationLtvBps, "MCV: not liquidatable");

        uint256 mntSeized = p.mntCollateral;
        uint256 debt = p.usdtDebt;

        // Liquidator covers the bad debt.
        bool ok = usdt.transferFrom(msg.sender, address(this), debt);
        require(ok, "MCV: liquidator transfer failed");

        p.mntCollateral = 0;
        p.usdtDebt = 0;
        usdtReserves += debt;

        (bool sent, ) = msg.sender.call{value: mntSeized}("");
        require(sent, "MCV: send MNT failed");

        emit Liquidated(user, mntSeized, debt);
    }

    // ──────────────────────────────  Views  ──────────────────────────────

    function maxBorrowable(address user) external view returns (uint256) {
        return _maxBorrowable(positions[user].mntCollateral);
    }

    function currentLtvBps(address user) external view returns (uint256) {
        return _currentLtvBps(positions[user].mntCollateral, positions[user].usdtDebt);
    }

    function getPosition(address user)
        external view returns (uint256 mntCollateral, uint256 usdtDebt, uint256 maxDebt, uint256 ltv)
    {
        Position storage p = positions[user];
        return (
            p.mntCollateral,
            p.usdtDebt,
            _maxBorrowable(p.mntCollateral),
            _currentLtvBps(p.mntCollateral, p.usdtDebt)
        );
    }

    function priceInfo() external view returns (uint256 price, uint256 updatedAt, bool fresh) {
        return (mntPriceUsd8, mntPriceUpdatedAt, _priceFresh());
    }

    // ──────────────────────────────  Internal  ───────────────────────────

    function _priceFresh() internal view returns (bool) {
        return block.timestamp - mntPriceUpdatedAt <= maxPriceAgeSec;
    }

    /**
     * @dev maxBorrow_USDT6 = mnt18 * priceUsd8 * ltvBps / 1e24
     *      Derivation: USD value (26 dec) / 1e20 → 6-dec USDT, then * ltv / 10000.
     */
    function _maxBorrowable(uint256 mnt18) internal view returns (uint256) {
        if (mnt18 == 0) return 0;
        return (mnt18 * mntPriceUsd8 * ltvBps) / 1e24;
    }

    function _currentLtvBps(uint256 mnt18, uint256 debt6) internal view returns (uint256) {
        if (mnt18 == 0) return debt6 > 0 ? type(uint256).max : 0;
        // collateralValue6 = mnt18 * priceUsd8 / 1e20
        uint256 collateralValue6 = (mnt18 * mntPriceUsd8) / 1e20;
        if (collateralValue6 == 0) return debt6 > 0 ? type(uint256).max : 0;
        return (debt6 * 10000) / collateralValue6;
    }

    // Accept incoming MNT only via borrow()
    receive() external payable {
        revert("MCV: use borrow()");
    }
}
