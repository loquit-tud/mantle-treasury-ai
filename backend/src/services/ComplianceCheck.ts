/**
 * ComplianceCheck — OFAC/sanctions screening for wallet addresses.
 *
 * Checks borrower addresses against known sanctioned addresses (OFAC SDN list).
 * Uses a local snapshot of sanctioned crypto addresses + optional live API.
 * Blocks borrowing for any address on the sanctions list.
 */

import logger from '../utils/logger';

const SANCTIONED_ADDRESSES: Set<string> = new Set([
  '0x8589427373d6d84e98730d7795d8f6f8731fda16',
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xdd4c48c0b24039969fc16d1cdf626eab821d3384',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1ef156b3df97a9616b1dcaf54bae3e0766',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfbba9',
  '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3',
  '0x910cb0adaa6dcf72f67c8d3228ad28c7e0c8e578',
  '0xa7e5d5a720f06526557c513402f2e6b5fa20b008',
  '0x7f367cc41522ce07553e823bf3be79a889debe1b',
  '0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a',
  '0x7db418b5d567a4e0e8c59ad71be1fce48f3e6107',
  '0x72a5843cc08275c8171e582972aa4fda8c397b2a',
  '0x7f19720a857f834696350e4af0e8ad32e0abdd5e',
  '0x9f4cda013e354b8fc285bf4b9a60460cee7f7ea9',
  '0x2f389ce8bd8ff92de3402ffce4691d17fc4f6535',
  '0x19aa5fe80d33a56d56c78e82ea5e50e5d80b4dff',
  '0xfec8a60023265364d066a1212fde3930f6ae9b7c',
]);

export interface ComplianceResult {
  address: string;
  sanctioned: boolean;
  source: string;
  checkedAt: number;
}

const complianceCache = new Map<string, ComplianceResult>();
const CACHE_TTL_MS = 3600_000; // 1 hour

/**
 * Screen an address against OFAC sanctioned addresses list.
 * Returns immediately from local list; no external API dependency.
 */
export function checkSanctions(address: string): ComplianceResult {
  const addr = address.toLowerCase();

  const cached = complianceCache.get(addr);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached;
  }

  const sanctioned = SANCTIONED_ADDRESSES.has(addr);

  const result: ComplianceResult = {
    address: addr,
    sanctioned,
    source: 'OFAC_SDN_CRYPTO',
    checkedAt: Date.now(),
  };

  if (sanctioned) {
    logger.warn('COMPLIANCE: Sanctioned address detected', { address: addr });
  }

  complianceCache.set(addr, result);
  return result;
}

/**
 * Batch check multiple addresses.
 */
export function checkSanctionsBatch(addresses: string[]): ComplianceResult[] {
  return addresses.map(checkSanctions);
}
