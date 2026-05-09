/**
 * Recover USDT0 from 0xb527... and 0x618b...
 * Deployer (0x286114...) has DEFAULT_ADMIN_ROLE on 0xb527
 */
const { ethers } = require('ethers');
require('dotenv').config();

const RPC      = process.env.RPC_URL || 'https://rpc.mantle.xyz';
const PK       = process.env.DEPLOYER_PRIVATE_KEY;
const USDT0    = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
const AAVE     = process.env.AAVE_POOL_ADDRESS || '0x458F293454fE0d67EC0655f3672301301DD51422';
const VAULT_B  = '0xb52718aec4bc8459ac97a276cb2d0798b25b17f0'; // 0xb527...
const VAULT_618= '0x618bfab3091f99c2476d34d803576c0b9e46acb8';
const DEPLOYER = '0x286114B674ad891640AaaBCC37C5F18116104CC9';
const USER     = '0x607Fc9D41858Aa23065275043698a9262F8f9bf9';
const TARGET   = USER; // trimitem banii înapoi la utilizator

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const AAVE_ABI = [
  'function getReserveData(address) view returns (uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
];
const VAULT_ABI = [
  // TreasuryVault functions
  'function emergencyWithdrawToken(address token, address to, uint256 amount) external',
  'function drainAll() external',
  'function pause() external',
  'function unpause() external',
  'function paused() view returns (bool)',
  'function getBalance() view returns (uint256)',
  'function owner() view returns (address)',
  // Generic admin/rescue
  'function rescueToken(address token, address to, uint256 amount) external',
  'function withdraw(address token, address to, uint256 amount) external',
  'function withdrawToken(address token, uint256 amount) external',
  'function transfer(address token, address to, uint256 amount) external',
  'function emergencyExit(address token, address to) external',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const deployer = new ethers.Wallet(PK, provider);
  const token    = new ethers.Contract(USDT0, ERC20_ABI, provider);

  console.log(`Deployer: ${deployer.address}`);
  const gas = await provider.getFeeData();
  console.log(`Gas price: ${ethers.formatUnits(gas.gasPrice || 0n, 'gwei')} gwei\n`);

  // --- Check aToken balances ---
  const pool = new ethers.Contract(AAVE, AAVE_ABI, provider);
  let aTokenAddr = null;
  try {
    const reserve = await pool.getReserveData(USDT0);
    aTokenAddr = reserve[8]; // aTokenAddress is index 8
    console.log(`aUSDT0 address: ${aTokenAddr}`);
    const aToken = new ethers.Contract(aTokenAddr, ERC20_ABI, provider);
    const balB   = await aToken.balanceOf(VAULT_B);
    const bal618 = await aToken.balanceOf(VAULT_618);
    const balDep = await aToken.balanceOf(DEPLOYER);
    console.log(`aUSDT0 in 0xb527: ${ethers.formatUnits(balB, 6)}`);
    console.log(`aUSDT0 in 0x618b: ${ethers.formatUnits(bal618, 6)}`);
    console.log(`aUSDT0 in Deployer: ${ethers.formatUnits(balDep, 6)}`);
  } catch (e) {
    console.log('Nu am putut citi aToken:', e.message);
  }

  // --- USDT0 direct balances ---
  const directB   = await token.balanceOf(VAULT_B);
  const direct618 = await token.balanceOf(VAULT_618);
  const directDep = await token.balanceOf(DEPLOYER);
  console.log(`\nUSDT0 direct in 0xb527: ${ethers.formatUnits(directB, 6)}`);
  console.log(`USDT0 direct in 0x618b: ${ethers.formatUnits(direct618, 6)}`);
  console.log(`USDT0 direct in Deployer: ${ethers.formatUnits(directDep, 6)}\n`);

  // --- Try to recover from VAULT_B (0xb527) ---
  if (directB > 0n) {
    console.log(`\n=== Încerc să recuperez ${ethers.formatUnits(directB, 6)} USDT0 din 0xb527... ===`);
    const vault = new ethers.Contract(VAULT_B, VAULT_ABI, deployer);

    const tryFn = async (name, fn) => {
      try {
        console.log(`  Încerc ${name}...`);
        const tx = await fn();
        console.log(`  Trimis: ${tx.hash}`);
        const rc = await tx.wait();
        console.log(`  ✅ Succes! Block: ${rc.blockNumber}`);
        return true;
      } catch (e) {
        console.log(`  ❌ Eșuat: ${e.reason || e.message?.slice(0,80)}`);
        return false;
      }
    };

    let ok = false;

    // Try emergencyWithdrawToken
    if (!ok) ok = await tryFn('emergencyWithdrawToken(USDT0, USER, all)', () =>
      vault.emergencyWithdrawToken(USDT0, TARGET, directB, { gasLimit: 200000 }));

    // Try rescueToken
    if (!ok) ok = await tryFn('rescueToken(USDT0, USER, all)', () =>
      vault.rescueToken(USDT0, TARGET, directB, { gasLimit: 200000 }));

    // Try withdraw(token, to, amount)
    if (!ok) ok = await tryFn('withdraw(USDT0, USER, all)', () =>
      vault.withdraw(USDT0, TARGET, directB, { gasLimit: 200000 }));

    // Try withdrawToken
    if (!ok) ok = await tryFn('withdrawToken(USDT0, all)', () =>
      vault.withdrawToken(USDT0, directB, { gasLimit: 200000 }));

    // Try transfer(token, to, amount)
    if (!ok) ok = await tryFn('transfer(USDT0, USER, all)', () =>
      vault.transfer(USDT0, TARGET, directB, { gasLimit: 200000 }));

    // Try emergencyExit
    if (!ok) ok = await tryFn('emergencyExit(USDT0, USER)', () =>
      vault.emergencyExit(USDT0, TARGET, { gasLimit: 200000 }));

    if (!ok) console.log('\n⚠️  Nu am putut extrage din 0xb527 prin funcții standard.');
  }

  // --- Try to recover aTokens via Aave withdraw (if 0xb527 has aToken balance) ---
  if (aTokenAddr) {
    const aToken = new ethers.Contract(aTokenAddr, ERC20_ABI, provider);
    const aBalB  = await aToken.balanceOf(VAULT_B);
    if (aBalB > 0n) {
      console.log(`\n=== Încerc Aave withdraw din 0xb527 (${ethers.formatUnits(aBalB, 6)} aUSDT0) ===`);
      const vault = new ethers.Contract(VAULT_B, [...VAULT_ABI, 'function withdrawFromAave(address asset, uint256 amount) external', 'function harvestYield() external'], deployer);
      
      const tryFn = async (name, fn) => {
        try {
          console.log(`  Încerc ${name}...`);
          const tx = await fn();
          console.log(`  Trimis: ${tx.hash}`);
          const rc = await tx.wait();
          console.log(`  ✅ Succes! Block: ${rc.blockNumber}`);
          return true;
        } catch (e) {
          console.log(`  ❌ Eșuat: ${e.reason || e.message?.slice(0,80)}`);
          return false;
        }
      };

      await tryFn('withdrawFromAave(USDT0, all)', () =>
        vault.withdrawFromAave(USDT0, aBalB, { gasLimit: 300000 }));
      await tryFn('harvestYield()', () =>
        vault.harvestYield({ gasLimit: 300000 }));
    }
  }

  // --- Final balances ---
  console.log('\n--- Balanțe finale ---');
  console.log(`0xb527: ${ethers.formatUnits(await token.balanceOf(VAULT_B), 6)} USDT0`);
  console.log(`0x618b: ${ethers.formatUnits(await token.balanceOf(VAULT_618), 6)} USDT0`);
  console.log(`Deployer: ${ethers.formatUnits(await token.balanceOf(DEPLOYER), 6)} USDT0`);
  console.log(`TU (${USER}): ${ethers.formatUnits(await token.balanceOf(USER), 6)} USDT0`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
