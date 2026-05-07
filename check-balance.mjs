import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  chain: { id: 5000, rpcUrls: { default: { http: ['https://rpc.mantle.xyz'] } } },
  transport: http(),
});

const USDT = '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE';
const vault = '0x4bEb9C28861cE1517B0B682cF9cFdeAc6795818a';

// Read USDT balance
const result = await client.call({
  account: vault,
  to: USDT,
  data: '0x70a08231' + ('000000000000000000000000' + vault.slice(2)).slice(-40),
});

if (result.data) {
  const balance = BigInt(result.data);
  console.log('USDT balance of vault:', balance.toString(), 'wei');
  console.log('USDT balance (6 decimals):', Number(balance) / 1e6);
} else {
  console.log('Result:', result);
}
