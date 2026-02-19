/**
 * TaskQueue — 브리핑 §7 기준
 */
import { StorageManager } from '@/storage/StorageManager';
import type { Task, TaskInput, TaskType, TaskPriority } from '@/types';
import { MODEL_TIERS } from '@/types';

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class TaskQueue {
  private maxConcurrent: number;
  private runningCount = 0;
  private onTaskReady: ((task: Task) => Promise<void>) | null = null;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /** 실행 콜백 등록 */
  onReady(callback: (task: Task) => Promise<void>): void {
    this.onTaskReady = callback;
  }

  /** 새 태스크 생성 & 저장 */
  async enqueue(
    input: TaskInput,
    options?: {
      type?: TaskType;
      priority?: TaskPriority;
      maxRetries?: number;
      modelIndex?: number;
      parentTaskId?: string | null;
    }
  ): Promise<Task> {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: options?.type || 'code_generation',
      priority: options?.priority || 'medium',
      status: 'pending',
      input,
      output: null,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 5,
      currentModelIndex: options?.modelIndex ?? 0,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      retryHistory: [],
      parentTaskId: options?.parentTaskId ?? null,
      childTaskIds: [],
    };
    await StorageManager.addTask(task);
    return task;
  }

  /** 우선순위 순으로 다음 태스크 꺼냄 */
  async dequeue(): Promise<Task | null> {
    if (this.runningCount >= this.maxConcurrent) return null;

    const tasks = await StorageManager.getTasks();
    const candidates = tasks
      .filter((t) => t.status === 'pending' || t.status === 'queued')
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 2;
        const pb = PRIORITY_ORDER[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return a.createdAt - b.createdAt;
      });

    if (candidates.length === 0) return null;

    const task = candidates[0];
    this.runningCount++;
    await StorageManager.updateTask(task.id, {
      status: 'running',
      startedAt: Date.now(),
    });
    return { ...task, status: 'running', startedAt: Date.now() };
  }

  /** 상태 업데이트 */
  async updateStatus(
    taskId: string,
    status: Task['status'],
    details?: Partial<Task>
  ): Promise<void> {
    const updates: Partial<Task> = { status, ...details };
    if (status === 'completed' || status === 'failed') {
      updates.completedAt = Date.now();
      this.runningCount = Math.max(0, this.runningCount - 1);
    }
    await StorageManager.updateTask(taskId, updates);
  }

  /** 재시도 (모델 업그레이드 포함) */
  async retry(
    taskId: string,
    error: string,
    upgradeModel = true
  ): Promise<void> {
    this.runningCount = Math.max(0, this.runningCount - 1);

    const tasks = await StorageManager.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.retryCount >= task.maxRetries) {
      await StorageManager.updateTask(taskId, {
        status: 'failed',
        error,
        completedAt: Date.now(),
      });
      return;
    }

    let newModelIndex = task.currentModelIndex;
    if (upgradeModel && newModelIndex < 3) {
      newModelIndex++;
    }

    const retryEntry = {
      attempt: task.retryCount + 1,
      model: MODEL_TIERS[Math.min(task.currentModelIndex, MODEL_TIERS.length - 1)].id,
      error,
      timestamp: Date.now(),
    };

    await StorageManager.updateTask(taskId, {
      status: 'pending',
      retryCount: task.retryCount + 1,
      currentModelIndex: newModelIndex,
      retryHistory: [...task.retryHistory, retryEntry],
      startedAt: null,
      completedAt: null,
      error: null,
    });
  }

  /** 취소 */
  async cancel(taskId: string): Promise<void> {
    this.runningCount = Math.max(0, this.runningCount - 1);
    await StorageManager.updateTask(taskId, {
      status: 'skipped',
      error: '사용자 취소',
      completedAt: Date.now(),
    });
  }

  /** 슬롯 반환 (수동 모드에서 실행 스킵 시) */
  async release(taskId: string): Promise<void> {
    this.runningCount = Math.max(0, this.runningCount - 1);
    await StorageManager.updateTask(taskId, { status: 'pending' });
  }

  /** 서브태스크 생성 */
  async createSubTask(
    parentId: string,
    input: TaskInput,
    type: TaskType
  ): Promise<Task> {
    const sub = await this.enqueue(input, { type, parentTaskId: parentId });

    const tasks = await StorageManager.getTasks();
    const parent = tasks.find((t) => t.id === parentId);
    if (parent) {
      await StorageManager.updateTask(parentId, {
        childTaskIds: [...parent.childTaskIds, sub.id],
      });
    }

    return sub;
  }

  /** 대기 큐 처리 */
  async processQueue(): Promise<void> {
    if (!this.onTaskReady) return;

    let task = await this.dequeue();
    while (task) {
      try {
        await this.onTaskReady(task);
      } catch (err) {
        await this.retry(
          task.id,
          err instanceof Error ? err.message : String(err)
        );
      }
      task = await this.dequeue();
    }
  }

  /** 통계 */
  async getStats(): Promise<{
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  }> {
    const tasks = await StorageManager.getTasks();
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending' || t.status === 'queued').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
    };
  }

  /** 우선순위 변경 */
  async reorderTask(taskId: string, newPriority: TaskPriority): Promise<void> {
    await StorageManager.updateTask(taskId, { priority: newPriority });
  }
}
