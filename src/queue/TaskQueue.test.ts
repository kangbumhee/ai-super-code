import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskQueue } from './TaskQueue';
import { StorageManager } from '@/storage/StorageManager';

// StorageManager 모킹
vi.mock('@/storage/StorageManager', () => {
  let tasks: any[] = [];
  return {
    StorageManager: {
      getTasks: vi.fn(() => Promise.resolve([...tasks])),
      saveTasks: vi.fn((t: any[]) => { tasks = t; return Promise.resolve(); }),
      addTask: vi.fn((task: any) => { tasks.push(task); return Promise.resolve(); }),
      updateTask: vi.fn((id: string, updates: any) => {
        const idx = tasks.findIndex((t: any) => t.id === id);
        if (idx === -1) return Promise.resolve(null);
        tasks[idx] = { ...tasks[idx], ...updates };
        return Promise.resolve(tasks[idx]);
      }),
      _reset: () => { tasks = []; }
    }
  };
});

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(3);
    (StorageManager as any)._reset?.();
    vi.clearAllMocks();
  });

  it('태스크 생성 시 올바른 기본값', async () => {
    const task = await queue.enqueue({
      userMessage: '테스트',
      claudeResponse: '응답',
      existingFiles: {}
    });

    expect(task.id).toMatch(/^task_/);
    expect(task.status).toBe('pending');
    expect(task.type).toBe('code_generation');
    expect(task.priority).toBe('medium');
    expect(task.retryCount).toBe(0);
    expect(task.maxRetries).toBe(5);
  });

  it('우선순위 기반 정렬', async () => {
    await queue.enqueue(
      { userMessage: 'low', claudeResponse: '', existingFiles: {} },
      { priority: 'low' }
    );
    await queue.enqueue(
      { userMessage: 'critical', claudeResponse: '', existingFiles: {} },
      { priority: 'critical' }
    );
    await queue.enqueue(
      { userMessage: 'high', claudeResponse: '', existingFiles: {} },
      { priority: 'high' }
    );

    const first = await queue.dequeue();
    expect(first?.input.userMessage).toBe('critical');
  });

  it('동시 실행 제한', async () => {
    const smallQueue = new TaskQueue(1);

    await smallQueue.enqueue({ userMessage: 'a', claudeResponse: '', existingFiles: {} });
    await smallQueue.enqueue({ userMessage: 'b', claudeResponse: '', existingFiles: {} });

    const first = await smallQueue.dequeue();
    expect(first).not.toBeNull();

    const second = await smallQueue.dequeue();
    expect(second).toBeNull(); // 제한 초과
  });

  it('재시도 시 모델 업그레이드', async () => {
    const task = await queue.enqueue(
      { userMessage: 'test', claudeResponse: '', existingFiles: {} },
      { modelIndex: 0 }
    );

    // 실행 상태로 변경
    await queue.dequeue();

    await queue.retry(task.id, '에러 발생', true);
    const tasks = await StorageManager.getTasks();
    const updated = tasks.find((t) => t.id === task.id);
    expect(updated?.currentModelIndex).toBe(1);
    expect(updated?.retryCount).toBe(1);
    expect(updated?.status).toBe('pending');
  });

  it('최대 재시도 초과 시 실패', async () => {
    const task = await queue.enqueue(
      { userMessage: 'test', claudeResponse: '', existingFiles: {} },
      { maxRetries: 1, modelIndex: 0 }
    );

    await queue.dequeue();
    await queue.retry(task.id, '첫 에러');

    // 재시도 1회 소진, 다시 dequeue + retry
    await queue.dequeue();
    await queue.retry(task.id, '두번째 에러');
    const tasks = await StorageManager.getTasks();
    const failed = tasks.find((t) => t.id === task.id);
    expect(failed?.status).toBe('failed');
  });

  it('큐 통계', async () => {
    await queue.enqueue({ userMessage: 'a', claudeResponse: '', existingFiles: {} });
    await queue.enqueue({ userMessage: 'b', claudeResponse: '', existingFiles: {} });
    await queue.dequeue(); // 1개 running

    const stats = await queue.getStats();
    expect(stats.total).toBe(2);
    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
  });
});
