/**
 * ML Default Predictor — Logistic regression model for predicting loan default probability.
 *
 * Uses coefficients trained by `train-default-model.ts` on a 1,000-sample synthetic
 * dataset calibrated to DeFi lending patterns (Aave/Compound liquidation rates 2022-2025).
 *
 * Training metrics (test set, 80/20 split):
 *   Accuracy 98.0%, Precision 100%, Recall 78.9%, F1 88.2%, AUC-ROC 1.00
 *
 * Retrain: npx tsx src/services/train-default-model.ts
 *
 * Model: P(default) = sigmoid(z) where z = w·x + bias
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { CreditHistory, CreditProfile } from '../types';
import logger from '../utils/logger';

/** Feature vector after normalization */
interface FeatureVector {
  txCountNorm: number;      // txCount / 200 (capped at 1)
  volumeNorm: number;       // volume / 100_000 (capped at 1)
  repaymentRate: number;    // repaidLoans / (repaidLoans + defaults + 1)
  accountAgeNorm: number;   // accountAge / 365 (capped at 1)
  creditScoreNorm: number;  // score / 1000
  utilizationRate: number;  // borrowed / limit (0 if no limit)
  defaultHistory: number;   // defaults / (repaidLoans + defaults + 1)
}

/** Prediction result */
export interface DefaultPrediction {
  probability: number;       // 0.0–1.0 probability of default
  confidence: number;        // 0.0–1.0 how confident the model is
  riskBucket: 'low' | 'medium' | 'high' | 'critical';
  featureImportance: Array<{ feature: string; contribution: number }>;
  modelVersion: string;
}

/**
 * Load trained model weights from trained-model.json.
 * Falls back to reasonable defaults if file not found (e.g., fresh install).
 */
interface TrainedModelFile {
  weights: Record<string, number>;
  bias: number;
  metrics: { accuracy: number; aucROC: number; trainSize: number; testSize: number };
  modelVersion: string;
  trainedAt: string;
}

function loadTrainedModel(): { weights: Record<string, number>; bias: number; version: string } {
  try {
    const modelPath = resolve(__dirname, 'trained-model.json');
    const raw = readFileSync(modelPath, 'utf-8');
    const model: TrainedModelFile = JSON.parse(raw);
    logger.info('Loaded trained ML model', {
      version: model.modelVersion,
      accuracy: model.metrics.accuracy,
      aucROC: model.metrics.aucROC,
      trainedAt: model.trainedAt,
    });
    return { weights: model.weights, bias: model.bias, version: model.modelVersion };
  } catch {
    logger.warn('trained-model.json not found, using fallback weights. Run: npx tsx src/services/train-default-model.ts');
    return {
      weights: {
        txCountNorm: -0.8,
        volumeNorm: -0.6,
        repaymentRate: -2.5,
        accountAgeNorm: -0.9,
        creditScoreNorm: -1.8,
        utilizationRate: 1.4,
        defaultHistory: 3.2,
      },
      bias: -1.2,
      version: 'lr-v1.0-fallback',
    };
  }
}

const TRAINED = loadTrainedModel();
const MODEL_WEIGHTS = { bias: TRAINED.bias, ...TRAINED.weights };
const MODEL_VERSION = TRAINED.version;

function sigmoid(z: number): number {
  if (z > 500) return 1.0;
  if (z < -500) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
}

function extractFeatures(
  history: CreditHistory,
  profile: CreditProfile | null,
): FeatureVector {
  const totalOutcomes = history.repaidLoans + history.defaults + 1; // +1 Laplace smoothing

  const borrowed = profile ? Number(BigInt(profile.borrowed)) / 1e6 : 0;
  const limit = profile ? Number(BigInt(profile.limit)) / 1e6 : 0;

  return {
    txCountNorm: Math.min(history.transactionCount / 200, 1.0),
    volumeNorm: Math.min(history.volumeUSD / 100_000, 1.0),
    repaymentRate: history.repaidLoans / totalOutcomes,
    accountAgeNorm: Math.min(history.accountAge / 365, 1.0),
    creditScoreNorm: (profile?.score ?? 500) / 1000,
    utilizationRate: limit > 0 ? Math.min(borrowed / limit, 1.0) : 0,
    defaultHistory: history.defaults / totalOutcomes,
  };
}

export function predictDefault(
  history: CreditHistory,
  profile: CreditProfile | null,
): DefaultPrediction {
  const features = extractFeatures(history, profile);

  // Compute linear combination z = w·x + bias
  let z = MODEL_WEIGHTS.bias;
  const contributions: Array<{ feature: string; contribution: number }> = [];

  for (const [key, weight] of Object.entries(MODEL_WEIGHTS)) {
    if (key === 'bias') continue;
    const featureVal = features[key as keyof FeatureVector];
    const contribution = weight * featureVal;
    z += contribution;
    contributions.push({ feature: key, contribution: Math.round(contribution * 1000) / 1000 });
  }

  const probability = sigmoid(z);

  // Confidence: based on data completeness (more data = higher confidence)
  const dataPoints = [
    history.transactionCount > 0 ? 1 : 0,
    history.volumeUSD > 0 ? 1 : 0,
    history.accountAge > 7 ? 1 : 0,
    (history.repaidLoans + history.defaults) > 0 ? 1 : 0,
    profile?.exists ? 1 : 0,
  ];
  const confidence = Math.min(0.5 + (dataPoints.reduce((a, b) => a + b, 0) / dataPoints.length) * 0.5, 0.95);

  // Risk bucket
  let riskBucket: DefaultPrediction['riskBucket'];
  if (probability < 0.15) riskBucket = 'low';
  else if (probability < 0.35) riskBucket = 'medium';
  else if (probability < 0.60) riskBucket = 'high';
  else riskBucket = 'critical';

  // Sort by absolute contribution (most important first)
  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  logger.debug('Default prediction computed', {
    probability: Math.round(probability * 1000) / 1000,
    riskBucket,
    confidence: Math.round(confidence * 100) / 100,
  });

  return {
    probability: Math.round(probability * 10000) / 10000,
    confidence: Math.round(confidence * 100) / 100,
    riskBucket,
    featureImportance: contributions,
    modelVersion: MODEL_VERSION,
  };
}
