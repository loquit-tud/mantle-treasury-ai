/**
 * WDK Service — Tether Wallet Development Kit integration
 *
 * Single source of truth for wallet + DeFi protocol access.
 * All agent code should use this service, never ethers.Wallet directly.
 */

import WDK from '@tetherto/wdk';
import type { IWalletAccountWithProtocols } from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import LendingAaveEvm from '@tetherto/wdk-protocol-lending-aave-evm';
// @ts-expect-error — bridge module ships types under /types/ but moduleResolution:node can't find them
import Usdt0BridgeEvm from '@tetherto/wdk-protocol-bridge-usdt0-evm';
import logger from '../utils/logger';

export interface WdkConfig {
  seedPhrase: string;
  rpcUrl: string;
  aavePoolAddress?: string;
  /** Optional: Ethereum mainnet RPC for cross-chain bridge */
  ethereumRpcUrl?: string;
  /** Optional: Polygon RPC for cross-chain bridge */
  polygonRpcUrl?: string;
  /** Max fee for bridge operations (LayerZero fee cap, in wei). Default: 0.01 ETH */
  bridgeMaxFee?: bigint;
}

export type WdkAccount = IWalletAccountWithProtocols;

let wdkInstance: WDK | null = null;

/**
 * Initialize WDK with seed phrase and register wallet + protocols.
 * Call once at startup.
 */
export async function initWdk(cfg: WdkConfig): Promise<WDK> {
  if (wdkInstance) return wdkInstance;

  logger.info('Initializing WDK...');

  const wdk = new WDK(cfg.seedPhrase);

  // Register EVM wallet — config key is `provider` (not rpcUrl), per WDK docs.
  // Chain ID is auto-detected from the RPC endpoint.
  wdk.registerWallet('ethereum', WalletManagerEvm, {
    provider: cfg.rpcUrl,
  });

  // Register Aave V3 lending protocol.
  // AaveProtocolEvm resolves the pool address internally from chain ID,
  // so no config is needed (constructor takes only account).
  wdk.registerProtocol('ethereum', 'aave', LendingAaveEvm, undefined as never);

  // Register USDt0 bridge protocol (LayerZero-based cross-chain bridging).
  // Allows bridging USDt between Arbitrum, Ethereum, and Polygon.
  const bridgeMaxFee = cfg.bridgeMaxFee ?? 10_000_000_000_000_000n; // 0.01 ETH default
  wdk.registerProtocol('ethereum', 'usdt0', Usdt0BridgeEvm, { bridgeMaxFee });
  logger.info('USDt0 bridge protocol registered (LayerZero)', { bridgeMaxFee: bridgeMaxFee.toString() });

  wdkInstance = wdk;

  // Log wallet address
  const account = await wdk.getAccount('ethereum', 0);
  const address = await account.getAddress();
  logger.info(`WDK wallet ready: ${address}`);

  return wdk;
}

/**
 * Get the primary EVM account (index 0).
 */
export async function getAccount(wdk: WDK): Promise<WdkAccount> {
  return wdk.getAccount('ethereum', 0);
}

/**
 * Get the Aave lending protocol handle from an account.
 * Returns null if Aave was not registered.
 */
export function getAaveLending(account: WdkAccount) {
  try {
    return account.getLendingProtocol('aave');
  } catch {
    logger.warn('Aave lending protocol not available');
    return null;
  }
}

/**
 * Get the USDt0 bridge protocol handle from an account.
 * Returns null if bridge was not registered.
 */
export function getBridgeProtocol(account: WdkAccount) {
  try {
    return account.getBridgeProtocol('usdt0');
  } catch {
    logger.warn('USDt0 bridge protocol not available');
    return null;
  }
}

/**
 * Get the WDK-derived address for the primary account.
 */
export async function getWdkAddress(wdk: WDK): Promise<string> {
  const account = await wdk.getAccount('ethereum', 0);
  return account.getAddress();
}

/**
 * Tear down WDK (call on shutdown).
 */
export async function disposeWdk(): Promise<void> {
  if (wdkInstance) {
    wdkInstance.dispose();
    wdkInstance = null;
    logger.info('WDK disposed');
  }
}
