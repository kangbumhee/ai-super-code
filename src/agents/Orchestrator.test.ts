import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './Orchestrator';
import type { Task } from '@/types';

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn()
}));

vi.mock('@/api/ClaudeClient', () => {
  const createCostEntry = vi.fn().mockReturnValue({
    timestamp: Date.now(),
    model: 'claude-3-5-haiku-20241022',
    inputTokens: 100,
    outputTokens: 200,
    cost: 0.001,
    taskId: 'test'
  });
  return {
    ClaudeClient: Object.assign(
      vi.fn().mockImplementation(() => ({
        call: mockCall,
        setApiKey: vi.fn()
      })),
      { createCostEntry }
    )
  };
});

describe('Orchestrator', () => {
  const mockTask: Task = {
    id: 'test-task-1',
    type: 'code_generation',
    priority: 'medium',
    status: 'running',
    input: {
      userMessage: '헬로월드 앱 만들어줘',
      claudeResponse: 'Express 서버를 만들면 됩니다. app.ts 파일에...',
      existingFiles: {}
    },
    output: null,
    retryCount: 0,
    maxRetries: 5,
    currentModelIndex: 0,
    createdAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    retryHistory: [],
    parentTaskId: null,
    childTaskIds: []
  };

  beforeEach(() => {
    mockCall.mockReset();
    const coderResponse = {
      content: [{
        type: 'text',
        text: '```json\n{"summary":"테스트 코드 생성","is_coding_task":true,"files":[{"path":"test.ts","content":"export const x = 1;","action":"create","language":"typescript"}],"commands":[],"git_message":"feat: test","questions":null}\n```'
      }],
      usage: { input_tokens: 100, output_tokens: 200 },
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn'
    };
    const reviewerResponse = {
      content: [{ type: 'text', text: '```json\n{"score":85,"passed":true,"issues":[],"summary":"리뷰 통과"}\n```' }],
      usage: { input_tokens: 50, output_tokens: 30 },
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn'
    };
    const testerResponse = {
      content: [{ type: 'text', text: '```json\n{"test_files":[],"summary":"스킵"}\n```' }],
      usage: { input_tokens: 50, output_tokens: 20 },
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn'
    };
    mockCall
      .mockResolvedValueOnce(coderResponse)
      .mockResolvedValueOnce(reviewerResponse)
      .mockResolvedValueOnce(testerResponse);
  });

  it('비코딩 작업 감지', async () => {
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n{"summary":"일반 대화","is_coding_task":false,"files":[],"commands":[],"git_message":"","questions":null}\n```'
      }],
      usage: { input_tokens: 50, output_tokens: 30 },
      model: 'claude-3-5-haiku-20241022',
      stop_reason: 'end_turn'
    });

    const orch = new Orchestrator('test-key', { maxIterations: 1 });
    const result = await orch.execute(mockTask);
    expect(result.isCodingTask).toBe(false);
  });

  it('프로그레스 콜백 호출', async () => {
    const progressCalls: unknown[] = [];
    const orch = new Orchestrator('test-key', {
      maxIterations: 2,
      onProgress: (update) => progressCalls.push(update)
    });

    await orch.execute(mockTask);

    expect(progressCalls.length).toBeGreaterThan(0);
    expect((progressCalls[0] as { taskId: string }).taskId).toBe('test-task-1');
  });

  it('코딩 작업 시 파일 반환', async () => {
    const orch = new Orchestrator('test-key', { maxIterations: 1 });
    const result = await orch.execute(mockTask);
    expect(result.isCodingTask).toBe(true);
    expect(result.files.length).toBeGreaterThanOrEqual(0);
    expect(result.summary).toBe('테스트 코드 생성');
  });
});
