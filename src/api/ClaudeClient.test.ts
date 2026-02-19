/**
 * ClaudeClient 테스트
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeClient } from './ClaudeClient';
import { MODEL_TIERS } from '@/types';

describe('ClaudeClient', () => {

  beforeEach(() => {
    // Reset fetch mock if needed in future
  });

  it('비용 계산이 정확해야 함', () => {
    const tier = MODEL_TIERS[0]; // Haiku 3.5: $0.25/$1.25
    const cost = ClaudeClient.calculateCost(1_000_000, 1_000_000, tier);
    expect(cost).toBe(0.25 + 1.25);
  });

  it('Sonnet 비용 계산', () => {
    const tier = MODEL_TIERS[2]; // Sonnet: $3/$15
    const cost = ClaudeClient.calculateCost(500_000, 200_000, tier);
    expect(cost).toBeCloseTo(1.5 + 3.0, 2);
  });

  it('모델 티어 찾기', () => {
    const tier = ClaudeClient.getModelTier('claude-haiku-4-5');
    expect(tier).toBeDefined();
    expect(tier?.name).toBe('Haiku 4.5');
  });

  it('존재하지 않는 모델은 기본(첫 번째) 티어 반환', () => {
    const tier = ClaudeClient.getModelTier('nonexistent');
    expect(tier).toBeDefined();
    expect(tier?.id).toBe(MODEL_TIERS[0].id);
  });

  it('API 키 없으면 에러', async () => {
    const client = new ClaudeClient('');
    await expect(
      client.call({
        model: 'test',
        system: 'Test',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow('API key is not set');
  });

  it('CostEntry 생성', () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn'
    };
    const entry = ClaudeClient.createCostEntry(mockResponse, 'claude-haiku-4-5', 'task-123');
    expect(entry.taskId).toBe('task-123');
    expect(entry.inputTokens).toBe(100);
    expect(entry.outputTokens).toBe(50);
    expect(entry.cost).toBeGreaterThan(0);
  });
});
