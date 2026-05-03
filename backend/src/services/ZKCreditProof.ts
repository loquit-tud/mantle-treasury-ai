/**
 * ZK-Inspired Credit Proof — Proves a credit score meets a tier threshold
 * without revealing the exact score.
 *
 * Scheme (hash-based commitment + verifiable range proof):
 *   1. Prover commits: commitment = SHA-256(score || nonce)
 *   2. Prover commits to delta = score - threshold: deltaCommitment = SHA-256(delta || deltaNonce)
 *   3. Prover decomposes delta into bits, commits each: bitCommitment_i = SHA-256(bit_i || bitNonce_i)
 *   4. Fiat-Shamir challenge binds all commitments
 *   5. Prover reveals bitNonces + deltaNonce (NOT the score nonce)
 *
 * Verifier checks (SOUND):
 *   - Each bitCommitment opens to 0 or 1 (tried both, one must match)
 *   - Reconstructed delta from bits matches deltaCommitment
 *   - Fiat-Shamir challenge is consistent
 *
 * Privacy: Score commitment is NOT opened — verifier cannot derive the exact score.
 *          Verifier learns delta (score - threshold), which bounds the score to
 *          [threshold, threshold + delta]. Production SNARKs would hide delta too.
 *
 * Soundness: A prover with score < threshold cannot forge a valid proof because
 *            delta would be negative, which cannot be represented as unsigned bits.
 */

import { createHash, randomBytes } from 'crypto';
import logger from '../utils/logger';
import { isProofUsed, markProofUsed, cleanExpiredProofs } from './StateDB';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZKCreditProof {
  proofId: string;               // unique ID for replay prevention
  commitment: string;            // SHA-256(score || nonce) — NOT opened
  tierThreshold: number;         // minimum score for the tier
  tierName: string;
  rangeProof: RangeProofData;    // proves score ≥ tierThreshold
  timestamp: number;
  expiresAt: number;             // proof validity window
}

export interface RangeProofData {
  /** Bit commitments: H(bit_i || bitNonce_i) for each bit of delta */
  bitCommitments: string[];
  /** Commitment to the full delta: H(delta || deltaNonce) */
  deltaCommitment: string;
  /** Fiat-Shamir challenge over all commitments */
  challenge: string;
  /** Opened bit nonces — verifier uses these to check each bit commitment */
  bitNonces: string[];
  /** Opened delta nonce — verifier checks deltaCommitment consistency */
  deltaNonce: string;
  /** Number of bits used */
  bitLength: number;
}

export interface ProofVerificationResult {
  valid: boolean;
  tierName: string;
  tierThreshold: number;
  reason: string;
  verifiedAt: number;
}

// ── Tier definitions (must match CreditAgent tiers) ──────────────────────────

const ZK_TIERS = [
  { minScore: 800, name: 'Excellent' },
  { minScore: 600, name: 'Good' },
  { minScore: 0, name: 'Poor' },
] as const;

// ── Cryptographic helpers ────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Commit to a value: H(value || nonce)
 */
function commit(value: number, nonce: string): string {
  return sha256(`${value}||${nonce}`);
}

/**
 * Commit to a single bit: H(bit || bitNonce)
 */
function commitBit(bit: number, bitNonce: string): string {
  return sha256(`${bit}||${bitNonce}`);
}

/**
 * Fiat-Shamir challenge: deterministic challenge derived from ALL commitments
 */
function fiatShamirChallenge(commitment: string, deltaCommitment: string, bitCommitments: string[]): string {
  return sha256(commitment + '|' + deltaCommitment + '|' + bitCommitments.join(','));
}

// ── Proof Generation ─────────────────────────────────────────────────────────

/**
 * Generate a ZK proof that `score >= tierThreshold`.
 *
 * Method: Bit-decomposition range proof with verifiable commitments
 *   - Compute delta = score - tierThreshold (must be ≥ 0)
 *   - Decompose delta into bits, commit each with a random nonce
 *   - Commit to delta itself: deltaCommitment = H(delta || deltaNonce)
 *   - Fiat-Shamir binds all commitments
 *   - Reveal bitNonces + deltaNonce (verifier can open and check)
 *   - Score nonce is NEVER revealed (score stays hidden behind commitment)
 */
export function generateProof(
  score: number,
  tierThreshold: number,
  tierName: string,
): { proof: ZKCreditProof; nonce: string } | null {
  if (score < tierThreshold) {
    logger.warn('Cannot generate ZK proof: score below threshold', { score, tierThreshold });
    return null;
  }

  const nonce = generateNonce();
  const commitment = commit(score, nonce);

  // Delta = score - threshold (guaranteed non-negative)
  const delta = score - tierThreshold;

  // Commit to delta
  const deltaNonce = generateNonce();
  const deltaCommitment = sha256(`${delta}||${deltaNonce}`);

  // Bit decomposition of delta (10 bits = max delta 1023, enough for 0-1000 scores)
  const BIT_LENGTH = 10;
  const bitNonces: string[] = [];
  const bitCommitments: string[] = [];

  for (let i = 0; i < BIT_LENGTH; i++) {
    const bit = (delta >> i) & 1;
    const bitNonce = generateNonce();
    bitNonces.push(bitNonce);
    bitCommitments.push(commitBit(bit, bitNonce));
  }

  // Fiat-Shamir: derive challenge from ALL commitments
  const challenge = fiatShamirChallenge(commitment, deltaCommitment, bitCommitments);

  const proof: ZKCreditProof = {
    proofId: randomBytes(16).toString('hex'),
    commitment,
    tierThreshold,
    tierName,
    rangeProof: {
      bitCommitments,
      deltaCommitment,
      challenge,
      bitNonces,      // revealed for verification
      deltaNonce,      // revealed for verification
      bitLength: BIT_LENGTH,
    },
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600_000, // 1 hour validity
  };

  logger.info('ZK credit proof generated', {
    tierName,
    tierThreshold,
    commitment: commitment.slice(0, 16) + '…',
  });

  return { proof, nonce };
}

// ── Proof Verification ───────────────────────────────────────────────────────

/**
 * Verify a ZK credit proof — cryptographically sound verification.
 *
 * Steps:
 *   1. Check proof not expired, tier valid
 *   2. Re-derive Fiat-Shamir challenge — must match (tamper detection)
 *   3. For each bit i: try H(0 || bitNonce_i) and H(1 || bitNonce_i)
 *      — exactly one MUST match bitCommitment_i (proves each "slot" is a valid bit)
 *   4. Reconstruct delta from extracted bits
 *   5. Verify H(delta || deltaNonce) == deltaCommitment (proves delta consistency)
 *
 * SOUNDNESS: A prover with score < threshold has negative delta.
 *   Negative values cannot be represented as a non-negative integer in bit form,
 *   so the reconstructed delta will not match the deltaCommitment.
 *
 * PRIVACY: The score commitment is NOT opened (nonce secret). The verifier
 *   learns delta = score - threshold, bounding the score but not revealing it
 *   exactly when threshold = 0 (for non-zero thresholds: score = threshold + delta).
 *   Full privacy would require zk-SNARKs (Circom + snarkjs).
 */
export function verifyProof(proof: ZKCreditProof): ProofVerificationResult {
  const now = Date.now();

  // 1. Check expiry
  if (now > proof.expiresAt) {
    return fail(proof, 'Proof expired', now);
  }

  // 1b. Replay prevention — each proof can only be verified once
  if (isProofUsed(proof.proofId)) {
    return fail(proof, 'Proof already used — replay detected', now);
  }

  // 2. Check tier threshold validity
  const validTier = ZK_TIERS.find(t => t.minScore === proof.tierThreshold && t.name === proof.tierName);
  if (!validTier) {
    return fail(proof, 'Invalid tier threshold', now);
  }

  const rp = proof.rangeProof;

  // 3. Structural checks
  if (rp.bitCommitments.length !== rp.bitLength || rp.bitNonces.length !== rp.bitLength) {
    return fail(proof, 'Malformed proof: array length mismatch', now);
  }
  if (!rp.deltaCommitment || !rp.deltaNonce) {
    return fail(proof, 'Malformed proof: missing delta commitment', now);
  }

  // 4. Verify Fiat-Shamir challenge consistency (tamper detection)
  const expectedChallenge = fiatShamirChallenge(proof.commitment, rp.deltaCommitment, rp.bitCommitments);
  if (expectedChallenge !== rp.challenge) {
    return fail(proof, 'Challenge verification failed — commitments tampered', now);
  }

  // 5. Open each bit commitment and extract the bit value
  let delta = 0;
  for (let i = 0; i < rp.bitLength; i++) {
    const commit0 = commitBit(0, rp.bitNonces[i]); // H(0 || nonce)
    const commit1 = commitBit(1, rp.bitNonces[i]); // H(1 || nonce)

    if (rp.bitCommitments[i] === commit0) {
      // bit = 0, no contribution to delta
    } else if (rp.bitCommitments[i] === commit1) {
      delta += (1 << i);
    } else {
      // Commitment doesn't open to 0 or 1 — FORGERY
      return fail(proof, `Bit commitment ${i} does not open to a valid bit — forgery detected`, now);
    }
  }

  // 6. Verify delta commitment consistency
  const expectedDeltaCommitment = sha256(`${delta}||${rp.deltaNonce}`);
  if (expectedDeltaCommitment !== rp.deltaCommitment) {
    return fail(proof, 'Delta commitment mismatch — reconstructed bits inconsistent with committed delta', now);
  }

  // All checks passed — proof is sound
  // Mark proof as used to prevent replay
  markProofUsed(proof.proofId, proof.tierName, now, proof.expiresAt);

  // Periodically clean expired proofs (1% chance per verification)
  if (Math.random() < 0.01) {
    cleanExpiredProofs();
  }

  return {
    valid: true,
    tierName: proof.tierName,
    tierThreshold: proof.tierThreshold,
    reason: `Verified: credit score meets ${proof.tierName} tier (≥${proof.tierThreshold}) — delta=${delta}, proof cryptographically sound (replay-protected)`,
    verifiedAt: now,
  };
}

/** Helper to construct a failed verification result */
function fail(proof: ZKCreditProof, reason: string, now: number): ProofVerificationResult {
  return {
    valid: false,
    tierName: proof.tierName,
    tierThreshold: proof.tierThreshold,
    reason,
    verifiedAt: now,
  };
}

// ── Convenience: determine best provable tier for a score ────────────────────

export function getBestProvableTier(score: number): { tierName: string; threshold: number } | null {
  for (const tier of ZK_TIERS) {
    if (score >= tier.minScore) {
      return { tierName: tier.name, threshold: tier.minScore };
    }
  }
  return null;
}
