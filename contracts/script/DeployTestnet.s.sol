// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";
import "../CreditLine.sol";

/// @dev Minimal ERC20 mock for testnet (18 decimals like Mantle USDT)
contract MockUSDT {
    string public name = "Mock USDT";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract DeployTestnet is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockUSDT
        MockUSDT usdt = new MockUSDT();

        // 2. Mint 100k USDT to deployer for testing
        usdt.mint(deployer, 100_000 * 10**6);

        // 3. Deploy TreasuryVault (no Aave on testnet — use zero address)
        TreasuryVault vault = new TreasuryVault(address(usdt), address(0));

        // 4. Deploy CreditLine
        CreditLine credit = new CreditLine(address(usdt), address(vault));

        // 5. Grant roles to deployer (acts as agent for demo)
        vault.grantRole(vault.AGENT_ROLE(), deployer);
        vault.grantRole(vault.EXECUTOR_ROLE(), deployer);
        credit.grantRole(credit.AGENT_ROLE(), deployer);

        vm.stopBroadcast();

        console.log("=== Quorum Testnet Deployment ===");
        console.log("MockUSDT:     ", address(usdt));
        console.log("TreasuryVault:", address(vault));
        console.log("CreditLine:   ", address(credit));
        console.log("Deployer:     ", deployer);
        console.log("=================================");
    }
}
