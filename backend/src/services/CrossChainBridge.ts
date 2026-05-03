/**
 * CrossChainBridge — WDK USDt0 bridge integration (LayerZero-based)
 *
 * Enables the Treasury Agent to:
 * 1. Compare yield opportunities across chains (Arbitrum, Ethereum, Polygon)
 * 2. Bridge USDt to the best-yield chain
 * 3. Supply on the remote chain
 * 4. Bridge profits back
 *
 * Uses @tetherto/wdk-protocol-bridge-usdt0-evm over LayerZero.
 */

import type { WdkAccount } from './wdk';
import EventBus from '../orchestrator/EventBus';
import logger from '../utils/logger';

// Supported chains for cross-chain yield (WDK bridge targets)
export type BridgeChain = 'ethereum' | 'arbitrum' | 'polygon';

export interface BridgeQuote {
  targetChain: BridgeChain;
  fee: string;       // bridge fee in wei
  bridgeFee: string;  // LayerZero fee in wei
}

export interface BridgeResult {
  hash: string;
  targetChain: BridgeChain;
  amount: string;   // raw amount
  fee: string;
  bridgeFee: string;
  timestamp: number;
}

export interface CrossChainYield {
  chain: BridgeChain;
  protocol: string;
  apy: number;
  bridgeCostUsd: number;  // estimated cost to bridge
}

export interface BridgeState {
  activeBridges: BridgeResult[];
  totalBridgedOut: string;         // total USDt bridged away from home chain
  totalBridgedBack: string;        // total USDt bridged back
  lastCrossChainScan: number;
  bestRemoteYield: CrossChainYield | null;
}

export interface ChainProtocolYield {
  chain: string;
  protocol: string;
  apy: number;
  pool: string;
}

export interface DemoShowcase {
  wallet: { address: string; usdtBalance: string; ethBalance: string };
  chains: ChainProtocolYield[];
  bridgeQuote: { targetChain: string; fee: string; bridgeFee: string } | null;
  decision: {
    localApy: number;
    bestRemoteApy: number;
    bestRemoteChain: string;
    apyAdvantage: number;
    minRequired: number;
    wouldBridge: boolean;
    reason: string;
  };
  infrastructure: {
    bridgeProtocol: string;
    oftContract: string;
    legacyMesh: string;
    layerZero: boolean;
    supportedChains: string[];
  };
  safetyCaps: {
    maxBridgeAmount: string;
    minBridgeAmount: string;
    minApyAdvantage: string;
  };
}

// Home chain is Arbitrum (where the vault lives)
const HOME_CHAIN: BridgeChain = 'arbitrum';

// Minimum APY advantage to justify bridging (accounts for bridge cost + risk)
const MIN_APY_ADVANTAGE = 1.5; // 1.5% higher APY needed to justify cross-chain

// Maximum amount to bridge in a single operation (safety cap)
const MAX_BRIDGE_AMOUNT = 500_000000n; // 500 USDt (6 decimals)

// Minimum amount worth bridging
const MIN_BRIDGE_AMOUNT = 1000n; // 0.001 USDt (allows testing with small balances)

export class CrossChainBridge {
  private wdkAccount: WdkAccount;
  private state: BridgeState;

  constructor(wdkAccount: WdkAccount) {
    this.wdkAccount = wdkAccount;
    this.state = {
      activeBridges: [],
      totalBridgedOut: '0',
      totalBridgedBack: '0',
      lastCrossChainScan: 0,
      bestRemoteYield: null,
    };
  }

  /**
   * Get bridge protocol handle from WDK account.
   * Returns null if not registered.
   */
  private getBridge() {
    try {
      return this.wdkAccount.getBridgeProtocol('usdt0');
    } catch {
      logger.warn('USDt0 bridge protocol not available');
      return null;
    }
  }

  /**
   * Quote a bridge operation — returns estimated fees without executing.
   */
  async quoteBridge(
    targetChain: BridgeChain,
    amount: bigint,
    recipient: string,
    token: string,
  ): Promise<BridgeQuote | null> {
    const bridge = this.getBridge();
    if (!bridge) return null;

    try {
      const quote = await bridge.quoteBridge({
        targetChain,
        recipient,
        token,
        amount,
      });

      return {
        targetChain,
        fee: quote.fee.toString(),
        bridgeFee: quote.bridgeFee.toString(),
      };
    } catch (err) {
      logger.error('Bridge quote failed', {
        targetChain,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Execute a bridge operation — sends USDt to target chain via LayerZero.
   */
  async bridge(
    targetChain: BridgeChain,
    amount: bigint,
    recipient: string,
    token: string,
  ): Promise<BridgeResult | null> {
    const bridgeProto = this.getBridge();
    if (!bridgeProto) return null;

    // Safety checks
    if (amount > MAX_BRIDGE_AMOUNT) {
      logger.warn('Bridge amount exceeds safety cap, reducing', {
        requested: amount.toString(),
        cap: MAX_BRIDGE_AMOUNT.toString(),
      });
      amount = MAX_BRIDGE_AMOUNT;
    }

    if (amount < MIN_BRIDGE_AMOUNT) {
      logger.info('Bridge amount below minimum threshold, skipping', {
        amount: amount.toString(),
        min: MIN_BRIDGE_AMOUNT.toString(),
      });
      return null;
    }

    try {
      // Quote first for logging
      const quote = await this.quoteBridge(targetChain, amount, recipient, token);
      logger.info('Bridge quote received', {
        targetChain,
        amount: amount.toString(),
        fee: quote?.fee,
        bridgeFee: quote?.bridgeFee,
      });

      // Execute bridge
      const result = await bridgeProto.bridge({
        targetChain,
        recipient,
        token,
        amount,
      });

      const bridgeResult: BridgeResult = {
        hash: result.hash,
        targetChain,
        amount: amount.toString(),
        fee: result.fee.toString(),
        bridgeFee: result.bridgeFee.toString(),
        timestamp: Date.now(),
      };

      // Update state
      this.state.activeBridges.push(bridgeResult);
      this.state.totalBridgedOut = (
        BigInt(this.state.totalBridgedOut) + amount
      ).toString();

      // Emit event
      EventBus.emitEvent('treasury:bridge_executed', 'treasury', {
        action: 'cross_chain_bridge',
        reasoning: `Bridged ${Number(amount) / 1e6} USDt to ${targetChain} via LayerZero (tx: ${result.hash}). Fee: ${Number(result.fee) / 1e18} ETH.`,
        data: bridgeResult,
        status: 'executed',
      });

      logger.info('Bridge executed successfully', {
        hash: result.hash,
        targetChain,
        amount: amount.toString(),
      });

      return bridgeResult;
    } catch (err) {
      logger.error('Bridge execution failed', {
        targetChain,
        amount: amount.toString(),
        error: err instanceof Error ? err.message : String(err),
      });

      EventBus.emitEvent('treasury:bridge_failed', 'treasury', {
        action: 'cross_chain_bridge',
        reasoning: `Bridge to ${targetChain} failed: ${err instanceof Error ? err.message : String(err)}`,
        data: { targetChain, amount: amount.toString() },
        status: 'failed',
      });

      return null;
    }
  }

  /**
   * Bridge USDt back to home chain (Arbitrum).
   */
  async bridgeBack(
    sourceChain: BridgeChain,
    amount: bigint,
    recipient: string,
    token: string,
  ): Promise<BridgeResult | null> {
    if (sourceChain === HOME_CHAIN) {
      logger.warn('Already on home chain, no bridge needed');
      return null;
    }

    const result = await this.bridge(HOME_CHAIN, amount, recipient, token);
    if (result) {
      this.state.totalBridgedBack = (
        BigInt(this.state.totalBridgedBack) + amount
      ).toString();

      EventBus.emitEvent('treasury:bridge_back', 'treasury', {
        action: 'cross_chain_bridge_back',
        reasoning: `Bridged ${Number(amount) / 1e6} USDt back from ${sourceChain} to ${HOME_CHAIN} (tx: ${result.hash}).`,
        data: { ...result, sourceChain },
        status: 'executed',
      });
    }
    return result;
  }

  /**
   * Evaluate cross-chain yield opportunities.
   * Compares local (Arbitrum) APY with remote chains.
   *
   * Returns the best remote yield if it beats local by MIN_APY_ADVANTAGE.
   */
  async evaluateCrossChainYield(
    localApy: number,
    walletAddress: string,
    usdtAddress: string,
  ): Promise<CrossChainYield | null> {
    const remoteChains: BridgeChain[] = ['ethereum', 'polygon'];
    const candidates: CrossChainYield[] = [];

    // Pre-check native ETH balance — if too low, skip on-chain quote to avoid
    // eth_estimateGas "insufficient funds" errors (LayerZero requires msg.value).
    let hasEnoughGas = false;
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
      const ethBal = await provider.getBalance(walletAddress);
      hasEnoughGas = ethBal > 50_000_000_000_000n; // > 0.00005 ETH (~$0.15)
      if (!hasEnoughGas) {
        logger.info('Low native ETH balance, skipping bridge quote (using estimate)', {
          ethBalance: ethBal.toString(),
        });
      }
    } catch {
      // If balance check fails, still attempt quote
      hasEnoughGas = true;
    }

    for (const chain of remoteChains) {
      try {
        // Estimate bridge cost by quoting a reference amount (100 USDt)
        // Skip on-chain quote if wallet has insufficient native ETH for gas
        let bridgeCostUsd = 5; // default estimate ~$5

        if (hasEnoughGas) {
          const refAmount = 100_000000n; // 100 USDt
          const quote = await this.quoteBridge(chain, refAmount, walletAddress, usdtAddress);
          bridgeCostUsd = quote ? Number(quote.bridgeFee) / 1e18 * 2500 : 5; // rough ETH→USD
        }

        // Fetch remote chain Aave APY
        // Note: This uses the WDK's registered protocol data when available.
        // In production, you'd query each chain's Aave pool separately.
        // For now, we use heuristic estimates + quote cost analysis.
        const remoteApy = await this.fetchRemoteApy(chain);

        if (remoteApy > 0) {
          candidates.push({
            chain,
            protocol: `Aave V3 (${chain})`,
            apy: remoteApy,
            bridgeCostUsd,
          });
        }
      } catch (err) {
        logger.debug(`Failed to evaluate ${chain} yield`, { err });
      }
    }

    this.state.lastCrossChainScan = Date.now();

    if (candidates.length === 0) {
      this.state.bestRemoteYield = null;
      return null;
    }

    // Find best candidate that beats local APY by enough margin
    const best = candidates.reduce((a, b) => a.apy > b.apy ? a : b);

    if (best.apy - localApy >= MIN_APY_ADVANTAGE) {
      this.state.bestRemoteYield = best;

      EventBus.emitEvent('treasury:cross_chain_opportunity', 'treasury', {
        action: 'cross_chain_yield_scan',
        reasoning: `Cross-chain scan: ${best.chain} offers ${best.apy}% APY (local: ${localApy}%). Advantage: +${(best.apy - localApy).toFixed(2)}% — bridge cost ~$${best.bridgeCostUsd.toFixed(2)}.`,
        data: { localApy, candidates, best },
        status: 'executed',
      });

      return best;
    }

    logger.info('No cross-chain advantage found', {
      localApy,
      bestRemote: best.apy,
      requiredAdvantage: MIN_APY_ADVANTAGE,
    });
    this.state.bestRemoteYield = null;
    return null;
  }

  /**
   * Fetch all protocol APYs for a remote chain (Aave V3 + Compound V3).
   * Returns array of { protocol, apy } — real on-chain queries only.
   */
  private async fetchRemoteProtocolApys(chain: BridgeChain): Promise<{ protocol: string; apy: number; pool: string }[]> {
    const results: { protocol: string; apy: number; pool: string }[] = [];
    const { ethers } = await import('ethers');

    const rpcEnv = chain === 'ethereum'
      ? process.env.ETHEREUM_RPC_URL
      : chain === 'polygon'
        ? process.env.POLYGON_RPC_URL
        : undefined;

    if (!rpcEnv) {
      logger.debug(`No RPC configured for ${chain}, skipping remote APY fetch`);
      return results;
    }

    const provider = new ethers.JsonRpcProvider(rpcEnv);

    // --- Aave V3 ---
    const aavePools: Record<string, string> = {
      ethereum: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    };
    const usdtAddresses: Record<string, string> = {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    };
    const aavePool = aavePools[chain];
    const usdt = usdtAddresses[chain];
    if (aavePool && usdt) {
      try {
        const poolAbi = [
          `function getReserveData(address asset) view returns (
            tuple(
              uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate,
              uint128 variableBorrowIndex, uint128 currentVariableBorrowRate,
              uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id,
              address aTokenAddress, address stableDebtTokenAddress,
              address variableDebtTokenAddress, address interestRateStrategyAddress,
              uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt
            ) data
          )`,
        ];
        const contract = new ethers.Contract(aavePool, poolAbi, provider);
        const data = await contract.getReserveData(usdt);
        const apy = Math.round(Number(data.currentLiquidityRate) / 1e25 * 100) / 100;
        if (apy > 0 && apy < 50) {
          results.push({ protocol: 'Aave V3', apy, pool: aavePool });
          logger.info(`Remote ${chain} Aave V3 USDt APY: ${apy}%`);
        }
      } catch (err) {
        logger.debug(`Failed to fetch ${chain} Aave V3 APY`, { err });
      }
    }

    // --- Compound V3 (Comet) ---
    // Compound V3 USDT Comet markets (mainnet)
    const compoundComets: Record<string, { comet: string; usdt: string }> = {
      ethereum: { comet: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840', usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
      polygon: { comet: '0xaeB318360f27748Acb200CE616E389A6C9409a07', usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
    };
    const cometCfg = compoundComets[chain];
    if (cometCfg) {
      try {
        const cometAbi = [
          'function getSupplyRate(uint256 utilization) view returns (uint64)',
          'function getUtilization() view returns (uint256)',
        ];
        const comet = new ethers.Contract(cometCfg.comet, cometAbi, provider);
        const utilization = await comet.getUtilization();
        const ratePerSec = Number(await comet.getSupplyRate(utilization));
        // Compound V3 rate is per-second, scaled by 1e18. APY = (1 + rate)^seconds_per_year - 1
        const secsPerYear = 365.25 * 24 * 3600;
        const apy = Math.round(((1 + ratePerSec / 1e18) ** secsPerYear - 1) * 100 * 100) / 100;
        if (apy > 0 && apy < 50) {
          results.push({ protocol: 'Compound V3', apy, pool: cometCfg.comet });
          logger.info(`Remote ${chain} Compound V3 USDt APY: ${apy}%`);
        }
      } catch (err) {
        logger.debug(`Failed to fetch ${chain} Compound V3 APY`, { err });
      }
    }

    return results;
  }

  /** Backward-compat: best APY across all protocols on a chain */
  private async fetchRemoteApy(chain: BridgeChain): Promise<number> {
    const protocols = await this.fetchRemoteProtocolApys(chain);
    if (protocols.length === 0) return 0;
    return Math.max(...protocols.map(p => p.apy));
  }

  /**
   * Get current bridge state (for dashboard / API).
   */
  getState(): BridgeState {
    return { ...this.state };
  }

  /**
   * Get summary for dashboard display.
   */
  getSummary(): {
    bridgesExecuted: number;
    totalBridgedOut: string;
    totalBridgedBack: string;
    bestRemoteYield: CrossChainYield | null;
    lastScan: number;
  } {
    return {
      bridgesExecuted: this.state.activeBridges.length,
      totalBridgedOut: this.state.totalBridgedOut,
      totalBridgedBack: this.state.totalBridgedBack,
      bestRemoteYield: this.state.bestRemoteYield,
      lastScan: this.state.lastCrossChainScan,
    };
  }

  /**
   * Full demonstration showcase — queries everything live:
   * wallet balance, APY per chain, bridge quote, decision logic.
   * Designed for hackathon jury to verify the full cross-chain pipeline.
   */
  async demoShowcase(
    walletAddress: string,
    usdtAddress: string,
  ): Promise<DemoShowcase> {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');

    // 1. Wallet balances (live on-chain)
    const erc20 = new ethers.Contract(usdtAddress, [
      'function balanceOf(address) view returns (uint256)',
    ], provider);
    const [usdtBal, ethBal] = await Promise.all([
      erc20.balanceOf(walletAddress) as Promise<bigint>,
      provider.getBalance(walletAddress),
    ]);

    // 2. APY per chain × protocol (real on-chain Aave V3 + Compound V3 queries)
    const chains: ChainProtocolYield[] = [];

    // Arbitrum (local) — Aave V3
    try {
      const arbPool = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
      const poolAbi = [
        `function getReserveData(address asset) view returns (
          tuple(
            uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate,
            uint128 variableBorrowIndex, uint128 currentVariableBorrowRate,
            uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id,
            address aTokenAddress, address stableDebtTokenAddress,
            address variableDebtTokenAddress, address interestRateStrategyAddress,
            uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt
          ) data
        )`,
      ];
      const arbAave = new ethers.Contract(arbPool, poolAbi, provider);
      const arbData = await arbAave.getReserveData(usdtAddress);
      const arbApy = Math.round(Number(arbData.currentLiquidityRate) / 1e25 * 100) / 100;
      chains.push({ chain: 'arbitrum', protocol: 'Aave V3', apy: arbApy, pool: arbPool });
    } catch {
      chains.push({ chain: 'arbitrum', protocol: 'Aave V3', apy: 0, pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' });
    }

    // Arbitrum — Compound V3
    try {
      const arbComet = '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07';
      const cometAbi = [
        'function getSupplyRate(uint256 utilization) view returns (uint64)',
        'function getUtilization() view returns (uint256)',
      ];
      const comet = new ethers.Contract(arbComet, cometAbi, provider);
      const util = await comet.getUtilization();
      const ratePerSec = Number(await comet.getSupplyRate(util));
      const secsPerYear = 365.25 * 24 * 3600;
      const arbCompApy = Math.round(((1 + ratePerSec / 1e18) ** secsPerYear - 1) * 100 * 100) / 100;
      chains.push({ chain: 'arbitrum', protocol: 'Compound V3', apy: arbCompApy, pool: arbComet });
    } catch {
      chains.push({ chain: 'arbitrum', protocol: 'Compound V3', apy: 0, pool: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07' });
    }

    // Remote chains (Ethereum, Polygon) — both protocols
    for (const chain of ['ethereum', 'polygon'] as BridgeChain[]) {
      const protocols = await this.fetchRemoteProtocolApys(chain);
      if (protocols.length > 0) {
        for (const p of protocols) {
          chains.push({ chain, protocol: p.protocol, apy: p.apy, pool: p.pool });
        }
      } else {
        chains.push({ chain, protocol: 'Aave V3', apy: 0, pool: '' });
      }
    }

    // 3. Bridge quote (uses real LayerZero quoteSend — no min amount check)
    let bridgeQuote: DemoShowcase['bridgeQuote'] = null;
    try {
      const quote = await this.quoteBridge('ethereum', 1_000000n, walletAddress, usdtAddress);
      if (quote) {
        bridgeQuote = { targetChain: quote.targetChain, fee: quote.fee, bridgeFee: quote.bridgeFee };
      }
    } catch { /* quote may fail if balance too low — that's ok for demo */ }

    // 4. Decision logic — best local APY across all Arbitrum protocols
    const localCandidates = chains.filter(c => c.chain === 'arbitrum' && c.apy > 0);
    const localApy = localCandidates.length > 0
      ? Math.max(...localCandidates.map(c => c.apy))
      : 0;
    const remoteCandidates = chains.filter(c => c.chain !== 'arbitrum' && c.apy > 0);
    const best = remoteCandidates.length > 0
      ? remoteCandidates.reduce((a, b) => a.apy > b.apy ? a : b)
      : null;
    const advantage = best ? best.apy - localApy : 0;
    const wouldBridge = advantage >= MIN_APY_ADVANTAGE && usdtBal >= MIN_BRIDGE_AMOUNT;

    let reason: string;
    if (!best) reason = 'No remote chain APY data available';
    else if (advantage < MIN_APY_ADVANTAGE) reason = `APY advantage (${advantage.toFixed(2)}%) below minimum threshold (${MIN_APY_ADVANTAGE}%). Best remote: ${best.protocol} on ${best.chain} at ${best.apy}%, best local: ${localApy}%`;
    else if (usdtBal < MIN_BRIDGE_AMOUNT) reason = `Wallet balance (${ethers.formatUnits(usdtBal, 6)} USDt) below min bridge amount (${ethers.formatUnits(MIN_BRIDGE_AMOUNT, 6)} USDt)`;
    else reason = `Would bridge to ${best.chain} (${best.protocol}) for +${advantage.toFixed(2)}% APY advantage`;

    return {
      wallet: {
        address: walletAddress,
        usdtBalance: ethers.formatUnits(usdtBal, 6),
        ethBalance: ethers.formatEther(ethBal),
      },
      chains,
      bridgeQuote,
      decision: {
        localApy,
        bestRemoteApy: best?.apy ?? 0,
        bestRemoteChain: best ? `${best.chain} (${best.protocol})` : 'none',
        apyAdvantage: Math.round(advantage * 100) / 100,
        minRequired: MIN_APY_ADVANTAGE,
        wouldBridge,
        reason,
      },
      infrastructure: {
        bridgeProtocol: 'LayerZero USDt0 OFT (via WDK)',
        oftContract: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92',
        legacyMesh: '0x238A52455a1EF6C987CaC94b28B4081aFE50ba06',
        layerZero: true,
        supportedChains: ['ethereum', 'polygon', 'arbitrum', 'berachain', 'ink', 'ton', 'tron'],
      },
      safetyCaps: {
        maxBridgeAmount: `${Number(MAX_BRIDGE_AMOUNT) / 1e6} USDt`,
        minBridgeAmount: `${Number(MIN_BRIDGE_AMOUNT) / 1e6} USDt`,
        minApyAdvantage: `${MIN_APY_ADVANTAGE}%`,
      },
    };
  }
}
