/**
 * Agent Wallet Service — ethers.js-based wallet management for Mantle Network
 *
 * Single source of truth for wallet + DeFi protocol access.
 * Uses ethers.Wallet directly; compatible with Aurelius Finance (Aave V3 fork on Mantle)
 * and any other Aave V3-compatible lending protocol.
 */

import { ethers } from 'ethers';
import logger from '../utils/logger';

export interface WdkConfig {
  seedPhrase: string;
  rpcUrl: string;
  aavePoolAddress?: string;
}

/** Aave V3 pool ABI — compatible with Aurelius Finance, Lendle, and other Aave V3 forks */
const AAVE_V3_POOL_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
];

const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

/**
 * AaveLendingProtocol — thin wrapper around an Aave V3-compatible pool.
 * Works with Aurelius Finance, Lendle, and any Aave V3 fork on Mantle.
 */
class AaveLendingProtocol {
  private wallet: ethers.Wallet;
  private poolAddress: string;
  private provider: ethers.Provider;

  constructor(wallet: ethers.Wallet, poolAddress: string, provider: ethers.Provider) {
    this.wallet = wallet;
    this.poolAddress = poolAddress;
    this.provider = provider;
  }

  async getAccountData() {
    const pool = new ethers.Contract(this.poolAddress, AAVE_V3_POOL_ABI, this.provider);
    const data = await pool.getUserAccountData(this.wallet.address);
    return {
      totalCollateralBase: data.totalCollateralBase,
      totalDebtBase: data.totalDebtBase,
      availableBorrowsBase: data.availableBorrowsBase,
      healthFactor: data.healthFactor,
    };
  }

  async supply({ token, amount }: { token: string; amount: bigint }): Promise<{ hash: string }> {
    const signer = this.wallet.connect(this.provider as ethers.JsonRpcProvider);
    const pool = new ethers.Contract(this.poolAddress, AAVE_V3_POOL_ABI, signer);
    const tx = await pool.supply(token, amount, this.wallet.address, 0);
    await tx.wait();
    return { hash: tx.hash };
  }

  async withdraw({ token, amount }: { token: string; amount: bigint }): Promise<{ hash: string }> {
    const signer = this.wallet.connect(this.provider as ethers.JsonRpcProvider);
    const pool = new ethers.Contract(this.poolAddress, AAVE_V3_POOL_ABI, signer);
    const tx = await pool.withdraw(token, amount, this.wallet.address);
    await tx.wait();
    return { hash: tx.hash };
  }
}

/**
 * WalletAccount — wraps ethers.Wallet as agent wallet service.
 * Drop-in replacement: same getAddress() / sendTransaction() / getLendingProtocol() API.
 */
export class WalletAccount {
  private wallet: ethers.Wallet;
  private provider: ethers.Provider;
  readonly aavePoolAddress: string | undefined;

  constructor(wallet: ethers.Wallet, provider: ethers.Provider, aavePoolAddress?: string) {
    this.wallet = wallet;
    this.provider = provider;
    this.aavePoolAddress = aavePoolAddress;
  }

  getAddress(): Promise<string> {
    return Promise.resolve(this.wallet.address);
  }

  async sendTransaction(tx: { to: string; value: bigint; data: string }): Promise<{ hash: string }> {
    const signer = this.wallet.connect(this.provider as ethers.JsonRpcProvider);
    const response = await signer.sendTransaction({ to: tx.to, value: tx.value, data: tx.data });
    return { hash: response.hash };
  }

  /** ERC-20 approve — used before supplying to lending pools */
  async approve({ token, spender, amount }: { token: string; spender: string; amount: bigint }): Promise<{ hash: string }> {
    const signer = this.wallet.connect(this.provider as ethers.JsonRpcProvider);
    const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
    const tx = await erc20.approve(spender, amount);
    await tx.wait();
    return { hash: tx.hash };
  }

  /** getLendingProtocol — returns Aave V3-compatible protocol wrapper (Aurelius/Lendle) */
  getLendingProtocol(_name: string): AaveLendingProtocol | null {
    if (!this.aavePoolAddress) return null;
    return new AaveLendingProtocol(this.wallet, this.aavePoolAddress, this.provider);
  }

  /** getBridgeProtocol — cross-chain bridge not used; returns null */
  getBridgeProtocol(_name: string): null {
    logger.debug('Cross-chain bridge not configured');
    return null;
  }
}

export type WdkAccount = WalletAccount;

let walletInstance: WalletAccount | null = null;

/**
 * Initialize agent wallet from seed phrase.
 * Returns WalletAccount (backwards-compatible with WDK account interface).
 */
export async function initWdk(cfg: WdkConfig): Promise<WalletAccount> {
  if (walletInstance) return walletInstance;

  logger.info('Initializing agent wallet (Mantle Network)...');

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const hdWallet = ethers.HDNodeWallet.fromPhrase(cfg.seedPhrase);
  const wallet = new ethers.Wallet(hdWallet.privateKey);

  walletInstance = new WalletAccount(wallet, provider, cfg.aavePoolAddress);
  const address = await walletInstance.getAddress();
  logger.info(`Agent wallet ready: ${address}`);

  return walletInstance;
}

/**
 * Get the primary wallet account.
 * Backwards-compatible: callers that do getAccount(wdk) still work.
 */
export async function getAccount(wdk: WalletAccount): Promise<WalletAccount> {
  return wdk;
}

/**
 * Get Aave V3-compatible lending protocol (Aurelius / Lendle on Mantle).
 * Returns null if YIELD_POOL_ADDRESS / AAVE_POOL_ADDRESS not configured.
 */
export function getAaveLending(account: WdkAccount): AaveLendingProtocol | null {
  return account.getLendingProtocol('aave');
}

/**
 * getBridgeProtocol — not used on Mantle; always returns null.
 */
export function getBridgeProtocol(account: WdkAccount): null {
  return account.getBridgeProtocol('usdt0');
}

/**
 * Get the agent wallet address.
 */
export async function getWdkAddress(wdk: WalletAccount): Promise<string> {
  return wdk.getAddress();
}

/**
 * Tear down wallet (call on shutdown).
 */
export async function disposeWdk(): Promise<void> {
  walletInstance = null;
  logger.info('Agent wallet disposed');
}
