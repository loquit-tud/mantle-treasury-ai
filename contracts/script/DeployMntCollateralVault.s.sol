// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../MntCollateralVault.sol";

/**
 * @dev Deploy MntCollateralVault on Mantle.
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY
 *   USDT_ADDRESS                (USDT0 on Mantle: 0x779Ded0c9e1022225f8E0630b35a9b54bE713736)
 *   AGENT_ADDRESS               (backend WDK signer — gets AGENT_ROLE + ORACLE_ROLE)
 *   INITIAL_MNT_PRICE_USD8      (e.g. 72340000 for $0.7234) — fetch from CoinGecko before deploy
 *
 * Run:
 *   forge script contracts/script/DeployMntCollateralVault.s.sol \
 *     --rpc-url https://rpc.mantle.xyz --broadcast -vvv
 */
contract DeployMntCollateralVault is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdt       = vm.envAddress("USDT_ADDRESS");
        address agent      = vm.envAddress("AGENT_ADDRESS");
        uint256 initPrice  = vm.envUint("INITIAL_MNT_PRICE_USD8");

        vm.startBroadcast(deployerPk);

        MntCollateralVault vault = new MntCollateralVault(usdt, initPrice);

        // Grant agent role to backend signer (price keeper + liquidator)
        vault.grantRole(vault.AGENT_ROLE(), agent);
        vault.grantRole(vault.ORACLE_ROLE(), agent);

        vm.stopBroadcast();

        console.log("MntCollateralVault:", address(vault));
        console.log("USDT0:             ", usdt);
        console.log("Agent (oracle):    ", agent);
        console.log("Initial price USD8:", initPrice);
        console.log("LTV (bps):         ", vault.ltvBps());
        console.log("Liq LTV (bps):     ", vault.liquidationLtvBps());
    }
}
