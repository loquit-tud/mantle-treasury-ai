/**
 * Shared write-transaction helper used by both TreasuryAgent and CreditAgent.
 * Primary path: WalletAccount (ethers.Wallet-backed).
 * Fallback: DEPLOYER_PRIVATE_KEY.
 */

import { ethers } from 'ethers';
import type { WdkAccount } from './wdk';
import logger from '../utils/logger';

export async function sendWriteTx(
  provider: ethers.Provider,
  privateKey: string | undefined,
  wdkAccount: WdkAccount,
  to: string,
  data: string,
  label: string,
): Promise<string> {
  // Primary path: agent wallet (ethers.Wallet-backed WalletAccount)
  try {
    const result = await wdkAccount.sendTransaction({ to, value: 0n, data });
    const hash = result.hash;
    logger.info(`[wallet] ${label} succeeded`, { hash });
    return hash;
  } catch (walletErr) {
    logger.warn(`[wallet] ${label} failed, falling back to DEPLOYER_PRIVATE_KEY`, {
      error: walletErr instanceof Error ? walletErr.message : String(walletErr),
    });
  }

  // Fallback: deployer private key
  if (privateKey) {
    const signer = new ethers.Wallet(privateKey, provider as ethers.JsonRpcProvider);
    const tx = await signer.sendTransaction({ to, data });
    const receipt = await tx.wait();
    const hash = receipt!.hash;
    logger.info(`[deployer-fallback] ${label} succeeded`, { hash });
    return hash;
  }

  throw new Error(`${label}: transaction failed — no wallet available`);
}
