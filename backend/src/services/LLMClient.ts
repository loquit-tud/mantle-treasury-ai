/**
 * LLMClient — failover wrapper over OpenAI-compatible providers
 *
 * Tries the primary provider first. On 429 / 5xx / timeout, switches to
 * the fallback provider for the remainder of a cooldown window (~60 s).
 * If neither is configured, all calls throw so callers use their existing
 * deterministic fallbacks.
 */

import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import logger from '../utils/logger';

export interface LLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  name: string;       // Human label for logs (e.g. "groq", "openai")
}

export class LLMClient {
  private primary: { client: OpenAI; model: string; name: string } | null;
  private fallback: { client: OpenAI; model: string; name: string } | null;

  /** Timestamp until which primary is skipped (after a 429) */
  private primaryCooldownUntil = 0;
  private static readonly COOLDOWN_MS = 60_000; // 1 min

  constructor(primary?: LLMProviderConfig, fallback?: LLMProviderConfig) {
    this.primary = primary?.apiKey
      ? {
          client: new OpenAI({
            apiKey: primary.apiKey,
            ...(primary.baseUrl ? { baseURL: primary.baseUrl } : {}),
          }),
          model: primary.model,
          name: primary.name,
        }
      : null;

    this.fallback = fallback?.apiKey
      ? {
          client: new OpenAI({
            apiKey: fallback.apiKey,
            ...(fallback.baseUrl ? { baseURL: fallback.baseUrl } : {}),
          }),
          model: fallback.model,
          name: fallback.name,
        }
      : null;
  }

  /**
   * Make a chat completion request with automatic failover.
   * Callers pass everything EXCEPT `model` — the wrapper injects it.
   */
  async chat(
    params: Omit<ChatCompletionCreateParamsNonStreaming, 'model'>,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const now = Date.now();
    const usePrimaryFirst = this.primary && now >= this.primaryCooldownUntil;

    // Order: primary first (unless cooling down), then fallback
    const providers = usePrimaryFirst
      ? [this.primary!, this.fallback].filter(Boolean) as typeof this.primary[]
      : [this.fallback, this.primary].filter(Boolean) as typeof this.primary[];

    if (providers.length === 0) {
      throw new Error('No LLM providers configured');
    }

    let lastError: unknown;

    for (const provider of providers) {
      if (!provider) continue;
      try {
        const response = await provider.client.chat.completions.create({
          ...params,
          model: provider.model,
        } as ChatCompletionCreateParamsNonStreaming);

        return response;
      } catch (err: unknown) {
        lastError = err;
        const status = (err as { status?: number }).status;

        if (status === 429 || (status && status >= 500)) {
          logger.warn(`LLM provider "${provider.name}" error ${status}, trying next`, {
            provider: provider.name,
            status,
          });

          // If primary failed, put it on cooldown
          if (provider === this.primary) {
            this.primaryCooldownUntil = Date.now() + LLMClient.COOLDOWN_MS;
          }
          continue;
        }

        // Non-retryable error — throw immediately
        throw err;
      }
    }

    // All providers failed
    throw lastError;
  }

  /** Quick check: is at least one provider configured? */
  get isConfigured(): boolean {
    return this.primary !== null || this.fallback !== null;
  }
}
