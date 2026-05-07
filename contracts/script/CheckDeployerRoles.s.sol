// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../TreasuryVault.sol";

contract CheckDeployerRoles is Script {
    address constant NEW_VAULT = 0x12D35721Df28282720a8367EBC9Dc0bfB66eB55A;

    function run() external view {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Vault:", NEW_VAULT);
        console.log("Deployer:", deployer);

        TreasuryVault vault = TreasuryVault(NEW_VAULT);

        bytes32 DEFAULT_ADMIN_ROLE = 0x0000000000000000000000000000000000000000000000000000000000000000;
        bytes32 AGENT_ROLE = keccak256("AGENT_ROLE");
        bytes32 GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
        bytes32 EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

        console.log("DEFAULT_ADMIN:", vault.hasRole(DEFAULT_ADMIN_ROLE, deployer));
        console.log("AGENT_ROLE:", vault.hasRole(AGENT_ROLE, deployer));
        console.log("GUARDIAN_ROLE:", vault.hasRole(GUARDIAN_ROLE, deployer));
        console.log("EXECUTOR_ROLE:", vault.hasRole(EXECUTOR_ROLE, deployer));
    }
}
