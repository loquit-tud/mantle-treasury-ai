/**
 * MntCollateralVault helper service.
 * - Read-only views (positions, price info, params)
 * - Price keeper: fetches MNT/USD from CoinGecko every N minutes and pushes to setPrice()
 *
 * The contract uses USD price with 8 decimals (Chainlink convention).
 */

import { ethers } from 'ethers';
import logger from '../utils/logger';

const MNT_VAULT_ABI = [
  'function setPrice(uint256 priceUsd8) external',
  'function fundReserves(uint256 amount) external',
  'function priceInfo() view returns (uint256 price, uint256 updatedAt, bool fresh)',
  'function getPosition(address user) view returns (uint256 mntCollateral, uint256 usdtDebt, uint256 maxDebt, uint256 ltv)',
  'function ltvBps() view returns (uint256)',
  'function liquidationLtvBps() view returns (uint256)',
  'function maxPriceAgeSec() view returns (uint256)',
  'function usdtReserves() view returns (uint256)',
];

export interface MntVaultPosition {
  mntCollateral: string; // wei
  usdtDebt: string;      // 6-dec
  maxDebt: string;       // 6-dec
  ltvBps: string;        // 0-10000
}

export interface MntVaultStatus {
  address: string;
  priceUsd8: string;
  priceUsd: number;
  priceUpdatedAt: number;
  priceFresh: boolean;
  ltvBps: number;
  liquidationLtvBps: number;
  maxPriceAgeSec: number;
  usdtReserves: string;
}

export class MntVaultService {
  private contract: ethers.Contract;
  private writeContract: ethers.Contract;
  private interval?: NodeJS.Timeout;

  constructor(
    public readonly address: string,
    provider: ethers.Provider,
    signer: ethers.Signer,
  ) {
    this.contract = new ethers.Contract(address, MNT_VAULT_ABI, provider);
    this.writeContract = new ethers.Contract(address, MNT_VAULT_ABI, signer);
  }

  /** Fetch MNT/USD price from CoinGecko, return USD8 (uint with 8 decimals). */
  static async fetchMntPriceUsd8(): Promise<{ priceUsd: number; priceUsd8: bigint }> {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=mantle&vs_currencies=usd');
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = (await res.json()) as { mantle?: { usd?: number } };
    const priceUsd = data?.mantle?.usd;
    if (typeof priceUsd !== 'number' || priceUsd <= 0) {
      throw new Error('CoinGecko returned no MNT price');
    }
    // 8 decimals (Chainlink convention)
    const priceUsd8 = BigInt(Math.floor(priceUsd * 1e8));
    return { priceUsd, priceUsd8 };
  }

  /** Push fresh price to the contract. */
  async pushPrice(): Promise<{ hash: string; priceUsd: number }> {
    const { priceUsd, priceUsd8 } = await MntVaultService.fetchMntPriceUsd8();
    const tx = await this.writeContract.setPrice(priceUsd8);
    const receipt = await tx.wait();
    logger.info(`[mnt-vault] setPrice($${priceUsd.toFixed(4)}) tx=${receipt.hash}`);
    return { hash: receipt.hash, priceUsd };
  }

  /** Start a recurring price keeper. */
  startPriceKeeper(intervalMs: number = 5 * 60_000): void {
    if (this.interval) return;
    // Fire-and-forget initial push (non-blocking)
    void this.pushPrice().catch((err) => {
      logger.warn(`[mnt-vault] initial price push failed: ${err.message}`);
    });
    this.interval = setInterval(() => {
      void this.pushPrice().catch((err) => {
        logger.warn(`[mnt-vault] price push failed: ${err.message}`);
      });
    }, intervalMs);
    this.interval.unref();
    logger.info(`[mnt-vault] price keeper started (every ${intervalMs / 1000}s) for ${this.address}`);
  }

  stopPriceKeeper(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  async getStatus(): Promise<MntVaultStatus> {
    const [priceInfo, ltvBps, liqBps, maxAge, reserves] = await Promise.all([
      this.contract.priceInfo(),
      this.contract.ltvBps(),
      this.contract.liquidationLtvBps(),
      this.contract.maxPriceAgeSec(),
      this.contract.usdtReserves(),
    ]);
    const priceUsd8 = BigInt(priceInfo[0]);
    return {
      address: this.address,
      priceUsd8: priceUsd8.toString(),
      priceUsd: Number(priceUsd8) / 1e8,
      priceUpdatedAt: Number(priceInfo[1]),
      priceFresh: Boolean(priceInfo[2]),
      ltvBps: Number(ltvBps),
      liquidationLtvBps: Number(liqBps),
      maxPriceAgeSec: Number(maxAge),
      usdtReserves: BigInt(reserves).toString(),
    };
  }

  async getPosition(user: string): Promise<MntVaultPosition> {
    const p = await this.contract.getPosition(user);
    return {
      mntCollateral: BigInt(p[0]).toString(),
      usdtDebt: BigInt(p[1]).toString(),
      maxDebt: BigInt(p[2]).toString(),
      ltvBps: BigInt(p[3]).toString(),
    };
  }
}
