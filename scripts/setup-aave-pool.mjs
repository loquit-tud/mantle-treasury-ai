// Script to setup Aave V3 pool on deployed TreasuryVault
// Run: node scripts/setup-aave-pool.mjs
import { ethers } from 'ethers';
import 'dotenv/config';

const AAVE_POOL = '0x458F293454fE0d67EC0655f3672301301DD51422'; // Aave V3 on Mantle (from bgd-labs/aave-address-book)

const VAULT_ABI = [
  'function setAavePool(address _pool) external',
  'function setProtocolAllowed(address protocol, bool allowed) external',
  'function aavePool() view returns (address)',
  'function allowedProtocols(address) view returns (bool)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const vault = new ethers.Contract(process.env.TREASURY_VAULT_ADDRESS, VAULT_ABI, signer);

  console.log('Deployer:', signer.address);
  console.log('TreasuryVault:', process.env.TREASURY_VAULT_ADDRESS);
  console.log('Aave V3 Pool:', AAVE_POOL);

  // Check current state
  const currentPool = await vault.aavePool();
  const isAllowed = await vault.allowedProtocols(AAVE_POOL);
  console.log('\nCurrent aavePool:', currentPool);
  console.log('Protocol allowed:', isAllowed);

  if (currentPool.toLowerCase() === AAVE_POOL.toLowerCase()) {
    console.log('\n✓ Pool already set correctly');
  } else {
    console.log('\nSetting aavePool...');
    const tx1 = await vault.setAavePool(AAVE_POOL);
    await tx1.wait();
    console.log('✓ setAavePool tx:', tx1.hash);
  }

  if (!isAllowed) {
    console.log('Setting protocol allowed...');
    const tx2 = await vault.setProtocolAllowed(AAVE_POOL, true);
    await tx2.wait();
    console.log('✓ setProtocolAllowed tx:', tx2.hash);
  } else {
    console.log('✓ Protocol already allowed');
  }

  // Verify
  const finalPool = await vault.aavePool();
  const finalAllowed = await vault.allowedProtocols(AAVE_POOL);
  console.log('\nFinal state:');
  console.log('  aavePool:', finalPool);
  console.log('  protocol allowed:', finalAllowed);
}

main().catch(e => { console.error(e); process.exit(1); });
