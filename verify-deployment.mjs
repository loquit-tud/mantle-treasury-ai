import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  chain: { id: 5000, rpcUrls: { default: { http: ['https://rpc.mantle.xyz'] } } },
  transport: http(),
});

const vaultAddress = '0x12d35721df28282720a8367ebc9dc0bfb66eb55a';

try {
  const code = await client.getBytecode({ address: vaultAddress });
  if (code === '0x') {
    console.log('❌ Vault NOT deployed at', vaultAddress);
  } else {
    console.log('✅ Vault deployed at', vaultAddress);
    console.log('   Contract bytecode length:', code.length);
  }
} catch (err) {
  console.error('Error:', err.message);
}
