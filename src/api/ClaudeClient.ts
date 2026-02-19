/**
 * ClaudeClient — Anthropic API 호출
 * 브리핑 §6 기준
 */
import type { ModelTier, CostEntry } from '@/types';
import { MODEL_TIERS } from '@/types';

interface CallOptions {
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
}

interface ApiResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export class ClaudeClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * API 호출 (재시도 포함)
   */
  async call(options: CallOptions, maxRetries = 3): Promise<ApiResponse> {
    if (!this.apiKey) throw new Error('API key is not set');

    const body = {
      model: options.model,
      max_tokens: options.maxTokens || 8000,
      system: options.system,
      messages: options.messages,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        });

        if (res.status === 401 || res.status === 400) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            `API Error ${res.status}: ${(errBody as { error?: { message?: string } }).error?.message || res.statusText}`
          );
        }

        if (res.status === 429 || res.status === 529 || res.status >= 500) {
          const wait = Math.min(60000, 1000 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, wait));
          lastError = new Error(`API Error ${res.status}`);
          continue;
        }

        if (!res.ok) {
          throw new Error(`API Error ${res.status}: ${res.statusText}`);
        }

        const data = (await res.json()) as ApiResponse;
        return data;
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message.includes('401') || err.message.includes('400'))
        ) {
          throw err; // 401/400은 재시도 없이 즉시 throw
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const wait = Math.min(60000, 1000 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }

    throw lastError || new Error('API call failed after retries');
  }

  /**
   * 비용 계산
   */
  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    model: ModelTier
  ): number {
    return (
      (inputTokens / 1_000_000) * model.inputPer1M +
      (outputTokens / 1_000_000) * model.outputPer1M
    );
  }

  static getModelTier(modelId: string): ModelTier {
    return (
      MODEL_TIERS.find((m) => m.id === modelId) || MODEL_TIERS[0]
    );
  }

  /**
   * CostEntry 생성
   */
  static createCostEntry(
    response: ApiResponse,
    modelId: string,
    taskId: string
  ): CostEntry {
    const tier = ClaudeClient.getModelTier(modelId);
    const cost = ClaudeClient.calculateCost(
      response.usage.input_tokens,
      response.usage.output_tokens,
      tier
    );
    return {
      timestamp: Date.now(),
      model: modelId,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cost,
      taskId,
    };
  }

  /**
   * 연결 테스트
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.call(
        {
          model: MODEL_TIERS[0].id,
          system: 'Reply OK.',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 16,
        },
        0 // 재시도 없음
      );
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
