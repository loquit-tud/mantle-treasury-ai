// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}

contract CheckState is Script {
    function run() external view {
        address OLD_VAULT = 0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a;
        address NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;
        address USDT = 0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE;
        address USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;

        IERC20 usdt = IERC20(USDT);
        IERC20 usdt0 = IERC20(USDT0);

        console.log("=== Vault State ===");
        console.log("Old vault USDT:", usdt.balanceOf(OLD_VAULT));
        console.log("Old vault USDT0:", usdt0.balanceOf(OLD_VAULT));
        console.log("New vault USDT:", usdt.balanceOf(NEW_VAULT));
        console.log("New vault USDT0:", usdt0.balanceOf(NEW_VAULT));
        console.log("");
        console.log("Old vault =", OLD_VAULT);
        console.log("New vault =", NEW_VAULT);
    }
}
